"""Read bounded persisted audit events and disclose unavailable export dependency."""
import json
from app.schemas.admin import AdminFailure, AuditEvent, AuditFilter, AuditPage
from app.storage.sqlite_repository import SqliteRepository


class AuditService:
    """Review actual events without enabling unresolved annotation workflows."""
    def __init__(self, repository: SqliteRepository) -> None:
        """Inject the shared file-backed repository."""
        self.repository = repository

    def list(self, filters: AuditFilter) -> AuditPage:
        """Apply exact event type, target ID and actor persona filters with AND."""
        conditions, values = [], []
        for field, value in [('event_type', filters.eventType), ('target_id', filters.target), ("json_extract(actor_context, '$.personaId')", filters.persona)]:
            if value is not None:
                conditions.append(f'{field}=?')
                values.append(value)
        where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
        total = self.repository.read('SELECT COUNT(*) AS count FROM audit_event' + where, values)[0]['count']
        rows = self.repository.read('SELECT * FROM audit_event' + where + ' ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?', [*values, filters.limit, filters.offset])
        events = [AuditEvent(id=row['id'], eventType=row['event_type'], occurredAt=row['occurred_at'], actor=json.loads(row['actor_context']) if row['actor_context'] else None, targetType=row['target_type'], targetId=row['target_id'], summary=row['summary'], details=json.loads(row['details_json']), datasetVersionId=row['dataset_version_id']) for row in rows]
        return AuditPage(data=events, total=total, limit=filters.limit, offset=filters.offset)

    def export(self, filters: AuditFilter) -> None:
        """Refuse export until an owner approves artifact format and contents."""
        raise AdminFailure(409, 'DEPENDENCY_UNAVAILABLE', 'Audit export is unavailable. Ask the product owner to approve export format and contents; review events on screen meanwhile.', {'dependency': 'approved_audit_export_definition'})
