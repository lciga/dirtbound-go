#!/usr/bin/env python3
"""Run Go integration tests against an isolated disposable PostgreSQL 18."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

root = Path(__file__).resolve().parents[1]
name = 'dirtbound-pg-test-' + secrets.token_hex(5)
env = dict(os.environ, POSTGRES_PASSWORD=secrets.token_hex(24), POSTGRES_DB='integration')
try:
    subprocess.run(['docker', 'run', '-d', '--name', name, '-p', '127.0.0.1::5432',
                    '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB', 'postgres:18-alpine'], env=env, check=True, stdout=subprocess.DEVNULL)
    for _ in range(60):
        ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'postgres', '-d', 'integration'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if ready.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Test PostgreSQL did not become ready')
    raw = subprocess.check_output(['docker', 'inspect', name])
    port = json.loads(raw)[0]['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
    env['TEST_DATABASE_URL'] = f"postgres://postgres:{env['POSTGRES_PASSWORD']}@127.0.0.1:{port}/integration?sslmode=disable"
    subprocess.run(['go', 'test', '-race', './...'], cwd=root, env=env, check=True)
finally:
    subprocess.run(['docker', 'rm', '-fv', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
