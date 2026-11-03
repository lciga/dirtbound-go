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
const TransmissionShiftTime = .14
const TransmissionLateralGrip = 64.0 // m/s²; scaled arcade roads need a generous cornering budget
const TransmissionMaxYaw = 3.2       // rad/s; keep full lock controllable at town speeds

const TransmissionHandbrakeSteerGrip = 48.0 // retain the previous handbrake yaw envelope

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
	// The sphere has no individual driven wheels. Use rolling road speed for
	// their estimate: a yaw/slip spike must not look like an instant wheel stop.
	rollingSpeed := math.Abs(speed)
	if t.Gear > 0 {
		rollingSpeed = math.Max(rollingSpeed, groundSpeed*.90)
	}
	wheelRPM := rollingSpeed / TransmissionWheelRadius * 60 / (2 * math.Pi)
	coupled := wheelRPM * ratioFor(t.Gear)
	sliding := groundSpeed > 6 && math.Abs(speed) < groundSpeed*.92
	if t.Gear > 0 && t.Shift == 0 && t.Hold > .65 && !sliding && !handbrake {
		upAt := 3500 + 3300*t.Load
		downAt := 1800 + 1300*t.Load
		targetGear := t.Gear
		if coupled > upAt && t.Gear < len(GearRatios) && t.Load > .1 {
			targetGear++
		} else if coupled < downAt && t.Gear > 1 {
			// Select a usable lower gear, rather than crawling down one at a time.
			for g := t.Gear - 1; g >= 1; g-- {
				// First is for launches and slow hairpins, not ordinary corners.
				if g == 1 && groundSpeed > 30/3.6 {
					break
				}
				if wheelRPM*ratioFor(g) > 4800 {
					break
				}
				targetGear = g
			}
		}
		if targetGear != t.Gear {
			t.Gear, t.Shift, t.Hold = targetGear, TransmissionShiftTime, 0
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
	// Half the shift opens the clutch; the remainder progressively reconnects.
	force *= Clamp(1-t.Shift/(TransmissionShiftTime*.5), 0, 1)
	if t.RPM >= TransmissionRedline-25 {
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
func BetaSteering(previous, worldSpeed, steer, dt float64, gripFactor ...float64) float64 {
	factor := 1.0
	if len(gripFactor) > 0 {
		factor = Clamp(gripFactor[0], .15, 1.5)
	}
	wheelbase := 2.56 / WorldMetres
	lateral := TransmissionLateralGrip / WorldMetres * factor * .85
	// Match the requested curvature to the tyre force budget. Without this,
	// full lock rotates the body 90° while its velocity still points straight.
	angle := math.Min(.65, math.Atan(lateral*wheelbase/math.Max(1, worldSpeed*worldSpeed)))
	target := worldSpeed * math.Tan(-Clamp(steer, -1, 1)*angle) / wheelbase
	target = Clamp(target, -TransmissionMaxYaw, TransmissionMaxYaw)
	return Lerp(previous, target, 1-math.Exp(-8*Clamp(dt, 0, .05)))
}

// BetaTyreVelocity turns road-plane momentum towards the car's rolling axis.
// A lateral constraint provides centripetal force, not a brake: projecting out
// sideways velocity each step otherwise throws away speed even below the grip
// limit. Rotation keeps the existing kinetic energy and bounds the actual
// velocity change by the tyre force budget. Drive, drag and braking run first.
// The collision adapter separately preserves road-normal velocity.
func BetaTyreVelocity(longitudinal, lateral, dt, gripFactor float64, handbrake bool) (float64, float64) {
	speed := math.Hypot(longitudinal, lateral)
	if speed < 1e-8 {
		return longitudinal, lateral
	}
	dt = Clamp(dt, 0, .05)
	grip := TransmissionLateralGrip
	if handbrake {
		grip = 3
	}
	grip *= Clamp(gripFactor, .15, 1.5) / WorldMetres
	slip := math.Atan2(lateral, math.Abs(longitudinal))
	turn := Clamp(slip*(1-math.Exp(-18*dt)), -grip*dt/speed, grip*dt/speed)
	angle := slip - turn
	return math.Copysign(speed*math.Cos(angle), longitudinal), speed * math.Sin(angle)
}
