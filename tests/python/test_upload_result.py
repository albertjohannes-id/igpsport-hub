import json
from pathlib import Path
import tempfile
import unittest
from upload_result import classify, normalize, record, response_shape


class UploadResultTests(unittest.TestCase):
    def test_unfamiliar_fields_keep_structure_without_values(self):
        shape = response_shape({"uploadId": "private-value", "pending": True,
                                "token": {"secretValue": "secret"},
                                "private@example.com": "private"})
        self.assertEqual(shape["uploadId"], "str")
        self.assertEqual(shape["pending"], "bool")
        self.assertEqual(shape["token"], "redacted")
        self.assertNotIn("private", json.dumps(shape))

    def test_success_wrappers_and_direct_report(self):
        report = {"successes": [{"internalId": 123}], "failures": []}
        for body in (report, {"detailedImportResult": report}, {"DetailedImportResult": report}):
            self.assertEqual(classify(body), ("success", ["123"]))

    def test_unknown_and_mixed_are_not_success(self):
        for body in (None, {}, [], {"successes": [{}]},
                     {"successes": [{"internalId": 123}], "failures": [{}]}):
            self.assertEqual(classify(body)[0], "unknown")
        self.assertEqual(classify({"failures": [{"code": 409}]})[0], "rejected")

    def test_response_objects_and_strings(self):
        class Response:
            def json(self):
                return {"successes": [{"activityId": "456"}]}
        self.assertEqual(classify(normalize(Response())), ("success", ["456"]))
        self.assertEqual(normalize('{"failures": []}'), {"failures": []})
        self.assertIsNone(normalize("not JSON"))

    def test_log_does_not_keep_secrets_or_free_text(self):
        body = {"token": "secret-token", "email": "private@example.com",
                "detailedImportResult": {"successes": [{"internalId": 123}],
                    "messages": [{"code": 200, "content": "secret-password"}],
                    "externalId": "private-filename.fit"}}
        with tempfile.TemporaryDirectory() as directory:
            outcome, ids, path = record(body, directory)
            text = path.read_text()
            for secret in ("secret-token", "private@example.com", "secret-password", "private-filename.fit"):
                self.assertNotIn(secret, text)
            self.assertEqual(json.loads(text)["activity_ids"], ["123"])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
