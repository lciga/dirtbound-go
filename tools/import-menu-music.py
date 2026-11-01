#!/usr/bin/env python3
"""Import user-provided audio for the approved menu playlist; never downloads music."""
import argparse
import json
from pathlib import Path
import shutil
import unicodedata

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path, help='directory containing your MP3/OGG/WAV/M4A files')
parser.add_argument('--output', type=Path, default=root / 'web/audio/music/club')
args = parser.parse_args()
if not args.source.is_dir():
    parser.error('Source must be an existing directory')

def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value).lower() if c.isascii() and c.isalnum())

approved = json.loads((root / 'web/audio/music/club-approved.json').read_text())['tracks']
files = sorted(p for p in args.source.rglob('*') if p.suffix.lower() in {'.mp3', '.ogg', '.wav', '.m4a'})
args.output.mkdir(parents=True, exist_ok=True)
ready = []
missing = []
for track in approved:
    matches = [p for p in files if normalized(track['id']) in normalized(p.stem) or
               (normalized(track['artist']) in normalized(p.stem) and normalized(track['title']) in normalized(p.stem))]
    if len(matches) != 1:
        existing = [p for p in args.output.glob(track['id'] + '.*') if p.suffix in {'.mp3', '.ogg', '.wav', '.m4a'}]
        if not matches and len(existing) == 1:
            target = existing[0]
        else:
            missing.append(track['artist'] + ' — ' + track['title'])
            continue
    else:
        target = args.output / (track['id'] + matches[0].suffix.lower())
        if matches[0].resolve() != target.resolve():
            shutil.copyfile(matches[0], target)
    ready.append({**track, 'src': 'audio/music/club/' + target.name})
(args.output / 'manifest.json').write_text(json.dumps({'tracks': ready}, ensure_ascii=False, indent=2) + '\n')
print(f'Menu playlist: {len(ready)} of {len(approved)} local files available.')
for name in missing:
    print('Missing or ambiguous: ' + name)
