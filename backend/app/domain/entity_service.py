"""Discover source records with explicit shared context, never inferred semantics."""
import json
import re
from app.schemas.contracts import Entity, EntityPage, Envelope, FilterOption, HierarchyNode, HierarchyPage, Page, QueryContext
from app.storage.sqlite_repository import EntityRepository

DIMENSIONS = ('domain', 'portfolio', 'application', 'environment', 'criticality', 'dateRange', 'toolSource', 'incidentSeverity')
TYPES = ('domain', 'portfolio', 'service', 'application', 'environment', 'ticket', 'release', 'journey', 'owner')
LEVELS = ('domain', 'portfolio', 'service', 'application', 'environment')


class EntityService:
    """Reuse source-associated scope for discovery and supplied KPI records."""

    def __init__(self, repository: EntityRepository) -> None:
        """Retain the file-backed repository."""
        self.repository = repository

    def _valid_child(self, row: dict, records: dict) -> bool:
        """Accept only consecutive represented levels, never a sixth level."""
        parent = records.get(row['parent_id'])
        return bool(row['entity_type'] in LEVELS and parent and parent['entity_type'] in LEVELS
                    and LEVELS.index(row['entity_type']) == LEVELS.index(parent['entity_type']) + 1)

    def _source(self) -> tuple[dict, dict]:
        """Index ancestry and direct application association evidence per read.

        Notes:
            Application dependencies do not transfer scope between applications.
            Associations support filtering only, not causal or impact claims.
        """
        records = {row['id']: row for row in self.repository.read('SELECT * FROM entity ORDER BY id')}
        values = {key: {dim: set() for dim in DIMENSIONS} for key in records}
        associations = {key: set() for key in records}
        for key, row in records.items():
            attrs = json.loads(row['attributes_json'])
            for dim in DIMENSIONS:
                raw = row['criticality'] if dim == 'criticality' else attrs.get(dim)
                if dim == 'environment' and row['entity_type'] == 'release':
                    # Release environment is evidence prose, not a filter identifier.
                    raw = attrs.get('environmentId')
                if dim == 'incidentSeverity':
                    raw = attrs.get(dim, attrs.get('severity'))
                if raw is not None:
                    values[key][dim].update(str(item) for item in (raw if isinstance(raw, list) else [raw]))
            current = row
            seen = set()
            for _ in range(5):
                if current['id'] in seen:
                    break
                seen.add(current['id'])
                kind = current['entity_type']
                if kind in ('domain', 'portfolio', 'application'):
                    values[key][kind].add(current['id'])
                if kind == 'application':
                    associations[key].add(current['id'])
                if not self._valid_child(current, records):
                    break
                current = records[current['parent_id']]
            app_id = attrs.get('applicationId')
            if app_id in records and records[app_id]['entity_type'] == 'application':
                associations[key].add(app_id)
        for link in self.repository.read('SELECT source_entity_id,target_entity_id FROM relationship'):
            left, right = link['source_entity_id'], link['target_entity_id']
            if left not in records or right not in records:
                continue
            if records[left]['entity_type'] == 'application' and records[right]['entity_type'] != 'application':
                associations[right].add(left)
            if records[right]['entity_type'] == 'application' and records[left]['entity_type'] != 'application':
                associations[left].add(right)
        evidence = {key: {dim: set(items) for dim, items in scope.items()} for key, scope in values.items()}
        app_evidence = {}
        for key, apps in associations.items():
            for app_id in apps:
                scope = app_evidence.setdefault(app_id, {dim: set() for dim in DIMENSIONS})
                for dim in ('environment', 'dateRange', 'toolSource', 'incidentSeverity'):
                    scope[dim].update(evidence[key][dim])
        for key, apps in associations.items():
            for app_id in apps:
                for dim in DIMENSIONS:
                    values[key][dim].update(evidence[app_id][dim])
                    values[key][dim].update(app_evidence[app_id][dim])
        return records, values

    def _entity(self, row: dict) -> Entity:
        """Map exact source fields with distinguishing identification text."""
        attrs = json.loads(row['attributes_json'])
        info = ' · '.join(str(value) for value in (row['id'], attrs.get('recordType'), row['parent_id']) if value)
        return Entity(id=row['id'], type=row['entity_type'], label=row['label'], parentId=row['parent_id'],
                      source=row['source_kind'], sourceRef=row['source_ref'], distinguishingInfo=info)

    def _scope(self, ids: list[str], context: QueryContext, records: dict, values: dict) -> tuple[list[str], list[str]]:
        """Intersect dimensions, excluding absent values and reporting unsupported scope."""
        if set(context.filters) - set(DIMENSIONS):
            raise ValueError('Unsupported context dimension')
        unavailable = [dim for dim, selected in context.filters.items()
                       if selected and not any(values[key][dim] for key in ids)]
        result = ids
        for dim, selected in context.filters.items():
            if selected:
                result = [key for key in result if values[key][dim].intersection(selected)]
        if context.hierarchyNodeId:
            if context.hierarchyNodeId not in records:
                return [], unavailable + ['hierarchyNodeId']
            allowed = {context.hierarchyNodeId}
            for _ in range(4):
                allowed.update(key for key, row in records.items()
                               if row['parent_id'] in allowed and self._valid_child(row, records))
            result = [key for key in result if key in allowed or values[key]['application'].intersection(allowed)]
        return result, unavailable

    def matching_ids(self, context: QueryContext, ids: list[str] | None = None) -> tuple[set[str], list[str]]:
        """Return exact IDs for source-associated metric scope checks."""
        records, values = self._source()
        candidates = list(records) if ids is None else [key for key in ids if key in records]
        result, unavailable = self._scope(candidates, context, records, values)
        if ids and not candidates and (context.filters or context.hierarchyNodeId):
            unavailable = list(context.filters) + (['hierarchyNodeId'] if context.hierarchyNodeId else [])
        return set(result), unavailable

    def _offset(self, limit: int, cursor: str | None) -> int:
        """Reject noncanonical or unbounded pagination values."""
        if not 1 <= limit <= 100 or (cursor is not None and not re.fullmatch(r'0|[1-9][0-9]{0,6}', cursor)):
            raise ValueError('Invalid limit or cursor')
        return int(cursor or 0)

    def entities(self, context: QueryContext, kind: str | None = None, q: str = '', limit: int = 50,
                 cursor: str | None = None) -> EntityPage:
        """Search case-insensitive IDs and names with parameterized SQL and bounded pages."""
        offset = self._offset(limit, cursor)
        if kind is not None and kind not in TYPES:
            raise ValueError('Unsupported entity type')
        if len(q) > 200:
            raise ValueError('Search text is too long')
        records, values = self._source()
        candidates = [key for key, row in records.items() if row['entity_type'] in TYPES
                      and (kind is None or row['entity_type'] == kind)]
        scoped, unavailable = self._scope(candidates, context, records, values)
        pattern = '%' + q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        found = self.repository.read("SELECT id FROM entity WHERE (label LIKE ? ESCAPE '\\' COLLATE NOCASE OR id LIKE ? ESCAPE '\\' COLLATE NOCASE) ORDER BY label COLLATE NOCASE,id", (pattern, pattern))
        selected = set(scoped)
        matches = [row['id'] for row in found if row['id'] in selected]
        return EntityPage(data=[self._entity(records[key]) for key in matches[offset:offset + limit]],
                          availability='unavailable' if unavailable or not candidates else 'available',
                          unavailableDimensions=unavailable, page=Page(limit=limit, total=len(matches),
                          nextCursor=str(offset + limit) if offset + limit < len(matches) else None))

    def hierarchy(self, context: QueryContext, parent_id: str | None = None,
                  limit: int = 50, cursor: str | None = None) -> HierarchyPage:
        """Return current-parent children with exact represented ancestor navigation."""
        offset = self._offset(limit, cursor)
        records, values = self._source()
        if parent_id and (parent_id not in records or records[parent_id]['entity_type'] not in LEVELS):
            raise LookupError('Unknown represented hierarchy parent')
        ancestry = []
        current = records.get(parent_id)
        for _ in range(5):
            if not current or any(item.id == current['id'] for item in ancestry):
                break
            ancestry.insert(0, self._entity(current))
            current = records.get(current['parent_id']) if self._valid_child(current, records) else None
        candidates = [key for key, row in records.items() if row['entity_type'] in LEVELS]
        matched, unavailable = self._scope(candidates, context, records, values)
        visible = set(matched)
        for _ in range(4):
            visible.update(records[key]['parent_id'] for key in list(visible)
                           if key in records and self._valid_child(records[key], records))
        children = [row for key, row in records.items() if key in visible and
                    ((parent_id is None and row['entity_type'] == 'domain' and row['parent_id'] is None)
                     or (parent_id is not None and row['parent_id'] == parent_id and self._valid_child(row, records)))]
        nodes = [HierarchyNode(**self._entity(row).model_dump(), level=row['entity_type'],
                 hasRepresentedChildren=any(child['parent_id'] == row['id'] and self._valid_child(child, records)
                                            for child in records.values())) for row in children[offset:offset + limit]]
        return HierarchyPage(data=nodes, ancestry=ancestry, unavailableDimensions=unavailable,
                             availability='unavailable' if unavailable or not candidates else 'available',
                             page=Page(limit=limit, total=len(children), nextCursor=str(offset + limit)
                                       if offset + limit < len(children) else None))

    def options(self, context: QueryContext) -> Envelope[dict[str, list[FilterOption]]]:
        """Return exact faceted values, excluding each facet's own selection."""
        records, values = self._source()
        data = {}
        _, unavailable = self._scope(list(records), context, records, values)
        for dim in DIMENSIONS:
            other = context.model_copy(update={'filters': {key: val for key, val in context.filters.items() if key != dim}})
            matched, _ = self._scope(list(records), other, records, values)
            supplied = sorted({value for key in matched for value in values[key][dim]})
            data[dim] = [FilterOption(id=value, label=records[value]['label'] if value in records else value)
                         for value in supplied[:100]]
        return Envelope(data=data, unavailableDimensions=unavailable,
                        availability='unavailable' if unavailable or not records else 'available')
