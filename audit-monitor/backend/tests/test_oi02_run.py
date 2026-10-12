import json
import pytest
from audit_monitor.backend.app.store import store
from audit_monitor.backend.app.services import simulate_run
from audit_monitor.backend.app.models import RunRequest

def test_simulate_run_oi02():
    kri = store.kri('OI-02')
    assert kri is not None, "KRI OI-02 should exist"
    req = RunRequest(period='P8 · Aug 2026', sampling=100, region='All regions')
    result = simulate_run(store, kri, req)
    # Ensure at least one exception generated
    assert len(result.exceptions) >= 1
    # Verify that generated exceptions have kriId OI-02
    for exc in result.exceptions:
        assert exc.kriId == 'OI-02'
        # classification should be either explainable or unexplained
        assert exc.classification in ('explainable', 'unexplained')
        # Print for debugging (optional)
        print(json.dumps(exc.model_dump(), indent=2))
