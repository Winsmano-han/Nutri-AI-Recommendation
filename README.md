# Nutri-AI-Recommendation

Production-oriented Nigerian restaurant recommendation pipeline with:
- Google Places venue discovery
- Local ML model serving (`.joblib`) for dish ranking
- Groq-based clinical filtering and explanation
- Contract-driven nutrition rules (FBDG + uploaded nutritionist plans)

## What This Project Does

Given a user location and profile:
1. Finds nearby restaurants using Google Places.
2. Classifies each venue into a restaurant archetype.
3. Queries a local FastAPI model server for ranked dish candidates.
4. Applies nutrition policy via active contract (FBDG baseline + optional user report overrides).
5. Uses Groq to produce structured `safeOrders`, `avoid`, and `tip`.
6. Writes recommendation JSON ready for mobile/web consumption.

---

## Repository Structure

- `best_models_bundle/`
  - `models/recommender_nigeria.joblib`
  - `models/recommender_nigeria_dishes_extended.joblib`
  - `utils/recommender.py` (food recommender logic)
  - `utils/dish_recommender.py` (dish recommender logic)
  - training/inference scripts
- `scraper/`
  - `model_server.py` (FastAPI server for model inference + PDF extraction)
  - `nutrifence_pipeline.js` (main recommendation pipeline)
  - `nutrition_contract.json` (nutrition policy contract definitions)
  - `report_ingestion.js` (nutritionist report -> active contract)
  - `run_ab_test.js` (paced 4-profile condition A/B test runner)

---

## Requirements

- Node.js 18+ (for built-in `fetch`)
- Python 3.10+ (recommended)
- Google Places API key
- Groq API key

Install Python dependencies:

```bash
pip install -r requirements.txt
```

`requirements.txt` includes:
- `fastapi`
- `uvicorn`
- `joblib`
- `scikit-learn`
- `pandas`
- `numpy`
- `python-multipart`
- `pdfplumber`

---

## Environment Configuration

Create `scraper/.env`:

```env
GOOGLE_MAPS_API_KEY=your_google_maps_key
GROQ_API_KEY=your_groq_key
MODEL_API_URL=http://127.0.0.1:8011

# Optional runtime overrides
USER_LAT=7.3622
USER_LNG=3.8503
SEARCH_RADIUS=1500
MAX_RESTAURANTS=5
```

Notes:
- `nutrifence_pipeline.js`, `report_ingestion.js`, and `run_ab_test.js` load `scraper/.env`.
- You can still override with shell env vars at runtime.

---

## Start the Model Server

From project root:

```bash
cd scraper
set PYTHONPATH=..\\best_models_bundle
set DISH_MODEL_PATH=..\\best_models_bundle\\models\\recommender_nigeria_dishes_extended.joblib
set FOOD_MODEL_PATH=..\\best_models_bundle\\models\\recommender_nigeria.joblib
python -m uvicorn model_server:app --host 127.0.0.1 --port 8011
```

Health check:

```bash
curl http://127.0.0.1:8011/health
```

Available API endpoints:
- `GET /health`
- `POST /recommend`
- `POST /recommend/batch`
- `POST /recommend/food`
- `POST /extract-pdf`

---

## Start the API Wrapper (HTTP Endpoints for App)

This wrapper exposes app-facing endpoints and calls the pipeline/ingestion modules:

```bash
npm run api
```

Default:
- Host: `127.0.0.1`
- Port: `8090`

Open wrapper endpoints:
- `GET /health`
- `GET /model/health` (proxied model-server health)
- `POST /api/recommendations`
- `POST /api/ingest-report`
- `POST /recommend` (proxied model-server endpoint)
- `POST /recommend/batch` (proxied model-server endpoint)
- `POST /recommend/food` (proxied model-server endpoint)
- `POST /extract-pdf` (proxied model-server endpoint)

For Render or any single-service deployment, use:

```bash
npm start
```

`npm start` runs `scripts/render_start.js`, which starts the Python FastAPI model server internally, waits for `/health`, then starts the Node API wrapper on the public `$PORT`. This is required because Render exposes one public port per service.

`POST /api/recommendations` request example:

```json
{
  "lat": 7.3622,
  "lng": 3.8503,
  "country": "NG",
  "radius": 1500,
  "maxRestaurants": 5,
  "userProfile": {
    "conditions": ["diabetes"],
    "restrictions": ["low sugar"]
  }
}
```

Canada is also supported with the same endpoint:

