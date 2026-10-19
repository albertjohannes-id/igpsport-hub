import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from connections import Connections
import apex_local


class CombinedTests(unittest.TestCase):
    def test_saved_igps_session_does_not_prompt_for_login(self):
        with tempfile.TemporaryDirectory() as directory, patch("connections.AUTH", Path(directory)):
            (Path(directory) / "igpsport.json").write_text(json.dumps({"access_token": "test-token"}))
            manager = Connections(Mock())
            client = Mock()
            client.session.headers = {}
            with patch("connections.IGPSportClient", return_value=client), patch.object(manager, "instrument"), patch.object(manager, "validate") as validate, patch("connections.connect") as login:
                selected, _ = manager.get("igpsport")
            self.assertIs(selected, client)
            validate.assert_called_once_with("igpsport", client)
            login.assert_not_called()
            self.assertEqual(client.session.headers["authorization"], "Bearer test-token")

    def test_disconnect_clears_memory_and_disk(self):
        with tempfile.TemporaryDirectory() as directory, patch("connections.AUTH", Path(directory)):
            path = Path(directory) / "garmin.json"
            path.write_text("{}")
            manager = Connections(Mock())
            manager.clients["garmin"] = Mock()
            manager.disconnect("garmin")
            self.assertFalse(path.exists())
            self.assertNotIn("garmin", manager.clients)

    def test_menu_returns_after_activity_action(self):
        with tempfile.TemporaryDirectory() as directory, patch("apex_local.ROOT", Path(directory)), patch("apex_local.Connections") as cls, patch("apex_local.trial.main") as transfer, patch("builtins.input", side_effect=["1", "2", "0"]), patch("apex_local.browse_garmin") as browse:
            cls.return_value.status = {}
            apex_local.main()
            transfer.assert_called_once_with(cls.return_value)
            browse.assert_called_once_with(cls.return_value)


if __name__ == "__main__":
    unittest.main()
