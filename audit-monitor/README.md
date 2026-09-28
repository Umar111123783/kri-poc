# Audit monitor – continuous KRI monitoring & Audit planner

A configurable Internal Audit platform: KRIs are onboarded as configuration
(sources, test steps, thresholds, schedule), run on the financial close
calendar or on demand, and every exception carries the agent's evidence,
reasoning and most-likely explanation. Persistent residual risk flows into
the Audit planner, which drafts pointed spot-audit steps from the latest
policy and prior work papers.

All names in the sample data are generic (Customer A…H, BG-A / BG-B,
Audit Manager / Senior Auditor / Audit Director). No client or personal data.

```
audit-monitor/
├── backend/            FastAPI (Python 3.12) – REST API + serves the built UI
│   ├── app/            main.py, models.py, store.py, services.py, routers/, seed.json
│   ├── tests/          pytest API tests
│   └── Dockerfile
├── frontend/           React 18 + Vite
│   └── src/            App.jsx, api.js, constants.js, ui.jsx, pages/, styles.css
├── docker-compose.yml  one-command local / server deployment
├── Dockerfile          multi-stage image: builds the UI, serves it from the API
└── .vscode/            launch + tasks for VS Code
```

## Run locally (VS Code)

Prerequisites: Python 3.12+, Node 20+.

```bash
# API
cd backend
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000         # http://localhost:8000/docs

# UI (second terminal)
cd frontend
npm install
npm run dev                                       # http://localhost:5173 (proxies /api to :8000)
```

Or press **F5** in VS Code and pick *API + UI* – `.vscode/launch.json` starts both.

Tests: `cd backend && pytest`.

## Deploy

Single container (UI built into the image, API serves it on port 8000):

```bash
docker compose up --build -d      # http://localhost:8000
```

State lives in a JSON document at `DATA_DIR/store.json` (mounted as the
`audit-data` volume). Delete it or call `POST /api/settings/reset` to restore
the sample data. Swap `app/store.py` for a database repository when you need
multiple instances.

Environment variables:

| Variable       | Default                      | Purpose                                              |
|----------------|------------------------------|------------------------------------------------------|
| `DATA_DIR`     | `backend/data`               | Where `store.json` is written                        |
| `STATIC_DIR`   | `frontend/dist`              | Built UI to serve from `/` (skipped if absent)       |
| `CORS_ORIGINS` | `http://localhost:5173,…`    | Allowed origins when the UI is hosted separately     |
| `VITE_API_BASE`| *(empty = same origin)*      | Frontend build-time API base URL                     |

Azure: build the image and run it on **Azure Container Apps** or **App Service
for Containers**; mount Azure Files at `DATA_DIR` (or replace the store with
Azure SQL / Cosmos DB); put Entra ID in front via Easy Auth.

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET/PUT | `/api/kris`, `/api/kris/{id}` | List / create / replace a KRI configuration |
| PATCH | `/api/kris/{id}/status` | active · paused · draft · handed |
| GET | `/api/kris/export/config` | The configuration file the agents read |
| GET/POST | `/api/runs` | Run history / run a KRI on demand (returns run + exceptions) |
| GET/PATCH | `/api/exceptions`, `/api/exceptions/{id}` | List / record reviewer decision |
| POST | `/api/exceptions/{id}/planner` | Escalate to the Audit planner |
| GET/POST/PATCH | `/api/planner`, `/api/planner/{id}` | Triggers, manual entries, approve / discard |
| POST | `/api/planner/{id}/draft` | Draft audit steps against a policy |
| GET | `/api/planner/reference` | Policies and prior work papers |
| GET/PUT | `/api/settings`, `/api/settings/calendar` | Close calendar and connections |
| POST | `/api/settings/reset` | Restore sample data (remove before production) |

## Where the real agents plug in

* `backend/app/services.py::simulate_run` – replace with the KRI execution
  agent (Azure OpenAI / AI Foundry) that pulls the population, runs the
  configured steps and returns `AuditException` objects with evidence,
  reasoning and hypothesis.
* `backend/app/services.py::build_plan` – replace with the Planner agent
  (policy + work-paper retrieval via Azure AI Search).
* `frontend/src/constants.js::TODAY` – the demo pins "today" to keep the
  sample schedule meaningful; switch to `new Date()` with live data.
