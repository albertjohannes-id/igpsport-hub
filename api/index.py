"""Vercel request boundary for the connection-only hosted test."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from hosted_api import *
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.route()

    def do_POST(self):
        self.route()

    def route(self):
        service = None
        status = 200
        try:
            allowed = {'https://' + os.environ.get('VERCEL_URL', '')}
            allowed.update(x.strip() for x in os.environ.get('APP_ORIGINS', '').split(',') if x.strip())
            origin = self.headers.get('Origin')
            host = self.headers.get('Host', '')
            # Origins are public; this exists only to diagnose allowlist mismatches.
            rejected = (('https://' + host not in allowed)
                        or self.headers.get('X-Apex-Client') != 'local-web'
                        or (origin and origin not in allowed)
                        or self.headers.get('Sec-Fetch-Site') == 'cross-site')
            if rejected:
                print(json.dumps({'event': 'hosted_origin_rejected', 'host': host, 'origin': origin,
                                  'vercel_url': os.environ.get('VERCEL_URL', ''),
                                  'app_origins': os.environ.get('APP_ORIGINS', '')}))
                raise RequestError('Request origin not allowed.', 403)
            if self.command == 'POST' and origin not in allowed:
                raise RequestError('Request origin required.', 403)
            query = parse_qs(urlsplit(self.path).query)
            path = '/api/' + query.pop('_route', [''])[0] if '_route' in query else urlsplit(self.path).path
            ip = self.headers.get('x-vercel-forwarded-for', 'unknown')
            vault = vault_from_environment()
            identity = vault.identity(ip)
            limiter.check('request:' + identity, 120, 60)
            if path.endswith('/login'):
                limiter.check('login:' + identity, 5, 300)
            if path.endswith('/transfer') or path.endswith('/check'):
                # Transfer and check contact both providers repeatedly; cap harder than browsing.
                limiter.check('transfer:' + identity, 20, 300)
            cookie_header = self.headers.get('Cookie', '')
            if len(cookie_header) > 24000:
                raise RequestError('Cookie header too large.', 431)
            service = HostedService(BrowserStore(vault, cookie_header, secure=True))
            data = {}
            if self.command == 'POST':
                if self.headers.get_content_type() != 'application/json':
                    raise RequestError('Use application/json.', 415)
                if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                    raise RequestError('A single Content-Length is required.')
                size = int(self.headers['Content-Length'])
                if not 0 <= size <= 8192:
                    raise RequestError('Request too large.', 413)
                data = json.loads(self.rfile.read(size) or b'{}')
                if not isinstance(data, dict):
                    raise RequestError('Expected an object.')
            result = dispatch(service, path, self.command, data, query)
        except RequestError as error:
            status, result = error.status, {'error': error.message, 'code': error.code}
        except GarminConnectAuthenticationError:
            status, result = 401, {'error': 'Garmin rejected the connection or verification code. Try again.', 'code': 'RECONNECT'}
        except GarminConnectTooManyRequestsError:
            status, result = 429, {'error': 'Garmin is limiting attempts. Please wait.', 'code': 'RATE_LIMITED'}
        except GarminConnectConnectionError as error:
            # The pinned client sanitizes this message for logs (no tokens or URLs).
            print(json.dumps({'event': 'hosted_garmin_connect_failed', 'detail': str(error)}))
            status, result = 502, {'error': 'The provider could not complete this request. Please try again.', 'code': 'PROVIDER_ERROR'}
        except (ValueError, UnicodeDecodeError):
            status, result = 400, {'error': 'Invalid request or provider response.', 'code': 'INVALID_REQUEST'}
        except Exception as error:
            # Exception text may contain signed URLs or provider credentials.
            print(json.dumps({'event': 'hosted_request_failed', 'errorType': type(error).__name__}))
            status, result = 502, {'error': 'The provider could not complete this request. Please try again.', 'code': 'PROVIDER_ERROR'}
        body = json.dumps(result).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if service:
            for cookie in [*service.store.changed.values(), *service.extra_cookies]:
                self.send_header('Set-Cookie', cookie)
        if status == 429:
            self.send_header('Retry-After', '300')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
