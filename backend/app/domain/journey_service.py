"""Read represented journeys without inferring transitive impact or dependencies."""
import json

from app.domain.entity_service import EntityService
from app.schemas.contracts import (
    EntityPage, Envelope, JourneyDetail, JourneyImpact, JourneyOverlay,
    JourneyRelationship, JourneyTarget, QueryContext,
)
from app.storage.sqlite_repository import EntityRepository


class JourneyService:
    """Use shared scope and retain only explicitly associated relationship rows."""

    def __init__(self, repository: EntityRepository, entities: EntityService) -> None:
        """Retain the injected repository and common filtering service."""
        self.repository = repository
        self.entities = entities

    def list_journeys(self, context: QueryContext, limit: int = 50,
                      cursor: str | None = None) -> EntityPage:
        """Return bounded journey identities under the common view context."""
        return self.entities.entities(context, kind='journey', limit=limit, cursor=cursor)

    def relationships(self, journey_id: str, context: QueryContext) -> Envelope[JourneyDetail | None]:
        """Return direct journey rows and connected application-to-API rows.

        Args:
            journey_id: Opaque represented journey identifier.
            context: Selected view scope, not authorization.
        Raises:
            LookupError: When the exact journey does not exist.
        Notes:
            Application-to-API rows retain their own source identity and type.
            They are not relabeled as journey edges or transitive impact.
        """
        found = self.repository.read('SELECT * FROM entity WHERE id=? AND entity_type=?',
                                     (journey_id, 'journey'))
        if not found:
            raise LookupError('No represented journey has this identifier.')
        matched, unavailable = self.entities.matching_ids(context, [journey_id])
        if journey_id not in matched:
            return Envelope(data=None, availability='unavailable', unavailableDimensions=unavailable)
        row = found[0]
        direct = self.repository.read(
            'SELECT * FROM relationship WHERE source_entity_id=? '
            "AND relationship_type IN ('depends_on','impact') ORDER BY id", (journey_id,))
        records = {item['id']: item for item in self.repository.read('SELECT * FROM entity')}
        direct = [link for link in direct if link['source_ref']]
        candidates = {link['target_entity_id'] for link in direct}
        visible, _ = self.entities.matching_ids(context, list(candidates))
        apps = {key for key in visible if records[key]['entity_type'] == 'application'}
        links = list(direct)
        for app_id in sorted(apps):
            links.extend(self.repository.read(
                'SELECT r.* FROM relationship r JOIN entity e ON e.id=r.target_entity_id '
                "WHERE r.source_entity_id=? AND e.entity_type='api' "
                "AND r.relationship_type IN ('depends_on','impact') ORDER BY r.id", (app_id,)))
        target_ids = list({link['target_entity_id'] for link in links})
        visible, _ = self.entities.matching_ids(context, target_ids)
        relationships = []
        for link in links:
            target = records.get(link['target_entity_id'])
            source = records.get(link['source_entity_id'])
            if (not target or not source or target['id'] not in visible
                    or target['entity_type'] not in ('application', 'api') or not link['source_ref']):
                continue
            relationships.append(JourneyRelationship(
                id=link['id'], type=link['relationship_type'], sourceEntityId=source['id'],
                sourceLabel=source['label'], source=link['source_kind'], sourceRef=link['source_ref'],
                representedContext=link['represented_context'], target=JourneyTarget(
                    entityType=target['entity_type'], entityId=target['id'], label=target['label'],
                    source=target['source_kind'], sourceRef=target['source_ref'])))
        attrs = json.loads(row['attributes_json'])
        impact = attrs.get('businessImpact')
        impact = impact if isinstance(impact, str) and impact.strip() else None
        return Envelope(data=JourneyDetail(
            id=row['id'], label=row['label'], description=attrs.get('description'),
            source=row['source_kind'], sourceRef=row['source_ref'], relationships=relationships,
            dependency=self._overlay(relationships, 'depends_on'),
            impactOverlay=self._overlay(relationships, 'impact'),
            impact=JourneyImpact(availability='available' if impact else 'unavailable', value=impact)))

    def _overlay(self, relationships: list[JourneyRelationship], kind: str) -> JourneyOverlay:
        """Keep absent associations null and each relationship type separate."""
        rows = [item for item in relationships if item.type == kind]
        return JourneyOverlay(availability='available' if rows else 'unavailable', value=rows or None)
