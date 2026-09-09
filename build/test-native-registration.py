#!/usr/bin/env python3
"""Exercise the real registration paths without touching the Windows registry."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "native" / "register_scheduler_host.py"
SPEC = importlib.util.spec_from_file_location("scheduler_registration", SOURCE)
registration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(registration)


class RegistrationTests(unittest.TestCase):
    def test_windows_write_uses_module_api(self):
        writes = []
        keys = []

        class Handle:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        def create_key(root, name, reserved, access):
            keys.append((root, name, reserved, access))
            return Handle()

        stub = types.SimpleNamespace(
            HKEY_CURRENT_USER=1, KEY_WRITE=2, REG_SZ=3,
            CreateKeyEx=create_key,
            SetValueEx=lambda *args: writes.append(args),
        )
        with tempfile.TemporaryDirectory(prefix="aut-registration-test-") as directory:
            destination = Path(directory) / "scheduler.json"
            manifest = registration.chrome_manifest(Path(directory) / "host.exe", [registration.CHROME_EXTENSION_ID])
            plan = {"entries": [{"manifestPath": str(destination), "manifest": manifest, "registryKey": "test-only"}]}
            with patch.dict(sys.modules, {"winreg": stub}):
                registration.register_windows(plan)
            self.assertEqual(keys, [(1, "test-only", 0, 2)])
            self.assertEqual(len(writes), 1)
            self.assertIsInstance(writes[0][0], Handle)
            self.assertEqual(writes[0][1:], ("", 0, 3, str(destination)))
            self.assertEqual(json.loads(destination.read_text(encoding="utf-8")), manifest)

    def test_unregister_dry_run_never_mutates(self):
        output = io.StringIO()
        with patch.object(sys, "argv", [str(SOURCE), "--unregister", "--dry-run", "--browser", "chrome"]):
            with patch.object(registration, "unregister") as remove, contextlib.redirect_stdout(output):
                self.assertEqual(registration.main(), 0)
                remove.assert_not_called()
        result = json.loads(output.getvalue())
        self.assertEqual(result["action"], "unregister")
        self.assertEqual(result["browsers"], ["chrome"])


if __name__ == "__main__":
    unittest.main()
