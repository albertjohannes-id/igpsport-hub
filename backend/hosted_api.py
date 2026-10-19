"""Read-only hosted provider adapter. No dependency on the upstream trial checkout."""
import base64
import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime
from http.cookies import SimpleCookie
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
import requests
from garminconnect import Garmin
from garminconnect.exceptions import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from activities import normalize_activity
from browser_storage import BrowserStore, Vault, COOKIE_LIMIT
from security import RequestError, RateLimiter, validate_fit_url, validate_payload
from verification import fetch_candidates, fit_summary, matches, verify
from upload_result import classify, normalize

logging.getLogger('garminconnect').setLevel(logging.CRITICAL)
logging.getLogger('garth').setLevel(logging.CRITICAL)
IGPS = 'https://prod.en.igpsport.com/service'
# An additional per-instance guard for the protected test deployment, not a distributed quota.
limiter = RateLimiter()
MFA_FIELDS = ('_mfa_method', '_mfa_login_params', '_mfa_post_headers', '_mfa_service_url', '_mfa_flow')


def vault_from_environment():
    try:
        key = base64.b64decode(os.environ['SESSION_KEY'], validate=True)
        if len(key) != 32:
            raise ValueError()
        return Vault(key)
    except (KeyError, ValueError):
        raise RequestError('Hosted sessions are not configured.', 503, 'NOT_CONFIGURED') from None


