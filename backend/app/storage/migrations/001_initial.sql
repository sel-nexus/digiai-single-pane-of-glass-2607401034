PRAGMA foreign_keys = ON;
CREATE TABLE dataset_version (
  id TEXT PRIMARY KEY,
  dataset_class TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('sample','local','uploaded')),
  source_filename TEXT,
  content_sha256 TEXT,
  accepted_at TEXT,
  accepted_by TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','error','unconfirmed')),
  reflection_status TEXT NOT NULL CHECK (reflection_status IN ('confirmed','unconfirmed','not_applicable')),
  issues_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE entity (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  label TEXT NOT NULL,
  parent_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
  criticality TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  dataset_version_id TEXT REFERENCES dataset_version(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('sample','local','uploaded')),
  source_ref TEXT
);
CREATE INDEX ix_entity_type_parent ON entity(entity_type,parent_id);
CREATE INDEX ix_entity_label ON entity(label COLLATE NOCASE);
CREATE TABLE relationship (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  target_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  represented_context TEXT,
  dataset_version_id TEXT REFERENCES dataset_version(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('sample','local','uploaded')),
  source_ref TEXT,
  UNIQUE(source_entity_id,target_entity_id,relationship_type,dataset_version_id)
);
CREATE INDEX ix_relationship_source_type ON relationship(source_entity_id,relationship_type);
CREATE INDEX ix_relationship_target_type ON relationship(target_entity_id,relationship_type);
CREATE TABLE metric (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  family TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  unit TEXT,
  period TEXT,
  entity_id TEXT REFERENCES entity(id) ON DELETE SET NULL,
  availability TEXT NOT NULL CHECK (availability IN ('available','unavailable')),
  dataset_version_id TEXT REFERENCES dataset_version(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('sample','local','uploaded')),
  source_ref TEXT,
  CHECK (value_text IS NULL OR value_number IS NULL)
);
CREATE INDEX ix_metric_family_entity_period ON metric(family,entity_id,period);
CREATE TABLE app_config (
  id TEXT PRIMARY KEY,
  config_kind TEXT NOT NULL,
  scope_id TEXT,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX ix_config_kind_scope ON app_config(config_kind,scope_id);
CREATE TABLE audit_event (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('edit','override','annotation','uploaded_data_version')),
  occurred_at TEXT NOT NULL,
  actor_context TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  dataset_version_id TEXT REFERENCES dataset_version(id)
);
CREATE INDEX ix_audit_occurred_at ON audit_event(occurred_at);
CREATE INDEX ix_audit_event_target ON audit_event(event_type,target_type,target_id);
