# Research — AI Usage Tracker

Research date: 2026-08-08

Scope: exhaustive product, ecosystem, security, privacy, reliability, architecture, dependency, testing, and distribution research for the browser-first AI Usage Tracker. This is a research-only pass. No source code, version metadata, commits, or remotes were changed.

Evidence labels used below:

- **Verified** means observed in the working tree or confirmed by the current local test/dependency baseline.
- **Strong signal** means supported by first-party documentation, an upstream issue, a maintained project, a standard, or multiple independent sources.
- **Needs live validation** means an implementation should verify behavior against the target browser, provider, store, or user configuration before treating it as a contract.

## Executive Summary

AI Usage Tracker is already a credible privacy-first, browser-local quota and usage monitor. The current v0.2.4 surface covers Claude and Codex web pages, optional provider APIs for Anthropic, OpenAI, GitHub Copilot, Cursor, Gemini, and OpenRouter, local history and forecasting, alerts, budgets, webhooks, profiles, incognito separation, settings sync, MCP/collaboration output, and an optional native scheduler. The strongest product decision is the local-only default: it avoids requiring a hosted account or telemetry pipeline while still giving users a single view of multiple providers.

The baseline is healthy but the next value is reliability and trust rather than another large provider integration. `npm test` passes, `npm audit` reports zero vulnerabilities, and the current dependency tree is small. Those results are **Verified**, but most source files are JavaScript outside the narrow `tsconfig.json` inclusion set, UI checks use `linkedom` or source contracts instead of a loaded extension, and the service-worker/runtime lifecycle is not exercised by the existing suite. The passing baseline therefore does not prove the golden path under worker restart, browser permission changes, provider throttling, real focus management, or layout constraints.

The highest-value sequence is:

1. Make notification schedules recoverable and immediately responsive to every relevant setting change.
2. Bound all provider request time, response size, pagination, and retry behavior.
3. Validate message provenance and schemas at the privileged background boundary.
4. Add provider-local freshness, in-flight deduplication, and rate-limit backoff so refreshes do not fan out unnecessarily.
5. Make history quota-aware before longer retention or richer charts increase local storage pressure.
6. Reduce permission and userscript cross-provider exposure by requesting only the capability a user enabled and fetching only the provider represented by the current page.
7. Add schema-drift sentinels and a thin real-browser smoke lane, then ratchet localization, accessibility, credential lifecycle, scraper teardown, persistence, and type coverage.

These priorities fit the existing architecture, are mostly medium-sized changes, and directly address platform behavior documented by Chrome and Mozilla: alarms can be missed around sleep, extension service workers terminate, storage has bounded quotas, optional permissions reduce default exposure, and messages from content contexts must be treated as attacker-crafted. Provider documentation and current upstream issues also show that quota windows, usage fields, and web/API measurements can change or disagree. The proposed plan therefore preserves last-known data and explicit uncertainty instead of guessing.

The active roadmap additions below are net-new implementation work. Firefox AMO signing/data-collection submission, Safari, and other items already recorded in `Roadmap_Blocked.md` are intentionally not duplicated in the active roadmap.

## Product Map

### Core workflows

