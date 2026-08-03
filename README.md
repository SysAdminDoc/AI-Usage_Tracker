# AI Usage Tracker

[![Version](https://img.shields.io/badge/version-0.2.2-blue.svg)](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-MV3-yellow.svg)](#install)
[![Firefox](https://img.shields.io/badge/Firefox-MV3-orange.svg)](#install)
[![Userscript](https://img.shields.io/badge/Userscript-Tampermonkey-red.svg)](#install)

Premium countdown timer + notification surface for Claude (claude.ai) and OpenAI Codex (chatgpt.com) usage limits. Always-visible glass widget on your chat tab, toolbar popup dashboard, and OS notifications when renewals or thresholds approach. Ships as a Chrome extension, Firefox extension, and Tampermonkey userscript from the same source.

## Why

Both Claude and Codex throttle you with daily and weekly quotas. The reset countdowns live on settings pages you have to navigate to. Run out unexpectedly, or waste fresh quota by not knowing it just renewed? This tells you, ambiently, all day, in your browser.

## Features

- **Always-visible widget** — drag-positionable glass card with radial-ring countdowns (HH:MM:SS center, green→amber→red ramp). Minimizes to a 32 px square corner badge.
- **Toolbar badge + popup dashboard** — rolled-up most-constrained usage percent on the extension icon, plus both providers side-by-side with recent-usage sparklines.
- **Inspectable sparklines** — hover or focus a popup sparkline to see the exact usage value and sample timestamp.
- **OS notifications** — five trigger types, each toggleable:
  - **R1 Renewal-imminent** — fires 60 min / 15 min / at-reset.
  - **R2 Renewal-arrived** — "Fresh quota — go!" the moment a bucket resets.
  - **U1 Usage-threshold** — 75% / 90% / 95% used.
  - **U2 Burn-rate forecast** — "At this pace you'll hit weekly Tuesday — 18 hrs early."
- **D1 Daily briefing** — one calm summary at 08:00.
- Missed renewal/reset and daily-briefing alerts recover during a bounded late-refresh grace period, and the extension schedules the next exact notification deadline when one is known.
- **Per-row visibility toggles** — by default shows headline buckets only; turn on per-model rows (GPT-5.3-Codex-Spark, Sonnet only, Claude Design, etc.) in Settings.
- **API-first usage collection** — reads Claude `api/organizations/{orgId}/usage` and Codex `backend-api/wham/usage` for actual usage windows, with Claude stream/header updates and opt-in page-scraper fallback tabs.
- **Claude context counter** — estimates the visible conversation plus draft prompt against the 200k context window and shows a compact progress bar in the widget.
- **Claude cache timer** — starts a five-minute follow-up countdown from streamed `message_limit` events, with explicit cache expiry support if Claude publishes it.
- **Polished status feedback** — clearer first-run, degraded, loading, diagnostics, and refresh states across the widget, popup, and settings.
- **Premium settings controls** — compact section navigation, theme selection, configurable warn/danger visual thresholds, notification snooze, and local diagnostics.
- **Rolling local history** (30-day default, configurable) with sparklines, persists across browser restart.
- **Portable history controls** — export CSV, choose retention length, compact representative samples, or clear history with an explicit confirmation.
- **Dark by default** — Catppuccin Mocha + glassmorphism. No pill backdrops.

## Accessibility

The widget, popup, options page, and userscript settings support keyboard focus, live reset timers, reduced-motion preferences, 44 px touch targets, and an opt-in high-contrast palette with text/pattern status cues. `npm test` runs the accessibility contract smoke checks, including high-contrast AA/AAA color ratios and the required live-region/focus hooks.

## Install

### Chrome / Edge / Brave / any Chromium 109+

1. Download `AI-Usage-Tracker-chrome-v0.2.2.zip` from the [Releases page](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/latest).
2. Unzip it anywhere.
3. Open `chrome://extensions`.
4. Toggle **Developer mode** on (top-right).
5. Click **Load unpacked**, pick the unzipped folder.
6. Visit claude.ai or chatgpt.com — widget appears bottom-right.

> **Why not just drag-drop the `.crx`?** Chromium 75+ rejects drag-installed self-signed CRX files (`CRX_REQUIRED_PROOF_MISSING`) regardless of developer mode. The ZIP / Load unpacked path is the supported install for self-hosted Chromium extensions.

### Firefox Developer Edition / Nightly

1. Download `ai-usage-tracker-firefox-v0.2.2.xpi` from the [Releases page](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/latest).
2. Open `about:config` → set `xpinstall.signatures.required` to `false` (DevEd/Nightly only).
3. Open `about:addons` → gear icon → **Install Add-on From File** → pick the `.xpi`.

Release Firefox does not allow unsigned extensions; a signed AMO submission is planned for a future release.

### Tampermonkey / Violentmonkey userscript

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) in your browser.
2. Open `ai-usage-tracker.user.js` from the [Releases page](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/latest) — the userscript manager will prompt to install.
3. Visit claude.ai or chatgpt.com.

Userscript caveats vs. extension:
- No silent background refresh — data only updates while you have a Claude or ChatGPT tab open.
- No toolbar popup dashboard (open the in-page settings modal and history controls via the widget gear icon).
- OS notifications use the web `Notification` API (requires page open in a tab).
- Late-refresh catch-up is bounded by the open tab's next refresh; the extension's service-worker alarm path can schedule the next exact deadline.
- History persists across restart via `GM.setValue`.

Release downloads include `SHA256SUMS.txt` for verifying the Chrome ZIP, Firefox XPI, and userscript assets.

Default extension packages do not request the optional `nativeMessaging` permission. QuotaGlass users who want the local desktop mirror can build the explicitly separated bridge channel with `npm run build:bridge`; it produces `AI-Usage-Tracker-chrome-bridge-v0.2.2.zip` and `ai-usage-tracker-firefox-bridge-v0.2.2.xpi` with the companion permission and no other tracking behavior changes.

## Build from source

```bash
cd ~/repos/AI-Usage_Tracker
node build/build-all.mjs
# → dist/chrome/, dist/firefox/, dist/userscript/
npm test
```

Runtime has no external services. Builds use Node 20 and the local esbuild dev dependency. `npm test` runs isolated linkedom UI permutations plus Chrome callback/Firefox promise WebExtension contract fixtures, so UI and runtime compatibility checks do not open a browser window.

The host matrix is checked at test and build time: wildcard content scripts cover `claude.ai` and `chatgpt.com` subdomains, while host permissions and web-accessible resources remain apex-only. The userscript metadata and runtime predicates use the same two-provider contract. The DOM safety audit rejects direct HTML sinks in UI modules and only permits reviewed static icon markup through the guarded helper.

## Privacy

- Nothing leaves your browser. No analytics, no telemetry, no remote servers.
- All scraping is against your own logged-in session on `claude.ai` and `chatgpt.com`.
- History stored locally in `chrome.storage.local` (extension) or `GM.setValue` (userscript).
- Source is auditable — open the built files and read them; they are not minified.

## License

MIT — see [LICENSE](LICENSE).
