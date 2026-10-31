#!/usr/bin/env python3
"""Cut backfires from Jonas Jocys' Audi R8 recording (see NOTICE.md).

Input: decoded 48 kHz stereo PCM16 WAV. Only the rear microphone is used.
"""
import argparse
import array
import math
from pathlib import Path
import wave

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
args = parser.parse_args()
with wave.open(str(args.source), 'rb') as source:
    assert source.getsampwidth() == 2 and source.getnchannels() == 2
    rate = source.getframerate()
    recording = array.array('h', source.readframes(source.getnframes()))[1::2]

destination = Path('web/audio/backfire')
destination.mkdir(exist_ok=True)
for index, (start, duration) in enumerate([(71.725, 0.16), (72.002, 0.14), (79.565, 0.14)], 1):
    data = recording[round(start * rate):round((start + duration) * rate)]
    # Remove the low engine rumble underneath the actual exhaust transient.
    low = 0
    alpha = 1 - math.exp(-2 * math.pi * 180 / rate)
    filtered = []
    for value in data:
        low += alpha * (value - low)
        filtered.append(value - low)
    gain = 0.85 * 32767 / max(abs(value) for value in filtered)
    samples = array.array('h', (
        round(value * gain * min(1, i / (rate * 0.00025), (len(data) - 1 - i) / (rate * 0.008)))
        for i, value in enumerate(filtered)
    ))
    path = destination / f'{index}.wav'
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, rate, len(samples), 'NONE', 'not compressed'))
        output.writeframes(samples.tobytes())
    print(path, len(samples) / rate, 's')
