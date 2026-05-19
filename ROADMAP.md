# Roadmap

**Last updated:** 2026-05-19 · **Current shipped version:** v0.1.4

This roadmap is a working document, not a wishlist. Every Now / Next / Later item is traceable to a numbered source in the [Appendix](#appendix-sources). Under Consideration entries are tracked but not committed. Rejected entries record decisions so they don't get silently resurrected.

---

## Shipped

### v0.1.4 — 2026-05-19 — Codex API repair
- [x] Codex WHAM usage API is now the primary usage source (`/api/auth/session` -> `/backend-api/wham/usage`)
- [x] `Authorization: Bearer` and `ChatGPT-Account-Id` headers are derived from the logged-in ChatGPT session when available
- [x] Codex API payload normalization covers primary/secondary windows, additional model limits, and alternate five-hour/weekly field names
- [x] Codex analytics page scraping remains as a DOM/raw-HTML fallback
- [x] Parser smoke coverage added for WHAM payloads and auth/header construction

### v0.1.3 — 2026-05-19 — premium polish
- [x] Shared UI primitives moved into `theme.css` for consistent popup/options/widget styling
- [x] Widget and popup first-run, refresh-loading, degraded, error, and missing-reset states refined
- [x] Settings diagnostics panel added for snapshot health, source path, row count, and copyable diagnostics
- [x] Focus-visible, disabled, responsive, and reduced-motion states improved
- [x] Content-script backdrop blur removed for lower repaint cost on host pages

### v0.1.2 — 2026-05-19 — Claude API repair
- [x] Claude JSON API is now the primary usage source (`/api/organizations` → `/api/organizations/{orgId}/usage`)
- [x] Claude DOM scrape retained as hard fallback
- [x] API percent values and streamed fractional `message_limit.windows` values normalize to the same bucket schema
- [x] Userscript preserves last successful provider snapshot during transient fetch failures

### v0.1.1 — 2026-05-14 — hotfix
- [x] Live-DOM scraper as primary path (fixes hydration-shell failure)
- [x] Silent inactive-tab refresh on alarm
- [x] One-click "Open analytics" in widget empty/error states
- [x] `tabs` permission added

### v0.1.0 — 2026-05-14 — initial release
- [x] Chrome MV3 extension
- [x] Firefox MV3 extension (unsigned XPI)
- [x] Tampermonkey / Violentmonkey userscript
- [x] Floating glass widget with radial-ring countdowns
- [x] Toolbar popup dashboard
- [x] 5 notification rule types (R1, R2, U1, U2, D1) — all toggleable
- [x] Settings page with per-row visibility toggles
- [x] 30-day rolling history per bucket
- [x] Burn-rate forecast (weekly)
- [x] Direct authenticated fetch scraping with silent-tab fallback note

---

## Now — v0.2.0 — "API path + competitive parity"

External research turned up something we missed at design time: every mature competitor has converged on **same-origin JSON API endpoints**, not page scraping. Switching the primary data path closes a class of fragility (DOM churn, hydration races, scraper drift) and unlocks the rolled-up toolbar badge that every reviewed competitor ships. This release is parity + the one differentiator (cache-timer + context counter) that minimal trackers like she-llac have made into table-stakes.

### Data path overhaul
- [x] **N-01 — Primary scraper: claude.ai JSON API.** Replace the DOM scrape with `GET https://claude.ai/api/organizations/{org_id}/usage`. Completed in v0.1.2 using `GET /api/organizations` org discovery with a 24h session cache; the `lastActiveOrg` cookie shortcut was skipped to avoid adding the `cookies` permission. The live-DOM scraper remains as a hard fallback if the endpoint returns 404 or schema drifts. Sources: [#2], [#3], [#6], [#18].
- [x] **N-02 — Primary scraper: chatgpt.com JSON API.** Switch to `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization: Bearer` + `ChatGPT-Account-Id` headers from existing browser session. Tolerate the documented alt field names (`five_hour`/`primary_window`/`five_hour_limit`, `weekly`/`secondary_window`/`weekly_limit`). Completed in v0.1.4 using `/api/auth/session` for token/account discovery, WHAM `rate_limit.primary_window` / `secondary_window` normalization, additional model limit support, and DOM/raw-HTML fallback retention. Source: [#7], [#8].
- [ ] **N-03 — SSE `message_limit` interception (Claude).** Hook into the streamed completion responses on claude.ai to capture unrounded utilization fractions (more accurate than the rounded `/usage` page values). Used to refine the bars in real time as the user sends messages. Source: [#18].
- [ ] **N-04 — Anthropic rate-limit response header sniffing.** When the user has API traffic flowing, parse `anthropic-ratelimit-unified-*-utilization` / `-reset` / `-status` headers as a third data source. Source: [#10].
- [ ] **N-05 — Stale-tab refresh becomes opt-in fallback only.** Once API-path data is flowing, retire the auto-opening silent tab from the default refresh loop. Keep the manual "open analytics" button.

### Surfaces & UX
- [ ] **N-06 — Toolbar badge with rolled-up %.** `chrome.action.setBadgeText` showing the most-constrained bucket's %-used, color-coded green/amber/red. `OffscreenCanvas` icon swap for badge background. Source: [#1], [#4], [#5], [#30].
- [ ] **N-07 — Conversation context-window counter.** Approximate tokens vs. the 200k Claude context window, mini progress bar in the widget. Use a vendored `o200k_base` tokenizer (MIT-compat). Source: [#2], [#18].
- [ ] **N-08 — Cache-timer countdown (Claude).** Show how long the current conversation remains cached (cheaper to continue) — read from SSE `message_limit` payload. Source: [#18].
- [ ] **N-09 — Sparkline tooltip on hover.** Exact value + timestamp at cursor position over the popup sparkline. Source: own v0.1.0 roadmap, [#11].
- [ ] **N-10 — Right-click context menu on widget.** Snooze 1 hr, hide for session, refresh now, open analytics, open settings. Source: own v0.1.0 roadmap.
- [ ] **N-11 — Light theme.** Catppuccin Latte variant. Auto-switch via `prefers-color-scheme` + manual override in settings. Source: [#3], own v0.1.0 roadmap.

### Settings & controls
- [ ] **N-12 — Configurable warn/danger thresholds.** Sliders for the amber/red transitions (sshnox uses 70% / 90% — let users pick). Source: [#3].
- [ ] **N-13 — Userscript in-page settings modal.** Finish the stubbed `openInlineSettings()` — mirrors the extension's options page, persisted via `GM.setValue`. Source: own stub in [userscript/entry.js](userscript/entry.js).
- [ ] **N-14 — "Reset cached org ID" button.** Useful when switching workspaces or after a Claude team account move. Source: [#3].
- [ ] **N-15 — "Clear all history" + "Export history (CSV)" buttons.** Source: [#11], own v0.1.0 roadmap.

### Reliability & accessibility
- [ ] **N-16 — WCAG 2.2 AA conformance pass.** Keyboard nav for the widget header buttons + popup + options; visible focus indicators; `aria-live="polite"` on countdown ticker; `prefers-reduced-motion` respected (kill shimmer + ring transitions); 4.5:1 contrast audit on every text/background pair. Source: [#12], [#13], [#14].
- [ ] **N-17 — High-contrast / color-blind safe palette option.** Use shape + pattern in addition to color on the rings (dashed → dotted → solid by danger level). Source: [#14].
- [x] **N-18 — Diagnostic panel in options.** Last-fetch timestamp per provider, error code if any, scraper path used (API vs. DOM vs. silent-tab), org-ID, plan label. One-click "copy diagnostics" button. Completed in v0.1.3 with local snapshot health, source path, provider row counts, truncated Claude org ID, and copyable diagnostics. Source: [#3], [#15].
- [ ] **N-19 — Signed AMO Firefox build.** Submit to addons.mozilla.org so release-channel users can install without `xpinstall.signatures.required=false`. Requires unique `id` in `browser_specific_settings.gecko` (already present). Source: [#16], own v0.1.0 roadmap.

### Engineering
- [ ] **N-20 — TypeScript migration.** Codebase is still small (~3,200 LOC); types catch the kind of schema-drift bugs the JSON API path will eventually hit. esbuild already handles TS transparently. Source: own [State of Repo].
- [ ] **N-21 — Unit tests for `countdown`, `history`, `notify`.** Currently only the scrapers have a smoke test. Reset-string parser cases especially: cross-DST, last-day-of-month, weekday rollover. Source: own [State of Repo].

### Docs
- [ ] **N-22 — `CONTRIBUTING.md` + `SECURITY.md`.** Contribution guide (build setup, commit conventions, PR checklist) + responsible-disclosure policy with contact + supported-version table. Source: own [State of Repo] — currently absent.
- [ ] **N-23 — Animated GIF / screenshots in README.** Reference screenshots in `docs/reference/` are source-page captures, not product captures. Show the actual widget on a chat page, the popup dashboard, and the options page. Source: [#1], [#2], [#5] all do this; we don't yet.
- [ ] **N-24 — Comparison table + FAQ in README.** "vs. lugia19, vs. she-llac, vs. T4B" honest-tradeoff table. FAQ covering: what data is stored where; why the analytics page must render once; how to revoke; license. Source: [#1] FAQ section, [#22] CLSkills comparison.

---

## Next — v0.3.0 — "Multi-provider + multi-account"

The next competitive cohort beyond Claude+Codex single-account is the cross-provider dashboard (T4B, OpenUsage, CodexBar) plus multi-account managers. We don't need to match their 17-29 provider counts to stay relevant — we need the top adjacent providers most of our users already pay for.

### Provider expansion
- [ ] **NX-01 — Anthropic API-key path.** Allow users to paste an Admin API key into settings; surface workspace + per-model usage from `api.anthropic.com/v1/organizations/usage_report/claude_code` and the Enterprise Analytics API. New "API" tab in the popup, separate from "Chat". Source: [#9], [#17], [#27].
- [ ] **NX-02 — OpenAI API-key path.** OpenAI Usage API for per-API-key, per-model token + cost breakdowns. Same "API" tab pattern. Source: [#11], [#23].
- [ ] **NX-03 — GitHub Copilot provider.** Device-flow auth, Copilot internal usage API. Surface chat/completions quota + session window. Source: [#11], [#24].
- [ ] **NX-04 — Cursor provider.** Browser session cookies, plan-spend/limits, Composer-session metrics. Source: [#11], [#24].
- [ ] **NX-05 — Gemini provider.** OAuth via Gemini CLI credentials when available; conversation count + per-model tokens. Source: [#11], [#24].
- [ ] **NX-06 — OpenRouter provider.** API key + their `/credits` endpoint. Lowest-effort provider addition. Source: [#11], [#24].

### Multi-account
- [ ] **NX-07 — Multi-profile manager.** Per-profile credential + settings isolation. Auto-generated friendly names ("Quantum Llama"-style) with rename. Profile badge on the widget. Manual switcher in popup. Source: [#19], [#20].
- [ ] **NX-08 — Incognito-window separate tracking.** Distinct `chrome.storage` keys for incognito context; widget mounts independently. Source: [#2].
- [ ] **NX-09 — chrome.storage.sync for settings only.** Settings cross-browser-sync; history stays local. Behind explicit opt-in. Source: own.

### Forecasting & analytics
- [ ] **NX-10 — Pace marker on rings.** A second, lighter-weight tick on the ring showing projected end-of-window utilization (linear extrapolation). Lets you see "you're burning toward 108% by 4pm" at a glance, no extra notification needed. Source: [#6], [#15], [#20].
- [ ] **NX-11 — Anomaly / spike detection.** Standard-deviation alert when a single sample jumps >2σ above the moving average — catches the "single prompt jumped me from 21% to 100%" class of pain. Source: [#21] (community).
- [ ] **NX-12 — Cost-per-token computation (API-key paths only).** USD totals per bucket, per model, per provider using an API pricing table shipped as JSON, refreshed monthly from a static file in the GH repo. Explicitly scoped to API-key paths (NX-01, NX-02) — subscription plans are flat-rate and "cost-per-token" is a misleading metric there. Source: [#11], [#15], [#23].

### Build & quality
- [ ] **NX-13 — i18n strings table.** Externalize all UI strings; ship English + Spanish + German + French in v0.3.0. Locale-aware date/time + percentage formatting via `Intl`. Source: [#20] (13 langs).
- [ ] **NX-14 — Settings export / import JSON.** Manual portability across browsers and accounts. Source: own.

---

## Later — v0.4+ — "Platform reach + power features"

Items here are committed in principle but parked behind a dependency (signing key, server cost, ToS clarity) or are large enough to deserve their own release window.

- [ ] **L-01 — Safari Web Extension.** `xcrun safari-web-extension-converter` to generate Xcode project, Mac App Store distribution required. Adds the $99/yr Apple Developer Program cost. Source: [#28].
- [ ] **L-02 — Mobile-friendly userscript build.** Kiwi browser + Tampermonkey on Android. Drop drag-positioning + glass blur for performance; collapse to a sticky-footer band. Source: own v0.1.0 roadmap.
- [ ] **L-03 — Plugin API for community providers.** Provider authoring guide; each provider becomes a module with `auth`, `fetch`, `parse`, `normalize` exports. Source: [#24] (CodexBar pattern).
- [ ] **L-04 — Webhook on rule fire.** Optional Slack / Discord / generic-POST hook when a notification rule fires. Source: own ideation; adjacent to Maciek's Sentry pattern [#15].
- [ ] **L-05 — Dollar-budget caps with 80/100% alerts.** T4B "Focus Mode" — set a session $-cap; alert at 80%, block (optional) at 100%. Requires cost-per-token table (NX-12) shipped first. Source: [#11].
- [ ] **L-06 — 30-day run-rate + month-end bill prediction.** Aggregate spend across all providers; project month-end against pricing table. Source: [#11].
- [ ] **L-07 — Plan optimization recommendations.** "You used 64% of your Max-20x weekly budget — Max-5x would have been enough" / vice versa. Source: [#11].
- [ ] **L-08 — Per-API-key / per-workspace breakdown.** Already gated by NX-01 + NX-02 landing. Source: [#5].
- [ ] **L-09 — MCP server exposing usage data.** Standalone MCP server reads from `chrome.storage` (via native messaging) and exposes `get_usage` / `forecast` / `time_to_reset` tools so Claude Code can answer "how much weekly do I have left?" without a context switch. Source: own ideation; ties to the Claude Code statusline space [#9].
- [ ] **L-10 — Team / collab dashboard.** Optional self-hosted aggregator — push anonymized usage timeseries to a user-provided URL; team sees aggregate but not individual prompts. WakaTime's anonymous-aggregate team-dashboard model. Source: [#31].
- [ ] **L-11 — Per-client / per-project / per-git-branch attribution.** TokenWatch's billable-AI-spend model — captures token counts, costs, model, git branch, developer identity, but never code or prompt content. Source: [#32].
- [ ] **L-12 — Native messaging companion for OS notification reliability.** Service worker dies after 30s idle, daily-briefing can miss if the SW is dormant at 08:00. A tiny native-messaging helper (PowerShell on Windows, AppleScript on macOS, systemd-user-timer on Linux) wakes the extension on schedule. Behind explicit opt-in. Source: [#25].

---

## Under Consideration — signals tracked, not committed

These are surfacing in the competitive set but either drift from the project's stated mission, need more real-world data before a design call, or sit in a ToS gray area.

- **UC-01 — Tauri / Electron desktop app.** Duplicates the menu-bar surface (T4B, hamed-elfayome, CodexBar) but we're browser-first by philosophy. Revisit if user demand is loud. Source: [#11], [#20], [#24].
- **UC-02 — Anonymized telemetry / error reporting (Sentry opt-in).** Maciek does it. README explicitly promises "no telemetry"; even opt-in adds infra weight and changes the privacy story. Source: [#15].
- **UC-03 — Local JSONL Claude Code session reading.** Powerful (ccusage builds entire UI on it) but is CLI-territory; our scope is browser. Could become a sister CLI sub-project, not a feature here. Source: [#26].
- **UC-04 — P90 / ML-based prediction model.** Heavier than our linear regression; depends on enough history. Revisit once U2 has a year of real samples to validate against. Source: [#15].
- **UC-05 — Auto-switch profile on session-limit hit.** hamed-elfayome ships it. Logging into multiple accounts to skirt limits is gray-area vs Anthropic/OpenAI ToS; we won't ship it as an explicit anti-limit feature. Source: [#20].
- **UC-06 — Auto-start session via throwaway prompt.** kuthiala's auto-refresh-reset feature. Same ToS concern as UC-05 plus it consumes a user's tokens silently. Hard skip unless heavily-disclosed and opt-in. Source: [#2].
- **UC-07 — Auto-detect plan from usage pattern (P90 custom plan).** Useful if the user is on an unknown / undocumented plan tier. Low priority until our explicit plan-picker is in pain. Source: [#15].
- **UC-08 — VSCode statusline integration.** Real demand exists. Probably belongs in a companion VSCode extension, not the browser surface. Source: [#33].
- **UC-09 — OS-native widgets (WidgetKit / Live Activities).** iOS/macOS pattern from CodexBar. Out of scope until L-01 lands. Source: [#24].
- **UC-10 — Browser-internal "block when limit hit" via declarativeNetRequest.** Could block claude.ai chat requests at 100% used to force a hard stop. Risky, frustrating UX if mis-fired. Park. Source: [#29].

---

## Rejected — decisions captured so they don't come back

- **R-01 — Token-injection / chat-history cost calculation.** Drifts from "renewal countdown" mission into general-purpose conversation-cost estimation; doubles scope without serving the stated goal. Two of the leading competitors (lugia19, she-llac) are already deep in this niche. Source: [#1], [#18].
- **R-02 — Backup-and-swap session cookies (account-switcher pattern).** Out of scope — that's an account-switcher project, not a usage tracker. Plenty of dedicated tools already exist. Source: [#19].
- **R-03 — Confetti on reset.** Conflicts with the project's "premium-restrained" design language. Source: [#24].
- **R-04 — Pill / oval / fully-rounded backdrop UI.** Hard-banned by the global project rule on stadium shapes. No exceptions. Source: own [global CLAUDE.md].
- **R-05 — GPL-3.0 / copyleft license switch.** No reason to change from MIT; copyleft would complicate downstream integration (MCP servers, plugin surfaces). Source: own.
- **R-06 — Firebase / cloud sync of usage data.** Violates the README's explicit "nothing leaves your browser" stance. lugia19 does it; we don't. Source: [#1], own README.
- **R-07 — Minified production builds.** README promises auditable source. esbuild stays in non-minified mode. Source: own README.
- **R-08 — "Built for Anthropic / OpenAI" / paid tier / pro upsell.** This is open-source MIT; no freemium gate. Source: own [philosophy].

---

## Themes covered by this roadmap

Defensive cross-check against the categories the brief enumerates:

| Category | Coverage |
|---|---|
| UX | N-06 to N-11, NX-10, L-02 |
| Performance | N-01, N-02, N-05 (drop silent-tab cost) |
| Security | N-19 (signed builds), R-02, R-06 |
| Reliability | N-04, N-18, L-12, UC-02 |
| Integrations | N-03, N-04, NX-01 to NX-06, L-09 |
| Data | N-01, N-02, N-15, NX-12, L-05, L-08 |
| Platform / OS | N-19, L-01, L-02, L-12 |
| Dev experience | N-20, N-21, L-03 |
| Accessibility | N-16, N-17 |
| i18n / l10n | NX-13 |
| Observability | N-18, UC-02 |
| Testing | N-21 |
| Docs | N-22 (CONTRIBUTING + SECURITY), N-23 (screenshots), N-24 (comparison + FAQ) |
| Distribution / packaging | N-19, L-01 |
| Plugin ecosystem | L-03, L-09 |
| Mobile | L-02 |
| Offline / resilience | N-05 (degraded mode), N-04 (header-fallback path) |
| Multi-user / collab | L-10, L-11 |
| Migration paths | NX-14 |
| Upgrade strategy | (version-tagged GH releases + userscript @updateURL already in place) |

---

## Appendix — sources

Every Now/Next/Later item is keyed to one or more of these.

1. [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension) — most popular Claude tracker (50k+ users, v5.2.4), GPL-3.0, gpt-tokenizer + Anthropic API token estimation, Firebase sync, Chrome+Firefox+desktop.
2. [kuthiala/claude-usage-tracker](https://github.com/kuthiala/claude-usage-tracker) — inline chat bar, popup dashboard, 200k context counter, incognito support with separate storage keys, auto-refresh-reset feature.
3. [sshnox/Claude-Usage-Tracker](https://github.com/sshnox/Claude-Usage-Tracker) — documents the `/api/organizations/{org_id}/usage` endpoint, 24h org-ID cache, configurable warning + danger thresholds, `prefers-color-scheme` theming, shadow-DOM isolation.
4. [cfranci/claude-usage-extension](https://github.com/cfranci/claude-usage-extension) — toolbar badge with green/orange/red %, multi-platform credentials reading (macOS keychain / `%APPDATA%` / `~/.config`), 1/5/30/60 min refresh.
5. [Wregret/claude-usage-tracker](https://github.com/Wregret/claude-usage-tracker) — separates Chat Usage tab (claude.ai) from API Usage tab (platform.claude.com); per-model tokens, rate limits, workspace + API-key filter dropdowns, raw API response viewer.
6. [chriswa/claude-usage-limit-tracker-browser-extension](https://github.com/chriswa/claude-usage-limit-tracker-browser-extension) — linear extrapolation that allows >100% projections, parks a tab to poll every 10 min, downloads raw JSON locally.
7. [openai/codex#10869](https://github.com/openai/codex/issues/10869) — official Codex CLI polls `https://chatgpt.com/backend-api/wham/usage` every 60s using the cached ChatGPT auth.json access token; bug describes the poller running when it shouldn't.
8. [knightli.com — Codex Usage and Quota Check](https://www.knightli.com/en/2026/04/12/codex-usage-quota-check/) + [codex-quota Practical Guide](https://www.knightli.com/en/2026/04/16/codex-quota-cli-web-docker-guide/) + [How Codex Usage Limits Work](https://www.knightli.com/en/2026/04/15/codex-usage-limits-five-hour-weekly-credits/) — third-party `codex-quota` consumes `/backend-api/wham/usage`; documents required headers (`Authorization: Bearer`, `ChatGPT-Account-Id`), alt field-name schema, web dashboard, Docker deploy.
9. [ohugonnot/claude-code-statusline](https://github.com/ohugonnot/claude-code-statusline) — documents the undocumented `api.anthropic.com/api/oauth/usage` endpoint, `anthropic-beta: oauth-2025-04-20` header, OAuth credentials at `~/.claude/.credentials.json`, multi-window cache sharing via `~/.claude/usage-exact.json`.
10. [Vincent Qiao — Claude Code /usage](https://blog.vincentqiao.com/en/posts/claude-code-usage/) + [Codelynx — Show Claude Code Usage Limits in Statusline](https://codelynx.dev/posts/claude-code-usage-limits-statusline) — documents `anthropic-ratelimit-unified-{claim}-utilization`, `-reset`, `-status` response headers and how Claude Code consumes them.
11. [Tokens 4 Breakfast](https://www.tokens4breakfast.app/) — macOS menu-bar, 8 providers (Claude Web, Claude Code, OpenAI, Copilot, Cursor, OpenRouter, DeepSeek, Mistral), Focus Mode $ session caps with 80%/100% alerts, 30-day run-rate, month-end bill prediction, plan optimization suggestions, morning digest, multi-currency, CSV export, privacy audit log, $7.99 one-time.
12. [Code With Seb — Web Accessibility in 2026](https://www.codewithseb.com/blog/web-accessibility-2026-eaa-ada-wcag-guide) — EAA + ADA Title II legal landscape, screen-reader patterns, WCAG 2.2 conformance levels.
13. [W3C WCAG 2.1](https://www.w3.org/TR/WCAG21/) + [WCAG 2 Overview](https://www.w3.org/WAI/standards-guidelines/wcag/) — normative spec for AA / AAA conformance criteria.
14. [Accessify — Best Contrast Checker Extensions 2026](https://blog.accessify.app/best-web-accessibility-contrast-checker-extensions-2026-ranked-for-designers/) — practical browser-test pattern, automated tools only catch 20-40% of WCAG issues, contrast as #1 home-page failure (83.9%).
15. [Maciek-roboblog/Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) — terminal monitor with P90 calculation, ML-style prediction (95% conf), WCAG-compliant contrast in TUI, plan auto-detection (Pro/Max5/Max20/Custom), Sentry opt-in, multi-level alerts, daily/monthly aggregations.
16. [Firefox Extension Workshop — Signing & Self-Distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/) + [Distributing yourself](https://extensionworkshop.com/documentation/publish/self-distribution/) + [MDN browser_specific_settings](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings) — MV3 requires `browser_specific_settings.gecko.id` for signing; AMO signing mandatory for release-channel install; unsigned only on DevEd/Nightly/ESR.
17. [Claude Enterprise Analytics API reference](https://support.claude.com/en/articles/13703965-claude-enterprise-analytics-api-reference-guide) + [docs.getdx.com Claude Code connector](https://docs.getdx.com/connectors/claude-code/) — `/v1/organizations/usage_report/claude_code` endpoint, admin-key auth, cost + usage beta endpoints, per-project + per-user breakdowns.
18. [she-llac/claude-counter](https://github.com/she-llac/claude-counter) — 1.3k★, intercepts SSE `message_limit` streamed events for unrounded utilization fractions, `lastActiveOrg` cookie as org source, vendored `o200k_base` tokenizer, ships extension + userscript.
19. [Claude Multi-Account Manager Chrome extension](https://chromewebstore.google.com/detail/claude-multi-account-mana/hpigokfijemjehgbboonfannjnfaokpl) — cookie-save + swap pattern, custom labels, all-local storage, no logout juggling.
20. [hamed-elfayome/Claude-Usage-Tracker](https://github.com/hamed-elfayome/Claude-Usage-Tracker) — Swift/SwiftUI macOS menu-bar; unlimited profiles with auto-generated friendly names, 5 icon styles, 6-tier pace marker, 13 languages, Apple code signing, peak-hours indicator, Keychain creds, browser sign-in via embedded browser, Claude Code statusline integration.
21. [Faros.ai — Claude Code Token Limits](https://www.faros.ai/blog/claude-code-token-limits) + [anthropics/claude-code#9094](https://github.com/anthropics/claude-code/issues/9094) — community pain documentation: weekly limit rollout, "single prompt jumped from 21% to 100%" reports, peak-hour tightening, lack of in-product controls.
22. [CLSkills — Best Claude Counter / Usage Tracker Extensions for Chrome (2026 Comparison)](https://clskillshub.com/blog/claude-counter-extension-chrome) — head-to-head comparison of the major Claude usage trackers; positions she-llac as "minimal" pick and lugia19 as "complete picture" pick; documents reliability issues with leading extensions.
23. [OpenAI Usage API (InfoWorld coverage)](https://www.infoworld.com/article/3618202/openai-unveils-api-for-tracking-openai-api-usage-costs.html) — official OpenAI usage endpoints with per-minute / hour / day granularity, filter by model + API key + project + user; cost endpoint for budget oversight.
24. [steipete/CodexBar](https://github.com/steipete/CodexBar) + [janekbaraniewski/openusage](https://github.com/janekbaraniewski/openusage) — multi-provider trackers (29 / 17 providers respectively); device-flow + browser-cookie + OAuth + API-key auth ladder; keybinding-driven CLI dashboard; 15+ themes; per-provider session/weekly/monthly windows with countdowns.
25. [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) + [chromium-extensions: SW shut down every 5 minutes](https://issues.chromium.org/issues/40733525) — SW dies after 30s idle / 5 min hard cap; offscreen API (Chrome 109+) and WebSocket / native-messaging keep-alives are sanctioned options; unsanctioned keep-alives may be acted against.
26. [ryoppippi/ccusage](https://github.com/ryoppippi/ccusage) + [ccusage.com](https://ccusage.com/) — CLI that reads local Claude Code / Codex JSONL files; daily / monthly / 5-hour-block reports; complements live tools.
27. [platform.claude.com — API overview](https://platform.claude.com/docs/en/api/overview) — official Anthropic API base; every response carries `request-id` + `anthropic-organization-id` headers; usage tiers + spend limits documented in Console.
28. [Apple — Safari Web Extensions](https://developer.apple.com/safari/extensions/) + [Distribute a Safari Web Extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension) + [Qiki — Building a Safari Web Extension 2025 Edition](https://www.qfqu.com/w/Building_and_Shipping_a_Safari_Web_Extension_on_macOS_(Manifest_V3,_2025_Edition):_A_Complete_Step-by-Step_Guide) — `xcrun safari-web-extension-converter`, mandatory Mac App Store distribution, $99/yr Apple Developer Program, new no-Xcode ZIP-upload path via App Store Connect.
29. [chrome.declarativeNetRequest API reference](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) — rule-based request blocking/redirect for MV3; `declarativeNetRequestWithHostAccess` variant for per-host scope.
30. [chrome.action API reference](https://developer.chrome.com/docs/extensions/reference/api/action) — `setBadgeText` / `setBadgeBackgroundColor` / `setBadgeTextColor` (Chrome 110+) / `setIcon` from `OffscreenCanvas` in service workers, per-tab scoping via `tabId`.
31. [WakaTime — Dashboards for dev teams](https://wakatime.com/teams) — Team dashboards collecting per-developer time/activity metrics with an opt-in "fully anonymous" mode showing only aggregate time, no per-person attribution.
32. [TokenWatch](https://www.tokenwatch.one/) — AI coding cost-attribution tool for dev agencies; tracks Claude Code / Cursor / Cline usage per client + project + developer + git-branch + developer identity; captures token counts + cost + model only, no code or prompt content.
33. [long-910/vscode-claude-status](https://github.com/long-910/vscode-claude-status) — VSCode extension surfacing Claude Code token usage + cost in the status bar; demonstrates demand for editor-level surfaces alongside browser-level ones.
