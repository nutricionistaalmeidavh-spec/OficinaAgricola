"""Contrato local do worker; nunca faz rede nem usa certificado nos testes."""
import json
from pathlib import Path
import subprocess
import sys
import unittest


WORKER = Path(__file__).resolve().parents[2] / "src/platform/acbrlib-worker.py"


class FiscalWorkerCliTests(unittest.TestCase):
    def test_self_test_is_read_only_and_needs_no_certificate(self):
        result = subprocess.run([sys.executable, str(WORKER), "--self-test"],
                                capture_output=True, text=True, check=True)
        value = json.loads(result.stdout)
        self.assertTrue(value["ok"])
        self.assertFalse(value["frozen"])
        self.assertNotIn("password", result.stdout.lower())

    def test_probe_fails_closed_without_real_native_library(self):
        result = subprocess.run([sys.executable, str(WORKER), "--probe",
                                 str(WORKER.parent / "inexistente.dll")],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        value = json.loads(result.stdout)
        self.assertFalse(value["ok"])
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