| Workflow | Current boundary | User value | Research implication |
| --- | --- | --- | --- |
| Page capture | Content/page adapters and `src/analytics-scraper.js` observe supported Claude and ChatGPT/Codex surfaces. | Shows plan limits and reset windows where the user already works. | DOM and response shapes are upstream contracts that need fixtures, drift detection, and lifecycle recovery. |
| Background aggregation | `src/background.js` coordinates refresh, direct API providers, page refresh tabs, alarms, notification candidates, and persistence. | Produces one provider-neutral state model. | Service-worker termination, duplicate refreshes, alarm recovery, and write amplification are first-order reliability concerns. |
| API analytics | `src/providers/` contains provider adapters and a shared API contract for Anthropic, OpenAI, GitHub Copilot, Cursor, Gemini, and OpenRouter. | Gives deeper usage/cost data than page badges alone. | Each provider has different pagination, auth, freshness, and entitlement semantics; the common contract must expose uncertainty. |
| Local history and insight | `src/lib/history.js`, forecast/optimization code, profiles, budgets, and alerts retain and interpret snapshots. | Shows trends, forecasted exhaustion, and actionable warnings. | Flat retention needs automatic quota protection and a clear stale/partial state model. |
| Delivery and automation | Browser notifications, webhooks, optional native scheduler, MCP, and collaboration/diagnostic paths. | Lets users act on warnings or consume data from local tooling. | Delivery failures, duplicate notifications, redaction, and retry policy must remain bounded and observable. |
| Settings and separation | Options/side panel/inline settings, profile storage, incognito separation, optional sync, import/export, and diagnostics. | Keeps personal and work contexts separate while allowing controlled portability. | Sensitive credentials need an explicit lifecycle and sync/export threat model; UI strings and direction support are incomplete. |

### Personas and jobs

- **Individual browser user:** wants a small, local status view with reset countdowns, trend history, and alerts without sending activity to a third-party dashboard.
- **Multi-provider analyst:** wants comparable snapshots across API and web sources, with clear source, freshness, cost, and confidence labels instead of false precision.
- **Automation-minded power user:** wants webhooks, MCP, collaboration, native scheduling, or userscript integration while retaining control of local credentials and output redaction.
- **Maintainer/release operator:** needs deterministic builds, provider fixtures, browser smoke coverage, permission reviews, and version/documentation provenance.

The first three personas are product interpretations grounded in the current feature set and adjacent tools; they are not evidence that telemetry about users exists.

### Platform and data-flow map

1. A supported page or provider API supplies a snapshot to the browser extension. Page-derived data is collected by content/analytics adapters; API-derived data is fetched by the background worker.
2. The background worker normalizes provider snapshots, merges them with profile and history state, computes forecast/alert candidates, and writes local state.
3. Popup, options, side panel, widget, and inline settings render the local model. Browser notifications, webhooks, MCP, collaboration, and the optional native scheduler receive explicitly selected outputs.
4. API credentials remain separate from ordinary exported state by default. Settings sync is optional and has an explicit allowlist; the product should continue to treat synchronization and diagnostics as separate data paths.

Distribution is Chrome MV3, Firefox MV3/private distribution, and a userscript build, with an optional QuotaGlass native bridge/scheduler. The repository’s blocked-work file records signed AMO and Safari/macOS constraints; those are environmental distribution blockers, not reasons to broaden this pass.

## Competitive Landscape

The landscape below is intentionally limited to eight comparison groups. The purpose is to identify durable product patterns, not to copy implementation or licensing terms.

1. **DevQuota — nearest browser-local commercial comparator.** Its public positioning combines a local-first Chrome extension, enabled-provider host scoping, dashboard/activity views, alerts, delivery, and diagnostics across Claude, ChatGPT, Codex, Cursor, and Copilot. Adopt the separation between provider enablement and data collection, and make diagnostics explain stale or unavailable sources. Do not assume its closed implementation or product claims are a correctness oracle.

2. **OpenUsage — provider-driven local dashboard.** The public provider contract (`ID`, description, specification, fetch, normalized snapshot), cache/backoff behavior, and explicit accuracy caveats are strong patterns for this repository’s API adapters. Reuse the conceptual boundary, not its daemon/SQLite scope; AI Usage Tracker is browser-first and already has a storage model.

3. **AI Token Monitor — local logs plus cost and cache efficiency.** The Windows/macOS tray tool demonstrates demand for local JSONL ingestion, cache-hit visibility, charts, multilingual UI, and optional alerts. Cache efficiency and explainable cost dimensions are useful ideas. Cloud leaderboards, chat, and broad desktop scope are poor defaults for a privacy-first extension.

