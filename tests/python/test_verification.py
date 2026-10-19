from datetime import datetime, timezone
import unittest
from unittest.mock import Mock
from verification import matches, verify


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.summary = {"start": datetime(2026, 10, 16, 1, tzinfo=timezone.utc),
                        "duration": 120.0, "distance": 1000.0}
        self.ride = {"activityId": 123, "startTimeGMT": "2026-10-16 01:00:00",
                     "duration": 120, "distance": 1000}

    def test_match_requires_all_metrics(self):
        self.assertTrue(matches(self.ride, self.summary))
        for changes in ({"distance": 2000}, {"duration": 200},
                        {"startTimeGMT": "2026-10-16 02:00:00"}, {"distance": None}):
            self.assertFalse(matches(self.ride | changes, self.summary))

    def test_existing_ride_is_not_new_success(self):
        client = Mock()
        client.get_activities_by_date.return_value = [self.ride]
        self.assertIsNone(verify(client, self.summary, [self.ride], sleep=Mock(), say=Mock()))
        client.upload_activity.assert_not_called()

    def test_delayed_new_ride_is_confirmed(self):
        client = Mock()
        client.get_activities_by_date.side_effect = [[], [self.ride]]
        self.assertEqual(verify(client, self.summary, [], sleep=Mock(), say=Mock()), "123")
        client.upload_activity.assert_not_called()

    def test_ambiguous_matches_not_confirmed(self):
        client = Mock()
        client.get_activities_by_date.return_value = [self.ride, self.ride | {"activityId": 456}]
        self.assertIsNone(verify(client, self.summary, [], sleep=Mock(), say=Mock()))


if __name__ == "__main__":
    unittest.main()
