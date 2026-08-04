# Roadmap

Open work only. Completed release history belongs in `CHANGELOG.md`; rejected or deferred research decisions belong in `RESEARCH.md`.

## Existing Open Items

### P1
### P2
### P3
- [ ] P3 — Webhook on notification rule fire
  Why: Power users may want Slack, Discord, or generic POST alerts when quota thresholds trip.
  Evidence: Existing Later item; commercial tools emphasize proactive alerts.
  Touches: `src/lib/notify.js`, `src/ui/options.js`, `src/background.js`
  Acceptance: Optional webhook delivery is disabled by default, redacts provider data by default, and is tested for retries/failure copy.
  Complexity: M

- [ ] P3 — Month-end bill prediction
  Why: Run-rate prediction turns raw API usage into a planning signal.
  Evidence: Tokens 4 Breakfast and CostGoat emphasize monthly spend forecasting.
  Touches: `src/lib/history.js`, cost provider modules, popup/options analytics
  Acceptance: API-key providers show a tested projected month-end cost with confidence label and assumptions.
  Complexity: L

- [ ] P3 — Plan optimization recommendations
  Why: Users need plan guidance only after usage history is accurate and exportable.
  Evidence: Tokens 4 Breakfast plan optimization; current history and forecast primitives.
  Touches: `src/lib/history.js`, popup analytics, options copy
  Acceptance: The app suggests cheaper or higher-cap plans only when data coverage is sufficient and labels uncertainty.
  Complexity: L

- [ ] P3 — Per-API-key and workspace breakdown
  Why: Official API usage endpoints support higher-resolution cost attribution.
  Evidence: OpenAI Usage API and Anthropic analytics docs.
  Touches: API provider modules, popup/options analytics, export
  Acceptance: API paths can group by workspace/project/API key without exposing secret values in UI or exports.
  Complexity: L

- [ ] P3 — MCP usage server
  Why: Claude Code and other agents could query remaining usage without a browser context switch.
  Evidence: Existing Later item; adjacent statusline and local-monitor tools show demand.
  Touches: native bridge, separate MCP package, storage export boundary
  Acceptance: A local-only MCP tool exposes `get_usage`, `forecast`, and `time_to_reset` from explicit exported state.
  Complexity: XL

- [ ] P3 — Team or collaboration dashboard
  Why: Teams need aggregate cost visibility, but this changes privacy and infrastructure assumptions.
  Evidence: WakaTime AI and TokenWatch team/client attribution models.
  Touches: optional aggregator, export schema, privacy docs, auth model
  Acceptance: Any team mode is opt-in, self-hostable or user-provided, and never uploads prompts or code.
  Complexity: XL

- [ ] P3 — Per-client, project, and git-branch attribution
  Why: Agencies need billable AI spend attribution, but it belongs after cost/API foundations.
  Evidence: TokenWatch captures cost, model, developer, project, and branch without prompt/code content.
  Touches: API provider modules, optional local Git metadata bridge, exports
  Acceptance: Attribution metadata is opt-in, redacted in diagnostics, and exportable for invoicing.
  Complexity: XL

- [ ] P3 — Native messaging companion for schedule reliability
  Why: MV3 service workers can sleep through exact notification windows.
  Evidence: Chrome service worker lifecycle docs; existing QuotaGlass bridge capability.
  Touches: native bridge, installer docs, `src/background.js`, `src/lib/notify.js`
  Acceptance: An explicit opt-in helper can wake the extension for scheduled refresh/briefing checks across supported OSes.
  Complexity: L

## Research-Driven Additions

### P1

### P2
### P3
- [ ] P3 — Claude cache-hit ratio metric
  Why: Cache timer visibility is useful, but users also need to know whether they are actually reusing cache before it expires.
  Evidence: `src/lib/cache-timer.js`, Claude stream metadata, OpenUsage cache-hit-ratio request #212, Tokens 4 Breakfast cache reuse positioning.
  Touches: `src/lib/cache-timer.js`, `src/lib/history.js`, widget/popup analytics
  Acceptance: The app records cache-window reuse events locally and shows a 24-hour/7-day cache reuse ratio with clear limitations.
  Complexity: M