class HostedService:
    def __init__(self, store):
        self.store = store
        self.clients = {}
        self.extra_cookies = []

    def igps(self, path, params=None, credentials=None):
        headers = {}
        if credentials is None:
            tokens = self.store.get('igpsport')
            if not tokens:
                raise RequestError('Connect iGPSPORT to continue.', 401, 'RECONNECT')
            headers['Authorization'] = 'Bearer ' + tokens['access_token']
        with requests.Session() as session:
            response = session.request('POST' if credentials else 'GET', IGPS + path,
                                       params=params, json=credentials, headers=headers,
                                       timeout=(10, 30), allow_redirects=False)
        if response.status_code == 429:
            raise RequestError('iGPSPORT is limiting requests. Wait before trying again.', 429, 'RATE_LIMITED')
        if response.status_code in (401, 403):
            raise RequestError('iGPSPORT rejected access. Check your connection details.', 401, 'RECONNECT')
        response.raise_for_status()
        body = response.json()
        if body.get('code') != 0:
            raise RequestError('iGPSPORT did not accept this request.', 401, 'RECONNECT')
        return body['data']

    def garmin(self):
        if 'garmin' not in self.clients:
            tokens = self.store.get('garmin')
            if not tokens:
                raise RequestError('Connect Garmin to continue.', 401, 'RECONNECT')
            client = Garmin(retry_attempts=1)
            client.client.loads(json.dumps(tokens))
            self.clients['garmin'] = client
        return self.clients['garmin']

    def persist_garmin(self, client, account=None):
        if not client.client.di_token:
            raise RequestError('Garmin did not return a reusable session.', 409, 'SESSION_UNSUPPORTED')
        self.store.set('garmin', json.loads(client.client.dumps()), account)

    def activities(self, provider, page):
        if provider == 'igpsport':
            data = self.igps('/web-gateway/web-analyze/activity/queryMyActivity',
                             {'pageNo': page, 'pageSize': 20, 'reqType': 0, 'sort': 1})
            rows, more = data['rows'], page < data.get('totalPage', page)
        else:
            client = self.garmin()
            rows = client.get_activities((page - 1) * 20, 20)
            self.persist_garmin(client)
            more = len(rows) == 20
        return {'activities': [normalize_activity(provider, row) for row in rows], 'hasMore': more, 'page': page}

    def detail(self, provider, identifier):
        if provider == 'igpsport':
            raw = self.igps('/web-gateway/web-analyze/activity/queryActivityDetail/' + identifier)
        else:
            client = self.garmin()
            raw = client.get_activity(identifier)
            self.persist_garmin(client)
            raw = raw | raw.get('summaryDTO', {}) | {'activityId': identifier}
        return normalize_activity(provider, raw)

    def clear_mfa(self):
        for i in range(3):
            self.extra_cookies.append(self.store.cookie('hub-mfa-' + str(i), '', max_age=0))

    def save_mfa(self, client, account):
        inner = client.client
        session = inner._mfa_session
        jar = getattr(session.cookies, 'jar', session.cookies)
        cookies = [{'name': c.name, 'value': c.value, 'domain': c.domain, 'path': c.path,
                    'secure': c.secure, 'expires': c.expires} for c in jar]
        state = {name: getattr(inner, name, None) for name in MFA_FIELDS}
        widget = getattr(inner, '_widget_last_resp', None)
        if state['_mfa_flow'] == 'widget':
            # Store only the hidden CSRF field needed by the pinned client's resume method.
            from garminconnect.client.constants import _CSRF_RE
            match = _CSRF_RE.search(widget.text)
            if not match:
                raise RequestError('Garmin verification could not be continued.', 409, 'MFA_UNSUPPORTED')
            state['widgetHtml'] = '<input name="_csrf" value="' + match.group(1) + '" />'
        state.update(account=account, cookies=cookies, headers=dict(session.headers),
                     native=type(session).__module__.startswith('curl_cffi'),
                     impersonate=getattr(session, 'impersonate', None))
        sealed = self.store.vault.seal('hosted-mfa', state, 300)
        if len(sealed) > 9000:
            raise RequestError('Garmin verification context is too large for this hosted test.', 409, 'MFA_TOO_LARGE')
        self.clear_mfa()
        for i in range(3):
            cookie = self.store.cookie('hub-mfa-' + str(i), sealed[i*3000:(i+1)*3000], max_age=300)
            if len(cookie.encode()) > COOKIE_LIMIT:
                raise RequestError('Verification context is too large.', 409, 'MFA_TOO_LARGE')
            self.extra_cookies.append(cookie)

    def resume_mfa(self, code):
        sealed = ''.join(self.store.cookies.get('hub-mfa-' + str(i)).value
                         if self.store.cookies.get('hub-mfa-' + str(i)) else '' for i in range(3))
        if not sealed:
            raise RequestError('Verification expired. Connect Garmin again.', 401, 'MFA_EXPIRED')
        state = self.store.vault.open('hosted-mfa', sealed)
        client = Garmin(retry_attempts=1, return_on_mfa=True)
        if state['native']:
            from curl_cffi import requests as native
            session = native.Session(impersonate=state.get('impersonate'), timeout=30)
        else:
            session = requests.Session()
        session.headers.update(state['headers'])
        for cookie in state['cookies']:
            session.cookies.set(cookie['name'], cookie['value'], domain=cookie['domain'], path=cookie['path'])
        inner = client.client
        for name in MFA_FIELDS:
            setattr(inner, name, state[name])
        inner._mfa_session = session
        inner._mfa_pending = True
        if state.get('widgetHtml'):
            inner._widget_last_resp = SimpleNamespace(text=state['widgetHtml'])
        client.resume_login({}, code)
        self.clear_mfa()
        return client, state['account']

    def login(self, provider, data):
        if provider == 'igpsport':
            if 'code' in data:
                raise RequestError('Connect iGPSPORT with username and password.')
            account = self.store.vault.identity(provider + ':' + data['username'].strip().casefold())
            token = self.igps('/auth/account/login', credentials={**data, 'appId': 'igpsport-web'})
            if not isinstance(token.get('access_token'), str) or not token['access_token']:
                raise RequestError('iGPSPORT did not return a usable session.', 502, 'INVALID_SESSION')
            self.store.set(provider, {k: token.get(k) for k in ('access_token', 'refresh_token', 'expires_in')}, account)
        else:
            if 'code' in data:
                client, account = self.resume_mfa(data['code'])
            else:
                self.clear_mfa()
                account = self.store.vault.identity(provider + ':' + data['username'].strip().casefold())
                client = Garmin(data['username'].strip(), data['password'], retry_attempts=1, return_on_mfa=True)
                try:
                    result = client.login()
                finally:
                    client.password = None
                if result and result[0] == 'needs_mfa':
                    self.save_mfa(client, account)
                    return {'needsMfa': True}
            self.persist_garmin(client, account)
            self.clients['garmin'] = client
        self.activities(provider, 1)
        return {'connected': True, 'storage': 'browser', 'storageProof': self.store.proof(provider)}

    def status(self):
        sessions = {}
        for provider in ('igpsport', 'garmin'):
            if not self.store.get(provider):
                sessions[provider] = {'state': 'disconnected'}
                continue
            try:
                self.activities(provider, 1)
                sessions[provider] = {'state': 'connected', 'checkedAt': time.time()}
            except (GarminConnectAuthenticationError, RequestError):
                sessions[provider] = {'state': 'disconnected', 'message': 'Reconnect to continue.'}
            except Exception:
                sessions[provider] = {'state': 'error', 'message': 'Unable to check the provider. Try again.'}
        return {'mode': 'hosted-test', 'capabilities': {'login': True, 'transfer': True},
                'sessions': sessions, 'history': [], 'historyScope': self.store.scope()}

    def transfer_result(self, scope, entry):
        result = {k: v for k, v in entry.items() if k not in ('scope', 'summary', 'before')}
        result['receipt'] = self.store.receipt(scope, entry)
        return result

    def transfer(self, identifier, check=False, receipt=None):
        client = self.garmin()
        scope = self.store.scope()
        if not scope:
            raise RequestError('Connect both accounts before transferring.', 401, 'RECONNECT')
        entry = None
        if receipt:
            restored = self.store.read_receipt(scope, receipt)
            if (not isinstance(restored, dict) or restored.get('sourceId') != identifier
                    or restored.get('scope') != scope):
                raise RequestError('Transfer belongs to another account or activity.', 400)
            entry = restored
        if entry and entry.get('state') in ('confirmed', 'existing'):
            return self.transfer_result(scope, entry)
        if check:
            if not entry:
                raise RequestError('No previous transfer to check.')
            summary = dict(entry['summary'])
            summary['start'] = datetime.fromisoformat(summary['start'])
            found = verify(client, summary, entry.get('before') or [], say=lambda _: None)
            if found:
                entry.update(state='confirmed', activityId=found)
            return self.transfer_result(scope, entry)
        if entry:
            raise RequestError('This upload is not confirmed yet. Use Check status before trying another upload.', 409, 'CHECK_FIRST')
        detail = self.igps('/web-gateway/web-analyze/activity/queryActivityDetail/' + identifier)
        url = validate_fit_url(detail.get('fitUrl'))
        content = bytearray()
        with requests.get(url, timeout=(10, 30), stream=True, allow_redirects=False) as response:
            if response.is_redirect:
                raise RequestError('FIT download redirects are not allowed.')
            response.raise_for_status()
            started = time.monotonic()
            for chunk in response.iter_content(65536):
                content.extend(chunk)
                if len(content) > 50 * 1024 * 1024 or time.monotonic() - started > 120:
                    raise RequestError('FIT download exceeded its size or time limit.')
        summary = fit_summary(content)
        before = fetch_candidates(client, summary)
        existing = [ride for ride in before if matches(ride, summary)]
        entry = {'sourceId': identifier, 'title': str(detail.get('title') or 'Ride')[:500],
                 'state': 'received', 'activityId': None, 'at': time.time(), 'scope': scope,
                 'summary': summary | {'start': summary['start'].isoformat()}, 'before': []}
        if existing:
            entry.update(state='existing', activityId=str(existing[0]['activityId']))
        else:
            try:
                with tempfile.TemporaryDirectory(prefix='apex-hosted-') as directory:
                    path = Path(directory) / 'ride.fit'
                    path.write_bytes(content)
                    result = client.upload_activity(str(path))
                _, ids = classify(normalize(result))
                activity_id = ids[0] if len(ids) == 1 else verify(client, summary, before, say=lambda _: None)
                entry.update(state='confirmed' if activity_id else 'unconfirmed', activityId=activity_id)
            except Exception:
                # Upload never becomes confirmed on uncertainty; the browser records the state.
                entry['state'] = 'unconfirmed'
        return self.transfer_result(scope, entry)


