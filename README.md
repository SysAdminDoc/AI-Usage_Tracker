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
- **Notification preflight** — Settings shows the active notification capability and can request permission plus send a test alert before a real quota rule fires.
- **D1 Daily briefing** — one calm summary at 08:00.
- Missed renewal/reset and daily-briefing alerts recover during a bounded late-refresh grace period, and the extension schedules the next exact notification deadline when one is known.
- **Per-row visibility toggles** — by default shows headline buckets only; turn on per-model rows (GPT-5.3-Codex-Spark, Sonnet only, Claude Design, etc.) in Settings.
- **API-first usage collection** — reads Claude `api/organizations/{orgId}/usage` and Codex `backend-api/wham/usage` for actual usage windows, with Claude stream/header updates and opt-in page-scraper fallback tabs.
- **Claude context counter** — estimates the visible conversation plus draft prompt against the 200k context window and shows a compact progress bar in the widget.
- **Claude cache timer** — starts a five-minute follow-up countdown from streamed `message_limit` events, with explicit cache expiry support if Claude publishes it.
- **Polished status feedback** — clearer first-run, degraded, loading, diagnostics, and refresh states across the widget, popup, and settings.
- **Redacted support bundle** — export version, channel, permission, freshness, source, error-code, and storage evidence without history, raw errors, cookies, prompts, or full identifiers.
- **Premium settings controls** — compact section navigation, theme selection, configurable warn/danger visual thresholds, notification snooze, and local diagnostics.
- **Rolling local history** (30-day default, configurable) with sparklines, persists across browser restart.
- **Portable history controls** — export CSV, choose retention length, compact representative samples, or clear history with an explicit confirmation.
- **Dark by default** — Catppuccin Mocha + glassmorphism. No pill backdrops.

## Accessibility

The widget, popup, options page, and userscript settings support keyboard focus, live reset timers, reduced-motion preferences, 44 px touch targets, and an opt-in high-contrast palette with text/pattern status cues. `npm test` runs the accessibility contract smoke checks, including high-contrast AA/AAA color ratios and the required live-region/focus hooks.

## Install

### Chrome / Edge / Brave / any Chromium 111+

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
- OS notifications use the userscript manager API when available, otherwise the web `Notification` API; either path requires a provider tab to be open.
- Settings can request notification permission and send a test alert before you rely on a quota rule.
- Late-refresh catch-up is bounded by the open tab's next refresh; the extension's service-worker alarm path can schedule the next exact deadline.
- History persists across restart via `GM.setValue`.

Release downloads include `SHA256SUMS.txt` for verifying the Chrome ZIP, Firefox XPI, and userscript assets.

Default extension packages do not request the optional `nativeMessaging` permission. QuotaGlass users who want the local desktop mirror can build the explicitly separated bridge channel with `npm run build:bridge`; it produces `AI-Usage-Tracker-chrome-bridge-v0.2.2.zip` and `ai-usage-tracker-firefox-bridge-v0.2.2.xpi` with the companion permission and no other tracking behavior changes.

## Browser compatibility

| Target | Supported floor | Notes |
| --- | --- | --- |
| Chrome, Edge, Brave, and other Chromium browsers | 111+ | MV3 extension; uses local storage, alarms, notifications, tabs, and runtime messaging. |
| Firefox | 115+ | MV3 extension; the manifest declares `strict_min_version` 115. |
| Userscript managers | Chrome/Chromium 111+ or Firefox 115+ | Requires a modern manager with `GM.getValue`/`GM.setValue` or legacy equivalents; notification delivery also requires the manager API or page notifications. |

The release build checks this matrix against both extension manifests, userscript metadata, README copy, and the browser adapter’s API surface before packaging.

## Permissions and data

The default extension packages use this narrow, local-first permission boundary:

| Surface | Why it is requested | What stays local |
| --- | --- | --- |
| `storage` | Save the current snapshot, settings, and rolling history | All tracker state remains in local extension storage; it is not put in sync storage. |
| `alarms` | Refresh the snapshot and recover notification deadlines after service-worker sleep | Alarm names and times are local browser scheduling metadata. |
| `notifications` | Show the alert rules that you enable | Notification text is derived from local snapshot state. |
| `tabs` | Open provider analytics pages and, only when explicitly enabled, a hidden fallback tab | The extension does not read arbitrary tabs or cookies. |
| `claude.ai` and `chatgpt.com` host access | Fetch or scrape usage from signed-in first-party pages | Requests stay between the extension and provider origins; no relay server is used. |
| `nativeMessaging` | Optional QuotaGlass desktop mirror only | Missing from default packages; the bridge profile sends a minimal redacted quota envelope to the locally installed companion. |

