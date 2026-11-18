"""Read Application 360 from exact supplied associations, never sibling evidence."""
import json

from app.domain.entity_service import EntityService
from app.schemas.contracts import (
    ApplicationCategories, ApplicationCategory, ApplicationEvidence,
    ApplicationProfile, Envelope, QueryContext,
)
from app.storage.sqlite_repository import EntityRepository

CATEGORIES = tuple(ApplicationCategories.model_fields)
RECORD_CATEGORIES = {'incident': 'incidents', 'major_incident': 'incidents',
                     'defect': 'defects', 'security_finding': 'securityPosture'}
METRIC_CATEGORIES = {'security': 'securityPosture', 'automation': 'automationMaturity',
                     'observability': 'observabilityCoverage'}


class ApplicationService:
    """Keep profile aggregation separate from routes and common scope matching."""

    def __init__(self, repository: EntityRepository, entities: EntityService) -> None:
        """Retain the file-backed repository and injected filtering service."""
        self.repository = repository
        self.entities = entities

    def profile(self, application_id: str, context: QueryContext) -> Envelope[ApplicationProfile | None]:
        """Read the exact application and only explicitly associated evidence.

        Args:
            application_id: Opaque application identity, bound as SQL data.
            context: Shared display scope, not authorization.
        Returns:
            An exact profile or null when the selected scope excludes it.
        Raises:
            LookupError: When the identity is missing or is not an application.
        """
        found = self.repository.read('SELECT * FROM entity WHERE id=? AND entity_type=?',
                                     (application_id, 'application'))
        if not found:
            raise LookupError('No represented application has this identifier.')
        matched, unavailable = self.entities.matching_ids(context, [application_id])
        if application_id not in matched:
            return Envelope(data=None, availability='unavailable', unavailableDimensions=unavailable)
        app = found[0]
        attrs = json.loads(app['attributes_json'])
        evidence = {key: [] for key in CATEGORIES}
        for key in ('health', 'automationMaturity', 'observabilityCoverage'):
            self._add(evidence, key, app, attrs.get(key), f'entity:{application_id}.{key}')
        self._add(evidence, 'criticality', app, app['criticality'], f'entity:{application_id}.criticality')
        records = {row['id']: row for row in self.repository.read('SELECT * FROM entity ORDER BY id')}
        for field, kind, category in (('ownerId', 'owner', 'ownership'), ('domain', 'domain', 'domainPortfolio'),
                                      ('portfolio', 'portfolio', 'domainPortfolio')):
            raw = attrs.get(field)
            for target_id in raw if isinstance(raw, list) else [raw]:
                target = records.get(target_id) if isinstance(target_id, str) else None
                if target and target['entity_type'] == kind:
                    self._add(evidence, category, target, {'id': target_id, 'label': target['label'], 'type': kind},
                              f'entity:{application_id}.{field}')
        links = self.repository.read('SELECT * FROM relationship WHERE source_entity_id=? OR target_entity_id=? ORDER BY id',
                                     (application_id, application_id))
        for row in records.values():
            if row['id'] == application_id:
                continue
            fields = json.loads(row['attributes_json'])
            category = 'releaseHistory' if row['entity_type'] == 'release' else RECORD_CATEGORIES.get(fields.get('recordType'))
            if not category:
                continue
            association = f'entity:{row["id"]}.applicationId' if fields.get('applicationId') == application_id else None
            if not association:
                link = next((link for link in links if link['source_entity_id'] == row['id']
                             and link['target_entity_id'] == application_id and link['source_ref']
                             and link['relationship_type'] in ('affects', 'releases', 'has_defect', 'has_finding')), None)
                association = f'relationship:{link["id"]}' if link else None
            if association:
                self._add(evidence, category, row, {**fields, 'id': row['id'], 'label': row['label']}, association)
        for link in links:
            target = records.get(link['target_entity_id'])
            if (link['source_entity_id'] == application_id and link['relationship_type'] == 'depends_on'
                    and target and link['source_ref']):
                self._add(evidence, 'dependencies', link, {'id': target['id'], 'label': target['label'],
                          'type': target['entity_type'], 'relationship': 'represented dependency'}, f'relationship:{link["id"]}')
            owner = records.get(link['source_entity_id'])
            if (link['target_entity_id'] == application_id and link['relationship_type'] == 'owns'
                    and owner and owner['entity_type'] == 'owner' and link['source_ref']):
                self._add(evidence, 'ownership', link, {'id': owner['id'], 'label': owner['label']}, f'relationship:{link["id"]}')
        for metric in self.repository.read('SELECT * FROM metric WHERE entity_id=? ORDER BY id', (application_id,)):
            category = METRIC_CATEGORIES.get(metric['family'])
            if metric['family'] == 'reliability' and metric['name'] == 'observability coverage':
                category = 'observabilityCoverage'
            if category and metric['availability'] == 'available':
                value = metric['value_number'] if metric['value_number'] is not None else metric['value_text']
                self._add(evidence, category, metric, value, f'metric:{metric["id"]}.entityId',
                          unit=metric['unit'], period=metric['period'])
        categories = {key: ApplicationCategory(availability='available' if rows else 'unavailable', value=rows or None)
                      for key, rows in evidence.items()}
        return Envelope(data=ApplicationProfile(id=app['id'], label=app['label'], source=app['source_kind'],
                        sourceRef=app['source_ref'], categories=ApplicationCategories(**categories)))

    def _add(self, evidence: dict, category: str, row: dict, value: object, association: str,
             unit: str | None = None, period: str | None = None) -> None:
        """Append supplied nonempty values without converting absence into status."""
        if value is None or value == '' or value == [] or value == {}:
            return
        if isinstance(value, str) and value.strip().lower() in ('', 'unavailable', 'unknown', 'n/a'):
            return
        evidence[category].append(ApplicationEvidence(id=row['id'], label=row.get('label', row.get('name', category)), value=value,
                                  source=row['source_kind'], sourceRef=row['source_ref'], association=association,
                                  unit=unit, period=period))
