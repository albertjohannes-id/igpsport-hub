import json
import os
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from types import SimpleNamespace
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import hosted_api
from browser_storage import BrowserStore, Vault
from hosted_api import HostedService, GARMIN_SKIP_STRATEGIES, dispatch, vault_from_environment
from security import RateLimiter, RequestError

SUMMARY = {'start': datetime(2026, 1, 1, 7, 30, tzinfo=timezone.utc), 'duration': 3600.0, 'distance': 50000.0}
SUMMARY_FROZEN = {'start': '2026-01-01T07:30:00+00:00', 'duration': 3600.0, 'distance': 50000.0}


def cookie_header(store):
    return '; '.join(value.split(';', 1)[0] for value in store.changed.values())


class HostedTests(unittest.TestCase):
    def setUp(self):
        self.vault = Vault(AESGCM.generate_key(bit_length=256))
        self.service = HostedService(BrowserStore(self.vault, secure=True))

    def connect_both(self, suffix='one'):
        store = self.service.store
        for provider in ('igpsport', 'garmin'):
            store.set(provider, {'access_token': 'private-' + provider}, 'test-account-' + suffix)
        return store

    def test_disconnected_status_does_not_contact_providers(self):
        with patch('hosted_api.requests.Session') as request, patch('hosted_api.Garmin') as garmin:
            result = self.service.status()
        request.assert_not_called()
        garmin.assert_not_called()
        self.assertEqual(result['mode'], 'hosted-test')
        self.assertTrue(result['capabilities']['transfer'])

    def test_unconnected_and_unknown_routes_reject_without_provider(self):
        for route in ['transfer', 'check', 'activities/123', 'detail', 'login/123']:
            with self.assertRaises(RequestError):
                dispatch(self.service, '/api/igpsport/' + route, 'POST', {'id': '1'}, {})

    def test_no_fallback_to_disk_key(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(RequestError):
            vault_from_environment()

    def test_mfa_survives_a_new_service_without_password(self):
        session = requests.Session()
        session.cookies.set('sso', 'private-cookie', domain='sso.garmin.com', path='/')
        inner = SimpleNamespace(_mfa_session=session, _mfa_flow='ios', _mfa_method='email',
                                _mfa_login_params={'clientId': 'test'}, _mfa_post_headers={},
                                _mfa_service_url='https://connect.garmin.com')
        self.service.save_mfa(SimpleNamespace(client=inner, password='must-not-be-saved'), 'account')
        # Browser applies replacement Set-Cookie values in order.
        cookies = {}
        for header in self.service.extra_cookies:
            name, value = header.split(';')[0].split('=', 1)
            cookies[name] = value
        header = '; '.join(name + '=' + value for name, value in cookies.items())
        other = HostedService(BrowserStore(self.vault, header, secure=True))
        fake = Mock(client=SimpleNamespace())
        with patch('hosted_api.Garmin', return_value=fake):
            restored, account = other.resume_mfa('123456')
        self.assertEqual(account, 'account')
        fake.resume_login.assert_called_once_with({}, '123456')
        self.assertEqual(fake.client._mfa_session.cookies.get('sso'), 'private-cookie')
        self.assertEqual(fake.client._mfa_flow, 'ios')
        self.assertTrue(all('Secure' in h and 'HttpOnly' in h for h in self.service.extra_cookies))
        self.assertNotIn('password', vars(fake.client))

    def test_expired_mfa_rejected(self):
        sealed = self.vault.seal('hosted-mfa', {}, -1)
        service = HostedService(BrowserStore(self.vault, 'hub-mfa-0=' + sealed, secure=True))
        with self.assertRaises(RequestError):
            service.resume_mfa('123456')

    def test_accounts_do_not_share_session(self):
        self.service.store.set('igpsport', {'access_token': 'first'}, 'first-account')
        other = HostedService(BrowserStore(self.vault, secure=True))
        self.assertIsNone(other.store.get('igpsport'))
        with self.assertRaises(RequestError):
            other.igps('/web-gateway/web-analyze/activity/queryMyActivity')

    def test_invalid_login_fields_rejected_before_provider(self):
        with patch.object(self.service, 'login') as login:
            with self.assertRaises(RequestError):
                dispatch(self.service, '/api/garmin/login', 'POST', {'username': 'x'}, {})
        login.assert_not_called()

    def test_garmin_challenge_arms_cooldown_and_refuses_immediate_retry(self):
        from garminconnect.exceptions import GarminConnectConnectionError
        client = Mock()
        client.client = SimpleNamespace(skip_strategies=set())
        client.login.side_effect = GarminConnectConnectionError(
            'Login failed: All login strategies exhausted: Portal login: HTTP 403 (Cloudflare bot challenge)')
        with patch.object(hosted_api, 'limiter', RateLimiter()), patch('hosted_api.Garmin', return_value=client) as garmin:
            with self.assertRaises(RequestError) as caught:
                self.service.login('garmin', {'username': 'fixture', 'password': 'fixture'})
            self.assertEqual(caught.exception.status, 429)
            self.assertEqual(caught.exception.code, 'GARMIN_BLOCKED')
            self.assertEqual(client.client.skip_strategies, GARMIN_SKIP_STRATEGIES)
            self.assertGreater(hosted_api.limiter.blocked('garmin-login'), 1500)
            self.assertNotIn('password', client.login.call_args.args)
            with self.assertRaises(RequestError) as caught:
                self.service.login('garmin', {'username': 'fixture', 'password': 'fixture'})
            self.assertEqual(caught.exception.code, 'GARMIN_COOLDOWN')
            garmin.assert_called_once()

    def test_garmin_rate_limit_arms_shorter_cooldown(self):
        from garminconnect.exceptions import GarminConnectTooManyRequestsError
        client = Mock()
        client.client = SimpleNamespace(skip_strategies=set())
        client.login.side_effect = GarminConnectTooManyRequestsError(
            'Mobile login returned 429 — rate limited or blocked by Garmin')
        with patch.object(hosted_api, 'limiter', RateLimiter()), patch('hosted_api.Garmin', return_value=client):
            with self.assertRaises(RequestError) as caught:
                self.service.login('garmin', {'username': 'fixture', 'password': 'fixture'})
            self.assertEqual(caught.exception.code, 'RATE_LIMITED')
            remaining = hosted_api.limiter.blocked('garmin-login')
        self.assertGreater(remaining, 540)
        self.assertLessEqual(remaining, 600)

    def existing_candidate(self, identifier):
        return {'activityId': identifier, 'startTimeGMT': '2026-01-01T07:30:00.000Z',
                'duration': 3601, 'distance': 50010}

    @staticmethod
    def download_response():
        response = Mock()
        response.is_redirect = False
        response.iter_content.return_value = [b'fixture-fit']
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        return response

    def transfer_patches(self, garmin, candidates):
        self.connect_both()
        return [patch('hosted_api.Garmin', return_value=garmin),
                patch.object(self.service, 'igps', return_value={'fitUrl': 'https://cdn.invalid/ride.fit', 'title': 'Morning ride'}),
                patch('hosted_api.validate_fit_url', return_value='https://cdn.invalid/ride.fit'),
                patch('hosted_api.requests.get', return_value=self.download_response()),
                patch('hosted_api.fit_summary', return_value=SUMMARY),
                patch('hosted_api.fetch_candidates', return_value=candidates)]

    def transfer_call(self, patches):
        for item in patches:
            item.start()
        try:
            return self.service.transfer('321')
        finally:
            for item in patches:
                item.stop()

    def test_existing_activity_avoids_upload(self):
        garmin = Mock()
        result = self.transfer_call(self.transfer_patches(garmin, [self.existing_candidate(555)]))
        self.assertEqual(result['state'], 'existing')
        self.assertEqual(result['activityId'], '555')
        self.assertEqual(result['sourceId'], '321')
        self.assertIn('receipt', result)
        self.assertNotIn('summary', result)
        self.assertNotIn('before', result)
        self.assertNotIn('scope', result)
        garmin.upload_activity.assert_not_called()

    def test_upload_confirmed_by_unique_reported_id(self):
        garmin = Mock()
        garmin.upload_activity.return_value = {'detailedImportResult': {'successes': [{'internalId': 987654}], 'failures': []}}
        result = self.transfer_call(self.transfer_patches(garmin, []))
        self.assertEqual(result['state'], 'confirmed')
        self.assertEqual(result['activityId'], '987654')
        garmin.upload_activity.assert_called_once()
        self.assertIn('.fit', str(garmin.upload_activity.call_args))

    def test_uncertain_upload_stays_unconfirmed(self):
        garmin = Mock()
        garmin.upload_activity.side_effect = requests.ConnectionError('connection lost')
        result = self.transfer_call(self.transfer_patches(garmin, []))
        self.assertEqual(result['state'], 'unconfirmed')
        self.assertIn('receipt', result)

    def test_check_confirms_from_receipt(self):
        store = self.connect_both()
        scope = store.scope()
        entry = {'sourceId': '321', 'title': 'Morning ride', 'state': 'unconfirmed', 'activityId': None,
                 'at': 1.0, 'scope': scope, 'summary': SUMMARY_FROZEN, 'before': []}
        receipt = store.receipt(scope, entry)
        garmin = Mock()
        with patch('hosted_api.Garmin', return_value=garmin), \
                patch('verification.fetch_candidates', return_value=[self.existing_candidate(777)]):
            result = self.service.transfer('321', check=True, receipt=receipt)
        self.assertEqual(result['state'], 'confirmed')
        self.assertEqual(result['activityId'], '777')
        garmin.upload_activity.assert_not_called()
        self.assertIn('receipt', result)

    def test_pending_transfer_blocks_repeat_upload(self):
        store = self.connect_both()
        scope = store.scope()
        entry = {'sourceId': '321', 'title': 'Morning ride', 'state': 'received', 'activityId': None,
                 'at': 1.0, 'scope': scope, 'summary': SUMMARY_FROZEN, 'before': []}
        receipt = store.receipt(scope, entry)
        with patch('hosted_api.Garmin', return_value=Mock()):
            with self.assertRaises(RequestError) as caught:
                self.service.transfer('321', False, receipt)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(caught.exception.code, 'CHECK_FIRST')

    def test_receipt_is_bound_to_scope_and_activity(self):
        store = self.connect_both()
        scope = store.scope()
        entry = {'sourceId': '321', 'title': 'Morning ride', 'state': 'received', 'activityId': None,
                 'at': 1.0, 'scope': scope, 'summary': SUMMARY_FROZEN, 'before': []}
        receipt = store.receipt(scope, entry)
        service = self.service
        garmin = Mock()
        with patch('hosted_api.Garmin', return_value=garmin):
            with self.assertRaises(RequestError) as caught:
                service.transfer('999', False, receipt)
        self.assertEqual(caught.exception.status, 400)
        other = BrowserStore(self.vault)
        for provider in ('igpsport', 'garmin'):
            other.set(provider, {'access_token': 'private-' + provider}, 'other-' + provider)
        other_service = HostedService(BrowserStore(self.vault, cookie_header(other), secure=True))
        garmin = Mock()
        with patch('hosted_api.Garmin', return_value=garmin):
            with self.assertRaises(RequestError) as caught:
                other_service.transfer('321', False, receipt)
        self.assertEqual(caught.exception.status, 401)
        garmin.upload_activity.assert_not_called()


if __name__ == '__main__':
    unittest.main()
