"""Verify readiness source integrity using isolated real SQLite files."""
import json
import pytest
from app.domain.entity_service import EntityService
from app.domain.kpi_service import KpiService
from app.domain.readiness_service import ReadinessService, MEASURES, CATEGORIES
from app.schemas.contracts import QueryContext


@pytest.fixture
def service(repository):
    """Compose real shared domain readers."""
    return ReadinessService(repository, EntityService(repository), KpiService(repository))


def test_exact_evidence_and_missing_application(service):
    """Keep five categories source-qualified and exclude other applications."""
    result = service.evidence(QueryContext(), 'app-0001', 'release-1')
    record = result.data[0]
    assert record.application.id == 'app-0001'
    assert set(record.categories.model_dump()) == set(CATEGORIES)
    for key in CATEGORIES:
        item = getattr(record.categories, key).value[0]
        assert item.period == 'month' and item.source == 'sample' and item.sourceRef == 'sample-v1'
        assert set(item.value) == {'status'}
        assert item.association == f'entity:release-1.{key}'
    assert service.evidence(QueryContext(), 'app-0002').data == []
    with pytest.raises(LookupError):
        service.evidence(QueryContext(), 'app-0002', 'release-1')
    with pytest.raises(LookupError):
        service.evidence(QueryContext(), 'missing')
    with pytest.raises(LookupError):
        service.evidence(QueryContext(), release_id='missing')


def test_absent_status_period_source_and_arbitrary_gate_ignored(service, repository):
    """Return unavailable categories without deriving or exposing arbitrary fields."""
    attrs = {'applicationId': 'app-0001', 'build': {'status': 'Approved', 'period': 'month', 'source': 'uploaded', 'sourceRef': 'build-file', 'gate': 100}, 'test': None, 'security': {'status': 'Review', 'period': 'month'}, 'change': {'status': 'Review', 'sourceRef': 'file'}, 'environment': ''}
    with repository.transaction() as db:
        db.execute('UPDATE entity SET attributes_json=? WHERE id=?', (json.dumps(attrs), 'release-1'))
    record = service.evidence(QueryContext(), release_id='release-1').data[0]
    assert record.categories.build.value[0].value == {'status': 'Approved'}
    assert record.categories.build.value[0].sourceRef == 'build-file'
    for key in ('test', 'security', 'change', 'environment'):
        assert getattr(record.categories, key).model_dump() == {'availability': 'unavailable', 'value': None}
    assert all(getattr(service.evidence(QueryContext(), period='week').data[0].categories, key).value is None for key in CATEGORIES)


@pytest.mark.parametrize('family', MEASURES)
def test_named_metrics_exact_period_missing_definition_and_other_app(service, repository, family):
    """Preserve exact supplied metrics and individual missing definitions."""
    result = service.metrics(QueryContext(), family)
    assert [item.label for item in result.data] == list(MEASURES[family])
    assert all(item.period == 'month' for item in result.data)
    assert all(item.value is None for item in service.metrics(QueryContext(), family, 'week').data)
    assert service.metrics(QueryContext(filters={'application': ['app-0002']}), family).data == []
    with repository.transaction() as db:
        db.execute('DELETE FROM metric WHERE family=? AND name=?', (family, MEASURES[family][0]))
    missing = service.metrics(QueryContext(), family).data[0]
    assert missing.label == MEASURES[family][0] and missing.value is None and missing.sourceRef is None


def test_filters_cursor_unknown_and_opaque_values(service):
    """Intersect repeated dimensions and keep opaque malicious values literal."""
    context = QueryContext(filters={'application': ['app-0002', 'app-0001'], 'domain': ['domain-member'], 'environment': ['prod'], 'criticality': ['high'], 'portfolio': ['portfolio-digital'], 'dateRange': ['2025-01/2025-02'], 'toolSource': ['sample-monitor'], 'incidentSeverity': ['Sev1']}, hierarchyNodeId='service-enrollment')
    assert len(service.evidence(context).data) == 1
    assert service.evidence(QueryContext(filters={'domain': ["' OR 1=1--"]})).data == []
    for method in (lambda c: service.evidence(c), lambda c: service.metrics(c, 'release')):
        result = method(QueryContext(filters={'unsupported': ['x']}))
        assert result.data == [] and result.unavailableDimensions == ['unsupported']
    first = service.metrics(QueryContext(), 'release', limit=2)
    assert first.page.total == 5 and first.page.nextCursor == '2'
    second = service.metrics(QueryContext(), 'release', limit=2, cursor=first.page.nextCursor)
    assert set(item.id for item in first.data).isdisjoint(item.id for item in second.data)
    assert service.evidence(QueryContext(), cursor='999').data == []
    for cursor in ('01', '-1', '1 OR 1=1'):
        with pytest.raises(ValueError):
            service.evidence(QueryContext(), cursor=cursor)
    with pytest.raises(ValueError):
        service.metrics(QueryContext(), 'invalid')
    with pytest.raises(ValueError):
        service.evidence(QueryContext(), period='year')
    with pytest.raises(LookupError):
        service.evidence(QueryContext(personaId='unknown'))


def test_metrics_choose_scoped_app_not_first_group_row(service, repository):
    """Avoid KPI grouping fallback to another application's same named metric."""
    with repository.transaction() as db:
        db.execute("INSERT INTO metric SELECT 'other-pipeline',name,family,value_text,0,unit,period,'app-0002',availability,dataset_version_id,source_kind,'other-file' FROM metric WHERE id='pipeline'")
    metric = next(item for item in service.metrics(QueryContext(filters={'application': ['app-0002']}), 'release').data if item.label == 'pipeline success rate')
    assert metric.value == 0 and metric.sourceRef == 'other-file'


def test_missing_metric_provenance_and_explicit_relationship_only(service, repository):
    """Require metric provenance and never infer application links from dependencies."""
    with repository.transaction() as db:
        db.execute("UPDATE metric SET source_ref=NULL WHERE id='pipeline'")
        db.execute("UPDATE entity SET attributes_json=? WHERE id='release-1'", (json.dumps({'period': 'month', 'build': 'Passed'}),))
        db.execute("UPDATE relationship SET relationship_type='depends_on' WHERE source_entity_id='release-1'")
    metric = next(item for item in service.metrics(QueryContext(), 'release').data if item.label == 'pipeline success rate')
    assert metric.value is None and metric.availability == 'unavailable'
    assert service.evidence(QueryContext()).data == []
    with repository.transaction() as db:
        db.execute("UPDATE relationship SET relationship_type='releases' WHERE source_entity_id='release-1'")
    assert service.evidence(QueryContext()).data[0].application.id == 'app-0001'
