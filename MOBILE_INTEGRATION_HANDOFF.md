# Nutrifence Mobile Integration Handoff

This document explains how the Flutter mobile/web app described in `report.md` should integrate the Nutri-AI recommendation backend.

Send this alongside:

- GitHub repository: `https://github.com/Winsmano-han/Nutri-AI-Recommendation`
- Full backend documentation: `nutrifence_technical_documentation_v3.docx`

## What The Backend Adds

The current Flutter app already has Firebase Auth, Firestore profile storage, Gemini-based report parsing, maps, geofence detection, and mock recommendation screens. The missing production piece is live restaurant recommendation data.

This backend fills that gap by:

- Searching real nearby restaurants using Google Places.
- Classifying each restaurant into a Nigerian food archetype.
- Calling local Nutrifence joblib models for ranked Nigerian dish candidates.
- Applying the Nigerian Food-Based Dietary Guidelines nutrition contract.
- Applying user-specific nutritionist report rules when available.
- Returning structured recommendation cards for Flutter.

The mobile app should treat this backend as the source of truth for restaurant recommendations. It should not call Groq, Google Places, or the Python model server directly.

## Services To Run

There are two backend processes.

### 1. Python Model Server

Run from `scraper/`:

```powershell
python -m uvicorn model_server:app --host 127.0.0.1 --port 8011
```

This exposes internal model endpoints used by the Node API wrapper:

- `GET /health`
- `POST /recommend`
- `POST /recommend/batch`
- `POST /recommend/food`
- `POST /extract-pdf`

The Flutter app should not call these endpoints directly.

### 2. Node API Wrapper

Run from `scraper/`:

```powershell
$env:MODEL_API_URL="http://127.0.0.1:8011"
node api_server.js
```

Default API base URL:

```text
http://127.0.0.1:8090
```

For mobile device testing, `127.0.0.1` means the phone itself, not the laptop. Use the laptop LAN IP or a hosted backend URL instead.

## Endpoint 1: Recommendations

Use this endpoint when the app needs nearby restaurant recommendations.

```http
POST /api/recommendations
Content-Type: application/json
```

Example request:

```json
{
  "lat": 7.3622,
  "lng": 3.8503,
  "country": "NG",
  "radius": 1500,
  "maxRestaurants": 5,
  "userProfile": {
    "conditions": ["diabetes", "hypertension"],
    "restrictions": ["low sodium", "low sugar"]
  }
}
```

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `lat` | Yes | User latitude from Geolocator. Must be a number. |
| `lng` | Yes | User longitude from Geolocator. Must be a number. |
| `country` | No | `NG` for Nigeria or `CA` for Canada. If omitted, backend infers from coordinates when possible. |
| `radius` | No | Search radius in metres. Use `1000` to `3000` for production. |
| `maxRestaurants` | No | Limits restaurants returned. Use low values during demos to reduce latency. |
| `userProfile.conditions` | No | Normalized condition labels, for example `diabetes`, `hypertension`, `weight_loss`. |
| `userProfile.restrictions` | No | Practical restrictions, for example `low sodium`, `low sugar`, `no fried food`. |

Canada example:

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

`country: "CA"` activates the Health Canada / Canada's Food Guide contract and Canadian restaurant archetypes. Canadian model inference is intentionally skipped until a Canadian model is trained, so Canada recommendations currently use the Canada contract plus AI knowledge.

Example response shape:

```json
{
  "_meta": {
    "generatedAt": "2026-05-03T18:55:33.687Z",
    "pipelineVersion": "2.0.0",
    "userLocation": {
      "lat": 7.3622,
      "lng": 3.8503,
      "radiusMetres": 1500
    },
    "venueCount": 3,
    "modelServerUsed": true
  },
  "venues": [
    {
      "id": "google_place_id",
      "name": "Restaurant Name",
      "address": "Restaurant address",
      "lat": 7.36,
      "lng": 3.85,
      "archetype": "local_canteen",
      "archetypeDesc": "Local Nigerian canteen or buka",
      "rating": 4.1,
      "ratingCount": 120,
      "openNow": true
    }
  ],
  "recommendations": {
    "google_place_id": {
      "modelRecommendations": [],
      "safeOrders": [
        {
          "dish": "Pounded Yam and vegetables",
          "reason": "Why this is suitable for the active nutrition contract",
          "source": "model"
        }
      ],
      "avoid": [
        {
          "item": "Fried Yam and Fried Sauce",
          "reason": "Why the user should avoid it"
        }
      ],
      "tip": "Ask for soup with less salt and no excess stock cubes.",
      "confidenceNote": null,
      "modelServerUsed": true,
      "archetype": "local_canteen"
    }
  }
}
```

