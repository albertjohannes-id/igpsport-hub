import json
import tempfile
import unittest
from diagnostics import Trace
from ride_display import title, igps_row, garmin_row


class DiagnosticsTests(unittest.TestCase):
    def test_rejected_login_response_is_sanitized(self):
        class Response:
            status_code = 401
            def json(self):
                return {"code": 401, "message": "private-login-message", "token": "private-token"}
        with tempfile.TemporaryDirectory() as directory:
            trace = Trace(directory)
            error = ValueError("private-error")
            error.response = Response()
            trace.emit("garmin.login", error=error)
            text = trace.path.read_text()
            event = json.loads(text)
            self.assertEqual(event["http_status"], 401)
            self.assertEqual(event["response"]["code"], 401)
            self.assertNotIn("private-", text)

    def test_trace_redacts_and_preserves_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = Trace(directory)
            result = {"data": {"access_token": "secret-token"}, "rows": [{"title": "private title", "rideDistance": 12.3}]}
            wrapped = trace.wrap("igpsport.login", lambda password: result)
            self.assertIs(wrapped("secret-password"), result)
            text = trace.path.read_text()
            for value in ("secret-token", "secret-password", "private title"):
                self.assertNotIn(value, text)
            event = json.loads(text)
            self.assertEqual(event["operation"], "igpsport.login")
            self.assertEqual(event["response"]["rows"][0]["rideDistance"], 12.3)
            self.assertEqual(trace.path.stat().st_mode & 0o777, 0o600)

    def test_exception_text_not_logged(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = Trace(directory)
            def fail():
                raise ValueError("secret-response")
            with self.assertRaises(ValueError):
                trace.wrap("test.failure", fail)()
            self.assertNotIn("secret-response", trace.path.read_text())

    def test_title_and_units(self):
        self.assertEqual(title({"title": "Real name", "name": "old"}), "Real name")
        self.assertIn("0.57 km", igps_row({"rideDistance": 566.66}))
        self.assertIn("13.69 km/h", igps_row({"avgSpeed": 3.803}))
        self.assertIn("1.00 km", garmin_row({"distance": 1000, "duration": 60}))


if __name__ == "__main__":
    unittest.main()
