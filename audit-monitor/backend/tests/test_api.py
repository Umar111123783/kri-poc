import os
import sys
import tempfile
from pathlib import Path

# Ensure backend root is on sys.path
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ["DATA_DIR"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402

from app.database import get_connection  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_sqlite_tables_exist_and_seeded():
    conn = get_connection()
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    assert "order_intake" in tables
    assert "purchase_orders" in tables
    assert "audit_exceptions" in tables
    assert "kris" in tables
    assert "runs" in tables
    assert "planner_items" in tables
    assert "settings" in tables

    # Verify order_intake & purchase_orders have data
    oi_count = conn.execute("SELECT COUNT(*) FROM order_intake").fetchone()[0]
    po_count = conn.execute("SELECT COUNT(*) FROM purchase_orders").fetchone()[0]
    assert oi_count > 0
    assert po_count > 0
    conn.close()


def test_kris_seeded_including_p2p02():
    kris = client.get("/api/kris").json()
    assert len(kris) >= 8
    p2p = client.get("/api/kris/P2P-02").json()
    assert p2p["id"] == "P2P-02"
    assert p2p["status"] == "active"
    assert p2p["area"] == "S2P"


def test_run_p2p02_creates_exceptions():
    before = len(client.get("/api/exceptions").json())
    r = client.post("/api/runs", json={"kriId": "P2P-02", "period": "P8 · Aug 2026"})
    assert r.status_code == 201
    body = r.json()
    assert body["run"]["kriId"] == "P2P-02"
    assert len(body["exceptions"]) >= 1
    assert len(client.get("/api/exceptions").json()) == before + len(body["exceptions"])


def test_exception_to_planner_and_draft():
    exc = client.get("/api/exceptions").json()[0]
    item = client.post(f"/api/exceptions/{exc['id']}/planner").json()
    assert item["status"] == "New"
    drafted = client.post(f"/api/planner/{item['id']}/draft", json={"policy": "v3.2"}).json()
    assert drafted["status"] == "Plan drafted" and len(drafted["plan"]) == 8
    live = client.patch(f"/api/planner/{item['id']}", json={"status": "Live"}).json()
    assert live["status"] == "Live"


def test_dynamic_step_insertion_deletion_and_reordering():
    # 1. Create a KRI with initial steps
    kri_payload = {
        "id": "KRI-RESILIENCE-TEST",
        "name": "Resilience Step Test KRI",
        "area": "P2P",
        "kind": "Leading",
        "status": "draft",
        "steps": [
            "Step 1: Extract population",
            "Step 2: Reconcile PO against GR",
            "Step 3: Flag variances > 5%"
        ],
        "thresholds": [
            {"key": "variance", "label": "Variance Limit", "value": 5.0, "unit": "%"}
        ]
    }
    create_res = client.put("/api/kris/KRI-RESILIENCE-TEST", json=kri_payload)
    assert create_res.status_code == 200
    assert len(create_res.json()["steps"]) == 3

    # 2. Dynamic Step Insertion: Insert 2 new steps
    updated_steps = [
        "Step 1: Extract population",
        "Step 1.5: Pre-filter zero-dollar lines (NEW)",
        "Step 2: Reconcile PO against GR",
        "Step 3: Flag variances > 5%",
        "Step 4: Escalate to management (NEW)"
    ]
    reorder_res = client.patch(
        "/api/kris/KRI-RESILIENCE-TEST/steps",
        json={"steps": updated_steps}
    )
    assert reorder_res.status_code == 200
    assert len(reorder_res.json()["steps"]) == 5
    assert reorder_res.json()["steps"][1] == "Step 1.5: Pre-filter zero-dollar lines (NEW)"

    # 3. Dynamic Step Reordering: Reverse and permute order
    permuted_steps = [
        "Step 4: Escalate to management (NEW)",
        "Step 1: Extract population",
        "Step 3: Flag variances > 5%",
        "Step 2: Reconcile PO against GR",
        "Step 1.5: Pre-filter zero-dollar lines (NEW)"
    ]
    permute_res = client.patch(
        "/api/kris/KRI-RESILIENCE-TEST/steps",
        json={"steps": permuted_steps}
    )
    assert permute_res.status_code == 200
    fetched = client.get("/api/kris/KRI-RESILIENCE-TEST").json()
    assert fetched["steps"] == permuted_steps

    # 4. Step Deletion: Remove steps down to 1 step
    reduced_steps = ["Step 1: Extract population"]
    reduced_res = client.patch(
        "/api/kris/KRI-RESILIENCE-TEST/steps",
        json={"steps": reduced_steps}
    )
    assert reduced_res.status_code == 200
    assert len(reduced_res.json()["steps"]) == 1

    # 5. Empty Step Resilience: Submitting empty list or whitespace strings should be rejected (422)
    invalid_empty = client.patch(
        "/api/kris/KRI-RESILIENCE-TEST/steps",
        json={"steps": ["   ", ""]}
    )
    assert invalid_empty.status_code == 422

    # 6. Pre-flight Validation check
    val_res = client.post("/api/kris/KRI-RESILIENCE-TEST/validate").json()
    assert val_res["valid"] is True
    assert val_res["stepCount"] == 1

    # Clean up
    delete_res = client.delete("/api/kris/KRI-RESILIENCE-TEST")
    assert delete_res.status_code == 200


def test_custom_tolerance_thresholds_dollar_vs_percentage():
    # 1. Define multi-unit thresholds combining Dollar (EUR), % Variance, Days, and Item counts
    thresholds = [
        {"key": "minDollarAmount", "label": "Minimum Material Reversal Exposure", "value": 50000.0, "unit": "EUR"},
        {"key": "priceVariancePct", "label": "Purchase Price Variance Tolerance", "value": 5.0, "unit": "%"},
        {"key": "agingWindowDays", "label": "Re-booking Search Window", "value": 30.0, "unit": "days"},
        {"key": "residualCountLimit", "label": "Planner Trigger: Unexplained Anomaly Cap", "value": 5.0, "unit": "items"}
    ]

    payload = {
        "id": "KRI-THRESHOLD-TEST",
        "name": "Custom Tolerance Threshold Benchmark",
        "area": "O2C",
        "kind": "Leading",
        "status": "active",
        "steps": ["Step 1: Ingest population", "Step 2: Check multi-unit thresholds"],
        "thresholds": thresholds,
        "sampling": 100
    }

    # 2. Save KRI with multi-unit thresholds
    res = client.put("/api/kris/KRI-THRESHOLD-TEST", json=payload)
    assert res.status_code == 200
    saved = res.json()
    assert len(saved["thresholds"]) == 4

    # 3. Verify Absolute Dollar vs Percentage Variance vs Days vs Items
    dollar_thr = next(t for t in saved["thresholds"] if t["key"] == "minDollarAmount")
    pct_thr = next(t for t in saved["thresholds"] if t["key"] == "priceVariancePct")
    days_thr = next(t for t in saved["thresholds"] if t["key"] == "agingWindowDays")
    items_thr = next(t for t in saved["thresholds"] if t["key"] == "residualCountLimit")

    assert dollar_thr["value"] == 50000.0 and dollar_thr["unit"] == "EUR"
    assert pct_thr["value"] == 5.0 and pct_thr["unit"] == "%"
    assert days_thr["value"] == 30.0 and days_thr["unit"] == "days"
    assert items_thr["value"] == 5.0 and items_thr["unit"] == "items"

    # 4. Update thresholds dynamically (tighten percentage to 2.5%, increase dollar to 75,000)
    updated_payload = dict(payload)
    updated_payload["thresholds"] = [
        {"key": "minDollarAmount", "label": "Minimum Material Reversal Exposure", "value": 75000.0, "unit": "EUR"},
        {"key": "priceVariancePct", "label": "Purchase Price Variance Tolerance", "value": 2.5, "unit": "%"}
    ]
    update_res = client.put("/api/kris/KRI-THRESHOLD-TEST", json=updated_payload)
    assert update_res.status_code == 200
    updated_saved = update_res.json()
    assert len(updated_saved["thresholds"]) == 2
    assert updated_saved["thresholds"][0]["value"] == 75000.0
    assert updated_saved["thresholds"][1]["value"] == 2.5

    # 5. Clean up
    client.delete("/api/kris/KRI-THRESHOLD-TEST")


def test_reset():
    assert client.post("/api/settings/reset").status_code == 204
    assert len(client.get("/api/planner").json()) == 3


