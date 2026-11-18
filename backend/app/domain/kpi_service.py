"""Retrieve configured dashboards and source-provided metrics without inference."""
import json
from app.schemas.contracts import Dashboard, Envelope, MetricValue, Persona, QueryContext, Scenario, Widget
from app.storage.sqlite_repository import EntityRepository
from app.domain.entity_service import EntityService

FAMILIES = ('enterprise', 'reliability', 'release', 'qe', 'security', 'transformation')
PERIODS = ('day', 'week', 'month', 'quarter')


class KpiService:
    """Keep display persona configuration separate from supplied KPI evidence."""
    def __init__(self, repository: EntityRepository) -> None:
        """Inject the shared structured-record repository."""
        self.repository = repository

    def personas(self) -> list[Persona]:
        """Return only configured approved mock personas."""
        return [Persona.model_validate(json.loads(row['payload_json'])) for row in self.repository.read("SELECT payload_json FROM app_config WHERE config_kind=? ORDER BY rowid LIMIT 100", ('persona',))]

    def _metric(self, metric_id: str, period: str, context: QueryContext) -> MetricValue:
        """Resolve a configured identity; ambiguous alternate periods are unavailable."""
        rows = self.repository.read('SELECT * FROM metric WHERE id=?', (metric_id,))
        if not rows:
            return MetricValue(id=metric_id, label='Metric unavailable', family='enterprise', value=None, unit=None, period=period, availability='unavailable', source='sample', sourceRef=None)
        row = rows[0]
        exact = [row] if row['period'] == period else self.repository.read('SELECT * FROM metric WHERE name=? AND family=? AND period=? AND entity_id IS ? ORDER BY id', (row['name'], row['family'], period, row['entity_id']))
        scoped, _ = EntityService(self.repository).matching_ids(context, [row['entity_id']])
        supported = (not context.filters and not context.hierarchyNodeId) or row['entity_id'] in scoped
        return self._value(exact[0] if len(exact) == 1 else row, period, supported and len(exact) == 1).model_copy(update={'id': metric_id})

    def _value(self, row: dict, period: str, exact: bool) -> MetricValue:
        """Present one source row without converting stored decimal text or aggregating."""
        available = exact and row['availability'] == 'available' and (row['value_number'] is not None or row['value_text'] is not None)
        return MetricValue(id=row['id'], label=row['name'], family=row['family'],
            value=(row['value_text'] if row['value_text'] is not None else row['value_number']) if available else None,
            unit=row['unit'] if exact else None, period=period,
            availability='available' if available else 'unavailable', source=row['source_kind'],
            sourceRef=row['source_ref'] if exact else None)

    def summary(self, context: QueryContext, period: str = 'month', family: str = 'enterprise') -> Envelope[list[MetricValue]]:
        """Return bounded family measures for the exact supplied reporting period.

        Raises:
            ValueError: When the family, period or persona is not configured.
        """
        if family not in FAMILIES or period not in PERIODS:
            raise ValueError('Unsupported KPI family or period')
        if context.personaId and context.personaId not in {persona.id for persona in self.personas()}:
            raise LookupError('Unknown configured persona')
        rows = self.repository.read('SELECT * FROM metric WHERE family=? ORDER BY id', (family,))
        family_rows = rows
        # An empty family means absent measures, not unsupported entity dimensions.
        scoped, dimensions = EntityService(self.repository).matching_ids(context, [row['entity_id'] for row in rows] if rows else None)
        if context.filters or context.hierarchyNodeId:
            rows = [row for row in rows if row['entity_id'] in scoped]
        no_scoped_evidence = bool(family_rows) and not rows
        groups = {}
        for row in rows:
            groups.setdefault((row['entity_id'], row['name']), []).append(row)
        metrics = []
        for candidates in groups.values():
            exact = [row for row in candidates if row['period'] == period]
            # Every exact-period identity is distinct evidence, not a preferred row.
            metrics.extend(self._value(row, period, not dimensions) for row in exact)
            if not exact:
                metrics.append(self._value(candidates[0], period, False))
        # Retain known names without treating another application's row as evidence.
        represented_names = {metric.label for metric in metrics}
        for row in sorted(family_rows, key=lambda row: (row['period'] != period, row['id'])):
            if row['name'] not in represented_names:
                metrics.append(self._value(row, period, False))
                represented_names.add(row['name'])
        metrics.sort(key=lambda metric: metric.id)
        available = not dimensions and (no_scoped_evidence or any(metric.availability == 'available' for metric in metrics))
        return Envelope(data=metrics[:100], availability='available' if available else 'unavailable', unavailableDimensions=dimensions)

    def dashboard(self, context: QueryContext, period: str = 'month') -> Envelope[Dashboard]:
        """Compose only the selected persona's visible widgets.

        Raises:
            LookupError: When no configured persona matches the selection.
        """
        persona = next((item for item in self.personas() if item.id == context.personaId), None)
        if persona is None:
            raise LookupError('Unknown configured persona')
        configs = self.repository.read('SELECT payload_json FROM app_config WHERE config_kind=? AND scope_id=? ORDER BY rowid LIMIT 100', ('widget', persona.id))
        widgets = []
        for row in configs:
            config = json.loads(row['payload_json'])
            if config.get('visible') is True:
                widgets.append(Widget(id=config['id'], title=config['title'], metric=self._metric(config['metricId'], period, context)))
        scenarios = [Scenario.model_validate(json.loads(row['payload_json'])) for row in self.repository.read('SELECT payload_json FROM app_config WHERE config_kind=? AND (scope_id IS NULL OR scope_id=?) ORDER BY rowid LIMIT 100', ('scenario', persona.id))]
        _, dimensions = EntityService(self.repository).matching_ids(context, [row['entity_id'] for row in self.repository.read('SELECT entity_id FROM metric')])
        return Envelope(data=Dashboard(persona=persona, widgets=widgets, scenarios=scenarios), availability='unavailable' if dimensions else 'available', unavailableDimensions=dimensions)