def dispatch(service, path, method, data, query):
    if path == '/api/status' and method == 'GET':
        return service.status()
    if path == '/api/storage' and method == 'GET':
        return {'saved': list(service.store.values), 'proofs': {p: service.store.proof(p) for p in ('igpsport', 'garmin')}}
    match = re.fullmatch(r'/api/(igpsport|garmin)/(login|disconnect|activities|detail|transfer|check)(?:/([0-9]{1,20}))?', path)
    if not match:
        raise RequestError('This hosted API supports connection, browsing and transfer operations only.', 404, 'NOT_AVAILABLE')
    provider, action, identifier = match.groups()
    if (action == 'detail') != bool(identifier):
        raise RequestError('Not found.', 404)
    if action in ('activities', 'detail'):
        if method != 'GET':
            raise RequestError('Method not allowed.', 405)
        if action == 'detail':
            return service.detail(provider, identifier)
        page = int(query.get('page', ['1'])[0])
        if not 1 <= page <= 1000:
            raise RequestError('Invalid page.')
        return service.activities(provider, page)
    if method != 'POST':
        raise RequestError('Method not allowed.', 405)
    validate_payload(action, data)
    if action == 'login':
        return service.login(provider, data)
    if action == 'disconnect':
        service.store.remove(provider)
        if provider == 'garmin':
            service.clear_mfa()
        return {'disconnected': True}
    return service.transfer(data['id'], action == 'check', data.get('receipt'))