Important response rules:

- `venues[].id` is the Google Places ID and is the key into `recommendations`.
- `recommendations[venueId].safeOrders` is what the UI should show as recommended orders.
- `recommendations[venueId].avoid` is what the UI should show as avoid/warning items.
- `tip` is a practical Nigerian ordering instruction.
- `confidenceNote` is populated when the venue type is uncertain. Display it as a small caution note, not as an error.
- `modelRecommendations` is useful for debug/advanced UI, but the main user-facing cards should use `safeOrders`, `avoid`, and `tip`.

## Endpoint 2: Nutrition Report Ingestion

Use this endpoint after the user submits or updates a nutritionist report.

```http
POST /api/ingest-report
Content-Type: application/json
```

Recommended mobile request:

```json
{
  "userId": "firebase_uid_here",
  "reportText": "Full report text or text extracted by the Flutter app..."
}
```

Response:

```json
{
  "success": true,
  "userId": "firebase_uid_here",
  "conditions": ["weight_loss"],
  "reportId": "user_report_user_001_..."
}
```

Important limitation:

- The current Node API wrapper accepts JSON only.
- It does not currently accept multipart file uploads from Flutter.
- If the mobile app has a PDF or scanned report, either extract text on the app side first, or add multipart support to `api_server.js` later.
- The backend can parse PDF files only when given a server-side `reportPath`, which is useful for local testing but not for mobile production.

## How This Fits The Current Flutter App

The current mobile app has these relevant flows:

- `NutritionReportCubit.analyze` parses report text with Gemini and saves `DietaryConstraints` to Firestore.
- `MapGeofenceCubit` tracks user location and navigates to `/recommendations?venueId=...`.
- `MockVenueMenuRepository` reads `assets/mock/menu_lagos.json`.
- `MockRecommendationRepository.compute` scores static menu data.
- Venue and recommendation data are always mock according to `report.md`.

The integration should replace only the mock venue/recommendation layer first. Do not rewrite Auth, routing, Firestore, or geofence logic.

## Flutter Change 1: Add Backend Base URL

Add a backend URL to the Flutter env file.

Example:

```text
RECOMMENDATION_API_BASE_URL=https://your-backend-domain.com
```

For local web testing:

```text
RECOMMENDATION_API_BASE_URL=http://127.0.0.1:8090
```

For Android emulator testing against a local laptop server:

```text
RECOMMENDATION_API_BASE_URL=http://10.0.2.2:8090
```

For a physical phone, use the laptop LAN IP or a hosted backend URL.

## Flutter Change 2: Create A Recommendation API Client

Create a data client similar to the existing Gemini/Firebase repository style.

Suggested location:

```text
lib/features/recommendations/data/nutrifence_recommendation_api_client.dart
```

Responsibilities:

- Read `RECOMMENDATION_API_BASE_URL`.
- Call `POST /api/recommendations`.
- Parse `venues[]`.
- Parse `recommendations`.
- Return a strongly typed response object.

Minimum Dart-style shape:

```dart
class NutrifenceRecommendationApiClient {
  NutrifenceRecommendationApiClient(this._httpClient, this._baseUrl);

  final http.Client _httpClient;
  final String _baseUrl;

  Future<NutrifenceRecommendationsResponse> getRecommendations({
    required double lat,
    required double lng,
    int radius = 1500,
    int maxRestaurants = 5,
    required DietaryConstraints constraints,
  }) async {
    final response = await _httpClient.post(
      Uri.parse('$_baseUrl/api/recommendations'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'lat': lat,
        'lng': lng,
        'radius': radius,
        'maxRestaurants': maxRestaurants,
        'userProfile': {
          'conditions': constraints.conditions,
          'restrictions': [
            ...constraints.excludedIngredients,
            if (constraints.macroGuards.maxSodiumMg != null) 'low sodium',
            if (constraints.macroGuards.maxSugarG != null) 'low sugar',
          ],
        },
      }),
    );

    if (response.statusCode != 200) {
      throw Exception('Recommendation API failed: ${response.statusCode} ${response.body}');
    }

    return NutrifenceRecommendationsResponse.fromJson(jsonDecode(response.body));
  }
}
```

