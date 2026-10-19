"""Small, explicit boundaries for the single-user loopback API."""
from collections import defaultdict, deque
import ipaddress
import re
import socket
import threading
import time
from urllib.parse import urlsplit


class RequestError(Exception):
    def __init__(self, message, status=400, code='INVALID_REQUEST'):
        self.message, self.status, self.code = message, status, code


def validate_payload(action, data):
    if not isinstance(data, dict):
        raise RequestError('Expected a JSON object.')
    if action == 'login':
        allowed = {'code'} if 'code' in data else {'username', 'password'}
        if set(data) != allowed:
            raise RequestError('Provide username and password, or a verification code.')
        limits = {'username': 320, 'password': 1024, 'code': 32}
        for key, value in data.items():
            if not isinstance(value, str) or not value.strip() or len(value) > limits[key] or '\x00' in value:
                raise RequestError('Invalid login field.')
    elif action in ('transfer', 'check'):
        if not {'id'} <= set(data) <= {'id', 'receipt'} or not isinstance(data['id'], str) or not re.fullmatch(r'[0-9]{1,20}', data['id']):
            raise RequestError('A numeric activity ID is required.')
        if 'receipt' in data and (not isinstance(data['receipt'], str) or len(data['receipt']) > 6000):
            raise RequestError('Invalid transfer receipt.')
    elif action == 'disconnect' and data:
        raise RequestError('Disconnect does not accept fields.')


class RateLimiter:
    def __init__(self):
        self.events = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key, limit, window):
        now = time.monotonic()
        with self.lock:
            queue = self.events[key]
            while queue and queue[0] <= now - window:
                queue.popleft()
            if len(queue) >= limit:
                raise RequestError('Too many requests. Wait before trying again.', 429, 'RATE_LIMITED')
            queue.append(now)


# Exact observed iGPSPORT storage bucket; never allow all Aliyun customer buckets.
FIT_HOSTS = frozenset({'qw20191008.oss-us-west-1.aliyuncs.com'})


def validate_fit_url(url):
    if not isinstance(url, str) or len(url) > 8192:
        raise RequestError('Invalid FIT download URL.')
    try:
        parsed = urlsplit(url)
        valid = (parsed.scheme == 'https' and parsed.hostname in FIT_HOSTS
                 and parsed.port in (None, 443) and not parsed.username
                 and not parsed.password and not parsed.fragment)
    except ValueError:
        valid = False
    if not valid:
        raise RequestError('The FIT download host is not approved. Contact the maintainer.', 400, 'UNAPPROVED_FIT_HOST')
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise RequestError('FIT download resolved to a non-public address.')
    return url
