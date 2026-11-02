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
		if state.RPM > TransmissionRedline || math.IsNaN(speed) || state.Gear < 1 || state.Gear > 5 {
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
	if v >= -1 || s.Gear != -1 {
		t.Fatal("reverse", v, s)
	}
	a := AdvanceTransmission(Transmission{Gear: 1, RPM: 3500}, Step, 2, 1, 1, false)
	b := AdvanceTransmission(Transmission{Gear: 1, RPM: 3500}, Step, 2, 1, .4, false)
	if b.Accel >= a.Accel {
		t.Fatal("offroad must reduce tractive force")
	}
}

func TestTransmissionReverseToForward(t *testing.T) {
	state := Transmission{}
	speed := 0.0
	for n := 0; n < 120*3; n++ {
		state = AdvanceTransmission(state, Step, speed, -1, 1, false)
		speed += state.Accel * Step
	}
	if speed >= -1 {
		t.Fatal("reverse did not engage", speed)
	}
	for n := 0; n < 120*5; n++ {
		state = AdvanceTransmission(state, Step, speed, 1, 1, false)
		speed += state.Accel * Step
	}
	if speed < 5 || state.Gear < 1 {
		t.Fatalf("forward acceleration did not recover after reverse: speed %.3f world/s, gear %d", speed, state.Gear)
	}
}

func TestRangeUsesTotalGroundSpeedAndReverseSpeedIsLimited(t *testing.T) {
	s := AdvanceTransmission(Transmission{Gear: 1}, Step, 0, -1, 1, false, 12)
	if s.Gear != 1 || s.Brake <= 0 || s.Load != 0 {
		t.Fatal("sideways motion selected R", s)
	}
	s = AdvanceTransmission(Transmission{Gear: -1}, Step, -7, -1, 1, false)
	if s.Accel <= 0 {
		t.Fatal("downhill reverse has no speed governor", s)
	}
	s = AdvanceTransmission(Transmission{Gear: 5, Shift: .2}, Step, 0, 1, 1, false)
	if s.Gear != 1 || s.Shift != 0 || s.Accel <= 0 {
		t.Fatal("stopped high gear did not reset", s)
	}
}
func TestBetaSteeringRespondsToDirectionAndRemainsBounded(t *testing.T) {
	for _, speed := range []float64{-30, -1, 0, 1, 30} {
		left, right := BetaSteering(0, speed, -1, Step), BetaSteering(0, speed, 1, Step)
		if math.Abs(left+right) > 1e-12 || math.Abs(left) > 3.8 || left*speed < 0 {
			t.Fatal(speed, left, right)
		}
	}
	if len(GearRatios) != 5 {
		t.Fatal("five forward gears required")
	}
}

func TestCornerShiftHysteresisAndClutchReturn(t *testing.T) {
	mid := AdvanceTransmission(Transmission{Gear: 2, RPM: 3500, Hold: 1}, Step, 50/7.2, 1, 1, false, 50/7.2)
	if mid.Gear != 2 {
		t.Fatal("normal corner selected first", mid)
	}
	drift := AdvanceTransmission(Transmission{Gear: 3, RPM: 4500, Hold: 1}, Step, 3, 1, 1, false, 14)
	if drift.Gear != 3 || drift.Shift != 0 {
		t.Fatal("sideways slip triggered a shift", drift)
	}
	open := AdvanceTransmission(Transmission{Gear: 2, RPM: 5000, Shift: .12}, Step, 10, 1, 1, false)
	reconnect := AdvanceTransmission(Transmission{Gear: 2, RPM: 5000, Shift: .03}, Step, 10, 1, 1, false)
	if open.Accel >= 0 || reconnect.Accel <= 0 || reconnect.Shift <= 0 {
		t.Fatal("clutch did not progressively return traction", open, reconnect)
	}
}
