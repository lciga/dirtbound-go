//go:build js && wasm

package main

import (
	"github.com/lciga/dirtbound-go/internal/vehicle"
	"syscall/js"
)

var callbacks []js.Func

func export(name string, fn func([]js.Value) any) {
	f := js.FuncOf(func(_ js.Value, args []js.Value) any { return fn(args) })
	callbacks = append(callbacks, f)
	js.Global().Get("DirtboundGo").Set(name, f)
}
func main() {
	js.Global().Set("DirtboundGo", js.Global().Get("Object").New())
	// One reusable Float64Array per result, avoiding JSON and allocations per step.
	out := js.Global().Get("Float64Array").New(8)
	export("advance", func(a []js.Value) any {
		n := func(i int) float64 { return a[i].Float() }
		r := vehicle.Advance(vehicle.State{Linear: n(0), Angular: n(1), Acceleration: n(2)}, vehicle.Input{DT: n(3), X: n(4), Z: n(5), Handbrake: a[6].Bool(), Boost: n(7), Touch: a[8].Bool(), SpeedFactor: n(9)}, n(10), n(11))
		values := []float64{r.Linear, r.Angular, r.Acceleration, r.Steer, r.Rotation, r.Drive, 0}
		if r.BoostUsed {
			values[6] = 1
		}
		for i, v := range values {
			out.SetIndex(i, v)
		}
		return out
	})
	txOut := js.Global().Get("Float64Array").New(8)
	export("transmission", func(a []js.Value) any {
		n := func(i int) float64 { return a[i].Float() }
		groundSpeed := n(5)
		if len(a) > 9 {
			groundSpeed = n(9)
		}
		t := vehicle.AdvanceTransmission(vehicle.Transmission{Gear: int(n(0)), RPM: n(1), Shift: n(2), Hold: n(3)}, n(4), n(5), n(6), n(7), a[8].Bool(), groundSpeed)
		for i, v := range []float64{float64(t.Gear), t.RPM, t.Shift, t.Hold, t.Accel, t.Load, vehicle.TransmissionRedline, t.Brake} {
			txOut.SetIndex(i, v)
		}
		return txOut
	})
	export("steering", func(a []js.Value) any {
		factor := 1.0
		if len(a) > 4 {
			factor = a[4].Float()
		}
		if len(a) > 5 && a[5].Bool() {
			factor *= vehicle.TransmissionHandbrakeSteerGrip / vehicle.TransmissionLateralGrip
		}
		return vehicle.BetaSteering(a[0].Float(), a[1].Float(), a[2].Float(), a[3].Float(), factor)
	})
	js.Global().Get("DirtboundGo").Set("worldMetres", vehicle.WorldMetres)
	js.Global().Get("DirtboundGo").Set("lateralGrip", vehicle.TransmissionLateralGrip)
	tyres := js.Global().Get("Float64Array").New(2)
	export("tyres", func(a []js.Value) any {
		longitudinal, lateral := vehicle.BetaTyreVelocity(a[0].Float(), a[1].Float(), a[2].Float(), a[3].Float(), a[4].Bool())
		tyres.SetIndex(0, longitudinal)
		tyres.SetIndex(1, lateral)
		return tyres
	})
	drift := js.Global().Get("Float64Array").New(2)
	export("drift", func(a []js.Value) any {
		r := vehicle.Drift(a[0].Float(), a[1].Float(), a[2].Float(), a[3].Float(), a[4].Float(), a[5].Float(), a[6].Bool())
		drift.SetIndex(0, r.Slip)
		drift.SetIndex(1, r.Intensity)
		return drift
	})
	export("angle", func(a []js.Value) any { return vehicle.Angle(a[0].Float(), a[1].Float(), a[2].Float()) })
	js.Global().Get("DirtboundGo").Set("version", "go-vehicle-120hz-v1")
	select {}
}
