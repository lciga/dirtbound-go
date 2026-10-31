#!/usr/bin/env python3
"""Build and smoke-test Compose using an isolated project and disposable volume."""
import argparse
import base64
import hashlib
import http.client
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-build', action='store_true', help='use the already built image')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    project = 'dirtbound-compose-smoke-' + secrets.token_hex(4)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    env = dict(os.environ, PORT=str(port), BIND_ADDRESS='127.0.0.1')
    compose = ['docker', 'compose', '-p', project]

    def run(*command, capture=False, timeout=600):
        return subprocess.run(command, cwd=root, env=env, check=True, text=True,
                              stdout=subprocess.PIPE if capture else None,
                              timeout=timeout)

    base = f'http://127.0.0.1:{port}'
    jar = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(base + path, data=data,
                                     headers={'Content-Type': 'application/json'})
        with client.open(req, timeout=20) as response:
            return response.headers, response.read()

    def api(path, body=None):
        _, raw = request(path, body)
        result = json.loads(raw)
        assert result['success'], result.get('error')
        return result['data']

    def websocket():
        cookie_req = urllib.request.Request(base + '/api/lobby')
        jar.add_cookie_header(cookie_req)
        key = base64.b64encode(secrets.token_bytes(16)).decode()
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        try:
            connection.request('GET', '/api/lobby', headers={
                'Connection': 'Upgrade', 'Upgrade': 'websocket',
                'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key,
                'Origin': base, 'Cookie': cookie_req.get_header('Cookie', ''),
            })
            response = connection.getresponse()
            assert response.status == 101, f'WebSocket status: {response.status}'
            expected = base64.b64encode(hashlib.sha1(
                (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            assert response.getheader('Sec-WebSocket-Accept') == expected
        finally:
            connection.close()

    try:
        run(*compose, 'config', '--quiet')
        if not args.no_build:
            print('Building Go server and WASM inside Docker...', flush=True)
            run(*compose, 'build')
        print('Starting isolated Compose project...', flush=True)
        run(*compose, 'up', '--no-build', '--wait', '--wait-timeout', '90')
        assert api('/healthz')['status'] == 'ok'
        for path in ['/', '/login.html', '/editor.html']:
            _, raw = request(path)
            assert b'DirtBound' in raw, f'Missing page: {path}'
        _, guest_page = request('/play.html?rally=smoke')
        assert b'id="auth"' in guest_page, 'Guest race did not require sign-in'
        headers, wasm = request('/wasm/physics.wasm')
        assert headers.get_content_type() == 'application/wasm'
        assert wasm[:4] == b'\0asm' and len(wasm) > 100000
        _, runtime = request('/wasm/wasm_exec.js')
        assert b'Go' in runtime
        _, vehicle = request('/js/Vehicle.js')
        assert b'GoPhysics.js' in vehicle
        car = next((root / 'web/models/cars').glob('*.car'))
        _, model = request('/' + car.relative_to(root / 'web').as_posix())
        assert len(model) == car.stat().st_size
        uid = run(*compose, 'exec', '-T', 'dirtbound', 'id', '-u', capture=True).stdout.strip()
        assert uid == '10001', f'Unexpected runtime UID: {uid}'
        print('Health, pages, Go WASM, models and non-root runtime: OK', flush=True)
        username = 'smoke_' + secrets.token_hex(4)
        password = secrets.token_urlsafe(24)
        account = api('/api/auth/register', {'username': username, 'password': password})['account']
        assert api('/api/me')['id'] == account['id']
        _, race_page = request('/play.html?rally=smoke')
        assert b'src="js/main.js"' in race_page, 'Signed-in player cannot load race'
        websocket()
        print('Registration, session and WebSocket upgrade: OK', flush=True)
        run(*compose, 'up', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '90')
        assert api('/api/me')['id'] == account['id'], 'Session lost after recreation'
        api('/api/auth/sign-out', {})
        logged_in = api('/api/auth/login', {'username': username, 'password': password})
        assert logged_in['account']['id'] == account['id'], 'Account lost after recreation'
        print('Account and session survive container recreation: OK', flush=True)
        print('Docker Compose smoke test passed.', flush=True)
    except Exception:
        subprocess.run([*compose, 'logs', '--no-color', '--tail', '40'], cwd=root, env=env)
        raise
    finally:
        # Only this test's random project is removed, including its test-only data.
        run(*compose, 'down', '--volumes', '--remove-orphans', timeout=90)


if __name__ == '__main__':
    main()
