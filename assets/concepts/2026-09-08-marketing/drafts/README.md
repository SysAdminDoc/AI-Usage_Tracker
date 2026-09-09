<img src="assets/brand/icon-1024.png" width="72" height="72" alt="AI Usage Tracker icon">

# AI Usage Tracker

[![Version](https://img.shields.io/badge/version-0.2.5-blue.svg)](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/tag/v0.2.5) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE) [![Platform](https://img.shields.io/badge/platform-Chromium%20%7C%20userscript-8b9df4.svg)](#install)

See how much Claude and Codex quota you have left, and when it resets, without leaving your chat.

AI Usage Tracker puts a small dashboard on claude.ai and chatgpt.com. The browser extension adds a toolbar popup, local history, and alerts for approaching limits. Optional API analytics track provider-reported usage separately from your chat subscription.

[Download for Chromium](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/download/v0.2.5/AI-Usage-Tracker-chrome-v0.2.5.zip) · [Install userscript](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/download/v0.2.5/ai-usage-tracker.user.js) · [User guide](GUIDE.md)

<img src="assets/screenshots/popup-dashboard.png" width="480" alt="Packaged extension showing Claude and Codex quota remaining, reset countdowns, and recent usage. Example data.">

*Actual packaged interface with example data, not a live account reading. Rings show quota remaining; the summary banner shows percentage used.*

## Why use it?

- **Keep resets in view.** A draggable widget stays on the provider page. Use the popup for a quick check, or keep Chromium's side panel open.
- Get notified before a limit or reset. Choose the rules you want, test notifications, and snooze them when you need quiet.
- **Spot changes over time.** Local sparklines show recent usage. Stale readings keep their last-known values and an error state instead of looking like fresh zeroes.
- Keep personal and work snapshots in separate local profiles. Export history when you want a copy.

Dark and light themes are included. The interface supports English, Spanish, French, German, and Arabic, with RTL layout, reduced motion, and an optional high-contrast palette.

## Install

### Chrome / Edge / Brave / any Chromium 114+

1. Download [AI-Usage-Tracker-chrome-v0.2.5.zip](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/download/v0.2.5/AI-Usage-Tracker-chrome-v0.2.5.zip) and extract it to a folder you'll keep.
2. Open your browser's Extensions page. In Chrome, use `chrome://extensions`; in Edge, use `edge://extensions`.
3. Turn on **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Sign in to Claude or ChatGPT normally. Visit the provider's usage page once, then open the tracker and refresh.

This is a self-hosted extension, not a Chrome Web Store listing. The ZIP is the normal install path. A signed CRX3 is also available for compatible managed/self-hosted setups; its signature does not remove browser distribution restrictions.

### Userscript

Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/), then open [ai-usage-tracker.user.js](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/download/v0.2.5/ai-usage-tracker.user.js) and approve it in your manager.

The userscript provides the in-page widget and settings. It needs a Claude or ChatGPT tab to remain open for refreshes and alerts. It doesn't add a toolbar popup, side panel, or browser settings sync. Its build target is Chrome/Chromium 111+ or Firefox 115+; manager permissions also affect what works.

### Firefox 115+

The Firefox extension builds locally, but this release does **not** include a Mozilla-signed XPI. A normal Firefox extension install is pending signing. Developers can [load the local build temporarily](GUIDE.md#firefox-development-build) without changing Firefox's signature checks. Mozilla distinguishes [temporary testing from signed distribution](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

[Release files and SHA256SUMS.txt](https://github.com/SysAdminDoc/AI-Usage_Tracker/releases/tag/v0.2.5) include checksums for the published assets. The [guide](GUIDE.md#updates-and-removal) covers updates, removal, and the optional local desktop bridge.

## A closer look

<img src="assets/screenshots/options-overview.png" width="960" alt="AI Usage Tracker settings showing local profiles and display controls in the packaged extension. Example data.">

*Settings in the packaged Chromium extension. Example profile; no account credentials.*

[First run](assets/screenshots/popup-first-run.png) · [Provider unavailable](assets/screenshots/popup-degraded.png) · [Side panel](assets/screenshots/sidepanel-dashboard.png) · [Icon review and preserved concepts](assets/concepts/2026-09-08-marketing/README.md)

## Know what the numbers mean

Claude Web and Codex Web are quota windows from your signed-in provider session. API analytics are separate integrations, not extra chat quota. The [guide lists each integration and its credential requirements](GUIDE.md#optional-api-analytics).

Provider pages and session endpoints can change. Check the source and freshness labels, and use the provider's own usage page as the final reference. Forecasts, local price-table costs, context counts, and cache reuse are estimates. They aren't billing records or promises about future limits.

## Privacy and permissions

The tracker has no analytics service or remote relay. Usage history and snapshots are stored in your local browser or userscript-manager profile.

It isn't offline. It makes requests to the provider sites, and optional API integrations contact the corresponding provider. API credentials default to session or memory storage; persistent local storage is an explicit option, not a password vault.

Two optional settings send data elsewhere: browser sync copies selected preferences through your browser account, and webhooks send alert events to the endpoint you configure. Webhooks are off by default; provider details require a separate opt-in. File exports can also contain labels you entered. Review them before sharing.

See the [permission and data guide](GUIDE.md#permissions-and-data) before enabling integrations or the native bridge.

## Build and verify

The local acceptance run used Node.js 24 with npm. Use Node.js 22.4 or newer for the full browser-verification workflow.

```sh
git clone https://github.com/SysAdminDoc/AI-Usage_Tracker.git
cd AI-Usage_Tracker
npm ci
npm test
npm run build
```

Load `dist/chrome` as an unpacked extension. Builds also produce a local Firefox development package and the userscript. Run `npm run test:runtime` for fresh-profile, headless Chromium and Firefox checks; browser and driver setup is documented in the [development guide](GUIDE.md#development-and-verification).

The strict model checks pass. Other covered JavaScript still has a checked-in baseline of 1,147 TypeScript diagnostics; the test fails on increases, not on every existing diagnostic. Authenticated provider accounts aren't part of the local acceptance run.

## Help and license

If a provider stops updating, refresh its signed-in usage page and check **Settings > Status**. [Open an issue](https://github.com/SysAdminDoc/AI-Usage_Tracker/issues) with the version and a reviewed redacted support bundle. Don't attach cookies, tokens, or raw account responses.

Released under the [MIT license](LICENSE). This is an independent project, not an official provider extension.
