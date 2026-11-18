"""Verify exact source discovery and fail-closed shared context."""
import json
import pytest
from app.domain.entity_service import DIMENSIONS, EntityService
from app.domain.kpi_service import KpiService
from app.schemas.contracts import QueryContext


def test_search_names_ids_pagination_and_literal_sql(repository):
    """Search names and IDs without treating user input as SQL or wildcards."""
    service = EntityService(repository)
    assert service.entities(QueryContext(), 'application', 'mEmBeR pOrTaL').data[0].id == 'app-0001'
    assert service.entities(QueryContext(), q='APP-0001').data[0].id == 'app-0001'
    first = service.entities(QueryContext(), 'application', limit=1)
    second = service.entities(QueryContext(), 'application', limit=1, cursor=first.page.nextCursor)
    assert first.page.total == 1000 and first.data[0].id != second.data[0].id
    for query in ("' OR 1=1 --", '%', '_'):
        assert service.entities(QueryContext(), q=query).data == []
    assert service.entities(QueryContext(), cursor='9999999').data == []


@pytest.mark.parametrize('kwargs', [{'kind': 'bad'}, {'limit': 0}, {'limit': 101}, {'cursor': '-1'},
                                    {'cursor': '01'}, {'cursor': '10000000'}, {'cursor': 'abc'}, {'q': 'x' * 201}])
def test_invalid_query_rejected(repository, kwargs):
    """Reject unsupported search and pagination boundaries."""
    with pytest.raises(ValueError):
        EntityService(repository).entities(QueryContext(), **kwargs)


def test_eight_dimensions_and_or_no_results_unsupported(repository):
    """Intersect eight source dimensions and distinguish unsupported from empty."""
    with repository.transaction() as db:
        db.execute('UPDATE entity SET attributes_json=? WHERE id=?',
                   (json.dumps({'dateRange': '2025-01/2025-02'}), 'app-0001'))
    filters = dict(zip(DIMENSIONS, [['domain-member'], ['portfolio-digital'], ['app-0001', 'missing'],
                                  ['prod'], ['high'], ['2025-01/2025-02'], ['sample-monitor'], ['Sev1']]))
    service = EntityService(repository)
    result = service.entities(QueryContext(filters=filters), 'application')
    assert [item.id for item in result.data] == ['app-0001']
    assert result.unavailableDimensions == []
    filters['environment'] = ['absent']
    result = service.entities(QueryContext(filters=filters), 'application')
    assert result.data == [] and result.availability == 'available'
    assert result.unavailableDimensions == []
    with repository.transaction() as db:
        db.execute("UPDATE entity SET attributes_json='{}'")
    result = service.entities(QueryContext(filters={'dateRange': ['x']}), 'application')
    assert result.data == [] and result.unavailableDimensions == ['dateRange']
    with pytest.raises(ValueError):
        service.matching_ids(QueryContext(filters={'madeUp': ['x']}))


def test_ancestry_children_and_missing_parent(repository):
    """Return exactly five represented levels and current-parent children."""
    service = EntityService(repository)
    parent = None
    for expected in ('domain', 'portfolio', 'service', 'application', 'environment'):
        page = service.hierarchy(QueryContext(), parent)
        node = page.data[0]
        assert node.level == expected and node.parentId == parent
        parent = node.id
    page = service.hierarchy(QueryContext(), parent)
    assert page.data == [] and len(page.ancestry) == 5
    assert service.hierarchy(QueryContext(), 'portfolio-digital').ancestry[0].id == 'domain-member'
    with pytest.raises(LookupError):
        service.hierarchy(QueryContext(), 'missing')
    with pytest.raises(LookupError):
        service.hierarchy(QueryContext(), 'ticket-1')
    assert service.entities(QueryContext(hierarchyNodeId='missing')).unavailableDimensions == ['hierarchyNodeId']


def test_association_scope_does_not_cross_application_dependency(repository):
    """Use explicit cross-domain associations without transferring app dependencies."""
    service = EntityService(repository)
    for kind in ('ticket', 'release', 'journey', 'owner'):
        result = service.entities(QueryContext(filters={'application': ['app-0001']}), kind)
        assert result.data
    result = service.entities(QueryContext(filters={'toolSource': ['sample-monitor']}), 'application')
    assert [item.id for item in result.data] == ['app-0001']


def test_options_empty_and_missing_class(repository):
    """Preserve facet choices and report absent classes without invention."""
    service = EntityService(repository)
    options = service.options(QueryContext(filters={'application': ['app-0001']}))
    assert set(options.data) == set(DIMENSIONS)
    assert options.data['application'] and options.data['environment'][0].id == 'prod'
    assert service.options(QueryContext(filters={'environment': ['missing']})).data['application'] == []
    with repository.transaction() as db:
        db.execute("DELETE FROM entity WHERE entity_type='owner'")
    assert service.entities(QueryContext(), 'owner').availability == 'unavailable'


def test_kpi_associated_filters_and_no_stale_fallback(repository):
    """Keep supplied values under matching context and remove nonmatching evidence."""
    service = KpiService(repository)
    matching = service.summary(QueryContext(filters={'application': ['app-0001'], 'environment': ['prod']}))
    assert next(item for item in matching.data if item.id == 'availability').value == 99.23456
    assert matching.unavailableDimensions == []
    empty = service.summary(QueryContext(filters={'application': ['app-0002']}))
    assert all(item.value is None for item in empty.data)
    with repository.transaction() as db:
        db.execute("UPDATE entity SET attributes_json='{}'")
    unsupported = service.dashboard(QueryContext(personaId='executive', filters={'dateRange': ['x']}))
    assert unsupported.unavailableDimensions == ['dateRange']
    assert all(item.metric.value is None for item in unsupported.data.widgets)
