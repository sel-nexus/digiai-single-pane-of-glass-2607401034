"""Verify exact application evidence against isolated file-backed SQLite."""
import json
import pytest
from app.domain.application_service import ApplicationService, CATEGORIES
from app.domain.entity_service import EntityService
from app.schemas.contracts import QueryContext


def service(repository) -> ApplicationService:
    """Build the real service with shared filtering."""
    return ApplicationService(repository, EntityService(repository))


def test_complete_profile_preserves_eleven_categories_and_sources(repository):
    """Keep exact identity and supplied evidence without calculated health."""
    profile = service(repository).profile('app-0001', QueryContext()).data
    assert profile.id == 'app-0001'
    assert len(profile.categories.model_dump()) == 11
    assert all(getattr(profile.categories, key).availability == 'available' for key in CATEGORIES)
    assert profile.categories.health.value[0].value == 'Warning (sample)'
    assert profile.categories.incidents.value[0].value['id'] == 'ticket-1'
    assert profile.categories.defects.value[0].value['id'] == 'defect-1'
    coverage = next(item for item in profile.categories.observabilityCoverage.value if item.id == 'coverage')
    assert (coverage.value, coverage.unit, coverage.period, coverage.association) == (84.321, '%', 'month', 'metric:coverage.entityId')
    assert {item.value['id'] for item in profile.categories.dependencies.value} == {'app-0002', 'api-enrollment'}
    assert all(item.sourceRef for key in CATEGORIES for item in getattr(profile.categories, key).value)


def test_partial_profile_does_not_borrow_evidence_or_invert_dependencies(repository):
    """Keep sibling categories null despite an incoming dependency."""
    profile = service(repository).profile('app-0002', QueryContext()).data
    for key in ('health', 'incidents', 'releaseHistory', 'defects', 'securityPosture',
                'dependencies', 'automationMaturity', 'observabilityCoverage'):
        assert getattr(profile.categories, key).model_dump() == {'availability': 'unavailable', 'value': None}
    assert profile.categories.ownership.availability == 'available'


@pytest.mark.parametrize('identifier', ['missing', 'ticket-1', "app-0001' OR 1=1 --", '<script>alert(1)</script>'])
def test_unknown_wrong_type_and_unsafe_ids_never_fallback(repository, identifier):
    """Bind opaque identities instead of interpreting SQL or markup."""
    with pytest.raises(LookupError):
        service(repository).profile(identifier, QueryContext())
    assert repository.read('SELECT id FROM entity WHERE id=?', ('app-0001',))


@pytest.mark.parametrize('filters,dimensions', [({'application': ['app-0002']}, []),
                                               ({'domain': ['missing']}, []),
                                               ({'dateRange': ['missing']}, ['dateRange'])])
def test_empty_scope_and_unsupported_dimensions_remain_empty(repository, filters, dimensions):
    """Reuse exact shared filter intersection and unavailable indicators."""
    result = service(repository).profile('app-0002', QueryContext(filters=filters))
    if filters == {'application': ['app-0002']}:
        assert result.data.id == 'app-0002'
    else:
        assert result.data is None
        assert result.availability == 'unavailable'
        assert result.unavailableDimensions == dimensions


def test_missing_fields_or_association_never_use_global_evidence(repository):
    """Remove application fields and associations, preserving null categories."""
    with repository.transaction() as db:
        db.execute('UPDATE entity SET attributes_json=?,criticality=NULL WHERE id=?', ('{}', 'app-0002'))
        db.execute('UPDATE entity SET attributes_json=? WHERE id=?', (json.dumps({'recordType': 'defect'}), 'defect-1'))
        db.execute('UPDATE metric SET entity_id=? WHERE family=?', ('app-0002', 'security'))
    first = service(repository).profile('app-0001', QueryContext()).data
    assert first.categories.defects.value is None
    partial = service(repository).profile('app-0002', QueryContext()).data
    assert partial.categories.ownership.value is None
    assert partial.categories.domainPortfolio.value is None
    assert partial.categories.criticality.value is None
    assert partial.categories.health.value is None
    assert {item.id for item in partial.categories.securityPosture.value} == {'aged', 'critical', 'policy', 'sdlc'}
    assert all(item.association.startswith('metric:') for item in partial.categories.securityPosture.value)


def test_direct_relationship_and_metric_zero_preserve_evidence(repository):
    """Accept only direct supplied rows; keep zero with unit and period."""
    with repository.transaction() as db:
        db.execute('UPDATE entity SET attributes_json=? WHERE id=?', (json.dumps({'recordType': 'incident'}), 'ticket-1'))
        db.execute('INSERT INTO metric VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                   ('automation-zero', 'Supplied automation', 'automation', None, 0, '%', 'quarter',
                    'app-0002', 'available', 'sample-v1', 'uploaded', 'automation-file'))
    first = service(repository).profile('app-0001', QueryContext()).data
    assert first.categories.incidents.value[0].association == 'relationship:rel-2'
    item = service(repository).profile('app-0002', QueryContext()).data.categories.automationMaturity.value[0]
    assert (item.value, item.unit, item.period, item.sourceRef) == (0, '%', 'quarter', 'automation-file')


def test_missing_link_source_and_unavailable_metric_are_not_evidence(repository):
    """Reject unsourced dependencies and unavailable metrics with stored values."""
    with repository.transaction() as db:
        db.execute('UPDATE relationship SET source_ref=NULL WHERE source_entity_id=?', ('app-0001',))
        db.execute('UPDATE entity SET attributes_json=? WHERE id=?', ('{}', 'app-0001'))
        db.execute('UPDATE metric SET availability=? WHERE family=?', ('unavailable', 'security'))
    profile = service(repository).profile('app-0001', QueryContext()).data
    assert profile.categories.dependencies.value is None
    assert profile.categories.automationMaturity.value is None
    assert all(item.id == 'finding-1' for item in profile.categories.securityPosture.value)


def test_hierarchy_exclusion_and_unknown_dimension(repository):
    """Keep no-match hierarchy empty and reject unsupported service keys."""
    result = service(repository).profile('app-0001', QueryContext(hierarchyNodeId='app-0002'))
    assert result.data is None
    with pytest.raises(ValueError):
        service(repository).profile('app-0001', QueryContext(filters={'invented': ['x']}))


def test_application_scope_mismatch_and_all_missing_categories(repository):
    """Return no fallback on mismatch and all null when no evidence exists."""
    assert service(repository).profile('app-0001', QueryContext(filters={'application': ['app-0002']})).data is None
    with repository.transaction() as db:
        db.execute('UPDATE entity SET attributes_json=?,criticality=NULL WHERE id=?', ('{}', 'app-0003'))
    profile = service(repository).profile('app-0003', QueryContext()).data
    assert all(getattr(profile.categories, key).model_dump() == {'availability': 'unavailable', 'value': None}
               for key in CATEGORIES)


@pytest.mark.parametrize('value', [None, '', '   ', 'Unavailable', [], {}])
def test_empty_supplied_fields_remain_null(repository, value):
    """Reject empty sentinel values without inventing a health classification."""
    with repository.transaction() as db:
        db.execute('UPDATE entity SET attributes_json=? WHERE id=?', (json.dumps({'health': value}), 'app-0002'))
    assert service(repository).profile('app-0002', QueryContext()).data.categories.health.value is None
