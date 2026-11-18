"""Verify explicit operations evidence using fresh real SQLite files."""
import json
import pytest
from app.domain.entity_service import EntityService
from app.domain.kpi_service import KpiService
from app.domain.operations_service import MEASURES, OperationsService
from app.schemas.contracts import QueryContext
from tests.test_kpi_scope import seed_twoapps


@pytest.fixture
def service(repository):
    """Reuse real shared scope and KPI services."""
    return OperationsService(repository, EntityService(repository), KpiService(repository))


def test_distinct_types_and_security_exclusion(service):
    """Keep problems/RCA, majors and severity separate from security findings."""
    page = service.incidents(QueryContext())
    assert {row.recordType for row in page.data} == {'incident', 'problem_rca', 'major_incident'}
    assert 'finding-1' not in {row.id for row in page.data}
    assert {row.evidence.value[0].value['subtype'] for row in page.data if row.recordType == 'problem_rca'} == {'problem', 'rca'}
    assert len(service.incidents(QueryContext(), record_type='incident').data) == 2


def test_exact_context_and_no_transitive_impact(service):
    """Show direct app/API/journey refs, never app dependencies as incident impact."""
    row = service.incidents(QueryContext(), incident_id='ticket-1').data[0]
    assert {item.value['id'] for item in row.businessContext.value} == {'app-0001', 'api-enrollment', 'journey-enrollment'}
    assert any(item.association == 'entity:ticket-1.applicationId' for item in row.businessContext.value)
    assert all(item.sourceRef == 'sample-v1' for item in row.businessContext.value)
    absent = service.incidents(QueryContext(), incident_id='ticket-2').data[0]
    assert absent.businessContext.value is None
    assert absent.businessContext.availability == 'unavailable'


def test_explicit_correlations_and_no_transitive_link(service, repository):
    """Return exact directed links only, with their relationship provenance."""
    page = service.correlations('ticket-1', QueryContext(), limit=1)
    assert page.page.total == 2 and page.page.nextCursor == '1'
    all_links = page.data + service.correlations('ticket-1', QueryContext(), limit=1, cursor='1').data
    assert {row.id for row in all_links} == {'rel-3', 'rel-9'}
    assert all(row.relationshipLabel == 'represented correlation' for row in all_links)
    assert all(row.evidence.association == f'relationship:{row.id}' for row in all_links)
    assert 'rca-1' not in {row.targetEntityId for row in all_links}
    with repository.transaction() as db:
        db.execute("UPDATE relationship SET source_ref=NULL WHERE id='rel-9'")
    assert service.correlations('ticket-1', QueryContext()).page.total == 1


def test_no_links_and_scope_mismatch_are_unavailable(service):
    """Never manufacture links from similar incident severity or shared application."""
    assert service.correlations('ticket-2', QueryContext()).data == []
    assert service.correlations('ticket-2', QueryContext()).availability == 'unavailable'
    assert service.correlations('ticket-1', QueryContext(filters={'application': ['app-0002']})).data == []


@pytest.mark.parametrize('identifier', ['unknown', 'finding-1', 'app-0001', "' OR 1=1 --", '<script>'])
def test_unknown_wrong_type_and_injection(service, identifier):
    """Treat identifiers as exact bound data and reject non-operational records."""
    with pytest.raises(LookupError):
        service.correlations(identifier, QueryContext())
    with pytest.raises(LookupError):
        service.incidents(QueryContext(), incident_id=identifier)


def test_filters_and_bounded_pages(service):
    """Intersect shared filters and explicitly disclose unsupported ones."""
    result = service.incidents(QueryContext(filters={'application': ['app-0001'], 'incidentSeverity': ['Sev1']}), limit=1)
    assert result.page.nextCursor == '1'
    assert result.page.total == 4
    assert service.incidents(QueryContext(filters={'application': ['missing']})).data == []
    unsupported = service.incidents(QueryContext(filters={'invented': ['yes']}))
    assert unsupported.data == [] and unsupported.unavailableDimensions == ['invented']
    with pytest.raises(ValueError):
        service.incidents(QueryContext(), record_type='security_finding')
    for limit, cursor in [(0, None), (101, None), (1, '01'), (1, '-1')]:
        with pytest.raises(ValueError):
            service.incidents(QueryContext(), limit=limit, cursor=cursor)