Keep secrets out of Flutter. The Flutter app should know only the backend URL, not Groq API keys, Google Places API keys, or model server details.

## Flutter Change 3: Replace Mock Venue Loading

Current behavior:

- `MockVenueMenuRepository` reads `assets/mock/menu_lagos.json`.
- Map markers come from static Lagos mock venues.

New behavior:

- On map screen load, get the user location from `Geolocator`.
- Call `POST /api/recommendations`.
- Use `response.venues` as the map marker source.
- Store the full response in memory/session cache so the recommendation screen can read it by `venueId`.

Practical implementation:

- Add a `BackendVenueRecommendationRepository`.
- Register it in `get_it` instead of `MockVenueMenuRepository` for venue/recommendation flows.
- Keep `MockVenueMenuRepository` behind a feature flag for offline demos.

The backend does not provide full menus. It provides restaurant-level safe orders, avoid items, and tips. Therefore the mobile app should stop expecting a complete `menus[venueId]` list for real backend mode.

## Flutter Change 4: Replace Mock Recommendation Computation

Current behavior:

- `RecommendationsCubit` loads a venue menu.
- It calls `MockRecommendationRepository.compute`.
- It gets `List<RankedRecommendation>`.

New behavior:

- `RecommendationsCubit` receives `venueId`.
- It looks up `recommendations[venueId]` from the latest backend response cache.
- It renders:
  - `safeOrders` as recommended cards.
  - `avoid` as warning cards.
  - `tip` as a practical order note.
  - `confidenceNote` as a caution badge if present.

Suggested UI mapping:

| Backend field | Flutter UI |
| --- | --- |
| `safeOrders[].dish` | Recommendation card title |
| `safeOrders[].reason` | Recommendation card explanation |
| `safeOrders[].source` | Small badge: `model` or `AI knowledge` |
| `avoid[].item` | Avoid card title |
| `avoid[].reason` | Avoid explanation |
| `tip` | Bottom tip/banner |
| `confidenceNote` | Caution banner |
| `venue.archetypeDesc` | Venue subtitle |

The old `RankedRecommendation.score` can be hidden or replaced with simple ordering. The backend already returns the safe orders in display order.

## Flutter Change 5: Send Reports To The Backend Contract Parser

The mobile app can keep its existing Gemini parsing and Firestore storage. That is still useful for displaying constraints in the app.

However, after report analysis succeeds, also send the raw report text to our backend:

```http
POST /api/ingest-report
```

Use:

```json
{
  "userId": "FirebaseAuth.instance.currentUser!.uid",
  "reportText": "the original report text"
}
```

Recommended location:

- Inside `NutritionReportCubit.analyze`, after Gemini succeeds and after Firestore writes `users/{uid}/constraints/current`.
- Treat this as a backend synchronization step.

Failure handling:

- If `/api/ingest-report` fails, do not block the user from continuing.
- Save an error flag/snippet in Firestore if needed.
- Show a small warning only if the user is about to request recommendations and no backend contract exists.

Why this matters:

- The backend uses the report to create `user_contract_active.json` in the current prototype.
- That user contract is layered on top of the FBDG contract during future recommendations.
- In production, this should become a database row keyed by `userId`, not a flat file.

## Data Mapping From Existing Flutter Models

The backend expects normalized but simple profile data.

Map current Flutter data as follows:

| Flutter source | Backend field |
| --- | --- |
| `UserProfile.medicalConditions` | `userProfile.conditions` |
| `DietaryConstraints.conditions` | `userProfile.conditions` |
| `DietaryConstraints.excludedIngredients` | `userProfile.restrictions` |
| `DietaryConstraints.allergensAvoid` | `userProfile.restrictions` |
| `MacroGuards.maxSodiumMg` | Add `low sodium` to restrictions |
| `MacroGuards.maxSugarG` | Add `low sugar` to restrictions |
| Free-text preference like weight loss | Add `weight_loss` if clearly present |

