#!/usr/bin/env python3
"""Local native-messaging scheduler for AI Usage Tracker.

The helper intentionally has no network, filesystem, browser, or credential
access. It receives a refresh cadence and one future notification deadline,
then emits wake messages over Chrome/Firefox's stdio native-messaging pipe.
"""

from __future__ import annotations

import datetime as _datetime
import json
import os
import queue
import struct
import sys
import threading
import time
from typing import Any


SCHEMA_VERSION = 1
MAX_FRAME_BYTES = 1024 * 1024
MIN_REFRESH_MINUTES = 1
MAX_REFRESH_MINUTES = 1440


def _now_iso() -> str:
    return _datetime.datetime.now(_datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _write_message(message: dict[str, Any]) -> None:
    payload = json.dumps(message, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    if len(payload) > MAX_FRAME_BYTES:
        raise ValueError("outbound message exceeds native-messaging frame limit")
    output = sys.stdout.buffer
    output.write(struct.pack("<I", len(payload)))
    output.write(payload)
    output.flush()


def _read_exact(stream: Any, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _read_messages(events: queue.Queue[tuple[str, Any]]) -> None:
    stream = sys.stdin.buffer
    while True:
        header = _read_exact(stream, 4)
        if not header:
            events.put(("eof", None))
            return
        if len(header) != 4:
            events.put(("fatal", "short native-messaging frame header"))
            return
        length = struct.unpack("<I", header)[0]
        if length <= 0 or length > MAX_FRAME_BYTES:
            events.put(("fatal", f"invalid native-messaging frame length: {length}"))
            return
        payload = _read_exact(stream, length)
        if len(payload) != length:
            events.put(("fatal", "short native-messaging frame payload"))
            return
        try:
            message = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            events.put(("invalid", str(error)))
            continue
        events.put(("message", message))


class Scheduler:
    def __init__(self) -> None:
        self.refresh_minutes: int | None = None
        self.next_refresh_monotonic: float | None = None
        self.notification_at_epoch: float | None = None
        self.notification_at_iso: str | None = None

    def apply(self, message: dict[str, Any]) -> dict[str, Any]:
        if message.get("schemaVersion") != SCHEMA_VERSION:
            return {"kind": "error", "schemaVersion": SCHEMA_VERSION, "detail": "unsupported-schema"}

        minutes = message.get("refreshMinutes")
        if isinstance(minutes, bool) or not isinstance(minutes, (int, float)) or int(minutes) != minutes:
            return {"kind": "error", "schemaVersion": SCHEMA_VERSION, "detail": "invalid-refresh-minutes"}
        minutes = int(minutes)
        if not MIN_REFRESH_MINUTES <= minutes <= MAX_REFRESH_MINUTES:
            return {"kind": "error", "schemaVersion": SCHEMA_VERSION, "detail": "refresh-minutes-out-of-range"}

        deadline = message.get("notificationAtISO")
        deadline_epoch: float | None = None
        if deadline is not None:
            if not isinstance(deadline, str):
                return {"kind": "error", "schemaVersion": SCHEMA_VERSION, "detail": "invalid-notification-deadline"}
            try:
                parsed = _datetime.datetime.fromisoformat(deadline.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=_datetime.timezone.utc)
                deadline_epoch = parsed.timestamp()
            except ValueError:
                return {"kind": "error", "schemaVersion": SCHEMA_VERSION, "detail": "invalid-notification-deadline"}

        self.refresh_minutes = minutes
        self.next_refresh_monotonic = time.monotonic() + minutes * 60
        self.notification_at_epoch = deadline_epoch
        self.notification_at_iso = deadline
        return {
            "kind": "scheduled",
            "schemaVersion": SCHEMA_VERSION,
            "refreshMinutes": minutes,
            "notificationAtISO": deadline,
        }

    def next_timeout(self) -> float | None:
        deadlines: list[float] = []
        if self.next_refresh_monotonic is not None:
            deadlines.append(self.next_refresh_monotonic - time.monotonic())
        if self.notification_at_epoch is not None:
            deadlines.append(self.notification_at_epoch - time.time())
        if not deadlines:
            return None
        return max(0.0, min(deadlines))

    def due_wake(self) -> str | None:
        now_epoch = time.time()
        if self.notification_at_epoch is not None and now_epoch >= self.notification_at_epoch:
            self.notification_at_epoch = None
            self.notification_at_iso = None
            return "notification"
        if self.next_refresh_monotonic is not None and time.monotonic() >= self.next_refresh_monotonic:
            self.next_refresh_monotonic = time.monotonic() + (self.refresh_minutes or 5) * 60
            return "refresh"
        return None


def run() -> int:
    if os.name == "nt":
        import msvcrt

        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    events: queue.Queue[tuple[str, Any]] = queue.Queue()
    reader = threading.Thread(target=_read_messages, args=(events,), daemon=True)
    reader.start()
    scheduler = Scheduler()

    while True:
        timeout = scheduler.next_timeout()
        try:
            event, value = events.get(timeout=1.0 if timeout is None else min(timeout, 1.0))
        except queue.Empty:
            event, value = "tick", None

        if event == "eof":
            return 0
        if event == "fatal":
            print(f"[ai-usage-tracker-scheduler] {value}", file=sys.stderr)
            return 1
        if event == "invalid":
            _write_message({"kind": "error", "schemaVersion": SCHEMA_VERSION, "detail": "invalid-json"})
            continue
        if event == "message":
            if not isinstance(value, dict):
                _write_message({"kind": "error", "schemaVersion": SCHEMA_VERSION, "detail": "message-must-be-object"})
                continue
            kind = value.get("kind")
            if kind == "ping":
                _write_message({"kind": "pong", "schemaVersion": SCHEMA_VERSION, "ts": _now_iso()})
            elif kind == "schedule":
                _write_message(scheduler.apply(value))
            else:
                _write_message({"kind": "error", "schemaVersion": SCHEMA_VERSION, "detail": "unknown-kind"})

        reason = scheduler.due_wake()
        if reason:
            _write_message({"kind": "wake", "schemaVersion": SCHEMA_VERSION, "reason": reason, "ts": _now_iso()})


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except BrokenPipeError:
        raise SystemExit(0)
