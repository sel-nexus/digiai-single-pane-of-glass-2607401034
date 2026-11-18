"""Persist supported configuration and its audit event in one local transaction."""
from datetime import datetime, timezone
import json
import sqlite3
from uuid import uuid4
from urllib.parse import quote
from app.schemas.admin import Actor, AdminFailure, ConfigCatalog, ConfigEnvelope, ConfigResult, KpiConfig, MappingConfig, ScenarioConfig, WidgetConfig
from app.storage.sqlite_repository import SqliteRepository


class ConfigService:
    """Validate existing catalog references and commit once without automatic retries."""
    def __init__(self, repository: SqliteRepository) -> None:
        """Retain the shared SQLite file, never a shared connection."""
        self.repository = repository

    def _connect(self) -> sqlite3.Connection:
        """Open a private foreign-key-enforced write connection."""
        db = sqlite3.connect(self.repository.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        return db

    def _commit(self, db: sqlite3.Connection) -> None:
        """Commit once; exceptions after this boundary are unconfirmed."""
        db.commit()

    def _actor(self, db: sqlite3.Connection, actor: Actor) -> None:
        """Reject unknown mock actors without introducing authorization."""
        if not db.execute("SELECT id FROM app_config WHERE config_kind='persona' AND scope_id=?", (actor.personaId,)).fetchone():
            raise AdminFailure(404, 'RESOURCE_NOT_FOUND', 'Choose an existing mock actor persona.', {'issues': [{'field': 'actor', 'message': 'Unknown mock persona.'}]})

    def _destinations(self, db: sqlite3.Connection) -> list[str]:
        """Build internal destinations only from available modules and exact IDs."""
        paths = ['/portfolio', '/journeys', '/operations', '/operations/reliability', '/readiness', '/readiness/release', '/readiness/qe', '/readiness/security', '/insights', '/insights/transformation']
        paths += ['/journeys/' + quote(row['id'], safe='') for row in db.execute("SELECT id FROM entity WHERE entity_type='journey' ORDER BY id LIMIT 100")]
        return paths

    def catalog(self) -> ConfigCatalog:
        """Read bounded supported configuration, including hidden persona widgets."""
        with self.repository.transaction() as db:
            configs = [dict(row) for row in db.execute('SELECT * FROM app_config ORDER BY rowid LIMIT 500')]
            decoded = lambda kind: [json.loads(row['payload_json']) | ({'personaId': row['scope_id']} if kind == 'widget' else {}) for row in configs if row['config_kind'] == kind]
            relationships = [dict(row) for row in db.execute("SELECT r.id AS relationshipId,r.source_entity_id AS sourceEntityId,r.target_entity_id AS targetEntityId,r.relationship_type AS type FROM relationship r JOIN entity s ON s.id=r.source_entity_id JOIN entity t ON t.id=r.target_entity_id WHERE s.entity_type='journey' AND t.entity_type IN ('application','api') AND r.relationship_type IN ('depends_on','impact') ORDER BY r.id LIMIT 100")]
            return ConfigCatalog(personas=decoded('persona'), widgets=decoded('widget'), metrics=[dict(row) for row in db.execute('SELECT id AS metricId,name AS label FROM metric ORDER BY id LIMIT 100')], scenarios=decoded('scenario'), relationships=relationships, destinations=self._destinations(db))

    def _apply(self, db: sqlite3.Connection, kind: str, payload: KpiConfig | MappingConfig | ScenarioConfig | WidgetConfig, persona_id: str | None, widget_id: str | None) -> tuple[str, dict]:
        """Validate and update only explicitly selected existing records."""
        if kind == 'kpi':
            row = db.execute('SELECT * FROM metric WHERE id=?', (payload.metricId,)).fetchone()
            if row is None:
                raise AdminFailure(404, 'RESOURCE_NOT_FOUND', 'Choose an existing supplied metric.', {'issues': [{'field': 'metricId', 'message': 'Unknown metric.'}]})
            if db.execute('SELECT id FROM metric WHERE name=? AND id<>?', (payload.label, payload.metricId)).fetchone():
                raise AdminFailure(422, 'INVALID_CONFIG', 'Choose a distinct metric label to preserve supplied identity.', {'issues': [{'field': 'label', 'message': 'Label already belongs to another supplied metric.'}]})
            db.execute('UPDATE metric SET name=? WHERE id=?', (payload.label, payload.metricId))
            for widget in db.execute("SELECT * FROM app_config WHERE config_kind='widget'").fetchall():
                config = json.loads(widget['payload_json'])
                if config['metricId'] == payload.metricId:
                    config['title'] = payload.title
                    db.execute('UPDATE app_config SET payload_json=? WHERE id=?', (json.dumps(config), widget['id']))
            return 'kpi-' + payload.metricId, payload.model_dump(exclude={'actor'})
        if kind == 'scenario':
            row = db.execute("SELECT * FROM app_config WHERE config_kind='scenario' AND json_extract(payload_json,'$.id')=?", (payload.scenarioId,)).fetchone()
            if row is None:
                raise AdminFailure(404, 'RESOURCE_NOT_FOUND', 'Choose an existing scenario.', {'issues': [{'field': 'scenarioId', 'message': 'Unknown scenario.'}]})
            if payload.destination not in self._destinations(db):
                raise AdminFailure(422, 'INVALID_CONFIG', 'Choose an available internal destination from the catalog.', {'issues': [{'field': 'destination', 'message': 'External, arbitrary and path redirects are not supported.'}]})
            config = {'id': payload.scenarioId, 'label': payload.label, 'description': payload.description, 'destination': payload.destination}
            return row['id'], config
        if kind == 'widget':
            if not db.execute("SELECT id FROM app_config WHERE config_kind='persona' AND scope_id=?", (persona_id,)).fetchone():
                raise AdminFailure(404, 'RESOURCE_NOT_FOUND', 'Unknown widget persona.')
            row = db.execute("SELECT * FROM app_config WHERE config_kind='widget' AND scope_id=? AND json_extract(payload_json,'$.id')=?", (persona_id, widget_id)).fetchone()
            if row is None:
                raise AdminFailure(404, 'RESOURCE_NOT_FOUND', 'Choose an existing widget for this persona.', {'issues': [{'field': 'widgetId', 'message': 'Widget is not configured for this persona.'}]})
            config = json.loads(row['payload_json']) | {'visible': payload.visible}
            return row['id'], config
        row = db.execute('SELECT * FROM relationship WHERE id=?', (payload.relationshipId,)).fetchone()
        if row is None:
            raise AdminFailure(404, 'RESOURCE_NOT_FOUND', 'Choose an existing supported relationship.', {'issues': [{'field': 'relationshipId', 'message': 'Unknown relationship.'}]})
        source = db.execute('SELECT entity_type FROM entity WHERE id=?', (payload.sourceEntityId,)).fetchone()
        target = db.execute('SELECT entity_type FROM entity WHERE id=?', (payload.targetEntityId,)).fetchone()
        if source is None or target is None:
            raise AdminFailure(404, 'RESOURCE_NOT_FOUND', 'Both mapped entities must exist.', {'issues': [{'field': 'sourceEntityId' if source is None else 'targetEntityId', 'message': 'Unknown entity ID.'}]})
        if source['entity_type'] != 'journey' or target['entity_type'] not in ('application', 'api'):
            raise AdminFailure(422, 'INVALID_CONFIG', 'Map an existing journey to an existing application or API asset.', {'issues': [{'field': 'targetEntityId', 'message': 'Unsupported relationship endpoint types.'}]})
        original_source = db.execute('SELECT entity_type FROM entity WHERE id=?', (row['source_entity_id'],)).fetchone()
        if original_source['entity_type'] != 'journey' or row['relationship_type'] not in ('depends_on', 'impact'):
            raise AdminFailure(422, 'INVALID_CONFIG', 'Only existing journey dependency/impact mappings can be configured.')
        db.execute('UPDATE relationship SET source_entity_id=?,target_entity_id=?,relationship_type=?,represented_context=? WHERE id=?', (payload.sourceEntityId, payload.targetEntityId, payload.type, 'Explicit administrator mapping; not causal', payload.relationshipId))
        return 'mapping-' + payload.relationshipId, payload.model_dump(exclude={'actor'})

    def save(self, kind: str, payload: KpiConfig | MappingConfig | ScenarioConfig | WidgetConfig, persona_id: str | None = None, widget_id: str | None = None) -> ConfigEnvelope:
        """Atomically save and audit, then confirm through a fresh connection.

        Raises:
            AdminFailure: For validation or a known rolled-back precommit failure.
        Returns:
            Unconfirmed rather than a rollback claim if commit or verification fails.
        """
        if kind not in ('kpi', 'mapping', 'scenario', 'widget'):
            raise AdminFailure(422, 'INVALID_CONFIG', 'Unsupported configuration kind.')
        db, committing = None, False
        audit_id = 'audit-' + uuid4().hex
        result = ConfigResult(configId='', auditId=audit_id, outcome='unconfirmed', effectiveStatus='unconfirmed', saved=False)
        try:
            db = self._connect()
            db.execute('BEGIN IMMEDIATE')
            self._actor(db, payload.actor)
            config_id, config = self._apply(db, kind, payload, persona_id, widget_id)
            timestamp = datetime.now(timezone.utc).isoformat()
            result.configId = config_id
            db.execute('INSERT INTO app_config VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by', (config_id, kind if kind != 'kpi' else 'kpi_definition', persona_id, json.dumps(config), timestamp, payload.actor.userId))
            event_type = 'override' if kind == 'widget' else 'edit'
            db.execute('INSERT INTO audit_event (id,event_type,occurred_at,actor_context,target_type,target_id,summary,details_json) VALUES (?,?,?,?,?,?,?,?)', (audit_id, event_type, timestamp, payload.actor.model_dump_json(), kind, config_id, 'Saved demo ' + kind + ' configuration', json.dumps({'config': config, 'personaId': persona_id})))
            committing = True
            self._commit(db)
            rows = self.repository.read('SELECT payload_json FROM app_config WHERE id=? AND updated_at=?', (config_id, timestamp))
            audit = self.repository.read('SELECT id FROM audit_event WHERE id=?', (audit_id,))
            if rows and audit and json.loads(rows[0]['payload_json']) == config:
                result.config = json.loads(rows[0]['payload_json'])
                result.outcome, result.effectiveStatus, result.saved = 'success', 'confirmed', True
            return ConfigEnvelope(data=result, availability='available' if result.saved else 'unavailable')
        except AdminFailure:
            if db is not None:
                db.rollback()
            raise
        except sqlite3.Error as error:
            if committing:
                return ConfigEnvelope(data=result, availability='unavailable')
            if db is not None:
                db.rollback()
            raise AdminFailure(503, 'STORAGE_UNAVAILABLE', 'Configuration was not committed. Check storage availability before a new attempt.', {'commitStatus': 'not_committed'}) from error
        finally:
            if db is not None:
                db.close()
