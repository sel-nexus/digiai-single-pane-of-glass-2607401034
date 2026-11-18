"""Read supplied operational evidence with exact non-causal associations."""
import json
from app.domain.entity_service import DIMENSIONS, EntityService
from app.domain.kpi_service import KpiService
from app.schemas.contracts import (ApplicationCategory, ApplicationEvidence, CorrelationLink,
    CorrelationsPage, MetricValue, OperationRecord, OperationsMetricsPage, OperationsPage, Page, QueryContext)
from app.storage.sqlite_repository import EntityRepository

RECORD_TYPES = ('incident', 'problem_rca', 'major_incident')
MEASURES = ('Availability %', 'SLA compliance %', 'Sev1 count', 'Sev2 count', 'MTTD', 'MTTR',
            'repeat incident rate', 'alert noise reduction %', 'observability coverage')


class OperationsService:
    """Keep incidents, supplied signals and reliability distinct from risk evidence."""

    def __init__(self, repository: EntityRepository, entities: EntityService, kpis: KpiService) -> None:
        """Reuse the shared repository, context matcher and supplied metric reader."""
        self.repository, self.entities, self.kpis = repository, entities, kpis

    def _matching(self, context: QueryContext, ids: list[str]) -> tuple[set[str], list[str]]:
        """Fail closed for unsupported filters while reusing shared supported matching."""
        unknown = [key for key, value in context.filters.items() if value and key not in DIMENSIONS]
        supported = context.model_copy(update={'filters': {key: value for key, value in context.filters.items() if key in DIMENSIONS}})
        matched, unavailable = self.entities.matching_ids(supported, ids)
        return (set() if unknown else matched), unavailable + unknown

    def _category(self, evidence: list[ApplicationEvidence]) -> ApplicationCategory:
        """Mark absent associations unavailable rather than inventing values."""
        return ApplicationCategory(availability='available' if evidence else 'unavailable', value=evidence or None)

    def _evidence(self, row: dict, value: object, association: str) -> ApplicationEvidence:
        """Preserve exact source identity and association alongside structured values."""
        return ApplicationEvidence(id=row['id'], label=row['label'], value=value, source=row['source_kind'],
                                   sourceRef=row['source_ref'], association=association)

    def _context(self, row: dict) -> ApplicationCategory:
        """Return only direct application, API, journey, service or dependency references."""
        evidence = []
        targets = {item['id']: item for item in self.repository.read('SELECT * FROM entity')}
        attrs = json.loads(row['attributes_json'])
        for field, kind in (('applicationId', 'application'), ('apiId', 'api'), ('journeyId', 'journey'),
                            ('serviceId', 'service'), ('dependencyId', 'dependency')):
            target = targets.get(attrs.get(field)) if isinstance(attrs.get(field), str) else None
            if target and target['entity_type'] == kind:
                evidence.append(self._evidence(target, {'id': target['id'], 'label': target['label'], 'type': kind},
                                              f'entity:{row["id"]}.{field}'))
        links = self.repository.read('SELECT * FROM relationship WHERE source_entity_id=? OR target_entity_id=? ORDER BY id',
                                     (row['id'], row['id']))
        for link in links:
            target_id = link['target_entity_id'] if link['source_entity_id'] == row['id'] else link['source_entity_id']
            target = targets.get(target_id)
            if (target and target['entity_type'] in ('application', 'api', 'journey', 'service', 'dependency')
                    and link['source_ref'] and link['relationship_type'] in ('affects', 'impact', 'depends_on', 'context')):
                evidence.append(self._evidence(link | {'label': target['label']},
                    {'id': target_id, 'label': target['label'], 'type': target['entity_type'],
                     'relationship': 'represented context', 'context': link['represented_context']}, f'relationship:{link["id"]}'))
        return self._category(evidence)

    def _record(self, row: dict) -> OperationRecord:
        """Present supplied record fields without diagnosing their meaning."""
        attrs = json.loads(row['attributes_json'])
        return OperationRecord(id=row['id'], label=row['label'], recordType=attrs['recordType'],
            source=row['source_kind'], sourceRef=row['source_ref'],
            evidence=self._category([self._evidence(row, attrs, f'entity:{row["id"]}')]), businessContext=self._context(row))

    def _list(self, context: QueryContext, kinds: tuple[str, ...], limit: int, cursor: str | None,
              incident_id: str | None = None) -> OperationsPage:
        """Scope source rows before slicing a canonical bounded page."""
        offset = self.entities._offset(limit, cursor)
        rows = [row for row in self.repository.read('SELECT * FROM entity ORDER BY id')
                if row['entity_type'] == 'ticket' and json.loads(row['attributes_json']).get('recordType') in kinds
                and (incident_id is None or row['id'] == incident_id)]
        matched, unavailable = self._matching(context, [row['id'] for row in rows])
        selected = [row for row in rows if row['id'] in matched]
        return OperationsPage(data=[self._record(row) for row in selected[offset:offset + limit]],
            availability='unavailable' if unavailable or not selected else 'available', unavailableDimensions=unavailable,
            page=self._page(len(selected), limit, offset))

    def _page(self, total: int, limit: int, offset: int) -> Page:
        """Expose the next canonical cursor only when another page exists."""
        return Page(limit=limit, total=total, nextCursor=str(offset + limit) if offset + limit < total else None)

    def _incident(self, incident_id: str) -> dict:
        """Reject unknown IDs and other ticket types, including security findings."""
        rows = self.repository.read('SELECT * FROM entity WHERE id=? AND entity_type=?', (incident_id, 'ticket'))
        if not rows or json.loads(rows[0]['attributes_json']).get('recordType') not in RECORD_TYPES:
            raise LookupError('No represented operational record has this identifier.')
        return rows[0]

    def incidents(self, context: QueryContext, limit: int = 50, cursor: str | None = None,
                  record_type: str | None = None, incident_id: str | None = None) -> OperationsPage:
        """List distinct record types, or resolve an exact selected identity."""
        if record_type is not None and record_type not in RECORD_TYPES:
            raise ValueError('Unsupported operational record type')
        if incident_id is not None:
            self._incident(incident_id)
        return self._list(context, (record_type,) if record_type else RECORD_TYPES, limit, cursor, incident_id)

    def correlations(self, incident_id: str, context: QueryContext, limit: int = 50,
                     cursor: str | None = None) -> CorrelationsPage:
        """Return only direct explicitly represented correlation rows, never transitive links."""
        self._incident(incident_id)
        offset = self.entities._offset(limit, cursor)
        matched, unavailable = self._matching(context, [incident_id])
        links = []
        if incident_id in matched:
            for row in self.repository.read('SELECT * FROM relationship WHERE (source_entity_id=? OR target_entity_id=?) AND relationship_type=? ORDER BY id',
                                            (incident_id, incident_id, 'correlates_with')):
                target_id = row['target_entity_id'] if row['source_entity_id'] == incident_id else row['source_entity_id']
                targets = self.repository.read('SELECT * FROM entity WHERE id=?', (target_id,))
                if not row['source_ref'] or not targets:
                    continue
                target = targets[0]
                links.append(CorrelationLink(id=row['id'], sourceEntityId=row['source_entity_id'], targetEntityId=row['target_entity_id'],
                    evidence=self._evidence(row | {'label': target['label']},
                        {'targetId': target_id, 'targetLabel': target['label'], 'targetType': target['entity_type'],
                         'fields': json.loads(target['attributes_json']), 'context': row['represented_context']}, f'relationship:{row["id"]}')))
        return CorrelationsPage(data=links[offset:offset + limit], incidentId=incident_id,
            availability='unavailable' if unavailable or not links else 'available', unavailableDimensions=unavailable,
            page=self._page(len(links), limit, offset))

    def metrics(self, context: QueryContext, period: str = 'month', limit: int = 50,
                cursor: str | None = None) -> OperationsMetricsPage:
        """Return the nine named measures using exact supplied KPI values, never formulas."""
        offset = self.entities._offset(limit, cursor)
        unknown = [key for key, value in context.filters.items() if value and key not in DIMENSIONS]
        supported = context.model_copy(update={'filters': {key: value for key, value in context.filters.items() if key in DIMENSIONS}})
        summaries = [self.kpis.summary(supported, period, family) for family in ('enterprise', 'reliability')]
        supplied = {metric.label: metric for summary in summaries for metric in summary.data}
        values = [supplied.get(label) or MetricValue(id=f'operations-{index}', label=label, family='reliability',
            value=None, unit=None, period=period, availability='unavailable', source='sample', sourceRef=None)
            for index, label in enumerate(MEASURES)]
        dimensions = sorted({dim for summary in summaries for dim in summary.unavailableDimensions} | set(unknown))
        if unknown:
            values = [item.model_copy(update={'value': None, 'availability': 'unavailable'}) for item in values]
        return OperationsMetricsPage(data=values[offset:offset + limit], unavailableDimensions=dimensions,
            availability='unavailable' if dimensions or not any(item.availability == 'available' for item in values) else 'available',
            page=self._page(len(values), limit, offset))

    def observability(self, context: QueryContext, limit: int = 50, cursor: str | None = None) -> OperationsPage:
        """Read only supplied summary and event records with explicit app/service context."""
        return self._list(context, ('observability_event', 'observability_summary'), limit, cursor)
