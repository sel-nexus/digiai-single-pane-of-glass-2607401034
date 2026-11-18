"""Verify journey scope and relationship evidence against real SQLite files."""
import sqlite3
import pytest
from app.domain.entity_service import EntityService
from app.domain.journey_service import JourneyService
from app.schemas.contracts import QueryContext
from app.storage.seed import seed_database


def service(repository):
    """Construct the journey service with the shared real scope implementation."""
    return JourneyService(repository, EntityService(repository))


def test_list_pagination_and_empty_scope(repository):
    """Keep bounded represented identities and empty selected intersections."""
    journeys = service(repository)
    first = journeys.list_journeys(QueryContext(), limit=1)
    second = journeys.list_journeys(QueryContext(), limit=1, cursor=first.page.nextCursor)
    assert first.page.total == 2 and first.data[0].id != second.data[0].id
    assert second.page.nextCursor is None
    assert journeys.list_journeys(QueryContext(filters={'application': ['missing']})).data == []
    assert journeys.list_journeys(QueryContext(), cursor='9999999').data == []
    with pytest.raises(ValueError):
        journeys.list_journeys(QueryContext(), limit=101)
    with pytest.raises(ValueError):
        journeys.list_journeys(QueryContext(), cursor='01')
    with pytest.raises(ValueError):
        journeys.list_journeys(QueryContext(filters={'unknown': ['x']}))


def test_direct_and_connected_rows_preserve_type_and_provenance(repository):
    """Never expand application dependencies into other application destinations."""
    result = service(repository).relationships('journey-enrollment', QueryContext()).data
    assert result.id == 'journey-enrollment' and result.sourceRef == 'sample-v1'
    assert [row.target.entityId for row in result.dependency.value] == ['app-0001', 'api-enrollment']
    assert result.dependency.value[1].sourceEntityId == 'app-0001'
    assert [row.target.entityId for row in result.impactOverlay.value] == ['api-enrollment']
    assert result.impact.value is None and result.impact.availability == 'unavailable'
    assert all(row.sourceRef == 'sample-v1' and row.source == 'sample' for row in result.relationships)
    assert all(row.target.entityId != 'app-0002' for row in result.relationships)


def test_missing_associations_and_exact_unknown_id(repository):
    """Leave missing associations unavailable rather than borrowing another journey."""
    result = service(repository).relationships('journey-renewal', QueryContext()).data
    assert result.relationships == []
    assert result.dependency.value is None and result.impactOverlay.value is None
    for identifier in ('missing', 'app-0001', "' OR 1=1 --"):
        with pytest.raises(LookupError):
            service(repository).relationships(identifier, QueryContext())


def test_scoped_detail_and_all_dimensions(repository):
    """Reuse common AND/OR and hierarchy scope without an unfiltered fallback."""
    scope = QueryContext(hierarchyNodeId='service-enrollment', filters={
        'domain': ['domain-member'], 'portfolio': ['portfolio-digital'], 'application': ['app-0001', 'missing'],
        'environment': ['prod'], 'criticality': ['high'], 'dateRange': ['2025-01/2025-02'],
        'toolSource': ['sample-monitor'], 'incidentSeverity': ['Sev1'],
    })
    assert service(repository).relationships('journey-enrollment', scope).data.id == 'journey-enrollment'
    excluded = service(repository).relationships('journey-enrollment', QueryContext(filters={'application': ['app-0002']}))
    assert excluded.data is None and excluded.availability == 'unavailable'
    unsupported = service(repository).relationships('journey-renewal', QueryContext(filters={'dateRange': ['x']}))
    assert unsupported.data is None and unsupported.unavailableDimensions == ['dateRange']
    assert service(repository).relationships('journey-enrollment', QueryContext(hierarchyNodeId='missing')).data is None


def test_target_scope_isolation_and_missing_reference(repository):
    """Hide out-of-scope targets and rows without an association source reference."""
    with repository.transaction() as db:
        db.execute("INSERT INTO relationship VALUES ('extra', 'journey-enrollment', 'app-0002', 'impact', NULL, 'sample-v1', 'uploaded', 'upload-map')")
        db.execute("UPDATE relationship SET source_ref=NULL WHERE target_entity_id='api-enrollment'")
    result = service(repository).relationships('journey-enrollment', QueryContext(filters={'application': ['app-0001']})).data
    assert [row.target.entityId for row in result.relationships] == ['app-0001']
    assert result.impactOverlay.availability == 'unavailable'
    unscoped = service(repository).relationships('journey-enrollment', QueryContext()).data
    assert unscoped.impactOverlay.value[0].source == 'uploaded'
    assert unscoped.impactOverlay.value[0].sourceRef == 'upload-map'


def test_unreferenced_journey_edge_cannot_unlock_connected_api(repository):
    """Require referenced journey association before exposing downstream API rows."""
    with repository.transaction() as db:
        db.execute("UPDATE relationship SET source_ref=NULL WHERE source_entity_id='journey-enrollment'")
    result = service(repository).relationships('journey-enrollment', QueryContext()).data
    assert result.relationships == [] and result.dependency.value is None


def test_orphan_relationship_is_not_an_available_destination(repository):
    """Reject corrupt orphan rows even if imported storage disabled foreign keys."""
    with sqlite3.connect(repository.path) as db:
        db.execute("INSERT INTO relationship VALUES ('orphan', 'journey-renewal', 'missing', 'depends_on', NULL, 'sample-v1', 'sample', 'orphan-map')")
    result = service(repository).relationships('journey-renewal', QueryContext()).data
    assert result.relationships == [] and result.dependency.availability == 'unavailable'


def test_opaque_id_supplied_impact_and_seed_idempotence(repository):
    """Resolve SQL-like identifiers literally and preserve supplied business prose."""
    identifier = "opaque' OR 1=1 --"
    with repository.transaction() as db:
        db.execute('INSERT INTO entity VALUES (?,?,?,?,?,?,?,?,?)', (
            identifier, 'journey', 'Opaque journey', None, None,
            '{"businessImpact":"Supplied local impact"}', 'sample-v1', 'local', 'local-map'))
    seed_database(repository)
    result = service(repository).relationships(identifier, QueryContext()).data
    assert result.id == identifier and result.source == 'local'
    assert result.impact.value == 'Supplied local impact'
    assert result.impact.availability == 'available'
    assert service(repository).list_journeys(QueryContext()).page.total == 3
