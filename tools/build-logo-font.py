#!/usr/bin/env python3
"""Extract logo outlines from a local font: pip install 'fonttools[woff]'."""
import argparse
import json
from pathlib import Path
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont


class Outline(BasePen):
    def __init__(self, glyphs, scale):
        super().__init__(glyphs)
        self.scale = scale
        self.tokens = []

    def emit(self, command, *points):
        self.tokens.append(command)
        for point in points:
            self.tokens.extend(str(round(v * self.scale)) for v in point)

    def _moveTo(self, p):
        self.start = p
        self.emit('m', p)

    def _lineTo(self, p):
        self.emit('l', p)

    def _qCurveToOne(self, control, end):
        self.emit('q', end, control)

    def _curveToOne(self, a, b, end):
        self.emit('b', end, a, b)

    def _closePath(self):
        self.emit('l', self.start)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('font', type=Path)
parser.add_argument('--text', default='Racing Club 1sk4nd3r')
parser.add_argument('--output', type=Path, default=Path('web/fonts/brand-logo.typeface.json'))
args = parser.parse_args()
font = TTFont(args.font)
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
scale = 1000 / font['head'].unitsPerEm
data = json.loads(args.output.read_text())
data['glyphs'] = {}
for char in dict.fromkeys(args.text):
    glyph = glyphs[cmap[ord(char)]]
    outline = Outline(glyphs, scale)
    glyph.draw(outline)
    data['glyphs'][char] = {'ha': round(glyph.width * scale), 'o': ' '.join(outline.tokens)}
data['resolution'] = 1000
args.output.write_text(json.dumps(data, separators=(',', ':')) + '\n')
