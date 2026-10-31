package server

import (
	"encoding/json"
	"errors"
	"math"
)

// validateGhost implements the public GhostCodec frame checks, not the private
// production server's full track replay and anti-cheat.
func validateGhost(raw json.RawMessage, seconds float64) error {
	var ghost struct {
		V    int       `json:"v"`
		Rate int       `json:"rate"`
		Data []float64 `json:"data"`
	}
	if json.Unmarshal(raw, &ghost) != nil || ghost.V != 1 || ghost.Rate != 20 || len(ghost.Data) < 16 || len(ghost.Data)%8 != 0 || len(ghost.Data)/8 > 12002 {
		return errors.New("Invalid ghost format")
	}
	frames := len(ghost.Data) / 8
	if math.Abs(float64(frames-1)/20-seconds) > .100000001 {
		return errors.New("Ghost duration does not match lap")
	}
	acc := [8]float64{}
	for i := 0; i < len(ghost.Data); i += 8 {
		distance := 0.0
		for c := 0; c < 8; c++ {
			delta := ghost.Data[i+c]
			if math.Trunc(delta) != delta || math.Abs(delta) > 2e7 {
				return errors.New("Invalid ghost channel")
			}
			acc[c] += delta
			if math.Abs(acc[c]) > 1e7 {
				return errors.New("Ghost coordinate out of range")
			}
			if c < 3 && i > 0 {
				distance += (delta / 100) * (delta / 100)
			}
		}
		if math.Sqrt(distance) > 35.0/20 {
			return errors.New("Ghost moves too fast")
		}
	}
	return nil
}
