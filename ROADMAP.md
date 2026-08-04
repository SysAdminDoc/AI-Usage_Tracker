# Roadmap

Open work only. Completed release history belongs in `CHANGELOG.md`; rejected or deferred research decisions belong in `RESEARCH.md`.

## Existing Open Items

### P1
### P2
### P3
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

