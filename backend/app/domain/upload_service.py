"""Validate complete mapped batches and atomically persist local upload evidence."""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
import sqlite3
from uuid import uuid4
from app.core.config import Settings
from app.domain.upload_parser import parse_file
from app.schemas.uploads import UploadActor, UploadEnvelope, UploadFailure, UploadIssue, UploadMapping, UploadReflection, UploadResult
from app.storage.sqlite_repository import SqliteRepository

ENTITY_TYPES = {'domain', 'portfolio', 'service', 'application', 'environment', 'ticket', 'release', 'journey', 'owner', 'api', 'recommendation', 'transformation'}
VIEWS = {'entity': ['search', 'portfolio', 'applications', 'journeys', 'operations', 'readiness', 'insights'], 'relationship': ['journeys', 'applications', 'operations', 'insights'], 'metric': ['dashboard', 'reliability', 'readiness', 'applications', 'transformation']}
REFERENCE_ATTRIBUTES = {'applicationId': 'application', 'ownerId': 'owner', 'environmentId': 'environment', 'releaseId': 'release', 'journeyId': 'journey', 'portfolioId': 'portfolio', 'domainId': 'domain'}


def load_object(value: str) -> dict:
    """Decode finite JSON objects, rejecting ambiguous duplicate keys."""
    def unique(pairs: list[tuple[str, object]]) -> dict:
        """Reject duplicate keys instead of silently replacing supplied values."""
        result = {}
        for key, item in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = item
        return result
    def invalid(value: str) -> None:
        """Reject nonstandard numeric constants."""
        raise ValueError('JSON numbers must be finite')
    result = json.loads(value, object_pairs_hook=unique, parse_constant=invalid)
    if not isinstance(result, dict):
        raise ValueError('Expected a JSON object')
    return result


