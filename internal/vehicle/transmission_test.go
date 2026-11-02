package vehicle

import (
	"math"
	"testing"
)

func TestTransmissionShiftCutsTractionAndCoastBrakes(t *testing.T) {
	state := Transmission{}
	speed := 0.0
	shifts := 0
	oldGear := 1
	for n := 0; n < 120*30; n++ {
		state = AdvanceTransmission(state, Step, speed, 1, 1, false)
		if state.Gear != oldGear {
			shifts++
			oldGear = state.Gear
			if state.Shift <= 0 || state.Accel > 0 {
				t.Fatal("shift did not interrupt traction", state)
			}
		}
		speed += state.Accel * Step
		if state.RPM > TransmissionRedline || math.IsNaN(speed) || state.Gear < 1 || state.Gear > 6 {
			t.Fatal(state, speed)
		}
	}
	if shifts < 3 || speed < 20 || speed > 50 {
		t.Fatal("bad acceleration/gear progression", shifts, speed, state)
	}
	coast := AdvanceTransmission(state, Step, speed, 0, 1, false)
	brake := AdvanceTransmission(state, Step, speed, -1, 1, false)
	if !(brake.Accel < coast.Accel && coast.Accel < 0) {
		t.Fatal("brakes/coast", brake, coast)
	}
}
func TestTransmissionReverseAndOffroad(t *testing.T) {
	s := Transmission{}
	v := 0.0
	for n := 0; n < 360; n++ {
		s = AdvanceTransmission(s, Step, v, -1, 1, false)
		v += s.Accel * Step
	}
	if v >= -1 || s.Gear != 1 {
		t.Fatal("reverse", v, s)
	}
	a := AdvanceTransmission(Transmission{Gear: 1, RPM: 3500}, Step, 2, 1, 1, false)
	b := AdvanceTransmission(Transmission{Gear: 1, RPM: 3500}, Step, 2, 1, .4, false)
	if b.Accel >= a.Accel {
		t.Fatal("offroad must reduce tractive force")
	}
}