def test_nine_named_exact_period_metrics(service, repository):
    """Preserve supplied precision and absence, never calculate incident counts."""
    metrics = service.metrics(QueryContext()).data
    assert tuple(row.label for row in metrics) == MEASURES
    assert metrics[0].value == 99.23456 and metrics[0].sourceRef == 'sample-kpi-availability'
    assert next(row for row in metrics if row.label == 'MTTR').value is None
    assert all(row.value is None and row.period == 'week' and row.sourceRef is None for row in service.metrics(QueryContext(), 'week').data)
    with repository.transaction() as db:
        db.execute("DELETE FROM metric WHERE id='sev1'")
    missing = next(row for row in service.metrics(QueryContext()).data if row.label == 'Sev1 count')
    assert missing.value is None and missing.availability == 'unavailable'
    assert service.metrics(QueryContext(), limit=3).page.nextCursor == '3'
    assert all(row.value is None for row in service.metrics(QueryContext(filters={'application': ['app-0002']})).data)
    assert service.metrics(QueryContext(filters={'invented': ['x']})).unavailableDimensions == ['invented']
    with pytest.raises(ValueError):
        service.metrics(QueryContext(), 'year')


def test_supplied_observability_context_and_absence(service, repository):
    """Keep app/service context explicit and summary signals supplied."""
    rows = service.observability(QueryContext()).data
    assert {row.id for row in rows} == {'event-1', 'summary-1'}
    assert all({item.value['id'] for item in row.businessContext.value} == {'app-0001', 'service-enrollment'} for row in rows)
    assert service.observability(QueryContext(filters={'application': ['app-0002']})).data == []
    with repository.transaction() as db:
        db.execute("DELETE FROM relationship WHERE target_entity_id='event-1'")
        db.execute("DELETE FROM entity WHERE id IN ('event-1','summary-1')")
    assert service.observability(QueryContext()).availability == 'unavailable'


@pytest.mark.parametrize('context,expected', [
    (QueryContext(), {'a-month', 'b-month'}),
    (QueryContext(filters={'application': ['app-0001']}), {'a-month'}),
    (QueryContext(filters={'application': ['app-0002']}), {'b-month'}),
    (QueryContext(hierarchyNodeId='app-0001'), {'a-month'}),
    (QueryContext(hierarchyNodeId='app-0002'), {'b-month'}),
    (QueryContext(hierarchyNodeId='service-enrollment'), {'a-month', 'b-month'}),
])
def test_same_label_distinct_supported_operations(service, repository, context, expected):
    """Preserve each app's supplied measure, with pagination counting evidence rows."""
    seed_twoapps(repository)
    rows = service.metrics(context).data
    available = [row for row in rows if row.availability == 'available']
    assert {row.id for row in available} == expected
    evidence = {'a-month': ('99.2345600000000000001', 'uploaded', 'csv-source-a'),
                'b-month': ('87.9950000000000000001', 'local', 'xlsx-source-b')}
    assert all((row.value, row.source, row.sourceRef) == evidence[row.id] for row in available)
    assert service.metrics(context).page.total == len(expected) + 8
    first = service.metrics(context, limit=1)
    second = service.metrics(context, limit=1, cursor=first.page.nextCursor)
    if len(expected) == 2:
        assert {first.data[0].id, second.data[0].id} == expected


def test_operations_same_label_across_families_and_missing_period(service, repository):
    """Do not prefer a family or borrow an available period for a missing app."""
    seed_twoapps(repository)
    with repository.transaction() as db:
        db.execute("INSERT INTO metric SELECT 'enterprise-a',name,'enterprise','45.67',NULL,unit,period,entity_id,availability,dataset_version_id,source_kind,'enterprise-source' FROM metric WHERE id='a-month'")
    assert {row.id for row in service.metrics(QueryContext()).data if row.availability == 'available'} == {'a-month', 'b-month', 'enterprise-a'}
    missing = service.metrics(QueryContext(filters={'application': ['app-0002']}), 'week')
    assert missing.availability == 'unavailable'
    assert all(row.value is None and row.sourceRef is None and row.period == 'week' for row in missing.data)
