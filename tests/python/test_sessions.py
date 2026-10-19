import base64
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from activities import normalize_activity
from session_trial import expiry_metadata, save


class SessionTests(unittest.TestCase):
    def test_normalization_preserves_duration_meanings(self):
        a = normalize_activity("igpsport", {"rideId": 1, "title": "Ride", "startTime": "2026.10.17", "totalMovingTime": 149, "rideDistance": 566.66})
        self.assertEqual(a["movingSeconds"], 149)
        self.assertIsNone(a["timerSeconds"])
        self.assertIsNone(a["startTimeUtc"])
        self.assertEqual(a["timePrecision"], "date")
        b = normalize_activity("garmin", {"activityId": 2, "duration": 150, "movingDuration": 149, "startTimeGMT": "2026-10-17 01:00:00"})
        self.assertEqual(b["timerSeconds"], 150)
        self.assertEqual(b["movingSeconds"], 149)
        self.assertTrue(b["startTimeUtc"].endswith("+00:00"))

    def test_invalid_metrics_remain_missing(self):
        a = normalize_activity("garmin", {"activityId": 1, "distance": float("nan"), "duration": -1})
        self.assertIsNone(a["distanceMeters"])
        self.assertIsNone(a["timerSeconds"])

    def test_expiry_only_no_token_claims(self):
        encoded = base64.urlsafe_b64encode(json.dumps({"exp": 2000, "private": "secret"}).encode()).decode().rstrip("=")
        with patch("session_trial.time.time", return_value=1000):
            self.assertEqual(expiry_metadata("a." + encoded + ".b"), {"expires_at": 2000, "remaining_seconds": 1000})
        self.assertEqual(expiry_metadata("invalid"), {})

    def test_private_atomic_session_file(self):
        with tempfile.TemporaryDirectory() as directory:
            auth = Path(directory) / "auth"
            with patch("session_trial.AUTH", auth):
                path = auth / "session.json"
                save(path, {"access_token": "test-only"})
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(auth.stat().st_mode & 0o777, 0o700)
                self.assertEqual(json.loads(path.read_text()), {"access_token": "test-only"})


if __name__ == "__main__":
    unittest.main()
