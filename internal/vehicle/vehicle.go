// Package vehicle contains the original DirtBound driving equations ported to Go.
// The renderer and sphere collision solver are supplied by the browser adapter.
package vehicle

import "math"

const Step = 1.0 / 120
const MaxSpeed = 1.5

type Input struct {
	DT, X, Z, Boost, SpeedFactor float64
	Handbrake, Touch             bool
}

type State struct {
	Linear, Angular, Acceleration float64
}

type Result struct {
	State
	Steer, Rotation, Drive float64
	BoostUsed              bool
}

func Lerp(a, b, t float64) float64    { return a + (b-a)*t }
func Clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
func Angle(a, b, t float64) float64 {
	diff := b - a
	for diff > math.Pi {
		diff -= 2 * math.Pi
	}
	for diff < -math.Pi {
		diff += 2 * math.Pi
	}
	return a + diff*t
}

// Advance preserves the update order and constants of Vehicle.js. The sphere
// solver receives Drive as angular impulse along the car's horizontal right axis.
func Advance(s State, i Input, forwardX, forwardZ float64) Result {
	r := Result{State: s, Steer: i.X}
	dt := i.DT
	if i.Touch && (i.X != 0 || i.Z != 0) {
		cross := forwardX*i.Z - forwardZ*i.X
		r.Steer = Clamp(-cross*2, -1, 1)
		r.Linear = Lerp(s.Linear, MaxSpeed*i.SpeedFactor, dt*1.5)
	} else {
		direction := math.Copysign(1, s.Linear)
		if s.Linear == 0 {
			direction = 1
			if math.Abs(i.Z) > 0.1 {
				direction = math.Copysign(1, i.Z)
			}
		}
		grip := Clamp(math.Abs(s.Linear), 0.2, 1)
		yaw, rate := 1.0, 4.0
		if i.Handbrake {
			yaw = 1.8
			rate = 6
		}
		target := -i.X * grip * 4 * yaw * direction
		r.Angular = Lerp(s.Angular, target, dt*rate)
		r.Rotation = r.Angular * dt
		switch {
		case i.Handbrake:
			r.Linear = Lerp(s.Linear, 0, dt*1.2)
		case i.Z < 0 && s.Linear > 0.01:
			r.Linear = Lerp(s.Linear, 0, dt*8)
		case i.Z < 0:
			r.Linear = Lerp(s.Linear, i.Z/2, dt*2)
		default:
			boost := 0
			if i.Z > 0 {
				boost = int(Clamp(math.Floor(i.Boost), 0, 2))
			}
			top := []float64{1, 1.5, 1.7}[boost]
			punch := []float64{1, 2, 3}[boost]
			r.BoostUsed = top > 1
			r.Linear = Lerp(s.Linear, i.Z*MaxSpeed*i.SpeedFactor*top, dt*1.5*punch)
		}
	}
	r.Linear *= math.Max(0, 1-0.1*dt)
	driveFactor := 1.0
	if i.Handbrake {
		driveFactor = 0.35
	}
	r.Drive = r.Linear * 100 * dt * driveFactor
	r.Acceleration = Lerp(s.Acceleration, r.Linear+0.25*r.Linear*math.Abs(r.Linear), dt)
	return r
}

type DriftResult struct{ Slip, Intensity float64 }

func Drift(linear, acceleration, vx, vz, fx, fz float64, handbrake bool) DriftResult {
	speed := math.Hypot(vx, vz)
	r := DriftResult{}
	if speed > 1.5 {
		r.Slip = math.Atan2(math.Abs((fx*vz-fz*vx)/speed), math.Abs((fx*vx+fz*vz)/speed))
	}
	slide := math.Max(0, r.Slip-0.3) * 3 * math.Min(1, speed/6)
	r.Intensity = math.Abs(linear-acceleration) + slide
	if handbrake {
		r.Intensity += math.Min(1, math.Abs(linear)) * 1.2
	}
	return r
}