The userscript has the equivalent two-provider `@match`/`@connect` scope and stores state through the userscript manager. It cannot refresh while no provider tab is open. No tracker path stores provider passwords, cookies, or raw prompt text. Provider snapshots may retain first-party identifiers needed for diagnostics; the optional bridge explicitly excludes account/org identifiers. The Claude context counter reads visible page text locally to estimate context usage; it does not transmit that text.

To revoke access, remove the extension or userscript from the browser. Before removal, use Settings → History → Export CSV if you want a portable history copy, then use the clear-history control. The optional QuotaGlass bridge can be excluded simply by using the default build; uninstalling the companion stops its local pipe.

## Build from source

```bash
cd ~/repos/AI-Usage_Tracker
node build/build-all.mjs
# → dist/chrome/, dist/firefox/, dist/userscript/
npm test
```

Runtime has no external services. Builds use Node 20 and the local esbuild dev dependency. `npm test` runs isolated linkedom UI permutations plus Chrome callback/Firefox promise WebExtension contract fixtures, so UI and runtime compatibility checks do not open a browser window.

The host matrix is checked at test and build time: wildcard content scripts cover `claude.ai` and `chatgpt.com` subdomains, while host permissions and web-accessible resources remain apex-only. The userscript metadata and runtime predicates use the same two-provider contract. The DOM safety audit rejects direct HTML sinks in UI modules and only permits reviewed static icon markup through the guarded helper.

## Comparison and FAQ

| Product | Strong fit | Honest tradeoff |
| --- | --- | --- |
| AI Usage Tracker | Browser-first Claude + Codex quota windows, local history, reset/threshold alerts, and an optional userscript | It intentionally covers fewer providers and does not provide cloud sync, team reporting, or API-spend accounting yet. |
| [Claude Counter](https://github.com/she-llac/claude-counter) | Lightweight Claude bars, reset countdowns, cache timing, and streamed usage | Primarily Claude-focused; page/API schema drift still needs maintenance in any tracker. |
| [Claude Usage Extension](https://github.com/lugia19/Claude-Usage-Extension) | Broad Claude accounting, tokenizer/API estimates, and wider distribution materials | Its broader accounting surface is a different privacy and complexity tradeoff from this tracker’s quota-window focus. |
| [CodexBar](https://github.com/steipete/CodexBar) | Multi-provider status and desktop/menu-bar diagnostics | A desktop-first workflow is better for system-wide status; this project stays in the browser where provider sessions already exist. |
| [OpenUsage](https://github.com/janekbaraniewski/openusage) | Provider breadth, local dashboard, exports, metrics, and spend views | A local daemon/database and wider integration surface are more operational overhead than this extension currently assumes. |
| Tokens 4 Breakfast / TokenWatch / WakaTime AI | Budgets, forecasting, attribution, and commercial cost intelligence | Those capabilities generally require API-cost data, project metadata, or a different cloud/team privacy model. |

### FAQ

**Does the tracker upload prompts or usage data?** No. The default build has no telemetry or remote relay. It makes first-party requests to Claude/ChatGPT using the browser session, then stores normalized state locally. The optional bridge is a separate local native-messaging build and receives only its documented redacted display envelope.

**Does it save API keys?** No API-key provider path is included in this release. Do not paste provider secrets into settings or diagnostics.

**Why is Firefox installation different?** The downloadable XPI is unsigned for self-hosted development. Firefox Release requires a signed store channel; Developer Edition/Nightly can use the documented development setting.

**What happens when a provider changes its page or endpoint?** The dashboard keeps the last known state with source/freshness/error diagnostics, and the contract tests cover representative API, stream, header, DOM, and failure shapes. A stale value is not presented as a fresh reading.

**Can I use it without a provider tab open?** The extension can use its authenticated API path and service-worker alarms. The userscript requires an open Claude or ChatGPT tab for refresh and browser notifications.

**How do I disable background page fallback?** It is off by default. If enabled for a debugging case, turn off “Use hidden fallback tabs when API refresh fails” in Settings; the extension does not silently enable it.

**What should I attach to a support report?** Use Status → Export redacted bundle. It omits history and raw provider errors; still inspect the JSON once before sharing it outside your trusted support channel.

## Privacy

- The default package sends no tracker data to analytics, telemetry, or remote relay servers. The optional bridge sends only its redacted display envelope to the locally installed QuotaGlass companion.
- All scraping is against your own logged-in session on `claude.ai` and `chatgpt.com`.
- History stored locally in `chrome.storage.local` (extension) or `GM.setValue` (userscript).
- Source is auditable — open the built files and read them; they are not minified.

## License

MIT — see [LICENSE](LICENSE).
