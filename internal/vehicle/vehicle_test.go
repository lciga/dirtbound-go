package vehicle

import (
	"math"
	"testing"
)

func TestBrakingReverseAndHandbrake(t *testing.T) {
	s := State{}
	for i := 0; i < 600; i++ {
		s = Advance(s, Input{DT: Step, Z: 1, SpeedFactor: 1}, 0, 1).State
	}
	if s.Linear < 1.39 || s.Linear > 1.42 {
		t.Fatalf("top speed %f", s.Linear)
	}
	forward := s.Linear
	r := Advance(s, Input{DT: Step, Z: -1, SpeedFactor: 1}, 0, 1)
	if r.Linear >= forward || r.Linear <= 0 {
		t.Fatal("reverse must brake first")
	}
	for i := 0; i < 1200; i++ {
		s = Advance(s, Input{DT: Step, Z: -1, SpeedFactor: 1}, 0, 1).State
	}
	if s.Linear >= -0.45 {
		t.Fatalf("reverse %f", s.Linear)
	}
	normal := Advance(State{Linear: 1}, Input{DT: Step, X: 1, Z: 1, SpeedFactor: 1}, 0, 1)
	brake := Advance(State{Linear: 1}, Input{DT: Step, X: 1, Z: 1, Handbrake: true, SpeedFactor: 1}, 0, 1)
	if math.Abs(brake.Angular) <= math.Abs(normal.Angular) || brake.Drive >= normal.Drive {
		t.Fatal("handbrake yaw/drive")
	}
}
func TestOffroadBoostAndSlip(t *testing.T) {
	run := func(factor, boost float64) float64 {
		s := State{}
		for i := 0; i < 1200; i++ {
			s = Advance(s, Input{DT: Step, Z: 1, SpeedFactor: factor, Boost: boost}, 0, 1).State
		}
		return s.Linear
	}
	road := run(1, 0)
	off := run(.62, 0)
	if math.Abs(off/road-.62) > 1e-12 {
		t.Fatal("offroad multiplier")
	}
	if run(1, 1) <= road*1.4 {
		t.Fatal("boost")
	}
	if Drift(1, 1, 0, 10, 0, 1, false).Intensity != 0 {
		t.Fatal("straight is not drift")
	}
	if Drift(1, 1, 10, 0, 0, 1, false).Intensity < 3 {
		t.Fatal("lateral slip")
	}
	if math.Abs(Angle(math.Pi-.1, -math.Pi+.1, .5)-math.Pi) > 1e-12 {
		t.Fatal("angle wrap")
	}
}
