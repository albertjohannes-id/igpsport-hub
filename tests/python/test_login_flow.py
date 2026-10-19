import unittest
from unittest.mock import Mock
import requests
from garminconnect.exceptions import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from login_flow import connect


class LoginTests(unittest.TestCase):
    def test_observed_igps_wrong_password_code(self):
        client = Mock()
        response = Mock(status_code=403)
        response.json.return_value = {"code": 1002, "message": "redacted"}
        client.session.request.return_value = response
        def login():
            client.session.request("POST", "https://example.test")
            return False
        client.login.side_effect = login
        say = Mock()
        connect("iGPSPORT", Mock(return_value=client), Mock(side_effect=["user", "n"]),
                Mock(return_value="wrong"), say)
        self.assertIn("rejected the login", str(say.call_args_list))
        self.assertNotIn("blocking the connection", str(say.call_args_list))

    def test_auth_retry_keeps_username_and_new_password(self):
        first, second = Mock(), Mock()
        first.login.side_effect = GarminConnectAuthenticationError("sensitive")
        factory = Mock(side_effect=[first, second])
        say = Mock()
        result, name = connect("Garmin", factory, Mock(side_effect=["user", "y", ""]),
                               Mock(side_effect=["wrong", "correct"]), say)
        self.assertIs(result, second)
        self.assertEqual(name, "user")
        self.assertEqual(factory.call_args_list[1].args[:2], ("user", "correct"))
        self.assertNotIn("sensitive", str(say.call_args_list))

    def test_rate_limit_does_not_retry(self):
        client = Mock()
        client.login.side_effect = GarminConnectTooManyRequestsError()
        factory = Mock(return_value=client)
        self.assertIsNone(connect("Garmin", factory, Mock(return_value="user"),
                                  Mock(return_value="password"), Mock())[0])
        self.assertEqual(factory.call_count, 1)

    def test_igps_network_failure_not_password_error(self):
        client = Mock()
        client.session.request.side_effect = requests.Timeout()
        def login():
            try:
                client.session.request("POST", "https://example.test")
            except requests.RequestException:
                return False
        client.login.side_effect = login
        say = Mock()
        connect("iGPSPORT", Mock(return_value=client), Mock(side_effect=["user", "n"]),
                Mock(return_value="password"), say)
        self.assertIn("Could not reach", str(say.call_args_list))
        self.assertIsNone(client.password)

    def test_cancel_before_password(self):
        secret = Mock()
        self.assertIsNone(connect("Garmin", Mock(), Mock(return_value="q"), secret, Mock())[0])
        secret.assert_not_called()


if __name__ == "__main__":
    unittest.main()