4. **CodexBar and related menu-bar tools — fast status aggregation.** CodexBar emphasizes reset status, cost, notifications, and many provider surfaces in a compact desktop view. Learn the value of a concise “what is available now?” surface and stale indicators. Keep the browser-local architecture instead of turning the optional native bridge into the primary product.

5. **Claude Usage Extension — page/account explainability.** Its token accounting, project/history breakdowns, and tooltips show that users need an explanation of how a number was derived. This supports source labels, last-updated timestamps, and confidence/error details in AI Usage Tracker. Its Firebase synchronization and GPL-3 licensing are not appropriate defaults or dependencies here.

6. **onWatch and coding-agent usage trackers — local daemon/CLI depth.** Local SQLite dashboards, unified quota/rate-limit views, and many-provider adapters show a durable adjacent demand for history and machine-readable output. The bounded local data model and provider contract are worth studying; a daemon, account-file crawler, or cloud service would expand the threat model and platform scope.

7. **codex-usage — source-native Codex analysis.** Reading local Codex logs and exposing CLI/web/JSON/SQLite views demonstrates the value of project, model, channel, and time-range breakdowns. It is a candidate future bridge/import direction, not a reason to make browser extension code inspect arbitrary filesystem paths.

8. **Windows/macOS tray tools such as `aqua5230/usage`, `jens-duttke/usage-monitor-for-claude`, and Tokdash.** These tools reinforce demand for stale state, dynamic quota types, themes, heatmaps, and compact status pages. They are useful reference points for optional exports and visual summaries; they do not displace the current local-only browser workflow.

Commercial VS Code usage tracking and multiple awesome lists confirm that the category is broader than one extension, while community discussions repeatedly ask for local quota panels and warn that static tests miss MV3 worker-restart behavior. The differentiation opportunity is therefore trustworthy, source-labeled, recoverable browser data with low permissions—not maximum provider count.

## Security, Privacy, and Reliability

### Security

- **Verified strength:** DOM rendering uses safe text/element paths in the tested UI contracts; diagnostics, MCP, collaboration, and bridge outputs have redaction paths; the default architecture does not require a hosted telemetry service; MV3 build policy avoids remote executable code.
- **Verified gap — privileged message provenance:** `src/lib/browser.js` exposes `sender`, but the background handlers accept scraped/rate-limit messages without validating sender tab origin, path, provider, or a strict payload schema. A content script or another extension context should be treated as attacker-crafted. The fix belongs at the background boundary, with tests for forged, malformed, wrong-host, valid, and extension-origin messages.
- **Verified gap — static API host footprint:** Chrome and Firefox manifests require six API hosts even when the user has not configured those providers. Webhook support also creates broad optional web host patterns. Optional host permissions are a better fit: keep the minimum first-party surface by default, request an exact provider origin when enabled, and explain the denial/degraded state.
- **Verified gap — unbounded API response handling:** `src/providers/api-contract.js` calls `response.json()` without an abort deadline or body-size cap, and its page limit is not a complete response/resource budget. A hostile, unexpectedly large, or slow endpoint can consume extension resources. Add timeout, maximum bytes, bounded pages/items, safe error codes, and cancellation.
- **External policy signal:** Chrome’s user-data, disclosure, and quality guidance treats local processing/storage as user-data handling and emphasizes disclosure, consent, single purpose, and minimum permissions. “Local-only” is a privacy property, not an exemption from documenting data handling.
- **Dependency signal:** the current `esbuild@0.28.1` is beyond the affected range in GHSA-67mh-4wv8-2f99. Keep the existing audit gate and add a release check so a future downgrade or transitive change cannot silently reintroduce the advisory.

### Privacy