Recommended normalized condition labels today:

- `diabetes`
- `hypertension`
- `weight_loss`
- `cardiovascular`

Implemented backend condition tables today:

- `diabetes`
- `cardiovascular_hypertension`
- `obesity_weight_loss`

Do not send unsupported labels like `kidney_disease` or `high_cholesterol` unless backend support is added later.

## Suggested Mobile Flow

### App Startup Or Map Open

1. User signs in through Firebase.
2. App reads `users/{uid}/profile/current`.
3. App reads `users/{uid}/constraints/current`.
4. App gets current location using `Geolocator`.
5. App calls `POST /api/recommendations`.
6. App stores the response in a session-level cache.
7. App renders `venues[]` as map markers.

### User Enters A Venue

1. Existing `MapGeofenceCubit` detects the user within radius.
2. Existing dwell timer completes.
3. Router navigates to `/recommendations?venueId=...`.
4. `RecommendationsCubit` looks up the cached backend response by `venueId`.
5. UI renders safe orders, avoid items, tip, and confidence note.

### User Uploads Or Pastes A Report

1. Existing `NutritionReportCubit.analyze` runs Gemini.
2. Existing code stores the parsed constraints in Firestore.
3. New code calls `POST /api/ingest-report` with `{userId, reportText}`.
4. Backend stores the active nutrition contract for future recommendation calls.

## Error Handling Expectations

Handle these response cases in Flutter:

| Case | Expected mobile behavior |
| --- | --- |
| `GET /health` fails | Show backend unavailable in debug/admin screen. |
| `/api/recommendations` returns `422` | Client sent bad lat/lng. Fix request construction. |
| `/api/recommendations` returns `500` | Show fallback message and optionally use mock/offline data. |
| Empty `venues[]` | Show "No nearby restaurants found" and allow radius retry. |
| `confidenceNote != null` | Show caution, not failure. |
| `/api/ingest-report` fails | Keep Firestore/Gemini result, retry sync later. |

Known backend behavior:

- If another recommendation pipeline run is already active, the current API returns `500` with `Pipeline is busy. Retry shortly.`
- A future backend improvement should return HTTP `503` for this case.

## Security And Production Notes

- Keep Groq API keys and Google Places API keys only on the backend.
- Do not ship backend secrets in `assets/env/maps.env`.
- The mobile app should call only the Node API wrapper.
- Add authentication before production. The current API wrapper does not verify Firebase ID tokens.
- In production, `user_contract_active.json` must become per-user database storage keyed by Firebase UID.
- The API wrapper currently runs one pipeline at a time. For production, convert this to a queue or request worker model.

## Minimum Acceptance Test For The Mobile Dev

Before wiring the Flutter UI, verify the backend manually.

```powershell
# Terminal 1
cd scraper
python -m uvicorn model_server:app --host 127.0.0.1 --port 8011

# Terminal 2
cd scraper
$env:MODEL_API_URL="http://127.0.0.1:8011"
node api_server.js
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8090/health
```

Recommendation test:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8090/api/recommendations `
  -ContentType "application/json" `
  -Body '{"lat":7.3622,"lng":3.8503,"radius":1500,"maxRestaurants":1,"userProfile":{"conditions":["diabetes"],"restrictions":["low sugar"]}}'
```

Report ingestion test:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8090/api/ingest-report `
  -ContentType "application/json" `
  -Body '{"userId":"test_user","reportText":"This is a weight loss meal plan. Avoid sugary drinks and fried foods. Prefer vegetables and lean protein."}'
```

Expected report ingestion result:

```json
{
  "success": true,
  "userId": "test_user",
  "conditions": ["weight_loss"],
  "reportId": "..."
}
```

## Implementation Priority

1. Add `RECOMMENDATION_API_BASE_URL`.
2. Add the Dart API client.
3. Replace mock map venue source with backend `venues[]`.
4. Cache the full backend response by `venueId`.
5. Replace `MockRecommendationRepository.compute` display with backend `recommendations[venueId]`.
6. Add report sync call to `/api/ingest-report`.
7. Add production authentication and per-user contract storage later.

This sequence lets the mobile app use the backend without breaking the existing Firebase, routing, onboarding, report preview, or geofence code.
