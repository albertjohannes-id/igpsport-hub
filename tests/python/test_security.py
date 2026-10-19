import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
import requests
from security import RateLimiter, RequestError, validate_payload, validate_fit_url
from web_api import Handler, LocalServer


class SecurityTests(unittest.TestCase):
    def test_payload_types_and_fields(self):
        for data in ([], {'username': {}, 'password': 'x'}, {'username': 'x', 'password': 'y', 'admin': True}, {'code': 'a' * 33}):
            with self.assertRaises(RequestError):
                validate_payload('login', data)
        for identifier in ('../secret', '１', '1' * 21, 1, None):
            with self.assertRaises(RequestError):
                validate_payload('transfer', {'id': identifier})
        validate_payload('login', {'username': 'test@example.invalid', 'password': 'valid input'})
        validate_payload('transfer', {'id': '123'})

    def test_limiter_expires_window(self):
        limiter = RateLimiter()
        with patch('security.time.monotonic', return_value=1):
            for _ in range(5):
                limiter.check('login', 5, 300)
            with self.assertRaises(RequestError) as error:
                limiter.check('login', 5, 300)
            self.assertEqual(error.exception.status, 429)
        with patch('security.time.monotonic', return_value=302):
            limiter.check('login', 5, 300)

    def test_fit_host_is_exact_and_public(self):
        for url in ('https://127.0.0.1/a.fit', 'https://169.254.169.254/latest', 'https://evil.aliyuncs.com/a.fit', 'https://qw20191008.oss-us-west-1.aliyuncs.com.evil.test/a', 'http://qw20191008.oss-us-west-1.aliyuncs.com/a', 'https://user@qw20191008.oss-us-west-1.aliyuncs.com/a'):
            with self.assertRaises(RequestError):
                validate_fit_url(url)
        url = 'https://qw20191008.oss-us-west-1.aliyuncs.com/ride.fit?signature=test'
        with patch('security.socket.getaddrinfo', return_value=[(2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(RequestError):
                validate_fit_url(url)
        with patch('security.socket.getaddrinfo', return_value=[(2, 1, 6, '', ('8.8.8.8', 443))]):
            self.assertEqual(validate_fit_url(url), url)


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.service = SimpleNamespace(limiter=RateLimiter(), lock=threading.RLock(), status=Mock(return_value={'mode': 'test'}), login=Mock(return_value={'connected': True}))
        class TestHandler(Handler):
            service = self.service
        self.server = LocalServer(('127.0.0.1', 0), TestHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.headers = {'Host': '127.0.0.1:8788', 'X-Apex-Client': 'local-web', 'Origin': 'http://127.0.0.1:5173'}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_cross_origin_and_missing_custom_header_rejected(self):
        for override in ({'Origin': 'https://evil.test'}, {'Host': 'evil.test'}, {'X-Apex-Client': ''}, {'Sec-Fetch-Site': 'cross-site'}):
            response = requests.get(self.url + '/api/status', headers=self.headers | override, timeout=2)
            self.assertEqual(response.status_code, 403)
        self.service.status.assert_not_called()

    def test_security_headers(self):
        response = requests.get(self.url + '/api/status', headers=self.headers, timeout=2)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        self.assertNotIn('Python', response.headers['Server'])

    def test_invalid_json_and_types_do_not_reach_provider(self):
        for body in ('{', '[]', '{"username":1,"password":"x"}'):
            response = requests.post(self.url + '/api/igpsport/login', headers=self.headers | {'Content-Type': 'application/json'}, data=body, timeout=2)
            self.assertEqual(response.status_code, 400)
        response = requests.post(self.url + '/api/igpsport/login', headers=self.headers, data='a=b', timeout=2)
        self.assertEqual(response.status_code, 415)
        self.service.login.assert_not_called()

    def test_login_rate_limit(self):
        for _ in range(5):
            response = requests.post(self.url + '/api/igpsport/login', headers=self.headers, json={'username':'test', 'password':'fixture'}, timeout=2)
            self.assertEqual(response.status_code, 200)
        response = requests.post(self.url + '/api/igpsport/login', headers=self.headers, json={'username':'test', 'password':'fixture'}, timeout=2)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(self.service.login.call_count, 5)
