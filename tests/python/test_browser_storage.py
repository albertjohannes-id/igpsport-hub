import json
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from pathlib import Path
from unittest.mock import Mock, patch
import requests
from browser_storage import Vault, BrowserStore, COOKIE_LIMIT
from security import RequestError
from web_api import BrowserRuntime, Service, Handler, LocalServer


def cookie_header(store):
    return '; '.join(value.split(';', 1)[0] for value in store.changed.values())


class BrowserStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.vault = Vault.local(self.root)
        self.patches = [patch('web_api.AUTH', self.root), patch('web_api.ROOT', self.root)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.temp.cleanup()

    def connected(self, suffix='one'):
        store = BrowserStore(self.vault)
        for provider in ('garmin', 'igpsport'):
            store.set(provider, {'access_token': 'private-' + provider}, provider + suffix)
        return store

    def test_tokens_survive_new_runtime_and_stay_out_of_files_and_javascript(self):
        store = self.connected()
        header = cookie_header(store)
        self.assertNotIn('private-garmin', header)
        for value in store.changed.values():
            self.assertLessEqual(len(value), COOKIE_LIMIT)
            self.assertIn('HttpOnly', value)
            self.assertIn('SameSite=Strict', value)
            self.assertIn('Path=/api', value)
            self.assertIn('Max-Age=2592000', value)
        restored = BrowserRuntime(Vault.local(self.root)).begin(header)
        self.assertEqual(restored.browser_store.get('garmin')['access_token'], 'private-garmin')
        self.assertFalse((self.root / 'garmin.json').exists())
        self.assertFalse((self.root / 'web-history.json').exists())
        self.assertEqual((self.root / 'browser-cookie.key').stat().st_mode & 0o777, 0o600)
        self.assertIn('Secure', BrowserStore(self.vault, secure=True).cookie('test', 'value'))

    def test_separate_browser_never_imports_disk_tokens_or_history(self):
        (self.root / 'garmin.json').write_text('{"secret":"legacy"}')
        (self.root / 'web-history.json').write_text('[{"title":"legacy history"}]')
        one = BrowserRuntime(self.vault).begin(cookie_header(self.connected()))
        two = BrowserRuntime(self.vault).begin('')
        self.assertIsNotNone(one.browser_store.get('garmin'))
        self.assertIsNone(two.browser_store.get('garmin'))
        self.assertEqual(two.history, [])
        with self.assertRaises(Exception):
            two.load('garmin')

    def test_tampered_expired_and_wrong_provider_tokens_fail_closed(self):
        sealed = self.vault.seal('provider:garmin', {'tokens': {'access_token': 'private'}})
        tampered = ('A' if sealed[0] != 'A' else 'B') + sealed[1:]
        expired = self.vault.seal('provider:garmin', {}, lifetime=-1)
        for value in (tampered, expired, 'not-base64'):
            store = BrowserStore(self.vault, 'apex-garmin=' + value)
            self.assertIsNone(store.get('garmin'))
            self.assertIn('Max-Age=0', store.changed['garmin'])
        self.assertIsNone(BrowserStore(self.vault, 'apex-igpsport=' + sealed).get('igpsport'))

    def test_size_failure_preserves_previous_cookie(self):
        store = self.connected()
        previous = store.changed['garmin']
        with self.assertRaises(RequestError) as error:
            store.set('garmin', {'token': 'x' * 4000})
        self.assertEqual(error.exception.code, 'SESSION_TOO_LARGE')
        self.assertEqual(store.changed['garmin'], previous)
        # A realistic-size Garmin session and iGPSPORT session fit independently.
        store.set('garmin', {'token': 'g' * 2184})
        store.set('igpsport', {'token': 'i' * 1372})

    def test_receipt_is_bound_to_both_accounts_and_survives_refresh(self):
        store = self.connected()
        scope = store.scope()
        entry = {'sourceId': '1', 'scope': scope, 'summary': {}, 'before': []}
        receipt = store.receipt(scope, entry)
        store.set('garmin', {'access_token': 'refreshed'})
        self.assertEqual(store.scope(), scope)
        self.assertEqual(store.read_receipt(scope, receipt), entry)
        with self.assertRaises(RequestError):
            self.connected('two').read_receipt(self.connected('two').scope(), receipt)

    def test_refresh_is_returned_as_new_cookie_and_disconnect_is_browser_specific(self):
        store = self.connected()
        service = Service(store)
        client = Mock()
        client.client.dumps.return_value = '{"access_token":"rotated"}'
        service.attach_garmin(client)
        client.client._refresh_di_token()
        self.assertEqual(BrowserStore(self.vault, cookie_header(store)).get('garmin')['access_token'], 'rotated')
        service.disconnect('garmin')
        self.assertIsNone(store.get('garmin'))
        self.assertIsNotNone(store.get('igpsport'))
        self.assertIn('Max-Age=0', store.changed['garmin'])

    def test_mfa_is_scoped_to_cookie_and_expires(self):
        runtime = BrowserRuntime(self.vault)
        one = runtime.begin('')
        import time
        one.pending = {'garmin': (Mock(), time.time(), 'fixture')}
        headers = runtime.finish(one)
        mfa = headers[-1].split(';', 1)[0]
        self.assertIn('garmin', runtime.begin(mfa).pending)
        self.assertEqual(runtime.begin('').pending, {})
        with patch('web_api.time.time', return_value=time.time() + 301):
            self.assertEqual(runtime.begin(mfa).pending, {})

    def test_check_after_lost_response_never_uploads(self):
        service = Service(self.connected())
        client = Mock()
        response = Mock()
        response.is_redirect = False
        response.iter_content.return_value = [b'fixture']
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        summary = {'start': datetime(2026, 1, 1, tzinfo=timezone.utc), 'duration': 10, 'distance': 20}
        with patch.object(service, 'load', return_value=client), patch.object(service, 'igps_get', return_value={'fitUrl': 'fixture', 'title': 'Ride'}), patch('web_api.validate_fit_url', return_value='https://example.invalid/ride.fit'), patch('web_api.requests.get', return_value=response), patch('web_api.fit_summary', return_value=summary), patch('web_api.fetch_candidates', return_value=[]):
            result = service.transfer('1', check=True)
        self.assertEqual(result['state'], 'unconfirmed')
        self.assertIn('receipt', result)
        client.upload_activity.assert_not_called()
        self.assertFalse((self.root / 'web-history.json').exists())

    def test_http_cookies_round_trip_and_second_client_has_no_access(self):
        runtime = BrowserRuntime(self.vault)
        class TestHandler(Handler):
            pass
        TestHandler.runtime = runtime
        TestHandler.service = Service(BrowserStore(self.vault))
        server = LocalServer(('127.0.0.1', 0), TestHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}/api'
        headers = {'Host': '127.0.0.1:8788', 'X-Apex-Client': 'local-web', 'Origin': 'http://127.0.0.1:5173'}
        one, two = requests.Session(), requests.Session()
        def login(service, provider, data):
            service.save_tokens(provider, {'access_token': 'private'}, data['username'])
            return {'connected': True, 'storage': 'browser'}
        try:
            with patch.object(Service, 'login', login):
                response = one.post(base + '/garmin/login', headers=headers, json={'username':'fixture', 'password':'fixture'}, timeout=2)
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('private', response.text)
            self.assertIn('HttpOnly', response.headers['Set-Cookie'])
            self.assertEqual(one.get(base + '/storage', headers=headers, timeout=2).json()['saved'], ['garmin'])
            self.assertEqual(two.get(base + '/storage', headers=headers, timeout=2).json()['saved'], [])
            response = one.post(base + '/garmin/disconnect', headers=headers, json={}, timeout=2)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(one.get(base + '/storage', headers=headers, timeout=2).json()['saved'], [])
        finally:
            one.close(); two.close()
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__':
    unittest.main()
