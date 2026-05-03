# Nutrifence — Technical Documentation

**Last updated:** May 2026  
**Live app:** [https://nutrifence-84631.web.app](https://nutrifence-84631.web.app)  
**Firebase project:** `nutrifence-84631`

---

## What this app actually does

Nutrifence is a Flutter app that bridges clinical nutrition data and real-world food choices. The idea is simple: a user pastes in their doctor's or nutritionist's report (free text — exactly as typed or scanned), the app runs it through Gemini to extract structured dietary constraints, then when the user physically walks into a nearby restaurant, the app detects that they're there, pulls the venue's menu, and recommends what they should (and shouldn't) order — filtered against their constraints.

The app runs on Web, Android, and iOS from a single codebase. The deployed version at the link above is the web build.

---

## Tech stack at a glance


| Concern              | What we use                                               |
| -------------------- | --------------------------------------------------------- |
| UI framework         | Flutter (Dart)                                            |
| State management     | `flutter_bloc` / `cubit`                                  |
| Dependency injection | `get_it`                                                  |
| Routing              | `go_router`                                               |
| Auth                 | Firebase Authentication (email/password + Google Sign-In) |
| Database             | Firestore                                                 |
| AI                   | Gemini 2.0 Flash (`google_generative_ai` Dart package)    |
| Maps                 | `google_maps_flutter`                                     |
| Location             | `geolocator`                                              |
| Env/secrets          | `flutter_dotenv` → `assets/env/maps.env`                  |


---

## Project structure

The project follows a **feature-first** layout under `lib/`. Every feature has its own `domain/`, `data/`, and `presentation/` sub-folders. Shared stuff lives in `lib/core/`.

```
lib/
├── app/                    # MaterialApp, router setup
├── core/
│   ├── config/             # Feature flags, env constants, demo credentials
│   ├── di/                 # GetIt registration (injection.dart)
│   ├── errors/             # AppFailure sealed class
│   ├── llm/                # Gemini client + prompt definitions
│   ├── models/             # Shared domain models
│   ├── routing/            # Route names, go_router refresh helpers
│   ├── services/           # RecommendationHistoryCache
│   └── theme/              # AppTheme
├── features/
│   ├── auth/
│   ├── home/
│   ├── map_geofence/
│   ├── nutrition_report/
│   ├── onboarding_profile/
│   ├── recommendations/
│   ├── history/
│   ├── settings/
│   └── shell/              # Splash, bootstrap, main nav shell
└── firebase_options.dart   # FlutterFire-generated
```

---

## Authentication

### How it works

Auth is handled entirely by Firebase Authentication. The `FirebaseAuthRepository` wraps `FirebaseAuth` and exposes three methods: email/password sign-in, email/password registration, and Google sign-in. All three map the underlying `FirebaseUser` to our own lightweight `AppUser` model (just `id` and `email`).

The `AuthCubit` sits at the root of the widget tree and subscribes to `firebaseAuth.authStateChanges()`. Every widget in the app that cares about auth status reads from this cubit — nothing talks to FirebaseAuth directly from the UI layer.

### Google Sign-In

On **web**, we use `GoogleAuthProvider` with `signInWithPopup` and pass `prompt: select_account` so users can switch accounts.

On **native (Android/iOS)**, we use the `google_sign_in` package. Once Google returns an ID token, we create a `GoogleAuthProvider.credential` and call `signInWithCredential` on FirebaseAuth. Note: `kGoogleSignInServerClientId` in `lib/core/config/google_web_oauth_client_id.dart` is currently an empty string — this needs to be filled with the correct Web client ID from Google Console for Android native sign-in to work properly.

### Demo bootstrap

There's a flag `kBootstrapDemoFirebaseUser` in `feature_flags.dart`. When true, if a sign-in attempt for the demo credentials fails with `user-not-found`, the app automatically creates that Firebase account. This is useful for first-run demos without manually pre-creating the user.

---

## Routing and navigation

Routing is handled by `go_router`. All route names/paths live in `lib/core/routing/app_routes.dart`.

### Routes


| Path                        | What it is                                                            |
| --------------------------- | --------------------------------------------------------------------- |
| `/splash`                   | Initial loading screen                                                |
| `/bootstrap`                | Shown while checking if user has a profile                            |
| `/onboarding`               | Profile setup for new users (also accessible as `/onboarding?edit=1`) |
| `/login`, `/register`       | Auth screens                                                          |
| `/home`                     | Dashboard (inside nav shell)                                          |
| `/report`                   | Nutrition report analysis (inside shell)                              |
| `/report/preview`           | Preview extracted constraints before saving                           |
| `/map`                      | Map + geofence screen (inside shell)                                  |
| `/history`                  | Past recommendation history (inside shell)                            |
| `/profile`                  | User profile (inside shell)                                           |
| `/recommendations?venueId=` | Full-screen recommendations (outside shell)                           |
| `/settings`                 | Full-screen settings (outside shell)                                  |


### Redirect logic

The router has a redirect function that runs on every navigation and on any auth/profile state change. The logic:

1. If auth status is `unknown` → stay on splash, don't redirect anywhere.
2. If not authenticated → only allow `/login` and `/register`; anything else bounces to `/login`.
3. If authenticated but profile status is still loading → send to `/bootstrap`.
4. If authenticated but no profile exists → send to `/onboarding`.
5. If authenticated and profile exists → if you're on a pre-auth screen, go to `/home`.

The router refreshes automatically via `CompositeRouterRefresh`, which combines two `Listenable`s: the `AuthCubit` stream and a `ProfileGateNotifier` (a `ChangeNotifier` that tracks whether the profile check has completed).

---

## State management

Each feature has its own Cubit or Bloc. The pattern across all features is the same: the cubit takes repository interfaces through its constructor (injected via GetIt), exposes methods the UI calls, and emits states the UI listens to.

The `AuthCubit` is the only globally registered cubit — it's provided at the app root and all other cubits are created per-route in the router.

`Bloc.observer = AppBlocObserver()` is registered in `main.dart`, so all state transitions are logged during development.

---

## User profile and the profile gate

When a user signs in for the first time, they have no profile document in Firestore. The `ProfileGateNotifier` detects this and the router sends them to `/onboarding`. Once they complete onboarding, the profile is written to Firestore, the notifier fires, and the router lets them through to `/home`.

Profile data (`UserProfile`) includes: display name, age, sex, height, weight, activity level, dietary preferences as free-text, any medical conditions mentioned, and a budget cap (`budgetMax`) used during recommendation scoring.

---

## AI integration (Gemini)

This is probably the most interesting part of the stack. The AI flow extracts structured dietary constraints from free-text clinical notes.

### The pipeline

1. User pastes their nutrition/clinical report text into the report screen and taps "Analyze".
2. `NutritionReportCubit.analyze` fires. It first saves a pending document to Firestore (`status: 'pending_llm'`) as a paper trail.
3. `GeminiLlmNutritionClient.extractConstraints` is called with the raw text.
4. Gemini returns a structured JSON response. If parsing succeeds, the cubit saves a `parsed` document to Firestore with `status: 'parsed'` and stores the `DietaryConstraints` under `users/{uid}/constraints/current`.
5. If Gemini or the JSON parse fails, the report document is updated to `status: 'llm_failed'`.

### The model and config

- **Model:** `gemini-2.0-flash` by default. Can be overridden with a `GEMINI_MODEL` env variable.
- **Temperature:** `0.25` — deliberately low so we get consistent, conservative extractions rather than creative interpretations.
- **Response format:** `application/json` with a full `responseSchema` matching the `DietaryConstraints` structure. Gemini is told to return only JSON, no markdown, no explanations.
- **Timeout:** 45 seconds per call.

### The prompt

`NutritionExtractionPrompt` defines three parts:

- **System prompt:** instructs Gemini to be a conservative clinical data extractor. Only extract what's explicitly stated, never infer, always produce valid JSON matching the schema.
- **User prefix:** provides the list of schema fields with a short example so Gemini knows exactly what structure to produce.
- **Repair instruction:** if the first response fails JSON parsing (e.g. Gemini wraps it in markdown despite instructions), a second `generateContent` call is made with the raw broken output and this repair instruction asking it to return clean JSON only.

### What `DietaryConstraints` contains

```dart
class DietaryConstraints {
  final List<String> conditions;           // e.g. ["Type 2 diabetes", "hypertension"]
  final List<String> excludedIngredients;  // e.g. ["refined sugar", "red meat"]
  final List<String> allergensAvoid;       // e.g. ["nuts", "shellfish"]
  final List<String> preferredFoods;       // e.g. ["leafy greens", "legumes"]
  final MacroGuards macroGuards;           // max sodium, max sugar, etc.
  final List<String> mealTimingNotes;      // any timing-related instructions
  final List<String> contraindications;   // drug-food interactions, if any
  final String? confidenceNote;           // Gemini's own confidence comment
}
```

### API key

The Gemini API key is read from `GEMINI_API_KEY` in the env file. There's a fallback to `GOOGLE_MAPS_API_KEY` but that only works if the same key has the Generative Language API enabled — which is unlikely in practice. Keep these as separate keys.

---

## Maps and geofencing

### Map display

The map screen uses `google_maps_flutter` with a `GoogleMap` widget. The default camera position is Lagos (`LatLng(6.5244, 3.3792)`) because that's where the mock venue data is located.

The API key is loaded from `dotenv.env['GOOGLE_MAPS_API_KEY']`. If it's missing or still set to `YOUR_KEY_HERE`, the map screen shows a banner telling the developer to configure it. On iOS, the key needs to go in `ios/Flutter/Secrets.xcconfig`.

Each food venue is shown as a marker on the map. Tapping a marker (or a venue in the list at the bottom) either navigates to recommendations directly or triggers the "simulate dwell" path.

### How geofencing works

We're not using OS-level geofence APIs (like Android's `GeofencingClient`). Instead, we're doing it ourselves in `MapGeofenceCubit` using a position stream and distance checks.

Here's the flow:

1. `MapGeofenceCubit.startTracking` calls `Geolocator.getPositionStream` with `LocationAccuracy.high` and a `distanceFilter` of 15 metres. This means a new position event only fires when the user moves at least 15m — saves battery, avoids spam.
2. Every time a position event comes in, we loop through all venues and call `Geolocator.distanceBetween` to calculate the straight-line distance in metres.
3. If the user is within **100 metres** of a venue, a `Timer` is started for **5 seconds** (the dwell threshold).
4. If the user leaves the 100m radius before those 5 seconds are up, the timer is cancelled.
5. If they stay for the full 5 seconds, the cubit emits `triggered` with the `venueId`. A `BlocListener` in the map UI catches this and navigates to `/recommendations?venueId=...`.

The dwell timer prevents accidental triggers when someone just walks past a restaurant without going in.

For demos and testing, `MapGeofenceCubit.simulateTrigger(venueId)` exists to jump straight to the triggered state without needing to physically be near a venue.

### Venue and menu data

Right now, venues and menus come from `assets/mock/menu_lagos.json`. The `MockVenueMenuRepository` reads this file and returns the data. The file structure has two keys: `venues` (list of venue objects with id, name, lat/lng, cuisine tags) and `menus` (map of venueId → list of menu items with name, ingredients, nutritional info, price).

This is still mock data — a real implementation would hit a backend API or a Firestore collection.

---

## Recommendations engine

When the user arrives at a venue, `RecommendationsCubit` loads the venue's menu and runs it through `MockRecommendationRepository.compute`. This scoring function does two things: filters out anything the user can't eat, then ranks what's left.

### Hard filters (items removed entirely)

- Any item whose name or ingredient list contains an excluded ingredient from `DietaryConstraints.excludedIngredients`.
- Any item whose allergen tags overlap with `DietaryConstraints.allergensAvoid`.
- Any item that exceeds `MacroGuards.maxSodiumMg` or `MacroGuards.maxSugarG`.

### Scoring (items that survive the filter)

Each remaining item gets a score based on:

- Protein content (rewarded)
- High sodium or sugar (penalized, proportional to how far over the "comfortable" threshold they are)
- Price vs `UserProfile.budgetMax` (penalized if above budget)
- Preference keyword matches (e.g. if the user's dietary preferences mention "protein" or "less oil", items matching those tags score higher)
- `DietaryConstraints.preferredFoods` matches (bonus)
- Vegetable/legume ingredient tags (small bonus)

The output is a sorted `List<RankedRecommendation>`, each with a score, a human-readable rationale string, and a list of badges (e.g. "High protein", "Within budget").

There's a stub `"FBDG stub: ok"` badge in the scoring — this is a placeholder for Nigerian Food-Based Dietary Guidelines compliance scoring that hasn't been implemented yet.

---

## Firestore data model

All user data lives under `users/{uid}/`. The security rules only allow reads and writes where `request.auth.uid == userId`, so users can only ever see their own data.

### Collections

`**users/{uid}/profile/current`**
The user's profile. Written as a merge on save (so partial updates work). Contains everything from `UserProfile` plus a server `updatedAt` timestamp.

`**users/{uid}/reports/{autoId}**`
Each nutrition report the user submits. Created with `status: 'pending_llm'` when analysis starts. Updated to `status: 'parsed'` with a `parsedAt` timestamp and optional `model` field when Gemini succeeds. Updated to `status: 'llm_failed'` with an error snippet if it fails.

`**users/{uid}/constraints/current**`
The most recently extracted `DietaryConstraints` for the user. Always written as a single document at a fixed path (not a sub-collection) so the app can read it with one get. Includes `source: 'gemini'`, `reportId` (points back to the report it came from), and timestamps.

### Offline persistence

Firestore persistence is enabled in `main.dart` with unlimited cache size. This means the app works offline — users can view their constraints and history without a connection.

---

## Environment variables

Everything sensitive is in `assets/env/maps.env`. This file is bundled into the app build and read at runtime with `flutter_dotenv`. **Do not commit real keys to a public repo.** See `.env.example` at the project root for the full list of variables.


| Variable              | What it's for                                                           |
| --------------------- | ----------------------------------------------------------------------- |
| `GOOGLE_MAPS_API_KEY` | Google Maps (required for the map screen to work)                       |
| `GEMINI_API_KEY`      | Gemini API (required for nutrition analysis)                            |
| `GEMINI_MODEL`        | Optional override for the Gemini model ID (default: `gemini-2.0-flash`) |


For iOS, the Maps key also needs to go into `ios/Flutter/Secrets.xcconfig` because the native Maps SDK reads it at compile time, not runtime.

---

## Feature flags

`lib/core/config/feature_flags.dart` has two flags:

`**kUseMockData`** — when `true`, swaps in mock implementations of `UserProfileRepository` and `NutritionReportRepository` and uses `MockLlmNutritionClient` (returns fixed constraints after 400ms). Currently `false`, so the app uses real Firebase.

`**kBootstrapDemoFirebaseUser**` — when `true`, auto-creates the demo Firebase account on first run if it doesn't exist yet.

Note: venue and recommendation data is **always** mock regardless of this flag. The map and recommendations screens always read from `menu_lagos.json`.

---

## Running locally

```bash
# Install dependencies
flutter pub get

# Run on Chrome (web)
flutter run -d chrome

# Run on Android
flutter run -d <android-device-id>

# Build for web (production)
flutter build web --release

# Deploy to Firebase Hosting
npx -y firebase-tools@latest deploy
```

Make sure `assets/env/maps.env` has real API keys before running.

---

## Known limitations and what's not done yet

- **Venues are mock.** All food venues and menus come from `menu_lagos.json`. There's no backend that returns real nearby venues. This is the biggest gap for a production version.
- **Recommendations are mock.** `MockRecommendationRepository` does real scoring logic but the data it works on is static. A real version would hit a live menu API.
- **Google Sign-In on Android native** needs `kGoogleSignInServerClientId` filled in.
- **FBDG compliance scoring** is stubbed out (badge says "FBDG stub: ok" for every item).
- **No push notifications.** The geofence trigger currently only works if the app is open and in the foreground.
- **No image recognition.** The report submission accepts text only — there's no OCR path for scanned documents.
- `**http` package** is in `pubspec.yaml` but not used anywhere in the current codebase.

---

## Deployment

The app deploys to Firebase Hosting (web only). Firestore security rules are also deployed as part of the same command.

```bash
flutter build web --release
npx -y firebase-tools@latest deploy
```

`firebase.json` is configured to serve `build/web` and rewrite all paths to `index.html` (standard SPA setup).

To deploy only one service:

```bash
npx -y firebase-tools@latest deploy --only hosting
npx -y firebase-tools@latest deploy --only firestore:rules
```

