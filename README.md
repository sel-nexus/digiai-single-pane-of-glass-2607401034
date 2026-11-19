# DigiAI Single Pane of Glass

Enterprise prototype command center built with React 18 JavaScript, Vite, Tailwind CSS, FastAPI/Python and file-backed SQLite. Four explicit mock personas share a connected dashboard, eight filters, hierarchy/search, journey maps, Application 360, incident/reliability and release/QE/security evidence, mock recommendations, transformation indicators and local data stewardship.

## Prototype boundaries
All seeded records are synthetic and source-qualified. Persona is presentation context, **not authentication or authorization**. No live telemetry, production integrations, source write-back, AI inference, remediation or compliance certification. Missing evidence stays unavailable. KPIs are supplied values, never invented formulas. Undefined snapshot/annotation and audit export remain disabled pending approved definitions.

SQLite persists locally across process restarts; Docker Compose uses a local named volume. **ECS task-local SQLite is disposable and not shared or durable across replacement/replicas.** An approved external persistence/recovery architecture is required before relying on deployed administrator changes. AWS deployment is downstream, not verified by this Developer stage.

## Development
Requires Python 3.12 and Node 24 (container build uses Node 24 Debian; Alpine/Node 22 produced a Rollup parser error).

```sh
python3 -m venv --copies "$HOME/venvs/app"
cd backend
"$HOME/venvs/app/bin/pip" install -r requirements.txt
cp .env.example .env
"$HOME/venvs/app/bin/python" -m app.main
```

In another terminal:
```sh
cd frontend
npm ci --no-bin-links
cp .env.example .env
node node_modules/vite/bin/vite.js
```
Defaults: UI http://localhost:5173, API http://localhost:8000; UI development proxy preserves same-origin `/api` requests. Per-tier `.env.example` documents configuration. Do not commit `.env` files. OpenAPI is available at `/docs`; backend liveness `/api/health`. Frontend root is explicit persona selection, not login.

## Containers
```sh
docker compose up --build -d
```
UI http://localhost:8080, API http://localhost:8000. Frontend nginx proxies `/api` to backend service and supports deep-link history fallback. `WEB_PORT` and `API_PORT` control published ports. Do not delete the `prototype-data` volume unless you intend to discard local records.

## Data ingestion and configuration
See [approved prototype upload contract](docs/upload-contract.md). Eleven dataset classes accept mapped UTF-8 CSV or first-sheet XLSX. No fixed input headers are imposed; map source columns to supported logical fields. Bounded safe parsing rejects formulas/unsafe XML/archive structures and duplicate/conflicting IDs. Confirmed writes persist dataset provenance and audit in one transaction; ambiguous completion is unconfirmed, never automatically retried. Verify current records before explicitly unlocking an uncertain form.

Configuration changes supported source labels/titles, explicit existing relationship mappings, approved internal scenario destinations and persona-specific widget visibility. Dashboard reads refresh after confirmed saves. Audit shows unverified mock actor context and timestamp; exact supported filters are event type, target ID and persona. It is not forensic identity assurance.

## Verification
```sh
cd backend
PYTHONPATH=. "$HOME/venvs/app/bin/python" -m pytest -q --ignore=tests/test_integration.py
PYTHONPATH=. "$HOME/venvs/app/bin/python" -m pytest -q tests/test_integration.py
cd ../frontend
node node_modules/vitest/vitest.mjs run
node node_modules/@playwright/test/cli.js install chromium
node node_modules/@playwright/test/cli.js test
node node_modules/vite/bin/vite.js build
```
Playwright starts real frontend/backend servers with an isolated temporary SQLite file and runs desktop/mobile projects. Console/page errors fail tests; deliberate transport-loss scenarios narrowly allow expected failures. Configuration tests restore observable catalog state in `finally`; audit events remain append-only. Browser specs cover actual backend values, cross-feature navigation, uploads/reflection, missing evidence, loading, error, recovery and scope preservation.

Current modernization verification: 583 backend cases including 13 integration; 286 frontend component cases; all 130 desktop/mobile browser journeys verified across the full run and targeted locator correction (initial 128 passed, 2 failed; affected spec rerun 4 passed). Independent critic passed at 1.00, zero high failures, round 4. Frontend production build and Docker Compose build/start passed. Text-based UI preflight captured desktop/mobile light/dark route states and screenshots under `frontend/preflight-modern-evidence/`; Playwright's current `ariaSnapshot()` API replaces the removed accessibility snapshot API. Evidence is for human review, not required to run the app. Final visual and release acceptance remains the product owner's decision.

## Modernized UI and visualization boundaries
Shared teal-tinted surfaces, purposeful depth, responsive navigation, typography, forms and evidence layouts modernize all existing routes without changing workflows. Shared metric cards plot only available, source-qualified, finite percentages in the exact 0–100 range; gauges are not scores or targets. Transformation charts compare compatible supplied numeric points in source order, not inferred chronology. Directed journey graphics show supplied relationship pairs only. Exact text, units, periods and provenance remain visible; missing or numerically unrepresentable data is explicitly unplotted. See CHANGELOG.md for changed files. No API/database migration or new authentication is introduced.

## Known limitations
- Production bundle reports a 572.30 kB minified JavaScript chunk (142.81 kB gzip); not a performance SLA. AWS stress/soak and latency budgets remain unverified.
- Current npm audit after router/test-runner upgrades reports zero findings. An earlier audit reported picomatch ReDoS; its reported patched version was unavailable from the registry. Zero subsequent findings alone is not proof of remediation; review advisories before public deployment.
- Direct dependency versions are pinned; Python transitive dependencies are not fully locked.
- A 1000-application synthetic dataset demonstrates representation, not a real inventory or production capacity claim.
