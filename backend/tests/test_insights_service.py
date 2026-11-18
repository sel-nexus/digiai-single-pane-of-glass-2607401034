"""Verify per-record completeness, exact associations and supplied periods on real SQLite."""
import json
import pytest
from app.domain.entity_service import EntityService
from app.domain.kpi_service import KpiService
from app.domain.insights_service import InsightsService
from app.schemas.contracts import QueryContext
from app.storage.seed import seed_database


def service(repository) -> InsightsService:
    """Use the actual shared scope reader and file-backed store."""
    return InsightsService(repository, EntityService(repository), KpiService(repository))


def attributes(repository, identity: str, attrs: dict) -> None:
    """Replace only task-owned fixture evidence to cover absent source branches."""
    with repository.transaction() as db:
        db.execute('UPDATE entity SET attributes_json=? WHERE id=?', (json.dumps(attrs), identity))


def test_per_item_completeness_and_provenance(repository):
    result = service(repository).recommendations(QueryContext())
    first, second, third = result.data
    assert first.reason != second.reason and first.confidence != second.confidence
    assert first.complete and second.complete
    assert third.reason is None and not third.complete and third.availability == 'unavailable'
    assert first.source == 'sample' and first.sourceRef == 'sample-recommendation-1'
    assert {link.entityType for link in first.associations} == {'journey', 'portfolio', 'application'}
    assert all(link.sourceRef and link.destination.startswith('/') for link in first.associations)


@pytest.mark.parametrize('reason,confidence', [(None, 'Low'), (' ', 'Low'), ('Reason', None), ('Reason', ''),
    ({'unsafe': 1}, 'Low'), ('Reason', {}), ('Reason', False), ('Reason', 0)])
def test_missing_or_invalid_fields_never_borrow_other_item_evidence(repository, reason, confidence):
    attributes(repository, 'recommendation-1', {'reason': reason, 'confidence': confidence})
    item = service(repository).recommendations(QueryContext()).data[0]
    if confidence == 0 and confidence is not False:
        assert item.complete and item.confidence == 0
    else:
        assert not item.complete and item.availability == 'unavailable'


def test_explicit_links_only_and_app_isolation(repository):
    with repository.transaction() as db:
        db.execute('DELETE FROM relationship WHERE source_entity_id=?', ('recommendation-1',))
    attributes(repository, 'recommendation-1', {'reason': 'Reason', 'confidence': 'Supplied',
        'applicationId': 'app-0001', 'destination': 'https://evil.example'})
    reader = service(repository)
    assert reader.recommendations(QueryContext()).data[0].associations == []
    assert 'recommendation-1' not in {item.id for item in reader.recommendations(QueryContext(), 'app-0001').data}
    assert reader.recommendations(QueryContext(), 'app-0002').data == []
    with repository.transaction() as db:
        db.execute('UPDATE relationship SET source_ref=NULL WHERE source_entity_id=?', ('transformation-1',))
    assert reader.transformation(QueryContext()).data[0].associations == []


@pytest.mark.parametrize('method', ['recommendations', 'transformation'])
def test_shared_scope_unknown_filters_bounded_cursor_and_security_ids(repository, method):
    read = getattr(service(repository), method)
    context = QueryContext(personaId='executive', hierarchyNodeId='service-enrollment',
        filters={'application': ['app-0001'], 'domain': ['domain-member']})
    result = read(context, limit=1)
    assert result.context == context and len(result.data) == 1 and result.page.nextCursor == '1'
    assert read(context, limit=1, cursor='1').data[0].id != result.data[0].id
    assert read(context, cursor='9999999').data == []
    assert read(QueryContext(filters={'domain': ['missing']})).data == []
    unknown = read(QueryContext(filters={'unknown': ['x']}))
    assert unknown.data == [] and unknown.unavailableDimensions == ['unknown']
    assert read(QueryContext(hierarchyNodeId='unknown')).unavailableDimensions == ['hierarchyNodeId']
    for identity in ['missing', "app-0001' OR 1=1 --", '../app-0001', 'journey-enrollment']:
        with pytest.raises(LookupError):
            read(QueryContext(), identity)
    with pytest.raises(LookupError):
        read(QueryContext(personaId='not-configured'))
    for limit, cursor in [(0, None), (101, None), (20, '-1'), (20, '01'), (20, '10000000')]:
        with pytest.raises(ValueError):
            read(QueryContext(), limit=limit, cursor=cursor)


def test_supplied_measures_precision_periods_and_order(repository):
    result = service(repository).transformation(QueryContext())
    item = result.data[0]
    assert [metric.value for metric in item.measures] == [65.4321, 'Developing', 125000.25, 420.5]
    assert {metric.period for metric in item.measures} == {'2025-02'}
    assert [point.period for point in item.series[0].points] == ['2025-01', '2025-02']
    assert item.series[0].availability == 'available'
    assert result.data[1].series[0].availability == 'unavailable'
    assert {link.entityType for link in item.associations} == {'journey', 'portfolio', 'application'}
    exact = service(repository).transformation(QueryContext(), period='unknown').data[0]
    assert all(metric.value is None for metric in exact.measures)
    assert exact.series[0].points == [] and exact.series[0].availability == 'unavailable'


@pytest.mark.parametrize('points', [[], [{'value': 1, 'sourceRef': 'f'}],
    [{'value': 1, 'period': 'later', 'sourceRef': 'f'}, {'value': 2, 'sourceRef': 'g'}],
    [{'value': 1, 'period': 'later', 'sourceRef': 'f'}, {'value': 2, 'period': 'earlier'}]])
def test_absent_period_or_provenance_does_not_form_a_trend(repository, points):
    attributes(repository, 'transformation-1', {'series': [{'label': 'Supplied', 'points': points}]})
    item = service(repository).transformation(QueryContext()).data[0]
    assert item.series[0].availability == 'unavailable'
    assert all(metric.availability == 'unavailable' and metric.value is None for metric in item.measures)


def test_order_is_source_order_not_chronological_and_seed_is_idempotent(repository):
    points = [{'value': 2, 'period': 'later', 'sourceRef': 'f'}, {'value': 1, 'period': 'earlier', 'sourceRef': 'g'}]
    attributes(repository, 'transformation-1', {'series': [{'label': 'Source order', 'points': points}]})
    seed_database(repository)
    result = service(repository).transformation(QueryContext()).data[0]
    assert [point.period for point in result.series[0].points] == ['later', 'earlier']
    assert result.series[0].availability == 'available'
    assert len(service(repository).recommendations(QueryContext()).data) == 3


def test_missing_item_provenance_and_invalid_series_values_stay_unavailable(repository):
    """Reject unqualified source evidence without borrowing valid adjacent records."""
    with repository.transaction() as db:
        db.execute('UPDATE entity SET source_ref=NULL WHERE id=?', ('recommendation-1',))
    assert service(repository).recommendations(QueryContext()).data[0].availability == 'unavailable'
    attributes(repository, 'transformation-1', {'measures': {'adoption': []}, 'series': [None,
        {'points': [None, {'value': False, 'period': 'p', 'sourceRef': 'f'}]}]})
    item = service(repository).transformation(QueryContext()).data[0]
    assert len(item.series) == 1 and item.series[0].availability == 'unavailable'
    assert all(point.value is None for point in item.series[0].points)
    for period in [' ', 'x' * 101]:
        with pytest.raises(ValueError):
            service(repository).transformation(QueryContext(), period=period)
