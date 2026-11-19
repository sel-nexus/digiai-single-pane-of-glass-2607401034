# Changelog

## Horizon-aligned dashboard redesign
- Replaced the horizontal navigation with a fixed desktop header and sidebar and a responsive mobile disclosure, retaining all existing links, persona context, search, filters and themes. Updated the shared slate/blue palette and compact dashboard card/grid presentation to follow the supplied Horizon reference.
- Preserved existing source-qualified values, visualizations, workflows, FastAPI and SQLite. No backend production code, schema, API, authentication, dependency or migration changes.
- Added shell and dashboard component/browser coverage including keyboard, modified clicks, desktop scrolling, tablet and mobile. Strengthened existing API validation tests and isolated the mapping browser journey with its own temporary SQLite-backed service.
- Changed application files: `frontend/src/components/shell/AppShell.jsx`, `frontend/src/pages/dashboard/DashboardPage.jsx`, `frontend/src/index.css`. Updated tests in `frontend/src/components/shell/discovery.test.jsx`, `frontend/src/pages/dashboard/dashboard.test.jsx`, `frontend/e2e/horizon-shell.spec.js`, `frontend/e2e/horizon-dashboard.spec.js`, `frontend/e2e/mapping.spec.js`, `frontend/preflight-modern.spec.js`, and `backend/tests/test_operations_api.py`, `test_readiness_api.py`, `test_uploads_api.py`.
- Verification: 589 backend tests including 13 integration, 297 frontend tests, Vite build and Docker Compose build/start passed. Browser run: 134 passed, 2 mapping cases failed due to the test proxy port; both passed after the setup fix in a focused rerun. Independent test critic PASS 1.00, zero high failures, round 4. Desktop/mobile preflight captures are for owner review. Product-owner approval of visual fidelity, charts and supported viewports remains required before release.

## Whole-UI modernization
- Modernized shared light/dark surfaces, typography hierarchy, rounded containers, navigation, forms, evidence panels, responsive grids and focus/reduced-motion styling across the existing DigiAI UI. Added an interlocking-pane brand mark and consistent mobile navigation closure.
- Added accessible fixed 0–100 percentage gauges to shared metric cards used by dashboard, reliability and readiness. Only available, source-qualified, in-range numeric percentages plot. Exact values and provenance remain visible; these are not scores or targets.
- Added source-ordered, same-unit transformation comparison bars with zero baseline and exact textual alternatives. Missing, incompatible, underflowing or unrepresentable magnitudes are explicitly withheld, never silently shown as zero.
- Added directed journey source/relationship/target diagrams for supplied relationships only, preserving overlays, API inspection, application drilldown and return scope.
- Added component and real-service desktop/mobile browser regressions. Corrected one browser source-label locator to target the application header.

Modified application files: `frontend/src/index.css`, `frontend/src/components/shell/AppShell.jsx`, `frontend/src/pages/dashboard/KpiBoard.jsx`, `frontend/src/pages/insights/TransformationTrends.jsx`, `frontend/src/pages/journeys/RelationshipOverlay.jsx`. Related component tests and E2E files were extended; three modern feature E2E files and a standalone UI evidence capture were added.

No breaking API, database schema, authentication, dependency or business-rule changes. No migration required. FastAPI and file-backed SQLite retained; seeded data remains synthetic and qualified. No production analytics/integrations added. Existing deployment persistence limitations remain.

Verification: 583 backend tests (including 13 integration), 286 frontend cases; all 130 desktop/mobile journeys verified across the full run and targeted correction. Independent critic: PASS 1.00, zero high failures. Vite build and Docker Compose build/start passed. UI accessibility/style/HTML capture and screenshots saved for human review. Automated verification is not release/design approval.