```json
{
  "lat": 43.6532,
  "lng": -79.3832,
  "country": "CA",
  "radius": 1500,
  "maxRestaurants": 5,
  "userProfile": {
    "conditions": ["diabetes"],
    "restrictions": ["low sugar"]
  }
}
```

Country behavior:
- `country: "NG"` uses the Nigerian FBDG contract and Nigerian archetypes/model seeds.
- `country: "CA"` uses the Health Canada / Canada's Food Guide contract and Canadian restaurant archetypes.
- If `country` is omitted, the pipeline infers `CA` or `NG` from the coordinates where possible.
- Canadian model inference is currently skipped unless `CANADA_MODEL_ENABLED=1`; this keeps the Nigerian model from producing misleading Canadian recommendations until a Canadian model is trained.
- If `userId` is supplied, the pipeline loads only that user's nutritionist contract.
- The response includes `_meta.apiVersion`, `_meta.contractSource`, `_meta.modelFamily`, `_meta.cache`, and per-venue `confidence`.

`POST /api/ingest-report` supports:
- JSON text mode: `{ "userId": "...", "reportText": "..." }`
- JSON path mode: `{ "userId": "...", "reportPath": "C:\\\\path\\\\report.pdf" }`

---

## Run the Main Recommendation Pipeline

```bash
cd scraper
node nutrifence_pipeline.js
```

Output:
- `scraper/recommendations_<timestamp>.json`

JSON shape:
- `_meta`
- `venues[]`
- `recommendations[place_id]`
  - `modelRecommendations[]`
  - `safeOrders[]`
  - `avoid[]`
  - `tip`
  - `confidenceNote`

---

## Nutrition Contract System

Contract source file:
- `scraper/nutrition_contract.json`

Active behavior:
1. DEFAULT FBDG contract is always active.
2. User conditions map to condition tables (e.g., diabetes/hypertension).
3. If `user_contract_active.json` exists, user nutritionist rules are layered on top.

Implemented condition tables today:
- `cardiovascular_hypertension`
- `diabetes`
- `obesity_weight_loss`

---

## Ingest a Nutritionist Report

Convert user PDF/TXT into active user contract:

```bash
cd scraper
node report_ingestion.js "C:\\path\\to\\report.pdf" user_001
```

Result:
- `scraper/user_contract_active.json`

This file is consumed automatically by `nutrifence_pipeline.js`.

---

## Run Condition A/B Tests (Rate-Limit Safe)

```bash
cd scraper
node run_ab_test.js
```

Generated files:
- `ab_baseline.json`
- `ab_diabetes.json`
- `ab_hypertension.json`
- `ab_both.json`
- `ab_comparison.txt`

The runner spaces runs with cooldown to reduce Groq rate-limit failures.

---

## Notes for Mobile/Web Integration

Current deployment model is backend-first:
- Mobile/web sends user location/profile (and eventually userId).
- Backend runs pipeline and returns structured recommendation cards.

Implemented API wrapper endpoints (Node):
- `POST /api/recommendations`
- `POST /api/ingest-report`
- `GET /health` (wrapper health)
- `GET /model/health` (model health through Node)
- `POST /recommend`, `/recommend/batch`, `/recommend/food`, `/extract-pdf` (model endpoints proxied through Node)

Per-user nutrition contracts:
- `POST /api/ingest-report` saves the parsed nutritionist contract by `userId`.
- `POST /api/recommendations` should send the same `userId` to load that user's contract.
- By default contracts are stored in local JSON files under `scraper/user_contracts/` for development.
- For a free hosted database, create a Supabase project, run `supabase_user_contracts.sql`, and set:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_CONTRACT_TABLE=user_contracts
```

Never expose the Supabase service role key to Flutter or any client app.

Minimal request contract for upstream API layer:

```json
{
  "userId": "firebase_uid",
  "lat": 7.3622,
  "lng": 3.8503,
  "country": "NG",
  "radius": 1500,
  "userProfile": {
    "conditions": ["diabetes"],
    "restrictions": ["low sugar"]
  }
}
```

Future production upgrade:
- resolve `userId` -> fetch user-specific active contract from DB instead of local file.

---

## Known Operational Guidance

- If model server is down, pipeline degrades to Groq-only recommendations.
- If Groq returns `429`, retry/backoff is built into pipeline Groq calls.
- For stable outputs in tests, keep `MAX_RESTAURANTS` small and use fixed location/radius.
