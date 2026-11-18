# Bounded demo upload contract

This is the human-authorized engineering contract from PLAN.md, not an assertion that original source schemas or production policies were defined. CSV/XLSX ingestion inserts new mapped records only. It does not replace existing records, integrate live systems, evaluate formulas, calculate KPIs or readiness gates, or provide exports.

## Explicit workflow and multipart API

Select a mock persona, click **Uploads** in navigation (`/admin/uploads`), choose a class and file, choose entity/relationship/metric, and enter each exact source header beside its logical target. Submit **Validate and upload**. Selecting a file or rendering the form sends no upload. Mapping edits are drafts, not saved reusable configurations.

`POST /api/v1/admin/uploads`, multipart fields exactly once each:

- `file`: file part, filename ending `.csv` or `.xlsx` (case insensitive). MIME is not trusted as proof of content.
- `datasetClass`: one exact class token below.
- `mapping`: JSON object encoded as a text field.
- `actor`: JSON text `{"personaId":"administrator"}`. This is supplied mock display context, **not authentication or RBAC**. Any 1–100 character persona context is accepted and recorded; no user identity is verified.

Mapping direction is **source header → logical field**, not the reverse:

```json
{"recordKind":"entity","columns":{"Identifier":"id","Kind":"type","Name":"label","Details":"attributes","Parent":"parentId","Tier":"criticality"}}
```

Mapping requires one supported recordKind, nonempty columns, unique targets and the required assignments. Unknown mapping/actor properties and duplicate JSON keys are rejected. A file has one record kind per request, but entity type may vary per row. Classes identify provenance, not fixed source columns or automatic transformations; every class accepts each supported record kind. QE and automation are separate stored class selections; their supplied metric families are never conflated or inferred from class.

## Supported fields

| Kind | Required mapped, nonempty fields | Optional fields |
|---|---|---|
| entity | id, type, label | parentId, criticality, attributes |
| relationship | id, sourceEntityId, targetEntityId, type | sourceRef |
| metric | id, label, family | value, unit, period, entityId |

Headers are dynamic and exact/case sensitive: no names such as `application_id` are imposed. Unmapped source columns are ignored. Header names must be nonempty, unique, and at most 200 characters. Identifiers and labels are literal strings; SQL values are parameterized, UI values are escaped text, and whitespace in nonblank supplied values is retained. Blank optional cells become null. Required identities/types/labels/families cannot be blank or whitespace-only.

Entity types: `domain`, `portfolio`, `service`, `application`, `environment`, `ticket`, `release`, `journey`, `owner`, `api`, `recommendation`, `transformation`. Extended types are stored and consumed by matching domain views; global discovery only exposes its existing supported types. `attributes` is a finite JSON object with unique keys, default `{}`. Nested objects/arrays and arbitrary source fields are retained as evidence, not interpreted as new executable features.

Useful source attributes consumed by existing views include `recordType`, `applicationId`, `releaseId`, `ownerId`, `environmentId`, `journeyId`, `domainId`, `portfolioId`, `health`, `automationMaturity`, `observabilityCoverage`, `severity`, `incidentSeverity`, `description`, `impact`, `build`, `test`, `security`, `change`, `environment`, `reason`, `confidence`. These are JSON attributes, not additional direct mapping targets. Do not invent a value when source evidence is absent.

Typed attribute references `applicationId`, `ownerId`, `environmentId`, `releaseId`, `journeyId`, `portfolioId`, `domainId` must point to the corresponding entity type. Filter association attributes `domain`, `portfolio`, `application`, `environment` may be an ID or list of IDs and are validated by type. Exception: release `environment` is source readiness prose/object, not an ID; use `environmentId` for the typed reference. Other opaque attributes are preserved but are not automatically FK references.

Relationship types are supplied nonempty strings. Existing consumers recognize directed types such as `depends_on`, `impact`, `affects`, `releases`, `has_defect`, `has_finding`, `owns`, `correlated_with`; storing another type does not invent a consumer. Both endpoint IDs must exist. A supplied relationship `sourceRef` is retained as `represented_context` source prose; canonical `source_ref` and `dataset_version_id` always identify the upload version. All entity/metric provenance likewise uses the upload version.