- **Verified strength:** local-only operation is the default; profiles and incognito state are separated; settings sync is optional and allowlisted; API credentials are omitted from ordinary exports by default; MCP, diagnostics, and collaboration outputs are designed to redact sensitive values.
- **Risk to make explicit:** locally stored API keys are still secrets. Chrome documents memory-only/session storage as a better option for sensitive data in applicable cases, while this project’s convenience path remains persistent local storage. Add a session/in-memory mode where the browser supports it, clear credentials on provider disable/profile deletion, and make sync/export exclusion testable and visible.
- **Data minimization direction:** provider-specific host permissions, userscript provider scoping, bounded history, and explicit delivery opt-ins reduce data exposure without removing the local workflow.
- **No default telemetry recommendation:** OTel and hosted observability are useful for enterprise agent operations, but exporting activity by default would contradict the product’s current privacy promise. If added later, make it a user-triggered local export or an explicit opt-in destination with redaction and retention controls.

### Reliability

- **Verified gap — notification scheduling:** `aut/settings-updated` refreshes badge/native state but does not rebuild the one-shot notification alarm for changes to reset windows, daily briefing hour, snooze, or budget thresholds. `aut/reschedule` is only sent for some settings. Chrome alarms can be missed around sleep and service workers can terminate, so alarm state must be rebuilt on worker startup and after all relevant setting changes.
- **Verified gap — refresh fan-out:** every background refresh loads all six API credentials and fetches all configured providers together. There is no provider-local TTL, in-flight deduplication, bounded retry/backoff, or clear manual-refresh bypass. A single slow or rate-limited provider can waste work and obscure freshness of the others.
- **Verified gap — storage quota:** history retains a flat up-to-90-day sample set and compaction is manual. Chrome `storage.local` is bounded, and sync has much tighter write/size limits. Automatic sample/byte compaction, usage telemetry, and a user-visible degraded state are needed before retention or chart features grow.
- **Verified gap — scraper lifecycle:** the observer pauses while hidden and disconnects after a callback cap, but there is no explicit visible resume/reinitialization or AbortController-style teardown for SPA navigation. A long-lived tab can silently stop updating.
- **Verified gap — service-worker timer:** silent tab refresh uses `setTimeout` to close a tab after 20 seconds. A worker termination can leave the tab open. Use an alarm or a tab-lifecycle fallback whose recovery behavior is tested.
- **Verified gap — persistence churn:** provider merges, final refresh, and notification handling can each save state; sync-enabled profiles can amplify those writes. Batch the refresh transaction while preserving partial/failure state and write-count observability.
- **Verified gap — delivery semantics:** notification reset candidates emit `tone: 'good'` even though the type union declares only `info`, `warn`, and `bad`; the browser adapter therefore falls through to informational behavior. Failed delivery is not marked as fired, so a transient failure may retry on every refresh. Normalize tone semantics and add bounded retry/backoff.
- **Verified gap — upstream drift:** Claude/Codex scrapers and API adapters parse known page/response shapes. Provider documentation and current Codex/Claude issue traffic show missing windows, web/API mismatches, changed quota buckets, and delayed headers are real operational signals. Preserve last-good data, attach source and age, reject unsupported shapes explicitly, and avoid filling gaps with guesses.
- **Verified gap — userscript scope:** `userscript/entry.js` requests Claude and Codex data on either supported page. Browser CORS rules and the narrow `@connect` list mean the wrong-provider request is both unnecessary and likely to fail. Scope refresh to the current host and explicitly document whether privileged GM network APIs are supported.

## Architecture Assessment

### Strengths to preserve

1. Plain ES modules and a small dependency surface keep the extension auditable and suitable for Chrome MV3, Firefox MV3, and userscript packaging.
2. The provider registry and API contract are a good seam for adapter-specific behavior without dynamic code loading.
3. State schema v2 migration, corruption recovery, import/export validation, stale-ledger/backpressure behavior, profile separation, and redacted outputs are strong foundations for a local-first product.
4. Accessibility styling already considers high contrast, reduced motion, keyboard navigation, and focus visibility; the missing piece is loaded-browser verification and complete localization/direction coverage.
5. The native bridge is separate from the extension build, which keeps optional automation from becoming a default runtime dependency.

