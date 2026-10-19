"""Client-held encrypted sessions for the loopback web trial; no provider token database."""
import base64
import hashlib
import hmac
from http.cookies import SimpleCookie, CookieError
import json
import os
import time
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag
from security import RequestError

LIFETIME = 30 * 86400
COOKIE_LIMIT = 3800
PROVIDERS = ('igpsport', 'garmin')


class Vault:
    def __init__(self, key):
        self.key = key
        self.cipher = AESGCM(key)

    @classmethod
    def local(cls, directory):
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / 'browser-cookie.key'
        if directory.is_symlink() or path.is_symlink():
            raise ValueError('Invalid encryption key path')
        os.chmod(directory, 0o700)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(AESGCM.generate_key(bit_length=256))
        os.chmod(path, 0o600)
        return cls(path.read_bytes())

    def seal(self, purpose, data, lifetime=LIFETIME):
        raw = json.dumps({'exp': int(time.time()) + lifetime, 'data': data}, separators=(',', ':')).encode()
        nonce = os.urandom(12)
        return base64.urlsafe_b64encode(nonce + self.cipher.encrypt(nonce, raw, purpose.encode())).decode().rstrip('=')

    def open(self, purpose, value):
        try:
            if not isinstance(value, str) or len(value) > 16000:
                raise ValueError()
            raw = base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True)
            data = json.loads(self.cipher.decrypt(raw[:12], raw[12:], purpose.encode()))
            if data['exp'] <= time.time():
                raise ValueError()
            return data['data']
        except (ValueError, KeyError, TypeError, InvalidTag):
            raise RequestError('Saved browser session expired or is invalid. Reconnect your accounts.', 401, 'RECONNECT') from None

    def identity(self, value):
        return hmac.new(self.key, value.encode(), hashlib.sha256).hexdigest()


class BrowserStore:
    def __init__(self, vault, cookie_header='', secure=False):
        self.vault, self.secure = vault, secure
        self.values, self.changed = {}, {}
        self.invalid = set()
        self.cookies = SimpleCookie()
        try:
            self.cookies.load(cookie_header)
        except CookieError:
            self.cookies = SimpleCookie()
        for provider in PROVIDERS:
            item = self.cookies.get('apex-' + provider)
            if item:
                try:
                    self.values[provider] = vault.open('provider:' + provider, item.value)
                except RequestError:
                    self.invalid.add(provider)
                    self.remove(provider)

    def get(self, provider):
        return self.values.get(provider, {}).get('tokens')

    def account(self, provider):
        return self.values.get(provider, {}).get('account')

    def set(self, provider, tokens, account=None):
        value = {'tokens': tokens, 'account': account or self.account(provider)}
        sealed = self.vault.seal('provider:' + provider, value)
        cookie = self.cookie('apex-' + provider, sealed)
        if len(cookie.encode()) > COOKIE_LIMIT:
            raise RequestError('This provider session is too large to save in a browser cookie. No tokens were saved.', 409, 'SESSION_TOO_LARGE')
        self.values[provider] = value
        self.changed[provider] = cookie

    def remove(self, provider):
        self.values.pop(provider, None)
        self.changed[provider] = self.cookie('apex-' + provider, '', max_age=0)

    def cookie(self, name, value, max_age=LIFETIME):
        cookie = SimpleCookie()
        cookie[name] = value
        cookie[name]['path'] = '/api'
        cookie[name]['httponly'] = True
        cookie[name]['samesite'] = 'Strict'
        cookie[name]['max-age'] = max_age
        if self.secure:
            cookie[name]['secure'] = True
        return cookie[name].OutputString()

    def proof(self, provider):
        value = self.values.get(provider)
        return self.vault.identity(json.dumps(value, sort_keys=True, separators=(',', ':'))) if value else None

    def scope(self):
        accounts = [self.account(p) for p in PROVIDERS]
        return self.vault.identity(json.dumps(accounts)) if all(accounts) else None

    def receipt(self, scope, entry):
        return self.vault.seal('transfer:' + scope, entry)

    def read_receipt(self, scope, value):
        return self.vault.open('transfer:' + scope, value)