Metric `value` must be a finite literal decimal (optional sign/exponent), or empty/null. It is persisted exactly in `value_text`, never converted to SQLite REAL or rounded. Examples: `0`, `-1.2500`, `12345678901234567890.00000001`, `1e-40`. Reject `NaN`, `Infinity`, `%` decorations, grouping commas, booleans and expressions. Preserve supplied family, unit and period exactly; they are not inferred. Existing views support only their configured families/periods/names, so ingestion is not a promise that every custom metric will appear on a dashboard. For supported family views use the actual family (`qe`, `automation`, `release`, `security`, `reliability`, `observability`, `transformation`, `value`, etc.) and supported period such as `month`; no formulas are calculated. Empty metrics remain unavailable, not zero.

## Sample templates and mappings for all eleven classes

All rows below are synthetic. Use unique IDs per attempt. `app-0001` exists only when sample seeding is enabled; otherwise upload an application first. Copy the applicable CSV template below, replacing literal values as needed. XLSX uses the same dynamic headers and literal values in the first worksheet.

**E (entity):** mapping `{"recordKind":"entity","columns":{"Key":"id","Kind":"type","Name":"label","Data":"attributes"}}`

```csv
Key,Kind,Name,Data
upload-app,application,Demo application,"{""health"":""Source supplied""}"
```

**R (relationship):** mapping `{"recordKind":"relationship","columns":{"Key":"id","From":"sourceEntityId","To":"targetEntityId","Link":"type","Evidence":"sourceRef"}}`

```csv
Key,From,To,Link,Evidence
upload-link,app-0001,app-0002,depends_on,Source represented dependency
```

**M (metric):** mapping `{"recordKind":"metric","columns":{"Key":"id","Measure":"label","Family":"family","Amount":"value","Units":"unit","Window":"period","App":"entityId"}}`

```csv
Key,Measure,Family,Amount,Units,Window,App
upload-qe,Defect escape rate,qe,1.25000001,%,month,app-0001
```

| Exact datasetClass | Template and example row values (JSON shown decoded; CSV quotes must be doubled) | Dependent query evidence |
|---|---|---|
| master | E: `master-app, application, Demo app, {"health":"Supplied","ownerId":"owner-platform"}` | search, portfolio, application profile |
| journey_mapping | R: `journey-link, journey-enrollment, app-0001, depends_on, represented map` | journey overlay; endpoints must already exist |
| incident | E: `upload-incident, ticket, Demo incident, {"recordType":"incident","applicationId":"app-0001","severity":"Sev2"}` | operations and profile incidents |
| problem_rca | E: `upload-rca, ticket, Demo RCA, {"recordType":"problem_rca","applicationId":"app-0001","description":"Source analysis"}` | operational record; correlations require explicit relationship upload |
| release_metrics | E: `upload-release, release, Demo release, {"applicationId":"app-0001","build":"Supplied passing","test":"Source tested","security":"Source reviewed","change":"Source approved","environment":{"status":"Source ready"}}`; alternatively M with supplied family `release` | release evidence and matching release family measures |
| qe_metrics | M: `upload-qe, Defect escape rate, qe, 1.25000001, %, month, app-0001`; alternatively E ticket `recordType: defect` | QE metrics; defects in profile |
| automation_metrics | M: `upload-auto, Automation maturity, automation, 42.1250, %, month, app-0001` | automation evidence in profile (distinct from QE) |
| security_findings | E: `upload-finding, ticket, Demo finding, {"recordType":"security_finding","applicationId":"app-0001","severity":"High"}`; alternatively M family `security` | profile security posture and security measures |
| observability_kpi | E: `upload-observation, ticket, Demo observation, {"recordType":"observability_summary","applicationId":"app-0001","description":"Source coverage"}`; alternatively M family `observability` or supported `reliability` | observability summaries and matching profile/metric evidence |
| transformation_maturity | E: `upload-transform, transformation, Demo maturity, {"description":"Source maturity"}`; alternatively M family `transformation` with entityId referencing it | matching transformation evidence and ordered supplied points |
| value_trend | M: `upload-value, Value realized, value, 1200.0001, USD, month, app-0001` | matching supplied value/transformation evidence; arbitrary series are not auto-configured |

No class-specific required input column list is imposed. These templates are examples of supported logical records, not original source-system schemas. Upload dependencies first; entity parent/typed attribute references can refer forward within the same valid entity batch. Relationships/metrics cannot create new entities in the same one-kind request.

## Limits and parser safety

Defaults, configurable through backend Settings / environment:

