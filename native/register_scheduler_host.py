#!/usr/bin/env python3
"""Register the AI Usage Tracker scheduler native-messaging host.

Registration is per-user. Windows uses HKCU registry values, while macOS and
Linux use each browser's user-level NativeMessagingHosts directory. No admin
rights, service, scheduled task, or network access is required.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
from pathlib import Path
from typing import Any


HOST_NAME = "com.sysadmindoc.ai_usage_tracker.scheduler"
CHROME_EXTENSION_ID = "olkdpcileldmdemjbiklkhompnhkhjeh"
FIREFOX_EXTENSION_ID = "ai-usage-tracker@sysadmindoc.dev"

CHROMIUM_REGISTRY = {
    "chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
    "chromium": r"Software\Chromium\NativeMessagingHosts",
}
FIREFOX_REGISTRY = r"Software\Mozilla\NativeMessagingHosts"


def chrome_manifest(host_path: Path, extension_ids: list[str]) -> dict[str, Any]:
    return {
        "name": HOST_NAME,
        "description": "AI Usage Tracker local scheduler companion.",
        "path": str(host_path),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/" for extension_id in extension_ids],
    }


def firefox_manifest(host_path: Path, extension_ids: list[str]) -> dict[str, Any]:
    return {
        "name": HOST_NAME,
        "description": "AI Usage Tracker local scheduler companion.",
        "path": str(host_path),
        "type": "stdio",
        "allowed_extensions": extension_ids,
    }


def browser_choices(value: str) -> list[str]:
    if value == "all":
        return ["chrome", "edge", "chromium", "firefox"]
    return [value]


def user_manifest_dirs(browser: str) -> list[Path]:
    home = Path.home()
    system = platform.system()
    if browser == "firefox":
        if system == "Darwin":
            return [home / "Library/Application Support/Mozilla/NativeMessagingHosts"]
        return [home / ".mozilla/native-messaging-hosts"]
    if system == "Darwin":
        roots = {
            "chrome": [home / "Library/Application Support/Google/Chrome/NativeMessagingHosts"],
            "edge": [home / "Library/Application Support/Microsoft Edge/NativeMessagingHosts"],
            "chromium": [home / "Library/Application Support/Chromium/NativeMessagingHosts"],
        }
    else:
        roots = {
            "chrome": [home / ".config/google-chrome/NativeMessagingHosts"],
            "edge": [home / ".config/microsoft-edge/NativeMessagingHosts"],
            "chromium": [home / ".config/chromium/NativeMessagingHosts"],
        }
    return roots[browser]


def selected_manifest_path(manifest_dir: Path, browser: str) -> Path:
    suffix = "firefox" if browser == "firefox" else "chromium"
    return manifest_dir / f"{HOST_NAME}-{suffix}.json"


def registry_key(browser: str) -> str:
    root = FIREFOX_REGISTRY if browser == "firefox" else CHROMIUM_REGISTRY[browser]
    return f"{root}\\{HOST_NAME}"


def build_plan(host_path: Path, browsers: list[str], manifest_dir: Path, extension_ids: list[str], firefox_ids: list[str]) -> dict[str, Any]:
    entries = []
    for browser in browsers:
        manifest = firefox_manifest(host_path, firefox_ids) if browser == "firefox" else chrome_manifest(host_path, extension_ids)
        path = selected_manifest_path(manifest_dir, browser)
        entries.append({
            "browser": browser,
            "manifestPath": str(path),
            "manifest": manifest,
            "registryKey": registry_key(browser) if os.name == "nt" else None,
            "manifestDirs": [str(path) for path in user_manifest_dirs(browser)] if os.name != "nt" else [],
        })
    return {"hostName": HOST_NAME, "hostPath": str(host_path), "entries": entries}


def register_windows(plan: dict[str, Any]) -> None:
    import winreg

    for entry in plan["entries"]:
        manifest_path = Path(entry["manifestPath"])
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(entry["manifest"], indent=2) + "\n", encoding="utf-8")
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, entry["registryKey"], 0, winreg.KEY_WRITE) as key:
            key.SetValue("", winreg.REG_SZ, str(manifest_path))


def register_unix(plan: dict[str, Any]) -> None:
    for entry in plan["entries"]:
        for directory_text in entry["manifestDirs"]:
            directory = Path(directory_text)
            directory.mkdir(parents=True, exist_ok=True)
            manifest_path = directory / f"{HOST_NAME}.json"
            manifest_path.write_text(json.dumps(entry["manifest"], indent=2) + "\n", encoding="utf-8")


def unregister(browser_list: list[str], manifest_dir: Path | None) -> None:
    if os.name == "nt":
        import winreg

        for browser in browser_list:
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, registry_key(browser))
            except FileNotFoundError:
                pass
        if manifest_dir:
            for browser in browser_list:
                selected_manifest_path(manifest_dir, browser).unlink(missing_ok=True)
        return
    for browser in browser_list:
        for directory in user_manifest_dirs(browser):
            (directory / f"{HOST_NAME}.json").unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Register the AI Usage Tracker local scheduler host.")
    parser.add_argument("--host-path", help="Absolute path to an executable native-messaging host.")
    parser.add_argument("--browser", choices=["chrome", "edge", "chromium", "firefox", "all"], default="all")
    parser.add_argument("--extension-id", action="append", dest="extension_ids", help="Additional Chromium extension ID.")
    parser.add_argument("--firefox-extension-id", action="append", dest="firefox_ids", help="Additional Firefox extension ID.")
    parser.add_argument("--manifest-dir", type=Path, help="Directory for generated manifests (useful for portable installs/tests).")
    parser.add_argument("--dry-run", action="store_true", help="Print the registration plan without writing files or registry keys.")
    parser.add_argument("--unregister", action="store_true", help="Remove per-user registration for the selected browsers.")
    args = parser.parse_args()
    browsers = browser_choices(args.browser)

    if args.unregister:
        unregister(browsers, args.manifest_dir.resolve() if args.manifest_dir else None)
        print(f"Unregistered {HOST_NAME} for: {', '.join(browsers)}")
        return 0

    if not args.host_path:
        parser.error("--host-path is required unless --unregister is used")
    host_path = Path(args.host_path).expanduser().resolve()
    if not args.dry_run and not host_path.is_file():
        parser.error(f"host path does not exist: {host_path}")
    manifest_dir = (args.manifest_dir or host_path.parent).expanduser().resolve()
    plan = build_plan(
        host_path,
        browsers,
        manifest_dir,
        [CHROME_EXTENSION_ID, *(args.extension_ids or [])],
        [FIREFOX_EXTENSION_ID, *(args.firefox_ids or [])],
    )
    if args.dry_run:
        print(json.dumps(plan, indent=2))
        return 0

    if os.name == "nt":
        register_windows(plan)
    else:
        register_unix(plan)
    print(f"Registered {HOST_NAME} for: {', '.join(browsers)}")
    print(f"Host path: {host_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
