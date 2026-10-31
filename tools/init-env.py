#!/usr/bin/env python3
"""Create local PostgreSQL credentials without printing them or replacing user settings."""
import os
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
path = root / '.env'
if not path.exists():
    content = (root / '.env.example').read_text()
    content = content.replace('replace-with-random-password', secrets.token_hex(32))
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(content)
    print('Created .env with generated PostgreSQL credentials.')
else:
    content = path.read_text()
    if 'POSTGRES_PASSWORD=' not in content:
        with path.open('a') as output:
            output.write('\nPOSTGRES_PASSWORD=' + secrets.token_hex(32) + '\n')
        path.chmod(0o600)
        print('Added PostgreSQL password to existing .env.')
    elif 'POSTGRES_PASSWORD=replace-with-random-password' in content:
        path.write_text(content.replace('POSTGRES_PASSWORD=replace-with-random-password', 'POSTGRES_PASSWORD=' + secrets.token_hex(32)))
        path.chmod(0o600)
        print('Replaced example PostgreSQL password in .env.')
    else:
        print('Existing .env kept unchanged.')
