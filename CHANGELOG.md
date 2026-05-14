# Changelog

## v0.1.0 — 2026-05-14

Initial release.

### Added
- Chrome MV3 extension (Chromium: Chrome / Edge / Brave).
- Firefox MV3 extension (Developer Edition / Nightly — unsigned XPI).
- Tampermonkey / Violentmonkey userscript (in-page widget + best-effort parity).
- Floating glass widget on claude.ai and chatgpt.com — radial-ring countdowns with HH:MM:SS centers, green/amber/red color ramp.
- Toolbar popup dashboard — both providers side-by-side, recent-usage sparklines.
- Settings page — refresh interval, per-row visibility toggles, notification rule toggles, widget position + minimized state.
- Notification rules — renewal-imminent (60 / 15 / 0 min), on-reset positive, usage thresholds (75 / 90 / 95%), burn-rate forecast, daily 08:00 briefing.
- 30-day rolling history per bucket; weekly burn-rate forecast.
- Direct authenticated `fetch()` against Codex Analytics and Claude usage endpoints; silent-tab fallback if the response is a hydration shell.
- Single source tree with three build targets (chrome.zip + crx, firefox.xpi, ai-usage-tracker.user.js).
