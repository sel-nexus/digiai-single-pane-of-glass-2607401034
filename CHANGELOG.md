# Changelog

## Whole-UI modernization
- Modernized shared light/dark surfaces, typography hierarchy, rounded containers, navigation, forms, evidence panels, responsive grids and focus/reduced-motion styling across the existing DigiAI UI. Added an interlocking-pane brand mark and consistent mobile navigation closure.
- Added accessible fixed 0–100 percentage gauges to shared metric cards used by dashboard, reliability and readiness. Only available, source-qualified, in-range numeric percentages plot. Exact values and provenance remain visible; these are not scores or targets.
- Added source-ordered, same-unit transformation comparison bars with zero baseline and exact textual alternatives. Missing, incompatible, underflowing or unrepresentable magnitudes are explicitly withheld, never silently shown as zero.
- Added directed journey source/relationship/target diagrams for supplied relationships only, preserving overlays, API inspection, application drilldown and return scope.
- Added component and real-service desktop/mobile browser regressions. Corrected one browser source-label locator to target the application header.

Modified application files: `frontend/src/index.css`, `frontend/src/components/shell/AppShell.jsx`, `frontend/src/pages/dashboard/KpiBoard.jsx`, `frontend/src/pages/insights/TransformationTrends.jsx`, `frontend/src/pages/journeys/RelationshipOverlay.jsx`. Related component tests and E2E files were extended; three modern feature E2E files and a standalone UI evidence capture were added.

No breaking API, database schema, authentication, dependency or business-rule changes. No migration required. FastAPI and file-backed SQLite retained; seeded data remains synthetic and qualified. No production analytics/integrations added. Existing deployment persistence limitations remain.

Verification: 583 backend tests (including 13 integration), 286 frontend cases; all 130 desktop/mobile journeys verified across the full run and targeted correction. Independent critic: PASS 1.00, zero high failures. Vite build and Docker Compose build/start passed. UI accessibility/style/HTML capture and screenshots saved for human review. Automated verification is not release/design approval.