class UploadService:
    """Own batch validation and explicit known-versus-ambiguous write outcomes."""
    def __init__(self, repository: SqliteRepository, config: Settings) -> None:
        """Retain real file storage and configured parser bounds."""
        self.repository = repository
        self.config = config

    def _connect(self) -> sqlite3.Connection:
        """Open a private connection; enable FK enforcement before any writes."""
        connection = sqlite3.connect(self.repository.path, timeout=5)
        connection.execute('PRAGMA foreign_keys=ON')
        return connection

    def _commit(self, connection: sqlite3.Connection) -> None:
        """Commit once; the caller classifies an exception as ambiguous."""
        connection.commit()

    def _map(self, headers: list[str], rows: list[list[str]], mapping: UploadMapping) -> list[dict]:
        """Validate every cell and return all issues before touching storage."""
        missing = set(mapping.columns) - set(headers)
        if missing:
            raise UploadFailure(422, 'UPLOAD_REJECTED', 'Mapping names columns absent from the file.', [UploadIssue(code='MISSING_COLUMN', message=f'Column not found: {name}', field=name) for name in sorted(missing)])
        records, issues = [], []
        for number, row in enumerate(rows, 2):
            record = {field: row[headers.index(source)] or None for source, field in mapping.columns.items()}
            for field in ('id', 'label', 'type', 'sourceEntityId', 'targetEntityId', 'family'):
                if field in record and (not record[field] or not record[field].strip()):
                    issues.append(UploadIssue(code='REQUIRED_VALUE', message='Supply a nonempty mapped value.', row=number, field=field))
            if mapping.recordKind == 'entity':
                if record.get('type') not in ENTITY_TYPES:
                    issues.append(UploadIssue(code='ENTITY_TYPE', message='Use a supported entity type from the contract.', row=number, field='type'))
                try:
                    record['attributes'] = load_object(record.get('attributes') or '{}')
                    # Ensure nested nonfinite numbers and oversized numeric conversions cannot escape.
                    json.dumps(record['attributes'], allow_nan=False)
                except (ValueError, RecursionError, OverflowError):
                    issues.append(UploadIssue(code='ATTRIBUTES_JSON', message='Attributes must be a finite JSON object with unique keys.', row=number, field='attributes'))
                    record['attributes'] = {}
            if mapping.recordKind == 'metric' and record.get('value') is not None:
                try:
                    value = record['value']
                    if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?', value) or not Decimal(value).is_finite():
                        raise ValueError('Numeric literal required')
                except (ValueError, InvalidOperation):
                    issues.append(UploadIssue(code='METRIC_NUMBER', message='Supply a finite numeric literal, or leave empty for unavailable.', row=number, field='value'))
            records.append(record)
        if issues:
            raise UploadFailure(422, 'UPLOAD_REJECTED', 'Correct the mapped row values; no records were accepted.', issues)
        return records

    def _validate_storage(self, connection: sqlite3.Connection, records: list[dict], kind: str) -> None:
        """Reject all identity conflicts and missing typed references inside the write lock."""
        issues = []
        existing = {row[0] for table in ('entity', 'relationship', 'metric') for row in connection.execute(f'SELECT id FROM {table}')}
        entities = dict(connection.execute('SELECT id,entity_type FROM entity'))
        if kind == 'entity':
            entities.update({record['id']: record['type'] for record in records})
        seen = set()
        for number, record in enumerate(records, 2):
            key = record['id']
            if key in seen or key in existing:
                issues.append(UploadIssue(code='DUPLICATE_ID', message='Use a new ID; existing and repeated IDs cannot be replaced.', row=number, field='id'))
            seen.add(key)
            refs = [(field, record.get(field), None) for field in ('parentId', 'entityId', 'sourceEntityId', 'targetEntityId')]
            if kind == 'entity':
                attrs = record['attributes']
                refs += [(f'attributes.{field}', attrs.get(field), expected) for field, expected in REFERENCE_ATTRIBUTES.items()]
                for field, expected in (('domain', 'domain'), ('portfolio', 'portfolio'), ('application', 'application'), ('environment', 'environment')):
                    if field in attrs and not (field == 'environment' and record['type'] == 'release'):
                        refs += [(f'attributes.{field}', item, expected) for item in (attrs[field] if isinstance(attrs[field], list) else [attrs[field]])]
            for field, target, expected in refs:
                if target is None or target == '':
                    continue
                if not isinstance(target, str) or target not in entities or (expected and entities[target] != expected):
                    issues.append(UploadIssue(code='INVALID_REFERENCE', message='Reference an existing or accepted-batch entity of the required type.', row=number, field=field))
        if issues:
            raise UploadFailure(422, 'UPLOAD_REJECTED', 'Correct duplicate IDs and references; no records were accepted.', issues)

    def accept(self, dataset_class: str, data: bytes, filename: str, mapping: UploadMapping, actor: UploadActor) -> UploadEnvelope:
        """Parse then validate the entire batch and commit records, version and audit once.

        Raises:
            UploadFailure: For known precommit rejection or rolled-back storage failure.
        Returns:
            Confirmed re-queried version, or unconfirmed if commit/verification is ambiguous.
        """
        headers, rows = parse_file(data, filename, self.config)
        records = self._map(headers, rows, mapping)
        version = 'up-' + uuid4().hex
        timestamp = datetime.now(timezone.utc).isoformat()
        result = UploadResult(uploadId=version, datasetVersion=version, datasetClass=dataset_class, outcome='unconfirmed', reflection=UploadReflection(status='unconfirmed', views=[]))
        connection = None
        committing = False
        try:
            connection = self._connect()
            connection.execute('BEGIN IMMEDIATE')
            self._validate_storage(connection, records, mapping.recordKind)
            connection.execute('PRAGMA defer_foreign_keys=ON')
            safe_name = re.sub(r'[^\w. -]', '_', filename.replace('\\', '/').rsplit('/', 1)[-1])[:200]
            connection.execute('INSERT INTO dataset_version (id,dataset_class,source_kind,source_filename,content_sha256,accepted_at,accepted_by,outcome,reflection_status) VALUES (?,?,?,?,?,?,?,?,?)', (version, dataset_class, 'uploaded', safe_name, hashlib.sha256(data).hexdigest(), timestamp, actor.personaId, 'success', 'confirmed'))
            for record in records:
                common = (version, 'uploaded', version)
                if mapping.recordKind == 'entity':
                    connection.execute('INSERT INTO entity (id,entity_type,label,parent_id,criticality,attributes_json,dataset_version_id,source_kind,source_ref) VALUES (?,?,?,?,?,?,?,?,?)', (record['id'], record['type'], record['label'], record.get('parentId'), record.get('criticality'), json.dumps(record['attributes'], allow_nan=False), *common))
                elif mapping.recordKind == 'relationship':
                    connection.execute('INSERT INTO relationship (id,source_entity_id,target_entity_id,relationship_type,represented_context,dataset_version_id,source_kind,source_ref) VALUES (?,?,?,?,?,?,?,?)', (record['id'], record['sourceEntityId'], record['targetEntityId'], record['type'], record.get('sourceRef'), *common))
                else:
                    connection.execute('INSERT INTO metric (id,name,family,value_text,unit,period,entity_id,availability,dataset_version_id,source_kind,source_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)', (record['id'], record['label'], record['family'], record.get('value'), record.get('unit'), record.get('period'), record.get('entityId'), 'available' if record.get('value') is not None else 'unavailable', *common))
            connection.execute('INSERT INTO audit_event (id,event_type,occurred_at,actor_context,target_type,target_id,summary,details_json,dataset_version_id) VALUES (?,?,?,?,?,?,?,?,?)', ('audit-' + uuid4().hex, 'uploaded_data_version', timestamp, actor.model_dump_json(), 'dataset_version', version, 'Accepted mapped demo upload', json.dumps({'datasetClass': dataset_class, 'rows': len(records), 'mapping': mapping.model_dump()}), version))
            committing = True
            self._commit(connection)
            # A fresh connection must see the entire accepted version and audit.
            table = mapping.recordKind
            persisted = self.repository.read(f'SELECT COUNT(*) AS count FROM {table} WHERE dataset_version_id=?', (version,))[0]['count']
            audit = self.repository.read('SELECT id FROM audit_event WHERE dataset_version_id=?', (version,))
            if persisted == len(records) and audit and self.repository.read('SELECT id FROM dataset_version WHERE id=?', (version,)):
                result.outcome = 'success'
                result.acceptedRows = persisted
                result.reflection = UploadReflection(status='confirmed', views=VIEWS[table])
            return UploadEnvelope(data=result, availability='available' if result.outcome == 'success' else 'unavailable')
        except sqlite3.Error as error:
            if committing:
                return UploadEnvelope(data=result, availability='unavailable')
            if connection is not None:
                try:
                    connection.rollback()
                except sqlite3.Error:
                    return UploadEnvelope(data=result, availability='unavailable')
            raise UploadFailure(503, 'STORAGE_UNAVAILABLE', 'Upload was not committed. Storage is unavailable; nothing was accepted.') from error
        finally:
            if connection is not None:
                connection.close()