| Setting | Default |
|---|---:|
| UPLOAD_MAX_BYTES | 5,242,880 (5 MiB file bytes) |
| UPLOAD_MAX_ROWS | 5,000 data rows, excluding header |
| UPLOAD_MAX_COLUMNS | 100 |
| XLSX_MAX_EXPANDED_BYTES | 52,428,800 (50 MiB across archive entries) |

Limits are demo engineering choices, not source NFRs or production capacity guarantees. The API also bounds the entire multipart wire body to configured file bytes plus 262,144 bytes of envelope allowance, one file/three text parts, each text part at most 65,536 bytes. XLSX allows at most 1,000 archive entries. CSV strict reader has its standard per-field safety bound (typically 131,072 characters); larger fields are rejected.

CSV must be UTF-8 (optional BOM), comma-delimited, well-formed quoted cells, rectangular with no NUL. Empty trailing optional fields need their delimiters. XLSX must be an internal first worksheet, contiguous rows starting with the header, no cells beyond header width/column bound, unique canonical cell references. Text/numeric literal cells and shared/inline strings are accepted; boolean/error/date-typed cells are rejected. Style-based Excel date serials are numeric text, not converted into dates: supply textual reporting periods. Formatting, charts, merges and calculated results are not imported.

The separate `upload_parser.py` helper uses stdlib ZIP handling and pinned `defusedxml==0.7.1`. It does not extract paths, resolve external entities or evaluate formulas. It checks total declared and actual expanded bytes, rejects unsafe/duplicate/encrypted entries, parses XML with DTD/entities/external access forbidden, and rejects formula cells even in later worksheets. It never follows external worksheet relationships.

## Atomicity, identities, provenance and outcomes

Validate all rows before insertion. Under a private SQLite `BEGIN IMMEDIATE` connection with FKs enabled, check every ID against entity/relationship/metric tables and against the entire input batch. Reject repeated/conflicting IDs, never upsert. Verify references against current DB or accepted entity batch. Insert all records + one dataset_version + one uploaded_data_version audit event atomically. Parent forward references use deferred FK checks. The audit records UTC timestamp, supplied persona, mapping, row count and version. The version stores sanitized filename basename and SHA-256; original source files are not retained as artifacts. Known rejection leaves all five affected tables unchanged. Failed attempts are not persisted when validation/storage prevents acceptance.

| HTTP | Meaning |
|---|---|
| 201 | Commit succeeded and a fresh connection re-queried full record count, version and audit. `data.outcome=success`, `source=uploaded`, `datasetVersion=uploadId`, `acceptedRows`, `reflection.status=confirmed`. |
| 400 | Invalid multipart shape, malformed mapping/actor JSON or unsupported class. Common error envelope. |
| 415 | Unsupported extension or mismatched binary container. |
| 422 | Parse or row validation rejected, with `error.details.issues` code/message and row/field where known. |
| 413 | Configured file/row/column/expanded-archive/wire limit exceeded. |
| 503 known | Precommit SQLite failure with confirmed rollback: error envelope `STORAGE_UNAVAILABLE`, `details.commitStatus=not_committed`. |
| 503 ambiguous | Commit raised or fresh verification cannot confirm: data envelope `outcome=unconfirmed`, null acceptedRows, unconfirmed reflection and no views. No rollback/no-data assertion. |

Errors follow `{ "error": { "code": "UPLOAD_REJECTED", "message": "…", "details": { "issues": [] } } }`. Generic unexpected failures are handled by the existing app-wide error handler; client-side write classification stays conservative.

Reflection lists query-capable dependent modules, not proof of a browser repaint, every source field having a consumer, or an external system update. Navigate/refetch after success, and check current filters: they may exclude new data. Missing fields/links stay unavailable.

Network loss, invalid write response, ambiguous 503 or missing confirmation locks the UI's submit button and warns **do not assume rollback**. There is no automatic retry. Inspect dependent views and ask the demo operator to query the correlated version/audit before explicitly unlocking another attempt. There is no idempotency key/recovery endpoint, background processing or retry queue. Retrying a committed batch will reject its IDs.

## Demo versus production

Local SQLite persistence is real and tested on fresh connections/restart. It is not durable shared ECS storage or a backup/retention guarantee. Mock persona is not authorization; do not upload PHI or production confidential records. Production requires real identity/RBAC, privacy classification, deployment request/concurrency budgets, malware/package review, durable storage/retention/backup, audit integrity and approved original source schemas. Export, snapshot, annotation and production controls are not implemented or promised here.
