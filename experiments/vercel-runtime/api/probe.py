"""Dependency compatibility probe; never receives credentials or uploads activities."""
from http.server import BaseHTTPRequestHandler
import importlib
import importlib.metadata
import json
import platform
import tempfile


def probe():
    results = {}
    for module, distribution in [
        ('garminconnect', 'garminconnect'), ('garth', 'garth'),
        ('curl_cffi', 'curl_cffi'), ('requests', 'requests'),
        ('cryptography.hazmat.primitives.ciphers.aead', 'cryptography'),
        ('fitdecode', 'fitdecode'),
    ]:
        try:
            importlib.import_module(module)
            results[distribution] = {'ok': True, 'version': importlib.metadata.version(distribution)}
        except Exception as error:
            results[distribution] = {'ok': False, 'errorType': type(error).__name__}
    checks = {}
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        import os
        cipher = AESGCM(AESGCM.generate_key(bit_length=256))
        nonce = os.urandom(12)
        checks['aesGcmRoundTrip'] = cipher.decrypt(nonce, cipher.encrypt(nonce, b'probe', b'probe'), b'probe') == b'probe'
    except Exception:
        checks['aesGcmRoundTrip'] = False
    try:
        from curl_cffi import requests
        with requests.Session() as session:
            response = session.get('https://example.com', timeout=15)
            checks['nativeHttps'] = response.status_code == 200
    except Exception as error:
        checks['nativeHttps'] = False
        checks['nativeHttpsError'] = type(error).__name__
    try:
        with tempfile.TemporaryFile() as file:
            file.write(b'probe')
            file.seek(0)
            checks['temporaryFile'] = file.read() == b'probe'
    except Exception:
        checks['temporaryFile'] = False
    return {'python': platform.python_version(), 'platform': platform.system(),
            'dependencies': results, 'checks': checks,
            'providerLoginTested': False, 'transferTested': False}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        result = probe()
        passed = all(item['ok'] for item in result['dependencies'].values()) and all(
            result['checks'].get(key) is True for key in ['aesGcmRoundTrip', 'nativeHttps', 'temporaryFile'])
        body = json.dumps(result).encode()
        self.send_response(200 if passed else 503)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
