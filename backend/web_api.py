"""Loopback-only API for the frontend. Not a public hosting backend."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import logging
from pathlib import Path
import re
import tempfile
import threading
import time
import uuid
from urllib.parse import urlparse, parse_qs
import requests
from session_trial import AUTH, ROOT, IGPSportClient, Garmin, save
from activities import normalize_activity
from diagnostics import Trace
from verification import fit_summary, fetch_candidates, matches, verify
from upload_result import classify
from security import RequestError, RateLimiter, validate_payload, validate_fit_url
from garminconnect.exceptions import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError

logging.disable(logging.CRITICAL)


class ApiError(Exception):
    def __init__(self, message, status=400, code='REQUEST_FAILED'):
        self.message, self.status, self.code = message, status, code


class Service:
    def __init__(self, browser_store=None):
        self.browser_store = browser_store
        self.trace = Trace(ROOT / 'logs')
        self.clients, self.pending = {}, {}
        self.sessions = {p: {'state': 'disconnected'} for p in ('igpsport', 'garmin')}
        self.lock = threading.RLock()
        self.history_path = AUTH / 'web-history.json'
        if AUTH.is_symlink() or self.history_path.is_symlink():
            raise ValueError('Local session paths must not be symlinks')
        self.history = json.loads(self.history_path.read_text()) if not browser_store and self.history_path.exists() else []
        self.scope = 'unconnected'
        self.limiter = RateLimiter()

    def identity(self):
        if self.browser_store:
            self.scope = self.browser_store.scope()
            return
        # Local account-set isolation; never expose token-derived fingerprints to the browser.
        digest = hashlib.sha256()
        for provider in ('igpsport', 'garmin'):
            path = AUTH / f'{provider}.json'
            if path.exists() and not path.is_symlink():
                marker = AUTH / f'{provider}-identity.json'
                if marker.is_symlink():
                    raise ApiError('Local identity path is invalid.')
                if not marker.exists():
                    save(marker, {'id': uuid.uuid4().hex})
                digest.update(provider.encode() + marker.read_bytes())
        self.scope = digest.hexdigest()

    def state(self, provider, state, message=None):
        self.sessions[provider] = {'state': state, 'message': message, 'checkedAt': time.time() if state == 'connected' else None}

    def load(self, provider):
        if provider in self.clients:
            return self.clients[provider]
        path = AUTH / f'{provider}.json'
        if AUTH.is_symlink() or path.is_symlink():
            raise ApiError('Local session path is invalid.')
        data = self.browser_store.get(provider) if self.browser_store else json.loads(path.read_text()) if path.exists() else None
        if not data:
            raise ApiError('Connect your account to continue.', 401, 'RECONNECT')
        if provider == 'igpsport':
            client = IGPSportClient('', '', 'global')
            client.token = data['access_token']
            client.session.headers['authorization'] = f'Bearer {client.token}'
            request = client.session.request
            def bounded(*args, **kwargs):
                kwargs.setdefault('timeout', 30)
                return request(*args, **kwargs)
            client.session.request = self.trace.wrap('igpsport.http', bounded)
        else:
            client = Garmin(retry_attempts=1)
            client.client.loads(json.dumps(data))
            self.attach_garmin(client)
        self.clients[provider] = client
        return client

    def save_tokens(self, provider, tokens, username=None):
        if self.browser_store:
            account = self.browser_store.vault.identity(provider + ':' + username.casefold()) if username else None
            self.browser_store.set(provider, tokens, account)
        else:
            save(AUTH / f'{provider}.json', tokens)

    def save_history(self):
        if not self.browser_store:
            save(self.history_path, self.history)

    def transfer_result(self, entry):
        result = {k: v for k, v in entry.items() if k not in ('scope', 'summary', 'before')}
        if self.browser_store:
            result['receipt'] = self.browser_store.receipt(self.scope, entry)
        return result

    def disconnect(self, provider):
        if self.browser_store:
            self.browser_store.remove(provider)
        else:
            path = AUTH / f'{provider}.json'
            if path.is_symlink() or AUTH.is_symlink():
                raise ApiError('Invalid session path.')
            path.unlink(missing_ok=True)
        self.clients.pop(provider, None)
        self.pending.pop(provider, None)
        self.state(provider, 'disconnected')

    def attach_garmin(self, client):
        client.client._run_request = self.trace.wrap('garmin.http', client.client._run_request)
        refresh = client.client._refresh_di_token
        def persisted_refresh():
            self.trace.wrap('garmin.refresh', refresh)()
            self.save_tokens('garmin', json.loads(client.client.dumps()))
        client.client._refresh_di_token = persisted_refresh

    def igps_get(self, path, params=None):
        client = self.load('igpsport')
        response = client.session.get(client.base_url + path, params=params)
        if response.status_code in (401, 403):
            raise ApiError('iGPSPORT rejected access with this session. Please reconnect.', response.status_code, 'RECONNECT')
        response.raise_for_status()
        body = response.json()
        if body.get('code') != 0:
            raise ApiError('iGPSPORT could not complete this request. Try reconnecting.', 400)
        return body['data']

    def activities(self, provider, page=1):
        if provider == 'igpsport':
            data = self.igps_get('/web-gateway/web-analyze/activity/queryMyActivity', {'pageNo': page, 'pageSize': 20, 'reqType': 0, 'sort': 1})
            rows, more = data['rows'], page < data.get('totalPage', page)
        else:
            rows = self.load(provider).get_activities((page - 1) * 20, 20)
            more = len(rows) == 20
        self.state(provider, 'connected')
        normalized = [normalize_activity(provider, row) for row in rows]
        for activity in normalized:
            previous = next((h for h in self.history if h.get('scope') == self.scope and h['sourceId'] == activity['id']), None) if provider == 'igpsport' else None
            if previous:
                activity['syncStatus'] = previous['state']
        return {'activities': normalized, 'hasMore': more, 'page': page}

    def status(self):
        self.identity()
        for provider in self.sessions:
            try:
                self.activities(provider)
            except RequestError:
                raise
            except Exception as error:
                self.failure(provider, error)
        return {'mode': 'local', 'capabilities': {'login': True, 'transfer': True}, 'sessions': self.sessions,
                **({'historyScope': self.scope} if self.browser_store else {}),
                'history': [{k: v for k, v in h.items() if k not in ('scope', 'summary', 'before')} for h in self.history if h.get('scope') == self.scope]}

    def failure(self, provider, error):
        if isinstance(error, ApiError) and error.code == 'RECONNECT' or isinstance(error, GarminConnectAuthenticationError) or getattr(getattr(error, 'response', None), 'status_code', None) == 401:
            self.state(provider, 'disconnected', 'Reconnect to continue.')
            self.clients.pop(provider, None)
        else:
            self.state(provider, 'error', 'Unable to check the connection. Try again.')

    def login(self, provider, data):
        if provider == 'garmin' and data.get('code'):
            pending = self.pending.get(provider)
            if not pending or time.time() - pending[1] > 300:
                self.pending.pop(provider, None)
                raise ApiError('Verification expired. Sign in again.', 401, 'MFA_EXPIRED')
            client = pending[0]
            client.resume_login({}, data['code'])
        else:
            username, password = data.get('username', '').strip(), data.get('password', '')
            if not username or not password:
                raise ApiError('Enter your email or username and password.')
            if provider == 'igpsport':
                client = IGPSportClient(username, password, 'global')
                response = client.session.post(client.base_url + '/auth/account/login', json={'username': username, 'password': password, 'appId': 'igpsport-web'}, timeout=30)
                self.trace.emit('igpsport.login_response', response)
                body = response.json()
                if response.status_code == 403 and body.get('code') == 1002 or response.status_code == 401:
                    raise ApiError('Incorrect email/username or password. Please try again.', 401, 'INVALID_LOGIN')
                response.raise_for_status()
                if body.get('code') != 0:
                    raise ApiError('Login was not accepted. Check your account details.', 401, 'INVALID_LOGIN')
                token = body['data']
                self.save_tokens('igpsport', {k: token.get(k) for k in ('access_token', 'refresh_token', 'expires_in')} | {'received_at': time.time()}, username)
                client.password = None
                self.clients.pop(provider, None)
                self.load(provider)
            else:
                client = Garmin(username, password, retry_attempts=1, return_on_mfa=True)
                result = self.trace.wrap('garmin.login', client.login)()
                if result and result[0] == 'needs_mfa':
                    self.pending[provider] = (client, time.time(), username)
                    client.password = None
                    return {'needsMfa': True}
        if provider == 'garmin':
            if data.get('code'):
                username = self.pending[provider][2]
            client.password = None
            if not client.client.di_token:
                raise ApiError('This Garmin session cannot be saved. Try the terminal connection flow.')
            self.save_tokens('garmin', json.loads(client.client.dumps()), username)
            self.clients[provider] = client
            self.attach_garmin(client)
            self.pending.pop(provider, None)
        if not self.browser_store:
            save(AUTH / f'{provider}-identity.json', {'id': hashlib.sha256((provider + ':' + username.casefold()).encode()).hexdigest()})
        self.identity()
        self.activities(provider)
        return {'connected': True, **({'storage': 'browser', 'storageProof': self.browser_store.proof(provider)} if self.browser_store else {})}

    def detail(self, provider, identifier):
        if provider == 'igpsport':
            raw = self.igps_get('/web-gateway/web-analyze/activity/queryActivityDetail/' + identifier)
        else:
            raw = self.load(provider).get_activity(identifier)
            raw = raw | raw.get('summaryDTO', {})
            raw['activityId'] = identifier
        return normalize_activity(provider, raw)

    def transfer(self, identifier, check=False, receipt=None):
        self.identity()
        client = self.load('garmin')
        if self.browser_store and not self.scope:
            raise ApiError('Connect both accounts before transferring.', 401, 'RECONNECT')
        if self.browser_store and receipt:
            entry = self.browser_store.read_receipt(self.scope or '', receipt)
            if entry.get('sourceId') != identifier or entry.get('scope') != self.scope:
                raise ApiError('Transfer belongs to another account or activity.', 400)
            self.history = [entry]
        previous = next((h for h in self.history if h.get('scope') == self.scope and h['sourceId'] == identifier), None)
        if previous and previous['state'] in ('confirmed', 'existing'):
            return self.transfer_result(previous)
        if check and not previous and not self.browser_store:
            raise ApiError('No previous transfer to check.')
        if check and previous:
            from datetime import datetime
            summary = previous['summary'] | {'start': datetime.fromisoformat(previous['summary']['start'])}
            result = verify(client, summary, previous['before'], say=lambda _: None)
            if result:
                previous.update(state='confirmed', activityId=result)
                self.save_history()
            return self.transfer_result(previous)
        if previous:
            raise ApiError('This upload is not confirmed yet. Use Check status before trying another upload.', 409, 'CHECK_FIRST')
        detail = self.igps_get('/web-gateway/web-analyze/activity/queryActivityDetail/' + identifier)
        url = validate_fit_url(detail.get('fitUrl'))
        content = bytearray()
        with requests.get(url, timeout=(10, 30), stream=True, allow_redirects=False) as response:
            if response.is_redirect:
                raise ApiError('FIT download redirects are not allowed.')
            response.raise_for_status()
            started = time.monotonic()
            for chunk in response.iter_content(65536):
                content.extend(chunk)
                if len(content) > 50 * 1024 * 1024 or time.monotonic() - started > 120:
                    raise ApiError('FIT download exceeded its size or time limit.')
        summary = fit_summary(content)
        before = fetch_candidates(client, summary)
        existing = [a for a in before if matches(a, summary)]
        entry = {'sourceId': identifier, 'title': str(detail.get('title') or 'Ride')[:500], 'state': 'received', 'activityId': None,
                 'at': time.time(), 'scope': self.scope, 'summary': summary | {'start': summary['start'].isoformat()}, 'before': [{'activityId': a['activityId']} for a in ([] if self.browser_store else before)]}
        self.history.insert(0, entry)
        self.save_history()
        if check and not existing:
            entry.update(state='unconfirmed')
        elif check and len(existing) > 1:
            entry.update(state='unconfirmed')
        elif existing:
            entry.update(state='existing', activityId=str(existing[0]['activityId']))
        else:
            try:
                with tempfile.TemporaryDirectory(prefix='apex-web-') as directory:
                    path = Path(directory) / 'ride.fit'
                    path.write_bytes(content)
                    response = self.trace.wrap('garmin.upload_activity', client.upload_activity)(str(path))
                _, ids = classify(response)
                activity_id = ids[0] if len(ids) == 1 else verify(client, summary, before, say=lambda _: None)
                entry.update(state='confirmed' if activity_id else 'unconfirmed', activityId=activity_id)
            except Exception as error:
                entry['state'] = 'unconfirmed'
                self.trace.emit('web.transfer_uncertain', error=error)
        self.save_history()
        return self.transfer_result(entry)


class BrowserRuntime:
    def __init__(self, vault):
        self.vault = vault
        self.pending = {}
        self.lock = threading.Lock()

    def begin(self, cookie_header):
        from browser_storage import BrowserStore
        import secrets
        store = BrowserStore(self.vault, cookie_header)
        service = Service(store)
        now = time.time()
        identifier = None
        cookie = store.cookies.get('apex-mfa')
        if cookie:
            try:
                identifier = self.vault.open('mfa', cookie.value)
            except RequestError:
                pass
        with self.lock:
            self.pending = {key: value for key, value in self.pending.items() if value[0] > now}
            if identifier in self.pending:
                service.pending = dict(self.pending[identifier][1])
            else:
                identifier = secrets.token_urlsafe(32)
            service.mfa_id = identifier
        return service

    def finish(self, service):
        store = service.browser_store
        headers = list(store.changed.values())
        identifier = service.mfa_id
        with self.lock:
            if service.pending:
                deadline = min(value[1] + 300 for value in service.pending.values())
                if deadline > time.time():
                    self.pending[identifier] = (deadline, service.pending)
            else:
                self.pending.pop(identifier, None)
        if service.pending:
            if self.pending.get(identifier):
                headers.append(store.cookie('apex-mfa', self.vault.seal('mfa', identifier, 300), max_age=300))
        elif store.cookies.get('apex-mfa'):
            headers.append(store.cookie('apex-mfa', '', max_age=0))
        return headers


class Handler(BaseHTTPRequestHandler):
    service: Service
    runtime = None
    browser_request = False
    server_version = 'iGPSPORTHub'
    sys_version = ''

    def setup(self):
        super().setup()
        self.connection.settimeout(10)
    def log_message(self, *args):
        pass

    def respond(self, body, status=200):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        if status == 429:
            self.send_header('Retry-After', '300')
        if self.runtime and self.browser_request:
            for cookie in self.runtime.finish(self.service):
                self.send_header('Set-Cookie', cookie)
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.route(False)

    def do_POST(self):
        self.route(True)

    def unsupported(self):
        self.respond({'error': 'Method not allowed.'}, 405)

    do_OPTIONS = do_PUT = do_PATCH = do_DELETE = do_TRACE = do_CONNECT = unsupported

    def route(self, mutation):
        if len(self.path) > 2048 or len(self.headers.get_all('Host', [])) != 1:
            return self.respond({'error': 'Invalid request.'}, 400)
        if self.headers.get('Host') not in ('127.0.0.1:8788', 'localhost:8788') or self.headers.get('X-Apex-Client') != 'local-web' or self.headers.get('Origin') not in (None, 'http://127.0.0.1:5173', 'http://localhost:5173') or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.respond({'error': 'Request origin not allowed.'}, 403)
        provider = None
        try:
            self.service.limiter.check('requests', 120, 60)
            with self.service.lock:
                if self.runtime:
                    if len(self.headers.get('Cookie', '')) > 12000:
                        raise ApiError('Cookie header too large.', 431)
                    shared_limiter = self.service.limiter
                    self.service = self.runtime.begin(self.headers.get('Cookie', ''))
                    self.service.limiter = shared_limiter
                    self.browser_request = True
                url = urlparse(self.path)
                parts = url.path.strip('/').split('/')
                data = {}
                if mutation:
                    if self.headers.get_content_type() != 'application/json':
                        raise RequestError('Use application/json.', 415)
                    if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                        raise RequestError('A single Content-Length is required.')
                    raw_size = self.headers.get('Content-Length', '')
                    if not re.fullmatch(r'[0-9]{1,7}', raw_size):
                        raise RequestError('A single Content-Length is required.')
                    size = int(raw_size)
                    if size > 8192:
                        raise ApiError('Request too large.', 413)
                    data = json.loads(self.rfile.read(size) or b'{}')
                    if not isinstance(data, dict):
                        raise ApiError('Expected a JSON object.')
                if url.path == '/api/storage' and not mutation and self.runtime:
                    return self.respond({'saved': [p for p in ('igpsport', 'garmin') if self.service.browser_store.get(p)],
                                         'proofs': {p: self.service.browser_store.proof(p) for p in ('igpsport', 'garmin')}})
                if url.path == '/api/status' and not mutation:
                    return self.respond(self.service.status())
                if len(parts) < 3 or parts[0] != 'api' or parts[1] not in ('igpsport', 'garmin'):
                    raise ApiError('Not found.', 404)
                provider, action = parts[1:3]
                if len(parts) != (4 if action == 'detail' else 3):
                    raise ApiError('Not found.', 404)
                if mutation:
                    validate_payload(action, data)
                if action == 'login' and mutation:
                    self.service.limiter.check('login:' + provider, 5, 300)
                    result = self.service.login(provider, data)
                elif action == 'disconnect' and mutation:
                    self.service.disconnect(provider)
                    result = {'disconnected': True}
                elif action == 'activities' and not mutation:
                    page = max(1, min(1000, int(parse_qs(url.query).get('page', ['1'])[0])))
                    result = self.service.activities(provider, page)
                elif action == 'detail' and not mutation and re.fullmatch(r'[0-9]{1,20}', parts[3]):
                    result = self.service.detail(provider, parts[3])
                elif action in ('transfer', 'check') and mutation and provider == 'igpsport' and re.fullmatch(r'[0-9]{1,20}', str(data.get('id', ''))):
                    result = self.service.transfer(str(data['id']), action == 'check', data.get('receipt'))
                else:
                    raise ApiError('Not found.', 404)
                self.respond(result)
        except (ApiError, RequestError) as error:
            if provider and error.code == 'RECONNECT':
                self.service.failure(provider, error)
            self.respond({'error': error.message, 'code': error.code}, error.status)
        except (ValueError, UnicodeDecodeError):
            self.respond({'error': 'Invalid request data.', 'code': 'INVALID_REQUEST'}, 400)
        except GarminConnectAuthenticationError:
            self.service.state('garmin', 'disconnected')
            self.service.clients.pop('garmin', None)
            self.respond({'error': 'Garmin rejected the login or session. Check your credentials and verification code.', 'code': 'RECONNECT'}, 401)
        except GarminConnectTooManyRequestsError:
            self.respond({'error': 'Too many attempts. Please wait before trying again.'}, 429)
        except Exception as error:
            self.service.trace.emit('web.request_failed', error=error)
            if provider:
                self.service.failure(provider, error)
            self.respond({'error': 'The provider could not complete this request. Please try again. Saved credentials have not been cleared.'}, 502)


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.slots = threading.BoundedSemaphore(16)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


if __name__ == '__main__':
    import os
    os.umask(0o077)
    from browser_storage import Vault, BrowserStore
    vault = Vault.local(AUTH)
    Handler.runtime = BrowserRuntime(vault)
    Handler.service = Service(BrowserStore(vault))
    print('iGPSPORT Hub local API: http://127.0.0.1:8788')
    LocalServer(('127.0.0.1', 8788), Handler).serve_forever()