### Gap analysis and prioritization

Fit means alignment with the existing browser-local architecture; impact means user trust or failure reduction; effort is the likely implementation size; risk is the chance of changing provider/browser behavior; novelty is the amount of new product surface. All ratings are relative and should be refined with implementation tests.

| ID | Opportunity | Fit | Impact | Effort | Risk | Novelty | Dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-01 | Recoverable, setting-aware notification alarms | High | High | Medium | Medium | Medium | Background alarm abstraction; notification tests |
| R-02 | Bounded provider request envelopes | High | High | Medium | Low | Medium | Shared API contract; adapter fixtures |
| R-03 | Provider TTL, dedupe, and backoff | High | High | Large | Medium | Medium | Refresh coordinator; stale-state UI |
| R-04 | Background message provenance validation | High | High | Medium | Medium | Low | Sender/url contract; forged-message tests |
| R-05 | Quota-aware history compaction | High | High | Medium | Low | Medium | Storage byte checks; migration fixtures |
| R-06 | Optional provider host permissions | High | High | Medium | Medium | Medium | Manifest/build matrix; permission UX |
| R-07 | Host-scoped userscript refresh | High | Medium | Medium | Low | Low | Host matrix; userscript tests/docs |
| R-08 | Provider schema-drift sentinels | High | High | Large | Medium | Medium | Fixture corpus; source-specific errors |
| R-09 | Packaged-browser runtime smoke lane | High | High | Large | Medium | Medium | Isolated Playwright/Chrome/Firefox setup |
| R-10 | Complete localization and RTL direction | High | Medium | Large | Medium | Medium | String catalog; logical CSS; locale fixtures |
| R-11 | Browser accessibility and visual acceptance | High | High | Medium | Medium | Medium | Loaded-browser harness; axe plus manual contracts |
| R-12 | Session/in-memory credential lifecycle | High | High | Medium | Medium | Medium | Storage capability detection; profile deletion semantics |
| R-13 | Scraper visibility/navigation lifecycle | High | High | Medium | Medium | Low | Observer controller; SPA lifecycle tests |
| R-14 | Notification tone and delivery retry semantics | High | Medium | Medium | Low | Low | Candidate schema; retry ledger |
| R-15 | Atomic refresh persistence | High | Medium | Medium | Medium | Low | State transaction boundary; sync write tests |
| R-16 | JavaScript typecheck ratchet | High | Medium | Large | Low | Low | JSDoc/type boundaries; CI budget |
| R-17 | Release/documentation/version provenance | High | Medium | Medium | Low | Low | Version source of truth; build checks |
| R-18 | Static provider authoring kit | Medium | Medium | Medium | Medium | Medium | Stable provider contract; fixture generator |
| R-19 | Versioned long-horizon local archive | Medium | Medium | Large | Low | Medium | Storage/export format; retention UX |
| R-20 | Opt-in local log import/export bridge | Medium | Medium | Large | High | High | Product decision; native/CLI boundary; threat model |

R-01 through R-09 are P1 because they prevent silent, costly, or security-relevant failures in the existing golden path. R-10 through R-17 are P2 because they improve trust and maintainability after the runtime contract is guarded. R-18 through R-20 are P3: they are valuable extensions, but each should wait for the core boundaries to stabilize. R-20 remains explicitly scoped as opt-in and local; it must not become arbitrary filesystem access in extension code.

### Test and release posture

**Verified baseline:** `npm test` passes the repository’s type-contract, model, scraper, storage, forecast, API, MCP, collaboration, native-scheduler, notification, budget, appearance, accessibility, UI DOM, host, manifest, browser/runtime, diagnostics, side panel, inline settings, i18n, and provider checks. `npm audit` is clean, and the current tree contains `esbuild@0.28.1`, `linkedom@0.18.13`, and TypeScript 7.0.2.

