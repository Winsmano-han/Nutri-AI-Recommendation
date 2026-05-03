# Nutrifence — Restaurant Recommendation System
## Integration Guide for Mobile Dev

---

## What this replaces

The old `scrape_menus.js` tried to scrape restaurant websites for menus.
This failed for ~90% of Lagos/Ibadan restaurants that have no website.

The new system **never scrapes anything**. Instead it reasons from:
- Google Places metadata (name, type, location, rating)
- AI knowledge of Nigerian restaurant archetypes
- Two trained Nigerian food recommendation models
- The user's clinical/nutritionist report

---

## System architecture

```
Flutter app
    │
    │  POST /pipeline/recommend
    │  { lat, lng, radius, userProfile }
    ▼
┌─────────────────────────────────────────┐
│         nutrifence_pipeline.js          │  ← Node.js  (you run this as a service
│                                         │              OR call it as a CLI script)
│  1. Google Places nearby search         │
│  2. Classify restaurant archetype       │
│  3. Map archetype → seed dishes         │
│  4. Call model server (Step 4 below)    │
│  5. Groq: filter + explain per profile  │
│  6. Return structured JSON              │
└─────────────────────────────────────────┘
                    │
                    │  POST /recommend/batch
                    │  { seeds[], condition }
                    ▼
┌─────────────────────────────────────────┐
│           model_server.py               │  ← Python FastAPI  (always running)
│                                         │
│  Loads on startup:                      │
│  • recommender_nigeria_dishes_          │
│    extended.joblib   → /recommend       │
│  • recommender_nigeria.joblib           │
│                       → /recommend/food │
└─────────────────────────────────────────┘
```

---

## Running the model server (Python)

The model server must always be running before the Node pipeline is called.

```bash
# Install dependencies once
pip install fastapi uvicorn joblib scikit-learn pandas numpy

# Start the server (from the folder containing model_server.py)
uvicorn model_server:app --host 0.0.0.0 --port 8000 --reload
```

Put your two model files at:
```
models/recommender_nigeria_dishes_extended.joblib
models/recommender_nigeria.joblib
```

Or override the paths with env vars:
```bash
DISH_MODEL_PATH=/path/to/dish_model.joblib \
FOOD_MODEL_PATH=/path/to/food_model.joblib \
uvicorn model_server:app --port 8000
```

Health check:
```
GET http://localhost:8000/health
→ { "status": "ok", "models_loaded": ["dish", "food"] }
```

---

## Running the Node pipeline

```bash
# Install dependencies once
npm install   # (no external deps — uses native fetch, built into Node 18+)

# Set env vars in .env
GOOGLE_MAPS_API_KEY=your_key_here
GROQ_API_KEY=your_groq_key_here
MODEL_API_URL=http://localhost:8000

# Run for a user in Ibadan (defaults)
node nutrifence_pipeline.js

# Run for a specific location + health profile
USER_LAT=7.3775 \
USER_LNG=3.9470 \
SEARCH_RADIUS=1500 \
USER_PROFILE='{"conditions":["diabetes"],"restrictions":["no red meat","low sodium"]}' \
node nutrifence_pipeline.js
```

Output: `recommendations_{timestamp}.json` in the same folder.

---

## Output JSON shape (what Flutter receives)

