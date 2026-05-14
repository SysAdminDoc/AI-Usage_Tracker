# AI Usage Tracker — Design

**Date:** 2026-05-14
**Version target:** v0.1.0
**Status:** Approved (user opted out of formal review cycle; assumptions locked, building immediately).

## Problem

Both Anthropic (claude.ai) and OpenAI (chatgpt.com Codex) expose per-user usage limits with reset countdowns — Claude shows a 5-hour "Current session" and a 7-day "Weekly limits" rollup with per-model breakouts; Codex shows a "5 hour usage limit" and "Weekly usage limit" plus per-model rows. The data lives on a settings page the user has to navigate to. There is no ambient awareness while working in `/chat` or `/codex/cloud/...` — so users either run out of quota unexpectedly or waste fresh quota by not knowing it just renewed.

## Goal

Persistent, premium-feeling countdown surface that:
- Shows the renewal time for both providers' daily and weekly buckets while the user is working.
- Notifies the user when renewals are imminent, when renewals arrive, when usage thresholds trip, and at a configurable daily briefing time.
- Forecasts when the weekly limit will be hit at current burn rate.
- Ships as a Chrome extension, a Firefox extension, and a Tampermonkey/Violentmonkey userscript from one source tree.

## Locked decisions

| # | Decision |
|---|---|
| 1 | Three deliverables — Chrome MV3, Firefox MV3, userscript — single source. |
| 2 | Three surfaces — floating glass widget on host sites + toolbar popup dashboard + OS notifications. |
| 3 | Data source — direct authenticated `fetch()` to the analytics URLs from the background service worker; falls back to silent hidden tab if the page is a hydration shell. |
| 4 | Granularity — headline only by default ("5 hour / Weekly" for Codex; "Current session / All models" for Claude); every sub-row is a togglable checkbox in Settings. |
| 5 | Notification triggers — R1 imminent (lead times 60/15/0 min), R2 on-reset, U1 thresholds (75/90/95% used), U2 burn-rate forecast, D1 daily 8 AM briefing. All toggleable. |
| 6 | Visual language — Catppuccin Mocha, glassmorphism, shimmer on hover; radial ring countdown with HH:MM:SS center; green→amber→red color ramp by remaining %; corner radius 12 (no pills); drag-positionable widget, minimizes to a 32 px square badge. |
| 7 | Refresh — 5 min default, 1/5/15/30 configurable. |
| 8 | History — 30-day rolling samples per bucket; `chrome.storage.local` in extensions, `GM.setValue` in userscript. |
| 9 | Repo — local commits during build, public GitHub repo with MIT license at the end of v0.1.0. |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Single source tree: src/                                        │
│                                                                 │
│ ┌─────────────────┐  ┌────────────────┐  ┌──────────────────┐   │
│ │ scrapers/       │  │ lib/           │  │ ui/              │   │
│ │   claude.js     │  │   countdown.js │  │   widget.js+css  │   │
│ │   codex.js      │  │   history.js   │  │   popup.html+js  │   │
│ │                 │  │   notify.js    │  │   options.html+js│   │
│ │                 │  │   storage.js   │  │   theme.css      │   │
│ │                 │  │   browser.js   │  │                  │   │
│ └─────────────────┘  └────────────────┘  └──────────────────┘   │
│                                                                 │
│ background.js     content.js     userscript-entry.js            │
└──────────────────┬───────────────┬──────────────────┬───────────┘
                   │               │                  │
        ┌──────────▼──────┐ ┌──────▼──────┐  ┌────────▼─────────┐
        │ build/chrome.mjs│ │ ../firefox  │  │ ../userscript    │
        │ → dist/chrome/  │ │ → dist/ff/  │  │ → ai-usage-      │
        │   .zip + .crx   │ │   .xpi      │  │   tracker.user.js│
        └─────────────────┘ └─────────────┘  └──────────────────┘
```

`lib/browser.js` is the polyfill seam: in extensions it re-exports `chrome.*` (or `browser.*` with shim); in the userscript build it stubs the same surface against `GM_*` / `Notification`.

## Data flow

1. Service worker (or userscript poller) wakes every N min.
2. `scrapers/claude.js` and `scrapers/codex.js` each `fetch()` their analytics URL with `credentials: 'include'`.
3. HTML parsed with `DOMParser`; bucket values extracted: `{ label, percent, resetAtISO, kind: 'session'|'weekly', model: 'all'|<name> }[]`.
4. `lib/history.js` appends a timestamped sample for each bucket (capped at 30 days).
5. `lib/notify.js` evaluates trigger rules against the new sample + history → fires `chrome.notifications` / web `Notification`.
6. `lib/storage.js` writes the snapshot.
7. Content script's `widget.js` reads the snapshot, renders SVG rings with HH:MM:SS centers, ticks locally every 1 s between fetches.
8. Popup dashboard reads the same snapshot, shows both providers side-by-side with sparkline of recent usage.

## Reset-string parser cases

| Source | String | Parser handles |
|---|---|---|
| Claude session | `Resets in 1 hr 5 min` | duration → `now + duration` |
| Claude weekly | `Resets Tue 1:00 PM` | next occurrence of weekday + local time |
| Codex 5hr | `Resets 3:34 PM` | next occurrence of time today/tomorrow (if past, +1 day) |
| Codex weekly | `Resets May 19, 2026 2:05 AM` | absolute datetime parse |

All resolved to absolute ISO timestamps and stored that way; UI re-renders relative strings from absolutes.

## Notification rules (defaults)

| Rule | Default | Fires |
|---|---|---|
| R1-60 | on | 60 min before reset |
| R1-15 | on | 15 min before reset |
| R1-0  | on | at reset moment (== R2) |
| R2    | on | on-reset positive ("fresh quota available") |
| U1-75 | off | 75% used (weekly only) |
| U1-90 | on  | 90% used (any bucket) |
| U1-95 | on  | 95% used (any bucket) |
| U2    | on  | weekly forecast crosses earlier than reset date |
| D1    | on  | daily summary at 08:00 local |

Each rule has an idempotent fire key (`<provider>-<bucket>-<rule>-<resetISO>`) stored in `firedRules` so we never double-fire across service-worker restarts.

## Build outputs

- `dist/chrome/AI-Usage-Tracker-v0.1.0.zip` — load-unpacked friendly, primary install path.
- `dist/chrome/AI-Usage-Tracker-v0.1.0.crx` — self-signed CRX3 with `selfhost.pem`; Chromium 75+ rejects drag-drop so README directs users to the ZIP.
- `dist/firefox/ai-usage-tracker-v0.1.0.xpi` — unsigned XPI for Developer Edition / Nightly; signed AMO submission deferred to v0.2.0.
- `dist/userscript/ai-usage-tracker.user.js` — IIFE bundle with userscript metadata header; Tampermonkey / Violentmonkey compatible.

## Out of scope for v0.1.0

- Mobile / Safari extension.
- AMO signed Firefox build.
- Inno installer for the extension.
- Multi-account switching.
- Export-to-CSV of history.
- i18n strings table (English only).

## Gotchas to remember

- Codex 5-hour reset string omits the date — parser must add a day if the time has already passed today.
- Claude `Resets Tue 1:00 PM` is the user's local timezone (verified via DOM, no UTC offset in the string).
- Per his global rule, no pill/oval backdrops anywhere — radial rings are circles (allowed), card corners are 12 px (allowed).
- CRX self-host is rejected by Chromium 75+; ZIP is the primary install asset.