**Coverage limitation:** the tests are hand-written Node checks and `linkedom`/regex contracts. They do not prove extension loading, service-worker restart, real permission prompts, actual browser alarm behavior, page navigation, CSS reflow, focus trapping, or provider network cancellation. Playwright isolated contexts and the Chrome extension E2E guidance support a thin packaged-browser lane. Any GUI-capable run for this project must follow the repository’s invisible non-input desktop and verified virtual-display policy; no such GUI run was needed for this research pass.

**Dependency posture:** do not add a framework or large runtime dependency merely to improve test ergonomics. Prefer a small dev-only browser harness, deterministic fixtures, and the current build shape. Keep `npm audit`, lockfile integrity, build provenance, and a pinned Node 20 floor in the release gate.

### Coverage audit

The research and roadmap cover security, privacy, reliability, accessibility, i18n/RTL, observability, testing, dependency health, documentation, distribution, provider plugins, offline/resilience, multi-user/profile separation, and migration/upgrade behavior. Local-only exports and optional OTel-style diagnostics are addressed without default telemetry. Desktop and filesystem-log ideas are separated from the browser core. Safari and signed Firefox AMO submission remain external blockers already tracked in `Roadmap_Blocked.md`.

## Rejected Ideas

- **Hosted cloud dashboard or default team sync:** conflicts with the local-only promise, adds credentials and retention obligations, and is not needed to solve current runtime reliability. Keep explicit local exports, settings sync controls, and optional collaboration outputs.
- **Default telemetry or automatic OTel export:** observability is useful for an enterprise operator, but default activity export would change the privacy contract. Consider only explicit, redacted, user-triggered or opt-in destinations.
- **Remote provider plugins or fetched executable code:** Chrome MV3 prohibits remote hosted code patterns and a dynamic plugin source would weaken reviewability. Keep the registry static and build an authoring kit around versioned local adapters.
- **Wildcard provider permissions and userscript `@connect *`:** convenience is not sufficient justification for broad host exposure. Request exact provider permissions and keep the userscript network path explicit.
- **Primary native tray rewrite:** CodexBar, aqua, and related tools validate the use case, but the repository already has an optional native bridge and its differentiator is browser-local capture. Do not make a desktop rewrite the next investment.
- **Arbitrary local log crawling (R-20 rejected):** local-log tools prove adjacent demand, but filesystem access would require a separate opt-in native/CLI boundary, import format, redaction model, and threat model. Reject it for this release; the browser core remains filesystem-free, and any future bridge needs a separately authorized product and security review.
- **Automatic outage/status aggregation:** a new remote service would create another availability and privacy dependency. Prefer source age, stale reasons, retry state, and links to official provider status surfaces.
- **Automatic plan/billing entitlement inference or prescriptive spending actions:** provider windows and billing/cost semantics can disagree or change. Keep recommendations conservative and show the source and uncertainty behind every forecast.
- **Mobile native app or Safari implementation in this pass:** the current repo lacks the macOS/Xcode/Apple distribution environment, and Safari work is already blocked in `Roadmap_Blocked.md`. Do not duplicate those blocked items in `ROADMAP.md`.
- **Heavy framework migration:** the existing plain-module build is working and auditable. A framework would increase surface area without addressing the verified lifecycle, permission, request, or browser-test gaps.

## Sources

### First-party platform and provider documentation

- https://platform.claude.com/docs/en/manage-claude/usage-cost-api
- https://platform.openai.com/docs/api-reference/usage
- https://help.openai.com/en/articles/20001106-codex-rate-card
- https://docs.github.com/en/copilot/concepts/copilot-usage-metrics/copilot-metrics
- https://code.claude.com/docs/en/monitoring-usage
- https://developer.chrome.com/docs/extensions/reference/api/alarms
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/reference/api/permissions
- https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
- https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- https://www.tampermonkey.net/documentation.php?locale=en&q=connect
- https://violentmonkey.github.io/api/gm/

