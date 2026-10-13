"""Standalone source fixtures; no live organs, provider or private-store reads."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "bin" / "te-organ-contain.py"
POLICY = ROOT / "router" / "module-descriptors" / "organs.json"
PROVENANCE = ROOT / "provenance.v1.json"
GUARD_SHA = "289643f5955ec243564728bf952e36e768cc8cb20430aa3d64766a4b674ab478"
SOURCE_COMMIT = "b57931b11859cdd5ab39fa14160abf093dd2139f"
ALLOWANCES = {"auspex": 10, "circulator": 3, "nutrix": 16, "praeceptor": 8, "self-heal": 9, "vestibule": 16, "adytum": 24}


def load():
    spec = importlib.util.spec_from_file_location("standalone_organ_guard", GUARD)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(raw):
    return "sha256:" + hashlib.sha256(raw).hexdigest()


class StandaloneGuardTests(unittest.TestCase):
    def test_closed_provenance_and_exact_guard(self):
        p = json.loads(PROVENANCE.read_bytes())
        self.assertEqual(set(p), {"schema", "source_repository", "source_commit", "source_path", "source_sha256", "packaged_path", "policy_source_path", "policy_source_sha256", "policy_sha256", "policy_structure_sha256", "policy_transform", "numerical_policy_changed", "source_only", "installed", "callback_joined", "semantic_acceptance", "capacity_authorization", "execution_authorized"})
        self.assertEqual(p["schema"], "temperance.organ-guard-source.v1")
        self.assertEqual(p["source_repository"], "github.com/Sheshiyer/noesis-cambium")
        self.assertEqual(p["source_commit"], SOURCE_COMMIT)
        self.assertEqual(p["source_path"], "bin/te-organ-contain.py")
        self.assertEqual(p["packaged_path"], "package/organ-guard/bin/te-organ-contain.py")
        self.assertEqual(digest(GUARD.read_bytes()), "sha256:" + GUARD_SHA)
        self.assertEqual(p["source_sha256"], "sha256:" + GUARD_SHA)
        self.assertEqual(p["policy_sha256"], digest(POLICY.read_bytes()))
        self.assertEqual(p["policy_source_sha256"], "sha256:9086cf1d8ce0471ed1d3fe4de5afa9eaa31ac1d32740ce5f023c794a1b7d0a25")
        self.assertEqual(p["policy_transform"], "resource.organ_process_allowance.basis prose only")
        self.assertIs(p["source_only"], True)
        for key in ("numerical_policy_changed", "installed", "callback_joined", "semantic_acceptance", "capacity_authorization", "execution_authorized"):
            self.assertIs(p[key], False)
        ast.parse(GUARD.read_bytes())

    def test_policy_structure_parity_except_declared_prose(self):
        p = json.loads(PROVENANCE.read_bytes())
        policy = json.loads(POLICY.read_bytes())
        policy["resource"]["organ_process_allowance"].pop("basis")
        normalized = json.dumps(policy, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual(digest(normalized), p["policy_structure_sha256"])
        self.assertEqual(p["policy_structure_sha256"], "sha256:7d6d854042b38dc6a353b6d381f055e446436c16497708aadf26ea960cf97c26")
        self.assertIs(policy["default_enabled"], False)

    def test_import_and_descriptor_lookup_outside_checkout_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            before = Path.cwd()
            try:
                os.chdir(tmp)
                m = load()
                for organ, expected in ALLOWANCES.items():
                    count, receipt = m.organ_process_allowance(organ)
                    self.assertEqual(count, expected)
                    self.assertEqual(receipt["descriptor_sha256"], hashlib.sha256(POLICY.read_bytes()).hexdigest())
                self.assertEqual((m.LIMIT_RSS, m.LIMIT_WALL, m.LIMIT_CHILDREN, m.MAX_LIFETIME_IDENTITIES), (163840, 120.0, 24, 4096))
                with self.assertRaises(ValueError):
                    m.organ_process_allowance("unknown")
            finally:
                os.chdir(before)

    @unittest.skipUnless(sys.platform in ("darwin", "linux"), "native birth backend unsupported")
    def test_own_process_birth_metadata_only(self):
        m = load()
        first = m.identity(os.getpid())
        self.assertIsNotNone(first)
        self.assertEqual(m.identity(os.getpid()), first)
        self.assertTrue(all(type(x) is int and x >= 0 for x in first))

    def test_unknown_pressure_never_admits(self):
        m = load()
        self.assertEqual(m.pressure_status(lambda: None), "host_pressure_unavailable")
        self.assertEqual(m.pressure_status(lambda: "host_pressure_elevated"), "host_pressure_elevated")

    def test_cli_bad_packaged_descriptor_holds_before_command_launch(self):
        with tempfile.TemporaryDirectory() as tmp:
            layout = Path(tmp)
            (layout / "bin").mkdir()
            (layout / "router/module-descriptors").mkdir(parents=True)
            guard = layout / "bin/te-organ-contain.py"
            guard.write_bytes(GUARD.read_bytes())
            (layout / "router/module-descriptors/organs.json").write_text('{"schema":"wrong"}')
            marker = layout / "should-not-exist"
            receipt = layout / "receipt.jsonl"
            result = subprocess.run([sys.executable, "-I", "-B", str(guard), "run", "--receipt", str(receipt), "--run-id", "invalid-policy", "--organ", "vestibule", "--wall", "3", "--", sys.executable, "-I", "-B", "-c", "from pathlib import Path;Path('should-not-exist').touch()"], env={"PATH": "/usr/bin:/bin"}, cwd=tmp, capture_output=True, timeout=3)
            self.assertEqual(result.returncode, 125)
            self.assertFalse(marker.exists())
            row = json.loads(receipt.read_bytes().splitlines()[-1])
            self.assertEqual(row["failure_operation"], "process_allowance")
            self.assertFalse(row["semantic_acceptance"])
            self.assertTrue(row["cleanup_complete"])

    @unittest.skipUnless(sys.platform in ("darwin", "linux"), "native guard backend unsupported")
    def test_inert_cli_normal_point_pressure_only(self):
        m = load()
        pressure = m.pressure_status(m.host_pressure)
        if pressure != "normal":
            self.skipTest("inert child held by point preflight: " + pressure)
        with tempfile.TemporaryDirectory() as tmp:
            receipt = Path(tmp) / "receipt.jsonl"
            result = subprocess.run([sys.executable, "-I", "-B", str(GUARD), "run", "--receipt", str(receipt), "--run-id", "standalone-inert", "--organ", "vestibule", "--wall", "3", "--", sys.executable, "-I", "-B", "-c", "pass"], env={"PATH": "/usr/bin:/bin"}, cwd=tmp, capture_output=True, timeout=5)
            self.assertTrue(receipt.is_file())
            row = json.loads(receipt.read_bytes().splitlines()[-1])
            self.assertFalse(row["semantic_acceptance"])
            self.assertEqual(row["limits"], {"wall_seconds": 3.0, "rss_kib": 163840, "descendants": 16})
            self.assertEqual(row["exit_code"], result.returncode)
            if result.returncode == 0:
                self.assertEqual(row["status"], "completed")
                self.assertTrue(row["cleanup_complete"])
            else:
                self.assertEqual(result.returncode, 125)
                self.assertIn(row["reason"], ("host_pressure_elevated", "host_pressure_unavailable"))
                self.assertEqual(row["status"], "failed")
            self.assertNotIn("args", row)
            self.assertNotIn("command", row)


if __name__ == "__main__":
    unittest.main()
