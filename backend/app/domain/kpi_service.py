"""Retrieve configured dashboards and source-provided metrics without inference."""
import json
from app.schemas.contracts import Dashboard, Envelope, MetricValue, Persona, QueryContext, Scenario, Widget
from app.storage.sqlite_repository import EntityRepository

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
        """Return exact-period evidence or an unavailable value, never a fallback."""
        rows = self.repository.read('SELECT * FROM metric WHERE id=?', (metric_id,))
        if not rows:
            return MetricValue(id=metric_id, label='Metric unavailable', family='enterprise', value=None, unit=None, period=period, availability='unavailable', source='sample', sourceRef=None)
        row = rows[0]
        exact = self.repository.read('SELECT * FROM metric WHERE name=? AND family=? AND period=? AND entity_id IS ? ORDER BY id LIMIT 1', (row['name'], row['family'], period, row['entity_id']))
        supported = not context.filters and not context.hierarchyNodeId
        supplied = exact[0] if exact else row
        available = bool(exact) and supported and supplied['availability'] == 'available' and (supplied['value_number'] is not None or supplied['value_text'] is not None)
        return MetricValue(id=metric_id, label=row['name'], family=row['family'], value=(supplied['value_number'] if supplied['value_number'] is not None else supplied['value_text']) if available else None, unit=supplied['unit'] if exact else None, period=period, availability='available' if available else 'unavailable', source=supplied['source_kind'], sourceRef=supplied['source_ref'] if exact else None)

    def summary(self, context: QueryContext, period: str = 'month', family: str = 'enterprise') -> Envelope[list[MetricValue]]:
        """Return bounded family measures for the exact supplied reporting period.

        Raises:
            ValueError: When the family, period or persona is not configured.
        """
        if family not in FAMILIES or period not in PERIODS:
            raise ValueError('Unsupported KPI family or period')
        if context.personaId and context.personaId not in {persona.id for persona in self.personas()}:
            raise LookupError('Unknown configured persona')
        rows = self.repository.read('SELECT id FROM metric WHERE family=? GROUP BY name ORDER BY id LIMIT 100', (family,))
        dimensions = list(context.filters) + (['hierarchyNodeId'] if context.hierarchyNodeId else [])
        return Envelope(data=[self._metric(row['id'], period, context) for row in rows], availability='unavailable' if dimensions or not rows else 'available', unavailableDimensions=dimensions)

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
        dimensions = list(context.filters) + (['hierarchyNodeId'] if context.hierarchyNodeId else [])
        return Envelope(data=Dashboard(persona=persona, widgets=widgets, scenarios=scenarios), availability='unavailable' if dimensions else 'available', unavailableDimensions=dimensions)
