"""Seed coherent synthetic evidence once without overwriting later configuration."""
import json
from datetime import datetime, timezone
from app.storage.sqlite_repository import SqliteRepository

METRICS = {
    'enterprise': [('availability', 'Availability %', 99.23456, '%'), ('sla', 'SLA compliance %', 98.76543, '%'), ('sev-count', 'Sev1/Sev2 count', 7, 'incidents'), ('mttd', 'MTTD', 4.5, 'minutes'), ('mttr', 'MTTR', None, None), ('repeat', 'repeat incident rate', 3.12, '%'), ('noise', 'alert noise reduction %', 18.5, '%')],
    'reliability': [('sev1', 'Sev1 count', 2, 'incidents'), ('sev2', 'Sev2 count', 5, 'incidents'), ('coverage', 'observability coverage', 84.321, '%')],
    'release': [('frequency', 'deployment frequency', 12, 'deployments'), ('lead', 'lead time for change', 2.75, 'days'), ('failure', 'change failure rate', 4.5, '%'), ('rollback', 'rollback rate', 1.25, '%'), ('pipeline', 'pipeline success rate', 97.1234, '%')],
    'qe': [('test', 'test execution success %', 96.4567, '%'), ('automation', 'automation coverage %', 78.4321, '%'), ('leakage', 'defect leakage %', 2.1234, '%'), ('escaped', 'escaped defects', 3, 'defects'), ('environment', 'environment readiness %', None, '%')],
    'security': [('critical', 'critical vulnerabilities', 4, 'findings'), ('aged', 'aged findings', 9, 'findings'), ('sdlc', 'secure SDLC compliance %', 91.2345, '%'), ('policy', 'policy violations', 6, 'violations')],
    'transformation': [('adoption', 'adoption', 65.4321, '%'), ('maturity', 'maturity', 'Developing', None), ('value', 'value realized', 125000.25, 'USD'), ('effort', 'effort saved', 420.5, 'hours')],
}


