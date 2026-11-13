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

    def _mini_fit(self, slots=(3000, 2000, 1000, 0, 0), zone_field=65):
        import struct
        from fitdecode.utils import compute_crc
        definition = bytes([0x40, 0x00, 0x00]) + struct.pack('<HB', 18, 1)
        definition += struct.pack('<3B', zone_field, 20, 0x86)
        record = bytes([0x00]) + struct.pack('<5I', *slots)
        body = definition + record
        header = bytearray(14)
        header[0] = 14
        header[1] = 0x10
        header[2:4] = struct.pack('<H', 2110)
        header[4:8] = struct.pack('<I', len(body))
        header[8:12] = b'.FIT'
        header[12:14] = struct.pack('<H', compute_crc(bytes(header[:12])))
        return bytes(header) + body + struct.pack('<H', compute_crc(bytes(header) + body))

    def _hr_zone_fields(self, content):
        import fitdecode
        import io
        with fitdecode.FitReader(io.BytesIO(content)) as reader:
            return [field.raw_value for frame in reader if isinstance(frame, fitdecode.FitDataMessage)
                    for field in frame.fields if field.name == 'time_in_hr_zone']

    def test_shift_hr_zones_moves_slots_up_one(self):
        import struct
        from fitdecode.utils import compute_crc
        from web_api import shift_hr_zones
        original = self._mini_fit()
        shifted, changed = shift_hr_zones(original)
        self.assertTrue(changed)
        self.assertEqual(len(shifted), len(original))
        self.assertEqual(struct.unpack_from('<5I', shifted, 24), (0, 3000, 2000, 1000, 0))
        self.assertEqual(compute_crc(shifted[:-2]), struct.unpack_from('<H', shifted, len(shifted) - 2)[0])
        self.assertEqual(self._hr_zone_fields(shifted), [(0.0, 3000.0, 2000.0, 1000.0, 0.0)])
        self.assertEqual(self._hr_zone_fields(original), [(3000.0, 2000.0, 1000.0, 0.0, 0.0)])

    def test_shift_hr_zones_leaves_files_without_zone_time_unchanged(self):
        from web_api import shift_hr_zones
        for slots, field in (((0, 0, 0, 0, 0), 65), ((3000, 2000, 0, 0, 0), 66)):
            source = self._mini_fit(slots, zone_field=field)
            content, changed = shift_hr_zones(source)
            self.assertFalse(changed, f'slots={slots} field={field}')
            self.assertEqual(content, source)

    def test_shift_hr_zones_survives_malformed_bytes(self):
        from web_api import shift_hr_zones
        for junk in (b'', b'\x0e\x00', b'\x0e' + b'\xff' * 40, self._mini_fit()[:30], self._mini_fit() + b'\x00'):
            content, changed = shift_hr_zones(junk)
            self.assertFalse(changed)
            self.assertEqual(content, junk)

    def test_transfer_with_fix_zones_uploads_shifted_fit(self):
        import struct
        from datetime import datetime, timezone
        from pathlib import Path
        original = self._mini_fit()
        client = Mock()
        client.upload_activity.return_value = {'detailedImportResult': {'successes': [{'internalId': '77'}], 'failures': []}}
        captured = {}

        def record_upload(path):
            captured['bytes'] = Path(path).read_bytes()
            return client.upload_activity.return_value

        client.upload_activity.side_effect = record_upload
        response = Mock()
        response.is_redirect = False
        response.iter_content.return_value = [original]
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        summary = {'start': datetime(2026, 1, 2, 6, 0, tzinfo=timezone.utc), 'duration': 3600.0, 'distance': 30000.0}
        with patch.object(self.service, 'identity'), patch.object(self.service, 'load', return_value=client), \
             patch.object(self.service, 'igps_get', return_value={'fitUrl': 'https://fit.example.invalid/1', 'title': 'Ride'}), \
             patch('web_api.validate_fit_url', return_value='https://fit.example.invalid/1'), \
             patch('web_api.requests.get', return_value=response), \
             patch('web_api.fit_summary', return_value=summary), \
             patch('web_api.fetch_candidates', return_value=[]):
            result = self.service.transfer('1', fix_zones=True)
        self.assertEqual(result['state'], 'confirmed')
        self.assertTrue(result['zoneFix'])
        self.assertEqual(struct.unpack_from('<5I', captured['bytes'], 24), (0, 3000, 2000, 1000, 0))

    def test_transfer_without_fix_zones_uploads_original_fit(self):
        import struct
        from datetime import datetime, timezone
        from pathlib import Path
        original = self._mini_fit()
        client = Mock()
        client.upload_activity.return_value = {'detailedImportResult': {'successes': [{'internalId': '77'}], 'failures': []}}
        captured = {}

        def record_upload(path):
            captured['bytes'] = Path(path).read_bytes()
            return client.upload_activity.return_value

        client.upload_activity.side_effect = record_upload
        response = Mock()
        response.is_redirect = False
        response.iter_content.return_value = [original]
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        summary = {'start': datetime(2026, 1, 2, 6, 0, tzinfo=timezone.utc), 'duration': 3600.0, 'distance': 30000.0}
        with patch.object(self.service, 'identity'), patch.object(self.service, 'load', return_value=client), \
             patch.object(self.service, 'igps_get', return_value={'fitUrl': 'https://fit.example.invalid/1', 'title': 'Ride'}), \
             patch('web_api.validate_fit_url', return_value='https://fit.example.invalid/1'), \
             patch('web_api.requests.get', return_value=response), \
             patch('web_api.fit_summary', return_value=summary), \
             patch('web_api.fetch_candidates', return_value=[]):
            result = self.service.transfer('1')
        self.assertEqual(result['state'], 'confirmed')
        self.assertNotIn('zoneFix', result)
        self.assertEqual(struct.unpack_from('<5I', captured['bytes'], 24), (3000, 2000, 1000, 0, 0))

    def test_transfer_with_force_uploads_again_after_synced_history(self):
        import struct
        from datetime import datetime, timezone
        from pathlib import Path
        original = self._mini_fit()
        client = Mock()
        client.upload_activity.return_value = {'detailedImportResult': {'successes': [{'internalId': '77'}], 'failures': []}}
        captured = {}

        def record_upload(path):
            captured['bytes'] = Path(path).read_bytes()
            return client.upload_activity.return_value

        client.upload_activity.side_effect = record_upload
        self.service.history = [{'sourceId': '1', 'scope': 'scope', 'state': 'existing', 'activityId': '55', 'summary': {'start': '2026-01-02T06:00:00+00:00', 'duration': 3600.0, 'distance': 30000.0}, 'before': []}]
        self.service.scope = 'scope'
        response = Mock()
        response.is_redirect = False
        response.iter_content.return_value = [original]
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        summary = {'start': datetime(2026, 1, 2, 6, 0, tzinfo=timezone.utc), 'duration': 3600.0, 'distance': 30000.0}
        with patch.object(self.service, 'identity'), patch.object(self.service, 'load', return_value=client), \
             patch.object(self.service, 'igps_get', return_value={'fitUrl': 'https://fit.example.invalid/1', 'title': 'Ride'}), \
             patch('web_api.validate_fit_url', return_value='https://fit.example.invalid/1'), \
             patch('web_api.requests.get', return_value=response), \
             patch('web_api.fit_summary', return_value=summary), \
             patch('web_api.fetch_candidates', return_value=[]):
            result = self.service.transfer('1', force=True)
        self.assertEqual(result['state'], 'confirmed')
        client.upload_activity.assert_called_once()
        self.assertEqual(self.service.history[0]['state'], 'confirmed')
        self.assertEqual(len(self.service.history), 2)

    def test_transfer_without_force_short_circuits_synced_history(self):
        self.service.history = [{'sourceId': '1', 'scope': 'scope', 'state': 'existing', 'activityId': '55'}]
        self.service.scope = 'scope'
        client = Mock()
        with patch.object(self.service, 'identity'), patch.object(self.service, 'load', return_value=client):
            result = self.service.transfer('1')
        self.assertEqual(result['state'], 'existing')
        self.assertEqual(result['activityId'], '55')
        client.upload_activity.assert_not_called()

    def test_history_does_not_return_internal_matching_data(self):
        self.service.scope = 'scope'
        self.service.history = [{'sourceId': '1', 'scope': 'scope', 'state': 'confirmed', 'activityId': '2', 'summary': {'private': 'value'}, 'before': []}]
        with patch.object(self.service, 'identity'), patch.object(self.service, 'activities', return_value={}):
            result = self.service.status()
        self.assertNotIn('scope', result['history'][0])
        self.assertNotIn('summary', result['history'][0])

    def _tagged_ride(self, summary, candidates):
        import requests
        client = Mock()
        self.service.clients['garmin'] = client
        with patch.object(self.service, 'identity'), patch.object(self.service, 'load', return_value=client), \
             patch.object(self.service, 'igps_get', return_value={'title': 'Ride', 'fitUrl': 'https://fit.example.invalid/1'}), \
             patch('web_api.validate_fit_url', return_value='https://fit.example.invalid/1'), \
             patch('web_api.requests.get') as get, \
             patch('web_api.fit_summary', return_value=summary), \
             patch('web_api.fetch_candidates', return_value=candidates):
            get.return_value.__enter__ = Mock(return_value=get.return_value)
            get.return_value.__exit__ = Mock(return_value=False)
            get.return_value.is_redirect = False
            get.return_value.iter_content.return_value = [b'fit']
            return self.service.tag('1')

    def test_tag_records_verified_existing_ride(self):
        from datetime import datetime, timezone
        summary = {'start': datetime(2026, 1, 2, 6, 0, tzinfo=timezone.utc), 'duration': 3600.0, 'distance': 30000.0}
        candidate = {'activityId': 55, 'startTimeGMT': '2026-01-02T06:00:00.0Z', 'duration': 3601.0, 'distance': 30010.0}
        result = self._tagged_ride(summary, [candidate])
        self.assertEqual(result['state'], 'existing')
        self.assertEqual(result['activityId'], '55')
        self.assertEqual(self.service.history[0]['sourceId'], '1')
        self.assertTrue((self.root / 'web-history.json').exists())

    def test_tag_without_garmin_match_records_nothing(self):
        from datetime import datetime, timezone
        summary = {'start': datetime(2026, 1, 2, 6, 0, tzinfo=timezone.utc), 'duration': 3600.0, 'distance': 30000.0}
        with self.assertRaises(ApiError) as error:
            self._tagged_ride(summary, [{'activityId': 55, 'startTimeGMT': '2026-01-02T06:00:00.0Z', 'duration': 7200.0, 'distance': 30010.0}])
        self.assertEqual(error.exception.code, 'NOT_ON_GARMIN')
        self.assertEqual(self.service.history, [])

    def test_tag_skips_ride_already_recorded(self):
        self.service.history = [{'sourceId': '1', 'scope': 'scope', 'state': 'existing', 'activityId': '9'}]
        self.service.scope = 'scope'
        with patch.object(self.service, 'identity'), patch.object(self.service, 'load', return_value=Mock()):
            result = self.service.tag('1')
        self.assertEqual(result['state'], 'existing')
        self.assertEqual(result['activityId'], '9')


if __name__ == '__main__':
    unittest.main()
