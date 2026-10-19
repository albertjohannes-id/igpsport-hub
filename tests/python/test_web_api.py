import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from web_api import Service, ApiError


class WebApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patches = [patch('web_api.AUTH', self.root), patch('web_api.ROOT', self.root)]
        for item in self.patches:
            item.start()
        self.service = Service()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.temp.cleanup()

    def test_missing_session_requests_reconnect(self):
        with self.assertRaises(ApiError) as error:
            self.service.load('igpsport')
        self.assertEqual(error.exception.code, 'RECONNECT')

    def test_history_scope_survives_token_refresh(self):
        path = self.root / 'garmin.json'
        path.write_text('{"token":"old-test-value"}')
        self.service.identity()
        original = self.service.scope
        path.write_text('{"token":"refreshed-test-value"}')
        self.service.identity()
        self.assertEqual(self.service.scope, original)

    def test_igps_rejected_session_requests_reconnect(self):
        for status in (401, 403):
            client = Mock(base_url='https://example.invalid')
            client.session.get.return_value.status_code = status
            with patch.object(self.service, 'load', return_value=client):
                with self.assertRaises(ApiError) as error:
                    self.service.igps_get('/activities')
            self.assertEqual(error.exception.code, 'RECONNECT')
            self.service.failure('igpsport', error.exception)
            self.assertEqual(self.service.sessions['igpsport']['state'], 'disconnected')

    def test_timeout_does_not_claim_bad_password_or_clear_session(self):
        import requests
        client = Mock()
        self.service.clients['igpsport'] = client
        self.service.failure('igpsport', requests.Timeout())
        self.assertEqual(self.service.sessions['igpsport']['state'], 'error')
        self.assertIs(self.service.clients['igpsport'], client)

    def test_activity_response_is_normalized(self):
        with patch.object(self.service, 'igps_get', return_value={'rows': [{'rideId': 1, 'title': 'Ride', 'rideDistance': 1200}], 'totalPage': 2}):
            result = self.service.activities('igpsport')
        self.assertEqual(result['activities'][0]['distanceMeters'], 1200)
        self.assertTrue(result['hasMore'])
        self.assertEqual(self.service.sessions['igpsport']['state'], 'connected')

    def test_extended_metrics_keep_units_and_missing_sensor_values(self):
        from activities import normalize_activity
        igps = normalize_activity('igpsport', {'rideId': 1, 'totalAscent': 57, 'maxSpeed': 10.094, 'avgHrm': 123, 'avgCad': 77, 'calorie': 674})
        garmin = normalize_activity('garmin', {'activityId': 1, 'elevationGain': 57, 'maxSpeed': 10.094, 'averageHR': 123, 'averageBikingCadenceInRevPerMinute': 77, 'calories': 674})
        for key in ('ascentMeters', 'maxSpeedMps', 'averageHeartRateBpm', 'averageCadenceRpm', 'caloriesKcal'):
            self.assertEqual(igps[key], garmin[key])
        self.assertEqual(igps['maxSpeedMps'], 10.094)
        absent = normalize_activity('igpsport', {'rideId': 2, 'avgHrm': 0, 'avgCad': -1})
        self.assertIsNone(absent['averageHeartRateBpm'])
        self.assertIsNone(absent['averageCadenceRpm'])

    def test_unconfirmed_transfer_cannot_upload_again(self):
        self.service.history = [{'sourceId': '1', 'scope': 'scope', 'state': 'unconfirmed'}]
        self.service.scope = 'scope'
        client = Mock()
        with patch.object(self.service, 'identity'), patch.object(self.service, 'load', return_value=client):
            with self.assertRaises(ApiError) as error:
                self.service.transfer('1')
        self.assertEqual(error.exception.code, 'CHECK_FIRST')
        client.upload_activity.assert_not_called()

    def test_history_does_not_return_internal_matching_data(self):
        self.service.scope = 'scope'
        self.service.history = [{'sourceId': '1', 'scope': 'scope', 'state': 'confirmed', 'activityId': '2', 'summary': {'private': 'value'}, 'before': []}]
        with patch.object(self.service, 'identity'), patch.object(self.service, 'activities', return_value={}):
            result = self.service.status()
        self.assertNotIn('scope', result['history'][0])
        self.assertNotIn('summary', result['history'][0])


if __name__ == '__main__':
    unittest.main()
