# Nutri-AI-Recommendation

Production-oriented Nigerian restaurant recommendation pipeline with:
- Google Places venue discovery
- Local ML model serving (`.joblib`) for dish ranking
- Multi-provider LLM (Gemini + Groq) for clinical filtering and explanation
- Contract-driven nutrition rules (FBDG + uploaded doctor/nutritionist plans)
- Batch processing architecture (2 LLM calls total for 20 restaurants)

## What This Project Does

Given a user location and profile:
1. Finds nearby restaurants using Google Places.
2. Classifies each venue into a restaurant archetype.
3. Queries a local FastAPI model server for ranked dish candidates.
4. Applies nutrition policy via active contract (FBDG baseline + optional user report overrides).
5. Uses multi-provider LLM (Gemini/Groq) to produce structured `safeOrders` and `avoid` items.
6. Writes recommendation JSON ready for mobile/web consumption.

---

## Repository Structure

- `best_models_bundle/`
  - `models/recommender_nigeria.joblib`
  - `models/recommender_nigeria_dishes_v3_weighted.joblib`
  - `utils/recommender.py` (food recommender logic)
  - `utils/dish_recommender.py` (dish recommender logic)
  - training/inference scripts
- `scraper/`
  - `model_server.py` (FastAPI server for model inference + PDF extraction)
  - `nutrifence_pipeline.js` (main recommendation pipeline)
  - `nutrition_contract.json` (nutrition policy contract definitions)
  - `report_ingestion.js` (doctor/nutritionist report -> active contract)
  - `run_ab_test.js` (paced 4-profile condition A/B test runner)

---

## Requirements

- Node.js 18+ (for built-in `fetch`)
- Python 3.10+ (recommended)
- Google Places API key
- Gemini API key (primary LLM provider)
- Groq API key (optional secondary provider)

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
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.5-flash
MODEL_API_URL=http://127.0.0.1:8011

# Optional: Groq as secondary provider
# GROQ_API_KEY=your_groq_key

# Optional runtime overrides
USER_LAT=7.3622
USER_LNG=3.8503
SEARCH_RADIUS=2000
MAX_RESTAURANTS=20
```

Notes:
- `nutrifence_pipeline.js`, `report_ingestion.js`, and `run_ab_test.js` load `scraper/.env`.
- You can still override with shell env vars at runtime.
- Default MAX_RESTAURANTS is 20 (optimized for geofence scanning).
- Pipeline uses batch mode by default (2 LLM calls total instead of 2N).

---

## Start the Model Server

From project root:

```bash
cd scraper
set PYTHONPATH=..\\best_models_bundle
set DISH_MODEL_PATH=..\\best_models_bundle\\models\\recommender_nigeria_dishes_v3_weighted.joblib
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
  "radius": 2000,
  "maxRestaurants": 20,
  "userProfile": {
    "conditions": ["diabetes"],
    "restrictions": ["low sugar"],
    "allergies": "peanuts, shellfish"
  }
}
```

Canada is also supported with the same endpoint:

```json
{
  "lat": 43.6532,
  "lng": -79.3832,
  "country": "CA",
  "radius": 2000,
  "maxRestaurants": 20,
  "userProfile": {
    "conditions": ["diabetes"],
    "restrictions": ["low sugar"],
    "allergies": []
  }
}
```

Country behavior:
- `country: "NG"` uses the Nigerian FBDG contract and Nigerian archetypes/model seeds.
- `country: "CA"` uses the Health Canada / Canada's Food Guide contract and Canadian restaurant archetypes.
- If `country` is omitted, the pipeline infers `CA` or `NG` from the coordinates where possible.
- Canadian model inference is currently skipped unless `CANADA_MODEL_ENABLED=1`; this keeps the Nigerian model from producing misleading Canadian recommendations until a Canadian model is trained.
- If `userId` is supplied, the pipeline loads only that user's doctor/nutritionist contract.
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

## Architecture Highlights

### Batch Processing Mode
The pipeline uses batch processing to minimize LLM API calls:
- **Old approach**: 20 restaurants × 2 LLM calls = 40 API calls (~10-20 minutes with rate limits)
- **New approach**: 1 classify call + 1 explain call = 2 API calls (~40 seconds total)

### Multi-Provider LLM Manager
Automatic failover between providers:
- **Primary**: Gemini 2.5 Flash (fast, reliable)
- **Secondary**: Groq Llama 3.3 70B (optional fallback)
- Round-robin load balancing with health tracking
- Automatic rate limit handling

### Evidence-Based Seed Generation
Restaurant seeds prioritized by evidence strength:
1. **Brand profiles** (0.90 confidence) - Known chains
2. **Google metadata** (0.72 confidence) - Menu hints, tags
3. **Restaurant archetype** (0.42-0.62 confidence) - Category defaults
4. **Country prior** (0.35 confidence) - National cuisine baseline

### Model Deduplication
- 10 seed terms × 6 dishes = 60 potential recommendations
- Deduplication by dish name keeps first occurrence
- Final output: 14-58 unique dishes per restaurant, sorted by similarity

---

## Nutrition Contract System

Contract source file:
- `scraper/nutrition_contract.json`

Active behavior:
1. DEFAULT FBDG contract is always active.
2. User conditions map to condition tables (e.g., diabetes/hypertension).
3. If a user-specific contract exists in Supabase or local development storage, doctor/nutritionist rules are layered on top.

Implemented condition tables today:
- `cardiovascular_hypertension`
- `diabetes`
- `obesity_weight_loss`

---

## Ingest a Doctor/Nutritionist Report

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
- `POST /api/ingest-report` saves the parsed doctor/nutritionist contract by `userId`.
- `POST /api/recommendations` should send the same `userId` to load that user's contract.
- Local development can store contracts in JSON files under `scraper/user_contracts/` when Supabase is not configured.
- For hosted use, create a Supabase project, run `supabase_user_contracts.sql`, and set:

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
  "radius": 2000,
  "userProfile": {
    "conditions": ["diabetes"],
    "restrictions": ["low sugar"],
    "allergies": "peanuts, shellfish"
  }
}
```

Allergy input can be either an array or a comma-separated string. The backend normalizes it and treats allergies as hard exclusions.

---

## Known Operational Guidance

- If model server is down, pipeline degrades to LLM-only recommendations.
- If LLM rate limits are hit, automatic failover to secondary provider occurs.
- Default MAX_RESTAURANTS=20 is optimized for 2km radius geofence scanning.
- Batch mode processes all restaurants in ~40 seconds (2 LLM calls total).
- For stable outputs in tests, keep `MAX_RESTAURANTS` small and use fixed location/radius.


