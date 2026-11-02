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
	txOut := js.Global().Get("Float64Array").New(7)
	export("transmission", func(a []js.Value) any {
		n := func(i int) float64 { return a[i].Float() }
		t := vehicle.AdvanceTransmission(vehicle.Transmission{Gear: int(n(0)), RPM: n(1), Shift: n(2), Hold: n(3)}, n(4), n(5), n(6), n(7), a[8].Bool())
		for i, v := range []float64{float64(t.Gear), t.RPM, t.Shift, t.Hold, t.Accel, t.Load, vehicle.TransmissionRedline} {
			txOut.SetIndex(i, v)
		}
		return txOut
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