### Standards

- https://www.w3.org/TR/WCAG22/
- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale/getTextInfo

### Security advisories and extension security

- https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet/
- https://github.com/advisories/GHSA-67mh-4wv8-2f99

### Academic and engineering research

- https://arxiv.org/abs/2507.13926
- https://arxiv.org/abs/2503.04292
- https://arxiv.org/abs/2606.30560
- https://arxiv.org/abs/2602.09185
- https://arxiv.org/abs/2607.01418

### Testing research

- https://playwright.dev/docs/api/class-browsercontext
- https://playwright.dev/docs/next/accessibility-testing
- https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing
- https://playwright.dev/docs/browsers

### Dependency changelogs and package signals

- https://github.com/evanw/esbuild/releases/tag/v0.28.1
- https://github.com/microsoft/typescript-go/releases/tag/typescript%2Fv7.0.2
- https://www.npmjs.com/package/linkedom?activeTab=versions

### Awesome lists

- https://github.com/QuesmaOrg/awesome-ai-tokenomics
- https://github.com/mxschmitt/awesome-playwright

### Direct OSS competitors and adjacent tools

- https://github.com/lugia19/Claude-Usage-Extension
- https://github.com/soulduse/ai-token-monitor
- https://github.com/DhWU-coder/codex-usage/blob/main/README.en.md
- https://github.com/steipete/codexbar
- https://github.com/janekbaraniewski/openusage
- https://openusage.sh/docs/concepts/providers/
- https://openusage.sh/docs/faq/
- https://github.com/onllm-dev/onwatch
- https://github.com/aqua5230/usage
- https://github.com/Dicklesworthstone/coding_agent_usage_tracker
- https://github.com/jens-duttke/usage-monitor-for-claude
- https://github.com/JingbiaoMei/tokdash

### Commercial products

- https://devquota.com/
- https://marketplace.visualstudio.com/items?itemName=ToqirAhmad.ai-usage-tracker

### Community and upstream issue signal

- https://www.reddit.com/r/GithubCopilot/comments/1uyvdjt/quotapanel_token_tracker/
- https://www.reddit.com/r/chrome_extensions/comments/1utlosw/best_modern_chrome_extension_testing/
- https://www.reddit.com/r/chrome_extensions/comments/1u87i95/40_tests_passed_i_shipped_to_production_and_my/
- https://github.com/openai/codex/issues/32840
- https://github.com/openai/codex/issues/23192
- https://github.com/anthropics/claude-code/issues/54750
- https://github.com/anthropics/claude-code/issues/6958

## Open Questions

1. Should Chrome and Firefox request each provider’s API host only when a provider is enabled, or should a first-run choice allow a user to grant a reviewed bundle? The default recommendation is exact, provider-scoped requests; browser-specific UX needs live validation.
2. Which credential mode should be the default for API-enabled profiles: persistent local storage for continuity, session/in-memory storage for safety, or an explicit per-profile choice? The product needs a clear recovery story when a browser does not expose equivalent session storage behavior.
3. Can the userscript distribution support a privileged GM network path consistently across Tampermonkey and Violentmonkey, or should API analytics remain extension-only? The safe interim behavior is current-page-only web scraping with no cross-provider fetch.
4. What is the smallest fixture and schema-fingerprint set that catches provider drift without encoding brittle undocumented markup? Start with source/version/shape fingerprints and last-good preservation, then expand only when a real regression is observed.
5. What history retention promise is useful enough to justify a versioned archive format? The implementation should choose a byte/sample budget first, measure real state sizes, and avoid implying durable analytics storage until export/import semantics are specified.
6. Which release checks should become mandatory before the next version: packaged Chrome/Firefox smoke, permission diff, audit, typecheck ratchet, documentation/version scan, or all of them? The recommended minimum is the full P1 runtime lane plus audit, build provenance, and permission-diff checks.
