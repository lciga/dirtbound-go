package vehicle

import "math"

// Experimental longitudinal powertrain. World geometry uses half-scale cars;
// two physical metres correspond to one world unit. The ordinary Advance is untouched.
const WorldMetres = 2.0
const TransmissionIdle = 1800.0
const TransmissionRedline = 7500.0

var GearRatios = [...]float64{3.2, 2.13, 1.52, 1.16, .92, .74}

type Transmission struct {
	Gear                          int
	RPM, Shift, Hold, Accel, Load float64
}

func AdvanceTransmission(t Transmission, dt, worldSpeed, throttle, speedFactor float64, handbrake bool) Transmission {
	dt = Clamp(dt, 0, .05)
	throttle = Clamp(throttle, -1, 1)
	speed := worldSpeed * WorldMetres
	if t.Gear < 1 || t.Gear > len(GearRatios) {
		t.Gear = 1
	}
	t.Hold += dt
	t.Shift = math.Max(0, t.Shift-dt)
	reverse := speed < -.5 || (math.Abs(speed) < .5 && throttle < 0)
	ratio := GearRatios[t.Gear-1] * 3.8
	if reverse {
		ratio = 3.1 * 3.8
		t.Gear = 1
	}
	wheelRPM := math.Abs(speed) / .31 * 60 / (2 * math.Pi)
	coupled := wheelRPM * ratio
	braking := (speed > .5 && throttle < 0) || (speed < -.5 && throttle > 0)
	t.Load = math.Abs(throttle)
	if braking {
		t.Load = 0
	}
	target := math.Max(TransmissionIdle, coupled)
	if math.Abs(speed) < 5 && t.Load > .1 && !braking {
		target = math.Max(target, TransmissionIdle+1900*t.Load)
	}
	if !reverse && t.Shift == 0 && t.Hold > .65 {
		if coupled > 6600 && t.Gear < len(GearRatios) && t.Load > .1 {
			t.Gear++
			t.Shift = .24
			t.Hold = 0
		}
		if coupled < 2800 && t.Gear > 1 && wheelRPM*GearRatios[t.Gear-2]*3.8 < 6000 {
			t.Gear--
			t.Shift = .20
			t.Hold = 0
		}
	}
	if t.Shift > 0 {
		target = math.Max(TransmissionIdle, wheelRPM*GearRatios[t.Gear-1]*3.8)
	}
	rate := 10.0
	if t.Shift > 0 {
		rate = 7
	}
	t.RPM = Clamp(Lerp(math.Max(t.RPM, TransmissionIdle), target, math.Min(1, dt*rate)), TransmissionIdle, TransmissionRedline)
	// Broad torque curve, finite tyre grip, drag and engine braking.
	torque := 360 * (.64 + .36*math.Exp(-math.Pow((t.RPM-4700)/2200, 2)))
	force := torque * ratio * .88 / .31 * t.Load
	if reverse {
		force = -force
	}
	if t.Shift > 0 || t.RPM >= TransmissionRedline-25 {
		force = 0
	}
	force = Clamp(force, -1300*5.8, 1300*5.8) * Clamp(speedFactor, .15, 1)
	sign := math.Copysign(1, speed)
	if math.Abs(speed) < .02 {
		sign = 0
	}
	accel := force/1300 - sign*(.16+.00038*speed*speed)
	if t.Load < .05 {
		accel -= sign * .45
	}
	if braking {
		accel = -sign * 8.5
	}
	if handbrake {
		accel = -sign * 10
	}
	if math.Abs(speed) < .15 && t.Load < .05 {
		accel = -speed / math.Max(dt, .001)
	}
	t.Accel = accel / WorldMetres
	return t
}