def seed_database(repository: SqliteRepository) -> None:
    """Insert the approved sample catalog and linked records atomically.

    Args:
        repository: Migrated file-backed store.
    Notes:
        A dataset marker prevents repeat startup from changing user edits.
    """
    now = datetime.now(timezone.utc).isoformat()
    with repository.transaction() as db:
        if db.execute('SELECT id FROM dataset_version WHERE id=?', ('sample-v1',)).fetchone():
            return
        db.execute('INSERT INTO dataset_version (id,dataset_class,source_kind,accepted_at,accepted_by,outcome,reflection_status) VALUES (?,?,?,?,?,?,?)', ('sample-v1', 'master', 'sample', now, 'sample-generator', 'success', 'confirmed'))
        records = [
            ('domain-member', 'domain', 'Member Experience', None, {}),
            ('portfolio-digital', 'portfolio', 'Digital Services', 'domain-member', {}),
            ('service-enrollment', 'service', 'Enrollment Services', 'portfolio-digital', {}),
            ('owner-digital', 'owner', 'Digital Platform Team', None, {}),
            ('journey-enrollment', 'journey', 'Member Enrollment', None, {'description': 'Synthetic enrollment journey'}),
            ('ticket-1', 'ticket', 'Sample enrollment incident', None, {'recordType': 'incident', 'severity': 'Sev1', 'applicationId': 'app-0001', 'toolSource': 'sample-monitor'}),
            ('problem-1', 'ticket', 'Sample recurring latency problem', None, {'recordType': 'problem', 'applicationId': 'app-0001'}),
            ('rca-1', 'ticket', 'Sample latency analysis', None, {'recordType': 'rca', 'applicationId': 'app-0001', 'reason': 'Supplied synthetic capacity observation'}),
            ('release-1', 'release', 'Sample enrollment release', None, {'applicationId': 'app-0001', 'build': 'Passed (sample)', 'test': 'Supplied test evidence', 'security': 'Supplied findings', 'change': 'Sample approved change', 'environment': 'Sample environment evidence'}),
        ]
        for index in range(1, 1001):
            app_id = f'app-{index:04d}'
            records.append((app_id, 'application', 'Member Portal' if index == 1 else f'Sample Application {index:04d}', 'service-enrollment', {'domain': 'domain-member', 'portfolio': 'portfolio-digital', 'ownerId': 'owner-digital', 'health': 'Warning (sample)' if index == 1 else 'Unavailable', 'automationMaturity': 'Developing', 'observabilityCoverage': 84.321}))
            records.append((f'env-{index:04d}', 'environment', f'Sample production environment {index:04d}', app_id, {'environment': 'prod', 'applicationId': app_id}))
        for entity_id, kind, label, parent, attributes in records:
            db.execute('INSERT INTO entity VALUES (?,?,?,?,?,?,?,?,?)', (entity_id, kind, label, parent, 'high' if kind == 'application' else None, json.dumps(attributes), 'sample-v1', 'sample', 'sample-v1'))
        for index, (source, target, kind) in enumerate([
            ('journey-enrollment', 'app-0001', 'depends_on'), ('app-0001', 'app-0002', 'depends_on'),
            ('ticket-1', 'app-0001', 'affects'), ('problem-1', 'ticket-1', 'correlates_with'),
            ('rca-1', 'problem-1', 'analyzes'), ('release-1', 'app-0001', 'releases'),
            ('owner-digital', 'app-0001', 'owns'),
        ]):
            db.execute('INSERT INTO relationship VALUES (?,?,?,?,?,?,?,?)', (f'rel-{index}', source, target, kind, 'Explicit synthetic association; not causal', 'sample-v1', 'sample', 'sample-v1'))
        for family, metrics in METRICS.items():
            for metric_id, label, value, unit in metrics:
                db.execute('INSERT INTO metric VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', (metric_id, label, family, value if isinstance(value, str) else None, value if isinstance(value, (float, int)) else None, unit, 'month', 'app-0001', 'available' if value is not None else 'unavailable', 'sample-v1', 'sample', f'sample-kpi-{metric_id}'))
        catalog = [
            ('executive', 'Executive', 'Enterprise outcomes and transformation', ['availability', 'sla', 'adoption']),
            ('operations', 'Operations', 'Reliability and incident evidence', ['availability', 'sev1', 'coverage', 'mttr']),
            ('engineering', 'Engineering', 'Release, quality and security evidence', ['pipeline', 'test', 'critical']),
            ('administrator', 'Administrator', 'Prototype data stewardship', ['sdlc']),
        ]
        for persona_id, label, description, widgets in catalog:
            db.execute('INSERT INTO app_config VALUES (?,?,?,?,?,?)', (f'persona-{persona_id}', 'persona', persona_id, json.dumps({'id': persona_id, 'label': label, 'description': description}), now, 'sample-generator'))
            for metric_id in widgets:
                title = next(item[1] for items in METRICS.values() for item in items if item[0] == metric_id)
                db.execute('INSERT INTO app_config VALUES (?,?,?,?,?,?)', (f'{persona_id}-{metric_id}', 'widget', persona_id, json.dumps({'id': metric_id, 'title': title, 'metricId': metric_id, 'visible': True}), now, 'sample-generator'))
        scenarios = [
            ('enrollment', 'Explore member enrollment', 'Follow supplied journey relationships.', '/journeys/journey-enrollment'),
            ('reliability', 'Review enrollment reliability', 'Inspect supplied incident and reliability evidence.', '/operations'),
            ('release', 'Review release evidence', 'Inspect the sample release context.', '/readiness'),
        ]
        for scenario_id, label, description, destination in scenarios:
            db.execute('INSERT INTO app_config VALUES (?,?,?,?,?,?)', (f'scenario-{scenario_id}', 'scenario', None, json.dumps({'id': scenario_id, 'label': label, 'description': description, 'destination': destination}), now, 'sample-generator'))
