import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from verify_bundle import REQUIRED_ROLES, verify_bundle


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {"source": {"commit": "a" * 40}, "target_platform": "linux-x86_64", "python_version": "3.12.10", "artifacts": []}
        for role in REQUIRED_ROLES:
            path = self.root / role
            path.write_bytes(role.encode())
            self.manifest["artifacts"].append({"path": role, "role": role, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "origin": "test-fixture", "license_path": "license"})
        self.path = self.root / "manifest.json"

    def run_verify(self):
        self.path.write_text(json.dumps(self.manifest), encoding="utf-8")
        return verify_bundle(self.root, self.path)

    def test_valid_inventory_is_not_offline_certification(self):
        self.assertTrue(self.run_verify()["inventory_verified"])
        self.assertFalse(self.run_verify()["offline_inference_verified"])

    def test_changed_artifact_rejected(self):
        (self.root / "weights").write_bytes(b"changed")
        with self.assertRaises(ValueError): self.run_verify()

    def test_missing_codec_rejected(self):
        self.manifest["artifacts"] = [a for a in self.manifest["artifacts"] if a["role"] != "tokenizer_codec"]
        with self.assertRaises(ValueError): self.run_verify()

    def test_escape_rejected(self):
        self.manifest["artifacts"][0]["path"] = "../outside"
        with self.assertRaises(ValueError): self.run_verify()

    def test_unpinned_source_rejected(self):
        self.manifest["source"] = {"commit": "main"}
        with self.assertRaises(ValueError): self.run_verify()


if __name__ == "__main__": unittest.main()
