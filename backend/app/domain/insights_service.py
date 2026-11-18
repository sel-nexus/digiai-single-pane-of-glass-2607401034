"""Read mock explanations and supplied transformation evidence without inference."""
import json
import math
from urllib.parse import quote, urlencode
from app.domain.entity_service import DIMENSIONS, EntityService
from app.domain.kpi_service import KpiService
from app.schemas.contracts import (InsightAssociation, MetricValue, Page, QueryContext,
    Recommendation, RecommendationsPage, Transformation, TransformationPage, TransformationSeries)
from app.storage.sqlite_repository import EntityRepository

MEASURES = ('adoption', 'maturity', 'value', 'effort')
LABELS = {'adoption': 'Adoption', 'maturity': 'Maturity', 'value': 'Value realized', 'effort': 'Effort saved'}


def supplied(value: object) -> bool:
    """Accept a nonempty source string or finite number, not objects or booleans."""
    return (isinstance(value, str) and bool(value.strip())) or (
        isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value))


class InsightsService:
    """Reuse file-backed storage and shared scope with source-only destinations."""

    def __init__(self, repository: EntityRepository, entities: EntityService, kpis: KpiService) -> None:
        """Inject storage and common scope/persona readers."""
        self.repository, self.entities, self.kpis = repository, entities, kpis

    def _rows(self, kind: str, context: QueryContext, application_id: str | None,
              limit: int, cursor: str | None) -> tuple[list[dict], list[str], int]:
        """Filter before pagination and fail closed for unknown selected dimensions."""
        offset = self.entities._offset(limit, cursor)
        if context.personaId and context.personaId not in {item.id for item in self.kpis.personas()}:
            raise LookupError('Unknown configured persona')
        if application_id is not None and not self.repository.read(
                'SELECT id FROM entity WHERE id=? AND entity_type=?', (application_id, 'application')):
            raise LookupError('Unknown represented application')
        rows = self.repository.read('SELECT * FROM entity WHERE entity_type=? ORDER BY id', (kind,))
        unknown = [key for key, values in context.filters.items() if values and key not in DIMENSIONS]
        scope = context.model_copy(update={'filters': {key: value for key, value in context.filters.items() if key in DIMENSIONS}})
        matched, unavailable = self.entities.matching_ids(scope, [row['id'] for row in rows])
        rows = [] if unknown else [row for row in rows if row['id'] in matched]
        if application_id is not None:
            rows = [row for row in rows if any(link.entityType == 'application' and link.entityId == application_id
                for link in self._associations(row['id'], scope))]
        return rows, sorted(set(unavailable + unknown)), offset

    def _associations(self, item_id: str, context: QueryContext) -> list[InsightAssociation]:
        """Resolve only directed context edges with provenance and an available target."""
        links = self.repository.read(
            'SELECT r.id AS link_id,r.source_kind AS link_source,r.source_ref AS link_ref,e.* '
            'FROM relationship r JOIN entity e ON e.id=r.target_entity_id '
            'WHERE r.source_entity_id=? AND r.relationship_type=? ORDER BY r.id', (item_id, 'context'))
        links = [row for row in links if row['entity_type'] in ('journey', 'portfolio', 'application')
                 and row['link_ref'] and row['source_ref']]
        visible, _ = self.entities.matching_ids(context, [row['id'] for row in links])
        result = []
        for row in links:
            if row['id'] not in visible:
                continue
            kind, identity = row['entity_type'], row['id']
            destination = f'/portfolio?{urlencode({"entityId": identity})}' if kind == 'portfolio' else (
                f'/{"applications" if kind == "application" else "journeys"}/{quote(identity, safe="")}')
            result.append(InsightAssociation(id=row['link_id'], entityType=kind, entityId=identity,
                label=row['label'], destination=destination, source=row['link_source'], sourceRef=row['link_ref']))
        return result

    def _page(self, total: int, limit: int, offset: int) -> Page:
        """Expose the next canonical offset only when more records exist."""
        return Page(total=total, limit=limit, nextCursor=str(offset + limit) if offset + limit < total else None)

    def recommendations(self, context: QueryContext, application_id: str | None = None,
                        limit: int = 50, cursor: str | None = None) -> RecommendationsPage:
        """Return each record's own explanation; a missing field makes only that item incomplete."""
        rows, unavailable, offset = self._rows('recommendation', context, application_id, limit, cursor)
        records = []
        for row in rows[offset:offset + limit]:
            attrs = json.loads(row['attributes_json'])
            reason = attrs.get('reason')
            reason = reason if isinstance(reason, str) and reason.strip() else None
            confidence = attrs.get('confidence') if supplied(attrs.get('confidence')) else None
            complete = reason is not None and confidence is not None
            records.append(Recommendation(id=row['id'], label=row['label'], reason=reason, confidence=confidence,
                complete=complete, availability='available' if complete and row['source_ref'] else 'unavailable',
                source=row['source_kind'], sourceRef=row['source_ref'], associations=self._associations(row['id'], context)))
        return RecommendationsPage(data=records, context=context, unavailableDimensions=unavailable,
            availability='unavailable' if unavailable or not rows else 'available', page=self._page(len(rows), limit, offset))

    def _metric(self, raw: object, row: dict, identity: str, label: str, period: str | None) -> MetricValue:
        """Require each value's explicit period and provenance, retaining supplied units."""
        raw = raw if isinstance(raw, dict) else {}
        source = raw.get('source', row['source_kind'])
        source = source if source in ('sample', 'local', 'uploaded') else row['source_kind']
        ref = raw.get('sourceRef')
        ref = ref if isinstance(ref, str) and ref.strip() else None
        supplied_period = raw.get('period')
        supplied_period = supplied_period if isinstance(supplied_period, str) and supplied_period.strip() else None
        available = supplied(raw.get('value')) and bool(ref) and bool(supplied_period) and (
            period is None or supplied_period == period)
        return MetricValue(id=identity, label=label, family='transformation', value=raw.get('value') if available else None,
            unit=raw.get('unit') if isinstance(raw.get('unit'), str) else None, period=supplied_period,
            source=source, sourceRef=ref, availability='available' if available else 'unavailable')

    def transformation(self, context: QueryContext, application_id: str | None = None, period: str | None = None,
                       limit: int = 50, cursor: str | None = None) -> TransformationPage:
        """Preserve explicit source point order; one point or any missing period is not a trend."""
        if period is not None and (not period.strip() or len(period) > 100):
            raise ValueError('Invalid reporting period')
        rows, unavailable, offset = self._rows('transformation', context, application_id, limit, cursor)
        records = []
        for row in rows[offset:offset + limit]:
            attrs = json.loads(row['attributes_json'])
            raw_measures = attrs.get('measures') if isinstance(attrs.get('measures'), dict) else {}
            measures = [self._metric(raw_measures.get(key), row, f'{row["id"]}-{key}', LABELS[key], period) for key in MEASURES]
            series = []
            for index, raw in enumerate(attrs.get('series') if isinstance(attrs.get('series'), list) else []):
                if not isinstance(raw, dict):
                    continue
                label = raw.get('label') if isinstance(raw.get('label'), str) else 'Series label unavailable'
                points = [self._metric(point, row, f'{row["id"]}-series-{index}-{number}', label, None)
                    for number, point in enumerate(raw.get('points') if isinstance(raw.get('points'), list) else [])]
                trend = len(points) > 1 and all(point.availability == 'available' for point in points)
                if period is not None:
                    points = [point for point in points if point.period == period]
                    trend = trend and len(points) > 1
                series.append(TransformationSeries(label=label, points=points, availability='available' if trend else 'unavailable'))
            records.append(Transformation(id=row['id'], label=row['label'], source=row['source_kind'], sourceRef=row['source_ref'],
                availability='available' if row['source_ref'] and any(item.availability == 'available' for item in measures) else 'unavailable',
                measures=measures, series=series, associations=self._associations(row['id'], context)))
        return TransformationPage(data=records, context=context, unavailableDimensions=unavailable,
            availability='unavailable' if unavailable or not rows else 'available', page=self._page(len(rows), limit, offset))
