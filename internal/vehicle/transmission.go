package vehicle

import "math"

// Beta powertrain. Model geometry is half scale: 1 world unit = 2 metres.
// Acceleration is in world units/s²; torque, drag and speed are computed in SI.
const WorldMetres = 2.0
const TransmissionIdle = 1800.0
const TransmissionRedline = 7500.0
const TransmissionMass = 1200.0
const TransmissionWheelRadius = .31
const TransmissionFinalDrive = 3.6
const TransmissionReverseRatio = 3.1
const TransmissionReverseSpeed = 10.0 // m/s, a separate low-speed reverse range

// Five forward gears for every beta car; -1 is the persistent reverse range.
var GearRatios = [...]float64{3.2, 2.13, 1.52, 1.16, .86}

type Transmission struct {
	Gear                                 int
	RPM, Shift, Hold, Accel, Load, Brake float64
}

func AdvanceTransmission(t Transmission, dt, worldSpeed, throttle, speedFactor float64, handbrake bool, groundWorldSpeed ...float64) Transmission {
	dt = Clamp(dt, 0, .05)
	throttle = Clamp(throttle, -1, 1)
	speed := worldSpeed * WorldMetres
	groundSpeed := math.Abs(speed)
	if len(groundWorldSpeed) > 0 {
		groundSpeed = math.Max(groundSpeed, math.Abs(groundWorldSpeed[0])*WorldMetres)
	}
	t.Brake = 0
	if t.Gear == 0 || t.Gear < -1 || t.Gear > len(GearRatios) {
		t.Gear = 1
	}
	t.Hold += dt
	t.Shift = math.Max(0, t.Shift-dt)
	direction := 1.0
	if t.Gear == -1 {
		direction = -1
	}
	requested := 0.0
	if math.Abs(throttle) > .05 {
		requested = math.Copysign(1, throttle)
	}
	// A direction change brakes first. Rollback on a hill does not select R:
	// the driver's selected range, rather than velocity noise, controls torque.
	braking := requested != 0 && requested != direction
	if groundSpeed < .35 {
		if requested != 0 && requested != direction {
			direction = requested
			t.Gear = int(direction)
			t.Shift, t.Hold = 0, 0
			braking = false
		} else if t.Gear > 1 {
			// A stop must launch in first immediately, including after a collision.
			t.Gear, t.Shift, t.Hold = 1, 0, 0
		}
	}
	t.Load = math.Abs(throttle)
	if braking || requested == 0 || handbrake {
		t.Load = 0
	}
	ratioFor := func(gear int) float64 {
		if gear < 0 {
			return TransmissionReverseRatio * TransmissionFinalDrive
		}
		return GearRatios[gear-1] * TransmissionFinalDrive
	}
	wheelRPM := math.Abs(speed) / TransmissionWheelRadius * 60 / (2 * math.Pi)
	coupled := wheelRPM * ratioFor(t.Gear)
	if t.Gear > 0 && t.Shift == 0 && t.Hold > .65 {
		upAt := 3500 + 3300*t.Load
		downAt := 1700 + 2100*t.Load
		targetGear := t.Gear
		if coupled > upAt && t.Gear < len(GearRatios) && t.Load > .1 {
			targetGear++
		} else if coupled < downAt && t.Gear > 1 {
			// Select a usable lower gear, rather than crawling down one at a time.
			for g := t.Gear - 1; g >= 1; g-- {
				if wheelRPM*ratioFor(g) > 6200 {
					break
				}
				targetGear = g
			}
		}
		if targetGear != t.Gear {
			t.Gear, t.Shift, t.Hold = targetGear, .20, 0
		}
	}
	ratio := ratioFor(t.Gear)
	targetRPM := math.Max(TransmissionIdle, wheelRPM*ratio)
	if math.Abs(speed) < 5 && t.Load > .1 {
		targetRPM = math.Max(targetRPM, TransmissionIdle+2100*t.Load)
	}
	rate := 10.0
	if t.Shift > 0 {
		rate = 7
	}
	t.RPM = Clamp(Lerp(math.Max(t.RPM, TransmissionIdle), targetRPM, math.Min(1, dt*rate)), TransmissionIdle, TransmissionRedline)

	// Arcade club tune, shared by all cars: broad torque and finite traction.
	torque := 480 * (.68 + .32*math.Exp(-math.Pow((t.RPM-4700)/2300, 2)))
	force := direction * torque * ratio * .88 / TransmissionWheelRadius * t.Load
	if t.Gear < 0 {
		force *= Clamp((TransmissionReverseSpeed-math.Abs(speed))/1.5, 0, 1)
	}
	if t.Shift > 0 || t.RPM >= TransmissionRedline-25 {
		force = 0
	}
	grip := TransmissionMass * 8.0
	force = Clamp(force, -grip, grip) * Clamp(speedFactor, .15, 1)
	// Gravity belongs to the collision solver, so it must not be counted here.
	sign := 0.0
	if math.Abs(speed) > 1e-8 {
		sign = math.Copysign(1, speed)
	}
	accel := force/TransmissionMass - sign*(.15+.00038*speed*speed)
	if t.Load < .05 {
		accel -= sign * .55
	}
	// A downhill reverse must remain a low-speed range after torque fades.
	if t.Gear < 0 && speed < -TransmissionReverseSpeed {
		accel = math.Max(accel, math.Min(4, (-speed-TransmissionReverseSpeed)/math.Max(dt, .001)))
	}
	if braking || handbrake {
		deceleration := 12.0
		if handbrake {
			deceleration = 12
		}
		// Braking can stop the car, never kick it through zero on the next step.
		t.Brake = math.Min(deceleration, groundSpeed/math.Max(dt, .001)) / WorldMetres
		accel = -sign * math.Min(deceleration, math.Abs(speed)/math.Max(dt, .001))
	} else if t.Load < .05 && math.Abs(accel)*dt > math.Abs(speed) {
		accel = -speed / math.Max(dt, .001)
	}
	t.Accel = accel / WorldMetres
	return t
}

// Bicycle steering in world units, with a rate cap for the club's arcade tune.
// Unlike the ordinary arcade steering it can negotiate a tight corner at low
// speed without a speed-independent minimum turning radius.
func BetaSteering(previous, worldSpeed, steer, dt float64) float64 {
	target := worldSpeed * math.Tan(-Clamp(steer, -1, 1)*.65) / (2.56 / WorldMetres)
	target = Clamp(target, -3.8, 3.8)
	return Lerp(previous, target, 1-math.Exp(-8*Clamp(dt, 0, .05)))
}
