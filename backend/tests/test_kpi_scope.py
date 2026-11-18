"""Keep same-name KPI evidence distinct in fresh real SQLite files."""
import pytest
from app.domain.kpi_service import KpiService
from app.schemas.contracts import QueryContext


def seed_twoapps(repository):
    """Represent two distinct sources with identical metric names and exact periods."""
    with repository.transaction() as db:
        db.execute('DELETE FROM metric')
        db.executemany('INSERT INTO metric (id,name,family,value_text,unit,period,entity_id,availability,dataset_version_id,source_kind,source_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
            ('a-month', 'Availability %', 'reliability', '99.2345600000000000001', '%', 'month', 'app-0001', 'available', 'sample-v1', 'uploaded', 'csv-source-a'),
            ('b-month', 'Availability %', 'reliability', '87.9950000000000000001', '%', 'month', 'app-0002', 'available', 'sample-v1', 'local', 'xlsx-source-b'),
            ('a-week', 'Availability %', 'reliability', '91.125', '%', 'week', 'app-0001', 'available', 'sample-v1', 'uploaded', 'csv-week-a'),
        ])


@pytest.mark.parametrize('context,ids', [
    (QueryContext(), {'a-month', 'b-month'}),
    (QueryContext(filters={'application': ['app-0001']}), {'a-month'}),
    (QueryContext(filters={'application': ['app-0002']}), {'b-month'}),
    (QueryContext(filters={'application': ['app-0001', 'app-0002']}), {'a-month', 'b-month'}),
    (QueryContext(hierarchyNodeId='app-0001'), {'a-month'}),
    (QueryContext(hierarchyNodeId='app-0002'), {'b-month'}),
    (QueryContext(hierarchyNodeId='service-enrollment'), {'a-month', 'b-month'}),
])
def test_same_name_scoped_before_selection(repository, context, ids):
    """Preserve both exact identities, values and source references without averaging."""
    seed_twoapps(repository)
    result = KpiService(repository).summary(context, family='reliability')
    assert {row.id for row in result.data} == ids
    expected = {'a-month': ('99.2345600000000000001', 'uploaded', 'csv-source-a'),
                'b-month': ('87.9950000000000000001', 'local', 'xlsx-source-b')}
    for row in result.data:
        assert (row.value, row.source, row.sourceRef) == expected[row.id]
        assert row.period == 'month' and row.availability == 'available'
    assert result.availability == 'available'


@pytest.mark.parametrize('application', ['app-0001', 'app-0002'])
def test_missing_period_never_borrows_other_app_or_period(repository, application):
    """Keep missing period values, units and source association unavailable."""
    seed_twoapps(repository)
    service = KpiService(repository)
    context = QueryContext(filters={'application': [application]})
    week = service.summary(context, 'week', 'reliability').data
    assert len(week) == 1
    assert week[0].value == ('91.125' if application == 'app-0001' else None)
    if application == 'app-0002':
        assert week[0].sourceRef is None and week[0].unit is None
        assert week[0].availability == 'unavailable'
    quarter = service.summary(context, 'quarter', 'reliability')
    assert len(quarter.data) == 1 and quarter.availability == 'unavailable'
    assert quarter.data[0].value is None and quarter.data[0].period == 'quarter'


def test_multiple_exact_sources_are_distinct_not_preferred(repository):
    """Expose same-app duplicate period evidence; configured alternate period is ambiguous."""
    seed_twoapps(repository)
    with repository.transaction() as db:
        db.execute("INSERT INTO metric SELECT 'a-other',name,family,'12.345',NULL,unit,period,entity_id,availability,dataset_version_id,'local','other-source' FROM metric WHERE id='a-month'")
    service = KpiService(repository)
    context = QueryContext(filters={'application': ['app-0001']})
    assert {row.id for row in service.summary(context, family='reliability').data} == {'a-month', 'a-other'}
    # A configured exact ID stays exact; an alternate-period lookup cannot choose a source.
    assert service._metric('a-month', 'month', context).value == '99.2345600000000000001'
    ambiguous = service._metric('a-week', 'month', context)
    assert ambiguous.value is None and ambiguous.sourceRef is None and ambiguous.unit is None


def test_scope_precedes_response_bound(repository):
    """Do not lose a later app's evidence behind the first hundred out-of-scope rows."""
    seed_twoapps(repository)
    with repository.transaction() as db:
        for index in range(110):
            db.execute("INSERT INTO metric SELECT ?,name,family,value_text,value_number,unit,period,entity_id,availability,dataset_version_id,source_kind,source_ref FROM metric WHERE id='a-month'", (f'aa-{index:03d}',))
    result = KpiService(repository).summary(QueryContext(filters={'application': ['app-0002']}), family='reliability')
    assert [row.id for row in result.data] == ['b-month']


def test_empty_family_does_not_claim_supported_scope_is_missing(repository):
    """Separate absent measures from unsupported selected dimensions."""
    seed_twoapps(repository)
    result = KpiService(repository).summary(QueryContext(filters={'application': ['app-0001']}), family='enterprise')
    assert result.data == [] and result.availability == 'unavailable'
    assert result.unavailableDimensions == []


@pytest.mark.parametrize('context,dimensions', [
    (QueryContext(filters={'application': ['missing']}), []),
    (QueryContext(filters={'application': ['app-0002']}, hierarchyNodeId='app-0001'), []),
    (QueryContext(hierarchyNodeId='missing'), ['hierarchyNodeId']),
])
def test_no_scoped_evidence_retains_named_descriptor_without_source_values(repository, context, dimensions):
    """Keep a known family name null without borrowing either application's evidence."""
    seed_twoapps(repository)
    result = KpiService(repository).summary(context, family='reliability')
    assert result.unavailableDimensions == dimensions
    assert result.availability == ('unavailable' if dimensions else 'available')
    assert len(result.data) == 1
    metric = result.data[0]
    assert metric.label == 'Availability %' and metric.family == 'reliability'
    assert metric.period == 'month' and metric.availability == 'unavailable'
    assert metric.value is None and metric.unit is None and metric.sourceRef is None


def test_missing_named_measure_does_not_borrow_other_application(repository):
    """Retain another known name only as a null descriptor alongside scoped evidence."""
    seed_twoapps(repository)
    with repository.transaction() as db:
        db.execute("UPDATE metric SET name='Other measure' WHERE id='b-month'")
    result = KpiService(repository).summary(QueryContext(filters={'application': ['app-0001']}), family='reliability')
    metrics = {metric.label: metric for metric in result.data}
    assert metrics['Availability %'].value == '99.2345600000000000001'
    missing = metrics['Other measure']
    assert missing.value is None and missing.availability == 'unavailable'
    assert missing.sourceRef is None and missing.unit is None