```jsonc
{
  "_meta": {
    "generatedAt": "2025-01-15T10:30:00Z",
    "pipelineVersion": "2.0.0",
    "userLocation": { "lat": 7.3775, "lng": 3.9470, "radiusMetres": 2000 },
    "userProfile": { "conditions": ["diabetes"], "restrictions": ["low sodium"] },
    "venueCount": 12,
    "modelServerUsed": true
  },

  "venues": [
    {
      "id": "ChIJabc123...",           // Google place_id — use as FK
      "name": "Chicken Republic",
      "address": "12 Ring Road, Ibadan",
      "lat": 7.3812,
      "lng": 3.9501,
      "archetype": "fast_food_nigerian",
      "archetypeDesc": "Nigerian fast food chain (Chicken Republic, Mr Bigg's...)",
      "rating": 4.1,
      "ratingCount": 342,
      "priceLevel": 2,                 // 1–4, Google scale
      "openNow": true
    }
    // ...more venues
  ],

  "recommendations": {
    "ChIJabc123...": {                 // keyed by place_id

      // Raw ranked output from the .joblib dish model
      "modelRecommendations": [
        {
          "dish": "Grilled Chicken with Jollof Rice",
          "similarityScore": 0.921,
          "healthLabel": "low_risk",
          "region": "South-West",
          "foodClass": "main_dish",
          "spiceLevel": "medium",
          "priceRange": "moderate"
        }
        // ...up to 10
      ],

      // Groq-generated, clinically filtered advice
      "safeOrders": [
        {
          "dish": "Grilled Chicken (no skin)",
          "reason": "High protein, low saturated fat — suitable for diabetics when paired with a small rice portion."
        },
        {
          "dish": "Coleslaw",
          "reason": "Low glycaemic index and no added sodium in their standard recipe."
        }
        // 3–5 items
      ],

      "avoid": [
        {
          "item": "Large Jollof Rice",
          "reason": "High refined carbohydrate load — spikes blood glucose rapidly."
        },
        {
          "item": "Pepsi / Fizzy drinks",
          "reason": "High sugar content — avoid entirely for diabetes management."
        }
        // 2–3 items
      ],

      "tip": "Ask for grilled chicken instead of fried, and swap the standard rice portion for coleslaw as your side.",

      "confidenceNote": null,          // non-null if model had low confidence

      "archetype": "fast_food_nigerian",
      "modelServerUsed": true
    }
  }
}
```

---

## Flutter integration — recommended approach

The mobile dev should call this pipeline as a **backend service**, not run the
Node script locally on the device. Suggested setup:

```
Flutter app
    │
    │  POST https://your-backend.com/api/recommendations
    │  Body: { lat, lng, radius, userProfile }
    ▼
Your backend (Node.js server)
    │  runs nutrifence_pipeline.js logic as an imported module
    │  calls model_server.py on the same server
    ▼
Returns the JSON above to Flutter
```

The Flutter app only needs to:
1. Send the user's GPS coordinates + health profile
2. Render `venues[]` on a map
3. Show `recommendations[place_id].safeOrders` and `.avoid` when a venue is tapped

---

## Environment variables — full reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_MAPS_API_KEY` | ✅ Yes | — | Google Maps API key |
| `GROQ_API_KEY` | ✅ Yes | — | Groq API key (free at console.groq.com) |
| `MODEL_API_URL` | No | `http://localhost:8000` | FastAPI model server URL |
| `USER_LAT` | No | `7.3775` | User latitude (Ibadan default) |
| `USER_LNG` | No | `3.9470` | User longitude (Ibadan default) |
| `SEARCH_RADIUS` | No | `2000` | Search radius in metres |
| `MAX_RESTAURANTS` | No | `15` | Max venues to process per run |
| `USER_PROFILE` | No | `{}` | JSON: `{"conditions":[],"restrictions":[]}` |
| `DISH_MODEL_PATH` | No | `models/recommender_nigeria_dishes_extended.joblib` | Path to dish model |
| `FOOD_MODEL_PATH` | No | `models/recommender_nigeria.joblib` | Path to food model |
| `INSPECT_PLACES_ONLY` | No | `0` | Set to `1` to debug Places API results |

---

## Supported health conditions (model-level filtering)

These are passed directly to the `.joblib` models which handle them natively:
- `diabetes` — removes high-risk flagged items and high sugar/carb dishes
- `hypertension` — removes high-risk flagged items and high sodium dishes

Other conditions (obesity, kidney disease, high cholesterol) are handled at
the Groq explanation layer — the AI reasons about them even though the model
doesn't filter them natively.

---

## Files

```
nutrifence_pipeline.js   ← Node.js pipeline (edit config here)
model_server.py          ← Python FastAPI server (runs the .joblib models)
README.md                ← this file

models/
  recommender_nigeria_dishes_extended.joblib
  recommender_nigeria.joblib
```