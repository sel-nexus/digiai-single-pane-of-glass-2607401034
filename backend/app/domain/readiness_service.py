"""Read exact source-associated release evidence and named readiness measures."""
import json
from app.domain.entity_service import DIMENSIONS, EntityService
from app.domain.kpi_service import KpiService, PERIODS
from app.schemas.contracts import (ApplicationCategory, ApplicationEvidence, MetricValue, Page,
    QueryContext, ReadinessCategories, ReadinessEvidencePage, ReadinessMetricsPage, ReleaseEvidenceRecord)
from app.storage.sqlite_repository import EntityRepository

MEASURES = {
    'release': ('deployment frequency', 'lead time for change', 'change failure rate', 'rollback rate', 'pipeline success rate'),
    'qe': ('test execution success %', 'automation coverage %', 'defect leakage %', 'escaped defects', 'environment readiness %'),
    'security': ('critical vulnerabilities', 'aged findings', 'secure SDLC compliance %', 'policy violations'),
}
CATEGORIES = ('build', 'test', 'security', 'change', 'environment')


class ReadinessService:
    """Keep display scope and source evidence separate from release decisions."""

    def __init__(self, repository: EntityRepository, entities: EntityService, kpis: KpiService) -> None:
        """Inject shared storage, entity scope and supplied KPI reader."""
        self.repository, self.entities, self.kpis = repository, entities, kpis

    def _matching(self, context: QueryContext, ids: list[str]) -> tuple[set[str], list[str]]:
        """Fail closed for unsupported selected dimensions."""
        if context.personaId and context.personaId not in {item.id for item in self.kpis.personas()}:
            raise LookupError('Unknown configured persona')
        unknown = [key for key, value in context.filters.items() if value and key not in DIMENSIONS]
        supported = context.model_copy(update={'filters': {key: value for key, value in context.filters.items() if key in DIMENSIONS}})
        matched, unavailable = self.entities.matching_ids(supported, ids)
        return (set() if unknown else matched), sorted(set(unavailable + unknown))

    def _page(self, total: int, limit: int, offset: int) -> Page:
        """Expose a next cursor only when another bounded page exists."""
        return Page(limit=limit, total=total, nextCursor=str(offset + limit) if offset + limit < total else None)

    def _application(self, application_id: str) -> dict:
        """Resolve only an exact application identifier, never a fallback."""
        rows = self.repository.read('SELECT * FROM entity WHERE id=? AND entity_type=?', (application_id, 'application'))
        if not rows:
            raise LookupError('Unknown represented application')
        return rows[0]

    def _associated_apps(self, row: dict) -> set[str]:
        """Read only explicit application fields and directed releases relationships."""
        attrs = json.loads(row['attributes_json'])
        apps = {attrs['applicationId']} if isinstance(attrs.get('applicationId'), str) else set()
        apps.update(link['target_entity_id'] for link in self.repository.read(
            'SELECT target_entity_id FROM relationship WHERE source_entity_id=? AND relationship_type=? AND source_ref IS NOT NULL',
            (row['id'], 'releases')))
        return apps

    def _category(self, row: dict, key: str, period: str) -> ApplicationCategory:
        """Expose only supplied status, period and provenance, never arbitrary gate fields."""
        attrs = json.loads(row['attributes_json'])
        raw = attrs.get(key)
        status = raw.get('status') if isinstance(raw, dict) else raw
        supplied_period = raw.get('period') if isinstance(raw, dict) else attrs.get('period')
        source_ref = raw.get('sourceRef') if isinstance(raw, dict) else row['source_ref']
        source = raw.get('source', row['source_kind']) if isinstance(raw, dict) else row['source_kind']
        available = isinstance(status, str) and bool(status.strip()) and supplied_period == period and bool(source_ref)
        items = [ApplicationEvidence(id=row['id'], label=f'Supplied {key} status', value={'status': status},
            source=source, sourceRef=source_ref, association=f'entity:{row["id"]}.{key}', period=supplied_period)] if available else None
        return ApplicationCategory(availability='available' if available else 'unavailable', value=items)

    def evidence(self, context: QueryContext, application_id: str | None = None, release_id: str | None = None,
                 period: str = 'month', limit: int = 50, cursor: str | None = None) -> ReadinessEvidencePage:
        """Scope exact releases before pagination; absent associations stay empty.

        Raises:
            LookupError: When an explicit application or release is unknown or mismatched.
            ValueError: When period or pagination is unsupported.
        """
        offset = self.entities._offset(limit, cursor)
        if period not in PERIODS:
            raise ValueError('Unsupported reporting period')
        if application_id is not None:
            self._application(application_id)
        rows = self.repository.read('SELECT * FROM entity WHERE entity_type=? ORDER BY id', ('release',))
        if release_id is not None:
            rows = [row for row in rows if row['id'] == release_id]
            if not rows:
                raise LookupError('Unknown represented release')
            if application_id and application_id not in self._associated_apps(rows[0]):
                raise LookupError('Release is not associated with the selected application')
        matched, unavailable = self._matching(context, [row['id'] for row in rows])
        records = []
        for row in rows:
            if row['id'] not in matched:
                continue
            apps = self._associated_apps(row)
            if application_id:
                apps &= {application_id}
            for app_id in sorted(apps):
                targets = self.repository.read('SELECT * FROM entity WHERE id=? AND entity_type=?', (app_id, 'application'))
                app_match, _ = self._matching(context, [app_id])
                if targets and app_id in app_match:
                    records.append(ReleaseEvidenceRecord(id=row['id'], label=row['label'], application=self.entities._entity(targets[0]),
                        source=row['source_kind'], sourceRef=row['source_ref'], categories=ReadinessCategories(**{
                            key: self._category(row, key, period) for key in CATEGORIES})))
        return ReadinessEvidencePage(data=records[offset:offset + limit], unavailableDimensions=unavailable,
            availability='unavailable' if unavailable or not records else 'available', page=self._page(len(records), limit, offset))

    def metrics(self, context: QueryContext, family: str, period: str = 'month', limit: int = 50,
                cursor: str | None = None) -> ReadinessMetricsPage:
        """Read each named measure through the KPI reader for its exact scoped source.

        Notes:
            Missing definitions remain individually unavailable. A filtered no-result is empty.
        """
        offset = self.entities._offset(limit, cursor)
        if family not in MEASURES or period not in PERIODS:
            raise ValueError('Unsupported readiness family or period')
        rows = self.repository.read('SELECT * FROM metric WHERE family=? ORDER BY id', (family,))
        matched, unavailable = self._matching(context, [row['entity_id'] for row in rows if row['entity_id']])
        scoped = [row for row in rows if row['entity_id'] in matched]
        values = []
        if not unavailable and (scoped or not context.filters and not context.hierarchyNodeId):
            for index, label in enumerate(MEASURES[family]):
                candidates = [row for row in scoped if row['name'] == label]
                exact = next((row for row in candidates if row['period'] == period), None)
                row = exact or (candidates[0] if candidates else None)
                metric = self.kpis._metric(row['id'], period, context) if row else MetricValue(
                    id=f'readiness-{family}-{index}', label=label, family=family, value=None, unit=None,
                    period=period, availability='unavailable', source='sample', sourceRef=None)
                if not metric.sourceRef:
                    metric = metric.model_copy(update={'value': None, 'availability': 'unavailable'})
                values.append(metric)
        return ReadinessMetricsPage(data=values[offset:offset + limit], unavailableDimensions=unavailable,
            availability='available' if not unavailable and any(item.availability == 'available' for item in values) else 'unavailable',
            page=self._page(len(values), limit, offset))
