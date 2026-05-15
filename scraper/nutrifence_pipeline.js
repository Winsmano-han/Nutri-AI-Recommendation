#!/usr/bin/env node

/**
 * Nutrifence — Restaurant Recommendation Pipeline
 *
 * What this does:
 *   1. Accepts a user GPS location + health profile
 *   2. Searches Google Places API for restaurants within a configurable radius
 *   3. Classifies each restaurant into one of 10 Nigerian food archetypes
 *   4. Maps each archetype → seed dishes → calls FastAPI model server
 *      (model server runs recommender_nigeria_dishes_extended.joblib)
 *   5. Groq filters and explains recommendations against the user's clinical profile
 *   6. Outputs recommendations_{timestamp}.json — ready for Flutter to consume
 *
 * Usage:
 *   node nutrifence_pipeline.js
 *
 * Required env vars (add to .env in this folder):
 *   GOOGLE_MAPS_API_KEY   — same key the Flutter app uses
 *   GROQ_API_KEY          — free at https://console.groq.com
 *   MODEL_API_URL         — FastAPI server URL  (default: http://localhost:8000)
 *
 * Optional env vars:
 *   USER_LAT              — user latitude         (default: Ibadan center)
 *   USER_LNG              — user longitude        (default: Ibadan center)
 *   SEARCH_RADIUS         — metres                (default: 2000)
 *   MAX_RESTAURANTS       — cap on venues         (default: 15)
 *   USER_PROFILE          — JSON string of user health profile (see below)
 *
 * USER_PROFILE example:
 *   '{"conditions":["diabetes","hypertension"],"restrictions":["no red meat","low sodium"]}'
 */

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Load .env ────────────────────────────────────────────────────────────────

const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GROQ_API_KEY        = process.env.GROQ_API_KEY;
const MODEL_API_URL       = (process.env.MODEL_API_URL || "http://localhost:8000").replace(/\/$/, "");

if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "YOUR_KEY_HERE") {
  console.error("❌  GOOGLE_MAPS_API_KEY is not set. Add it to .env");
  process.exit(1);
}
if (!GROQ_API_KEY || GROQ_API_KEY === "YOUR_KEY_HERE") {
  console.error("❌  GROQ_API_KEY is not set. Get a free key at https://console.groq.com");
  process.exit(1);
}

const GROQ_MODEL   = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Default coords: Ibadan city center (University of Ibadan area)
const USER_LAT      = parseFloat(process.env.USER_LAT  || "7.3775");
const USER_LNG      = parseFloat(process.env.USER_LNG  || "3.9470");
const SEARCH_RADIUS = parseInt(process.env.SEARCH_RADIUS || "2000", 10);
const MAX_RESTAURANTS = parseInt(process.env.MAX_RESTAURANTS || "15", 10);

// Parse user health profile from env or use empty defaults
let USER_PROFILE = { conditions: [], restrictions: [] };
if (process.env.USER_PROFILE) {
  try {
    USER_PROFILE = JSON.parse(process.env.USER_PROFILE);
  } catch {
    console.warn("⚠️  USER_PROFILE env var is not valid JSON — using empty profile");
  }
}

function normalizeCountry(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["ca", "can", "canada"].includes(raw)) return "CA";
  if (["ng", "nga", "nigeria"].includes(raw)) return "NG";
  return null;
}

function inferCountryFromCoordinates(lat, lng) {
  if (lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52) return "CA";
  if (lat >= 4 && lat <= 14.5 && lng >= 2 && lng <= 15) return "NG";
  return "NG";
}

const USER_COUNTRY =
  normalizeCountry(process.env.USER_COUNTRY || process.env.COUNTRY || USER_PROFILE.country) ||
  inferCountryFromCoordinates(USER_LAT, USER_LNG);

const INSPECT_PLACES_ONLY = process.env.INSPECT_PLACES_ONLY === "1";

const OUTPUT_PATH = path.join(
  __dirname,
  `recommendations_${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
const CONTRACT_PATHS = {
  NG: path.join(__dirname, "nutrition_contract.json"),
  CA: path.join(__dirname, "nutrition_contract_canada.json"),
};
const ACTIVE_USER_CONTRACT_PATH = path.join(__dirname, "user_contract_active.json");

// ─── Archetype taxonomy ───────────────────────────────────────────────────────

/**
 * 10 archetypes that cover the Nigerian restaurant landscape.
 * Each maps to seed dishes the recommender models understand.
 * The archetype is derived first from name/types pattern matching (fast, cached),
 * and only falls back to a Groq classify call for ambiguous names.
 */
const ARCHETYPES = {
  fast_food_nigerian:   "Nigerian fast food chain (Chicken Republic, Mr Bigg's, Tastee Fried Chicken)",
  fast_food_western:    "Western fast food chain (KFC, Domino's, Subway, Burger King)",
  local_canteen:        "Local Nigerian canteen or buka (mama put, local chop house)",
  suya_grill:           "Suya spot or roadside Nigerian grill (suya, asun, kilishi)",
  seafood_joint:        "Seafood restaurant (fresh fish, prawns, crab, lobster)",
  pepper_soup_joint:    "Pepper soup bar or Nigerian pub-style spot",
  chinese_continental:  "Chinese or continental/intercontinental restaurant",
  shawarma_pizza:       "Shawarma, pizza, or Middle Eastern fast food spot",
  fine_dining_nigerian: "Upscale Nigerian or Afro-fusion fine dining restaurant",
  unknown:              "Restaurant type could not be determined — Nigerian food likely",
  canadian_fast_food:   "Canadian fast food chain or quick-service restaurant",
  coffee_bakery:        "Coffee shop, cafe, bakery, or breakfast pastry spot",
  casual_dining:        "Canadian casual dining restaurant or pub-style restaurant",
  pizza_canada:         "Pizza restaurant common in Canada",
  burger_grill_canada:  "Burger, grill, or sandwich restaurant common in Canada",
  asian_canadian:       "Asian restaurant in Canada (Chinese, Japanese, Thai, Korean, Vietnamese)",
  middle_eastern_canada:"Middle Eastern, shawarma, kebab, or Mediterranean restaurant in Canada",
  indian_canada:        "Indian or South Asian restaurant in Canada",
  caribbean_canada:     "Caribbean restaurant in Canada",
  healthy_bowl_salad:   "Health-focused salad, bowl, smoothie, or fresh food restaurant",
  seafood_canada:       "Seafood restaurant in Canada",
  breakfast_brunch:     "Breakfast or brunch restaurant in Canada",
  unknown_canada:       "Restaurant type could not be determined — Canadian restaurant guidance likely",
};

/**
 * Seed dishes per archetype — these are passed as `like_text` to the dish model.
 * Chosen to represent the typical spread at each venue type.
 */
const ARCHETYPE_SEEDS = {
  fast_food_nigerian:   ["jollof rice chicken", "fried rice coleslaw", "puff puff chips", "grilled chicken wings"],
  fast_food_western:    ["fried chicken burger", "french fries", "grilled chicken wrap", "coleslaw"],
  local_canteen:        ["egusi soup pounded yam", "jollof rice fried plantain", "ofe onugbu garri", "amala ewedu gbegiri"],
  suya_grill:           ["beef suya", "chicken suya", "asun peppered goat meat", "grilled fish pepper sauce"],
  seafood_joint:        ["peppered fish", "grilled tilapia", "prawn stir fry", "seafood okra soup"],
  pepper_soup_joint:    ["goat meat pepper soup", "catfish pepper soup", "cow leg pepper soup", "assorted meat pepper soup"],
  chinese_continental:  ["fried rice egg", "noodles chicken", "sweet sour chicken", "vegetable stir fry"],
  shawarma_pizza:       ["chicken shawarma", "beef shawarma", "pepperoni pizza", "chicken pizza"],
  fine_dining_nigerian: ["ofada rice ayamase sauce", "banga soup starch", "oha soup", "nkwobi cow leg"],
  unknown:              [
    "jollof rice",
    "egusi soup pounded yam",
    "grilled chicken",
    "fried plantain",
    "pepper soup",
    "ofada rice",
  ],
  canadian_fast_food:   ["grilled chicken sandwich", "side salad", "apple slices", "burger", "fries", "sugary drink"],
  coffee_bakery:        ["oatmeal", "egg breakfast sandwich", "whole grain toast", "black coffee", "muffin", "donut", "sweetened latte"],
  casual_dining:        ["grilled salmon", "chicken salad", "vegetable soup", "steak with vegetables", "poutine", "fried wings"],
  pizza_canada:         ["thin crust vegetable pizza", "grilled chicken pizza", "garden salad", "pepperoni pizza", "cheesy bread"],
  burger_grill_canada:  ["grilled chicken sandwich", "lettuce wrap burger", "side salad", "beef burger", "fries", "milkshake"],
  asian_canadian:       ["steamed rice vegetables", "stir fried vegetables", "grilled teriyaki chicken", "fried rice", "sweet sour chicken"],
  middle_eastern_canada:["chicken shawarma plate", "falafel salad", "lentil soup", "tabbouleh", "shawarma wrap", "garlic potatoes"],
  indian_canada:        ["tandoori chicken", "dal", "chana masala", "vegetable curry", "naan", "butter chicken"],
  caribbean_canada:     ["jerk chicken", "rice and peas", "vegetable stew", "curry goat", "fried plantain", "patty"],
  healthy_bowl_salad:   ["grain bowl", "salad with grilled chicken", "lentil bowl", "vegetable soup", "smoothie", "sweetened juice"],
  seafood_canada:       ["grilled salmon", "baked cod", "shrimp salad", "fish and chips", "clam chowder"],
  breakfast_brunch:     ["oatmeal", "egg omelette vegetables", "whole grain toast", "fruit bowl", "pancakes syrup", "bacon"],
  unknown_canada:       [
    "grilled chicken",
    "vegetable salad",
    "whole grain sandwich",
    "vegetable soup",
    "fries",
    "sugary drink",
  ],
};

// In-memory cache: placeId → archetype (avoids reclassifying same venue twice)
const archetypeCache = new Map();

// ─── Nutrition contract helpers ───────────────────────────────────────────────

function loadActiveContract(userProfile) {
  const contractPath = CONTRACT_PATHS[USER_COUNTRY] || CONTRACT_PATHS.NG;
  if (!fs.existsSync(contractPath)) {
    throw new Error(`Nutrition contract not found for country ${USER_COUNTRY}: ${contractPath}`);
  }
  const contractFile = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const contracts = contractFile.contracts || {};
  const defaultContract = contracts.DEFAULT || null;
  const normMap = contractFile.backendNormalization?.conditionAliases || {};
  const tableMap = contractFile.backendNormalization?.fbdgConditionTableMap || {};

  const normalizedConditions = (userProfile?.conditions || []).map((c) => {
    const key = String(c || "").toLowerCase().trim();
    return normMap[key] || key;
  });

  const activeTables = [...new Set(
    normalizedConditions.map((c) => tableMap[c]).filter(Boolean)
  )];

  let userContract = null;
  if (fs.existsSync(ACTIVE_USER_CONTRACT_PATH)) {
    userContract = JSON.parse(fs.readFileSync(ACTIVE_USER_CONTRACT_PATH, "utf8"));
  }

  return {
    defaultContract,
    userContract,
    activeTables,
    normalizedConditions,
    country: USER_COUNTRY,
  };
}

function buildNutritionPromptBlock(contractData, userProfile) {
  const { defaultContract, userContract, activeTables, country } = contractData;
  const restrictions = (userProfile?.restrictions || []).filter(Boolean);
  const baselineLabel =
    country === "CA"
      ? "BASELINE RULES (Health Canada — Canada's Food Guide):"
      : "BASELINE RULES (Federal Ministry of Health Nigeria, WHO 2006):";
  const lines = [];

  lines.push("=== ACTIVE NUTRITION CONTRACT ===");

  if (defaultContract) {
    lines.push(`Authority: ${defaultContract.source}`);
    lines.push("");
    lines.push(baselineLabel);
    for (const inst of defaultContract.llmInstructions || []) lines.push(`- ${inst}`);

    for (const tableKey of activeTables) {
      const table = defaultContract.conditionTables?.[tableKey];
      if (!table) continue;

      lines.push("");
      lines.push(`CONDITION-SPECIFIC RULES (${tableKey.toUpperCase()}):`);
      lines.push(`USE: ${Object.values(table.use || {}).flat().join(", ") || "none"}`);
      lines.push(`REDUCE: ${(table.reduceIntake || []).join(", ") || "none"}`);
      lines.push(`AVOID: ${(table.avoid || []).join(", ") || "none"}`);
      lines.push(`COOKING NOTES: ${(table.cookingNotes || []).join(" | ") || "none"}`);
    }
  }

  if (restrictions.length > 0) {
    lines.push("");
    lines.push("USER DIETARY RESTRICTIONS:");
    for (const r of restrictions) lines.push(`- ${r}`);
  }

  if (userContract && Array.isArray(userContract.llmInstructions) && userContract.llmInstructions.length) {
    lines.push("");
    lines.push(`USER NUTRITIONIST PLAN (${userContract.source || "uploaded report"}):`);
    lines.push("These rules override FBDG where they conflict:");
    for (const inst of userContract.llmInstructions) lines.push(`- ${inst}`);

    if (userContract.constraints?.contraindications?.length) {
      lines.push(`Hard exclusions: ${userContract.constraints.contraindications.join(", ")}`);
    }
    if (userContract.constraints?.dinnerRules?.length) {
      lines.push(`Dinner rules: ${userContract.constraints.dinnerRules.join(" | ")}`);
    }
    if (userContract.constraints?.portionRules?.length) {
      lines.push(`Portions: ${userContract.constraints.portionRules.slice(0, 5).join(" | ")}`);
    }
  }

  lines.push("=================================");
  return lines.join("\n");
}

// ─── Google Places helpers ────────────────────────────────────────────────────

async function searchNearbyRestaurants(lat, lng, pageToken = null) {
  let url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${lat},${lng}` +
    `&radius=${SEARCH_RADIUS}` +
    `&type=restaurant` +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  if (pageToken) url += `&pagetoken=${pageToken}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Places API error: ${data.status} — ${data.error_message || ""}`);
  }

  return data;
}

async function getPlaceDetails(placeId) {
  const fields = [
    "place_id",
    "name",
    "geometry",
    "formatted_address",
    "editorial_summary",
    "serves_vegetarian_food",
    "price_level",
    "rating",
    "user_ratings_total",
    "types",
    "opening_hours",
  ].join(",");

  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${placeId}` +
    `&fields=${fields}` +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  const res  = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK") {
    throw new Error(`Place Details error for ${placeId}: ${data.status}`);
  }

  return data.result;
}

function resolveVenueCoordinates(details, basicPlace) {
  const dLat = details?.geometry?.location?.lat;
  const dLng = details?.geometry?.location?.lng;
  const bLat = basicPlace?.geometry?.location?.lat;
  const bLng = basicPlace?.geometry?.location?.lng;

  if (typeof dLat === "number" && typeof dLng === "number") {
    return { lat: dLat, lng: dLng, coordSource: "details" };
  }
  if (typeof bLat === "number" && typeof bLng === "number") {
    return { lat: bLat, lng: bLng, coordSource: "nearby_search_fallback" };
  }
  return { lat: USER_LAT, lng: USER_LNG, coordSource: "user_location_fallback" };
}

// ─── Archetype classifier ─────────────────────────────────────────────────────

/**
 * Fast pattern-based classifier — handles known chains and obvious name patterns
 * without spending an API call. Returns an archetype key or null if ambiguous.
 */
function classifyByPattern(name, types, country = USER_COUNTRY) {
  const n = name.toLowerCase();
  const t = (types || []).join(" ").toLowerCase();

  if (country === "CA") {
    if (n.match(/tim hortons?|starbucks|second cup|coffee|cafe|bakery|bagel|donut|doughnut/))
      return "coffee_bakery";
    if (n.match(/mcdonald|wendy|a&w|harvey|subway|popeyes|kfc|burger king|dairy queen|taco bell/))
      return "canadian_fast_food";
    if (n.match(/pizza|domino|pizza pizza|pizzaiolo|little caesars|241 pizza|panago/))
      return "pizza_canada";
    if (n.match(/burger|grill|smash|sandwich|deli/))
      return "burger_grill_canada";
    if (n.match(/sushi|thai|chinese|korean|vietnam|pho|ramen|wok|asian|teriyaki/))
      return "asian_canadian";
    if (n.match(/shawarma|kebab|falafel|lebanese|middle.?east|mediterranean|gyro/))
      return "middle_eastern_canada";
    if (n.match(/indian|punjabi|tandoor|curry|biryani|dosa|pakistani|south asian/))
      return "indian_canada";
    if (n.match(/caribbean|jamaican|jerk|roti|trini|west indian/))
      return "caribbean_canada";
    if (n.match(/salad|freshii|fresh|bowl|smoothie|juice|healthy/))
      return "healthy_bowl_salad";
    if (n.match(/seafood|fish|lobster|oyster|clam|crab/))
      return "seafood_canada";
    if (n.match(/breakfast|brunch|pancake|waffle|egg/))
      return "breakfast_brunch";
    if (t.includes("cafe") || t.includes("bakery")) return "coffee_bakery";
    if (t.includes("fast_food") || t.includes("meal_takeaway")) return "canadian_fast_food";
    return null;
  }

  // Known Nigerian fast food chains
  if (n.match(/chicken republic|mr bigg|tastee|tantalizer|sweet sensation|debonairs/))
    return "fast_food_nigerian";

  // Known western chains
  if (n.match(/\bkfc\b|domino|subway|burger king|cold stone|pizza hut|hardee/))
    return "fast_food_western";

  // Suya / grill signals
  if (n.match(/suya|asun|kilishi|bbq|barbeque|grill(?!e)/))
    return "suya_grill";

  // Seafood
  if (n.match(/seafood|lobster|crab|prawn|fish ?house|fish ?spot/))
    return "seafood_joint";

  // Pepper soup
  if (n.match(/pepper.?soup|nkwobi|point.?and.?kill/))
    return "pepper_soup_joint";

  // Chinese / continental
  if (n.match(/chinese|asian|wok|dragon|jade|dynasty|continental|intercontinental/))
    return "chinese_continental";

  // Shawarma / pizza
  if (n.match(/shawarma|pizza|wraps?|middle.?east|lebanese|turkish/))
    return "shawarma_pizza";

  // Fine dining signals
  if (n.match(/restaurant(?! canteen| buka)/) && t.includes("restaurant") && !t.includes("fast_food"))
    return null; // Could be fine dining or local — let Groq decide

  // Google types fast food
  if (t.includes("fast_food") || t.includes("meal_takeaway"))
    return "fast_food_nigerian";

  // Canteen / buka signals
  if (n.match(/mama|buka|bukas|canteen|eatery|chophouse|chop.?house|joint|spot/))
    return "local_canteen";

  // Cultural/local naming cues that often map to Nigerian restaurant brands.
  if (n.match(/ad[uù]n|ile|eko|naija|9ja|afro|lagos|abuja|ibile/))
    return "fine_dining_nigerian";

  return null; // Ambiguous — fall through to Groq
}

/**
 * Groq-assisted classifier for ambiguous names.
 * Returns one of the 10 archetype keys as a string.
 */
async function classifyWithGroq(name, address, types, editorial, country = USER_COUNTRY) {
  const countryLabel = country === "CA" ? "Canadian" : "Nigerian";
  const fallbackKey = country === "CA" ? "unknown_canada" : "unknown";
  const allowedKeys = country === "CA"
    ? [
        "canadian_fast_food",
        "coffee_bakery",
        "casual_dining",
        "pizza_canada",
        "burger_grill_canada",
        "asian_canadian",
        "middle_eastern_canada",
        "indian_canada",
        "caribbean_canada",
        "healthy_bowl_salad",
        "seafood_canada",
        "breakfast_brunch",
        "unknown_canada",
      ]
    : [
        "fast_food_nigerian",
        "fast_food_western",
        "local_canteen",
        "suya_grill",
        "seafood_joint",
        "pepper_soup_joint",
        "chinese_continental",
        "shawarma_pizza",
        "fine_dining_nigerian",
        "unknown",
      ];
  const archetypeList = allowedKeys
    .map((key) => `  "${key}": ${ARCHETYPES[key]}`)
    .join("\n");

  const prompt = `You are classifying a ${countryLabel} restaurant into exactly one category.

Restaurant name: ${name}
Address: ${address || countryLabel}
Google types: ${(types || []).join(", ")}
${editorial ? `Description: ${editorial}` : ""}

Choose the single best matching archetype key from this list:
${archetypeList}

Respond with ONLY the archetype key string. Nothing else. No explanation.`;

  const response = await groqWithRetry(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();
  const raw  = (data.choices?.[0]?.message?.content || "unknown").trim().replace(/"/g, "");

  return allowedKeys.includes(raw) ? raw : fallbackKey;
}

/**
 * Main archetype resolver — pattern first, Groq fallback, with caching.
 */
async function resolveArchetype(place) {
  if (archetypeCache.has(place.place_id)) {
    return archetypeCache.get(place.place_id);
  }

  const patternResult = classifyByPattern(
    place.name,
    place.types,
    USER_COUNTRY
  );

  const archetype = patternResult
    ? patternResult
    : await classifyWithGroq(
        place.name,
        place.formatted_address,
        place.types,
        place.editorial_summary?.overview,
        USER_COUNTRY
      );

  archetypeCache.set(place.place_id, archetype);
  return archetype;
}

// ─── FastAPI model server bridge ──────────────────────────────────────────────

/**
 * Runs all seed dishes for a given archetype through the model server in one
 * batch call. Returns a deduplicated, similarity-sorted list.
 */
async function getModelRecommendations(archetype, userConditions) {
  const seeds = ARCHETYPE_SEEDS[archetype] || ARCHETYPE_SEEDS.unknown;
  if (USER_COUNTRY === "CA" && process.env.CANADA_MODEL_ENABLED !== "1") {
    return [];
  }

  // Map first condition to model-compatible string (model supports one at a time)
  const primaryCondition = userConditions.find(c =>
    ["diabetes", "hypertension"].includes(c.toLowerCase())
  ) || null;

  const body = { seeds, top_k: 6 };
  if (primaryCondition) body.condition = primaryCondition;

  const response = await fetch(`${MODEL_API_URL}/recommend/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Model server batch error ${response.status}: ${err}`);
  }

  const payload = await response.json();
  const resultMap = payload.results || {};

  // Flatten, deduplicate by dish_name, sort by similarity
  const seen   = new Set();
  const merged = [];

  for (const seed of seeds) {
    const items = Array.isArray(resultMap[seed]) ? resultMap[seed] : [];
    for (const item of items) {
      if (!seen.has(item.dish_name)) {
        seen.add(item.dish_name);
        merged.push(item);
      }
    }
  }

  return merged.sort((a, b) => (b.similarity_score || 0) - (a.similarity_score || 0));
}

// ─── Groq recommendation explainer ───────────────────────────────────────────

/**
 * Takes the raw model recommendations and asks Groq to:
 *   1. Filter against the user's full clinical profile (all conditions + restrictions)
 *   2. Produce 3-5 "safe to order" dishes with plain-language reasoning
 *   3. Produce 2-3 "avoid" flags specific to this restaurant type
 *   4. Give 1 practical ordering tip for this venue type in Nigeria
 *
 * Returns a structured object the Flutter app can render directly.
 */
async function explainWithGroq(restaurantName, archetype, modelRecs, userProfile) {
  const contractData = loadActiveContract(userProfile);
  const nutritionBlock = buildNutritionPromptBlock(contractData, userProfile);
  const archetypeDesc = ARCHETYPES[archetype];
  const conditions = contractData.normalizedConditions.join(", ") || "none";
  const countryLabel = USER_COUNTRY === "CA" ? "Canadian" : "Nigerian";
  const foodGuideName = USER_COUNTRY === "CA" ? "Canada's Food Guide" : "Nigerian Food-Based Dietary Guidelines";
  const contextTip = USER_COUNTRY === "CA"
    ? "Canadian context (e.g. sauces/dressings/gravy on the side, water instead of pop, grilled/baked instead of fried, salad/vegetables instead of fries or poutine)"
    : "Nigerian context (e.g. ask for soup without stock cubes, choose grilled/boiled instead of fried)";

  const modelDishNames = new Set(modelRecs.map((r) => String(r.dish_name || "").toLowerCase()).filter(Boolean));
  const attachSafeOrderSources = (obj) => {
    obj.safeOrders = (obj.safeOrders || []).map((item) => {
      const dish = String(item?.dish || "").toLowerCase();
      return {
        ...item,
        source: modelDishNames.has(dish) ? "model" : "ai_knowledge",
      };
    });
    return obj;
  };
  const recList = modelRecs
    .slice(0, 15) // cap prompt size
    .map((r, i) => `${i + 1}. ${r.dish_name} (similarity: ${(r.similarity_score || 0).toFixed(2)}, health_label: ${r.health_label || "unknown"})`)
    .join("\n");

  const prompt = `You are a ${countryLabel} clinical nutrition advisor. A user is at a restaurant and needs safe meal guidance.

Restaurant: "${restaurantName}"
Type: ${archetypeDesc}
Country context: ${USER_COUNTRY}

Active normalized conditions: ${conditions}

${nutritionBlock}

The following dishes were ranked by our AI recommendation model as most relevant for this restaurant type:
${recList || "(no model recommendations available — use your knowledge of this restaurant type)"}

Using both the model recommendations and your knowledge of ${countryLabel} restaurant food:

Return a JSON object with exactly this shape:
{
  "safeOrders": [
    { "dish": "dish name", "reason": "one sentence why it is safe for this user", "source": "model|ai_knowledge" }
  ],
  "avoid": [
    { "item": "dish or category", "reason": "one sentence why to avoid" }
  ],
  "tip": "one practical ordering tip for this specific restaurant type in this country",
  "confidenceNote": "short note if recommendation confidence is low, else null"
}

Rules:
- safeOrders: 3 to 5 items. Prefer items from the model list. Add from your knowledge only if list is thin.
- source: "model" ONLY if the exact dish appears in the ranked model list above.
          Use "ai_knowledge" if you added the dish from your own knowledge.
- avoid: 2 to 3 items. Must reference specific active conditions when present.
- tip: must be specific to ${contextTip}, not generic advice.
- tip must never claim palm oil, extra fried foods, or excessive red meat are healthier choices.
- even with no stated conditions, keep cardiovascular-safe guidance.
- If conditions is "none", give general healthy guidance aligned with ${foodGuideName}.
- Return ONLY the JSON object. No markdown, no explanation, no code fences.`;

  const response = await groqWithRetry(GROQ_API_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      temperature: 0.1,
      max_tokens:  800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq explain error ${response.status}: ${err}`);
  }

  const data    = await response.json();
  const rawText = data.choices?.[0]?.message?.content || "{}";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return attachSafeOrderSources(parsed);
  } catch {
    // Second-pass repair
    return attachSafeOrderSources(await repairGroqJSON(cleaned));
  }
}

async function repairGroqJSON(brokenText) {
  const response = await groqWithRetry(GROQ_API_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       GROQ_MODEL,
      temperature: 0,
      max_tokens:  800,
      messages: [
        {
          role:    "system",
          content: "You fix malformed JSON. Return ONLY the corrected JSON object, nothing else.",
        },
        {
          role:    "user",
          content: `Fix this JSON and return it clean:\n\n${brokenText}`,
        },
      ],
    }),
  });

  const data    = await response.json();
  const rawText = data.choices?.[0]?.message?.content || "{}";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { safeOrders: [], avoid: [], tip: null, confidenceNote: "Could not generate structured advice." };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wraps fetch() for Groq API calls with exponential backoff on 429.
 */
async function groqWithRetry(url, options, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const baseWait = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.pow(2, attempt + 3) * 1000; // 8s, 16s, 32s...
        const jitter = baseWait * 0.2 * (Math.random() * 2 - 1);
        const wait = Math.max(1000, Math.round(baseWait + jitter));

        if (attempt < maxRetries) {
          console.warn(
            `  ⏳ Groq 429 rate limit — waiting ${(wait / 1000).toFixed(1)}s before retry ${attempt + 1}/${maxRetries}...`
          );
          await sleep(wait);
          continue;
        }
      }

      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const wait = Math.pow(2, attempt + 3) * 1000;
        console.warn(`  ⏳ Groq network error — retrying in ${wait / 1000}s...`);
        await sleep(wait);
      }
    }
  }

  throw lastError || new Error("Groq request failed after max retries");
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

function buildVenueObject(place, archetype, coords, coordSource) {
  return {
    id:            place.place_id,
    name:          place.name,
    address:       place.formatted_address || "Nigeria",
    lat:           coords.lat,
    lng:           coords.lng,
    coordSource,
    archetype,
    archetypeDesc: ARCHETYPES[archetype],
    rating:        place.rating        ?? null,
    ratingCount:   place.user_ratings_total ?? null,
    priceLevel:    place.price_level   ?? null,
    openNow:       place.opening_hours?.open_now ?? null,
  };
}

// ─── Health the model server before starting ──────────────────────────────────

async function checkModelServer() {
  try {
    const res = await fetch(`${MODEL_API_URL}/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log(`  ✅ Model server healthy — models loaded: ${data.models_loaded?.join(", ") || "unknown"}`);
    return true;
  } catch (e) {
    console.error(`  ❌ Model server unreachable at ${MODEL_API_URL} — ${e.message}`);
    console.error(`     Make sure model_server.py is running: uvicorn model_server:app --reload`);
    return false;
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function main() {
  console.log("🍽️  Nutrifence — Restaurant Recommendation Pipeline");
  console.log(`   Groq model : ${GROQ_MODEL}`);
  console.log(`   Model API  : ${MODEL_API_URL}`);
  console.log(`   Country    : ${USER_COUNTRY}`);
  console.log(`   Location   : ${USER_LAT}, ${USER_LNG}  radius ${SEARCH_RADIUS}m`);
  console.log(`   Profile    : conditions=[${USER_PROFILE.conditions}]  restrictions=[${USER_PROFILE.restrictions}]`);
  console.log("══════════════════════════════════════════════════════\n");

  // ── Step 0: Health-check model server ──
  console.log("🔌 Step 0: Checking model server…");
  const modelServerUp = await checkModelServer();
  console.log();

  // ── Step 1: Find nearby restaurants ──
  console.log(`📍 Step 1: Searching Google Places within ${SEARCH_RADIUS}m…\n`);

  const allPlaces = new Map();

  try {
    const data = await searchNearbyRestaurants(USER_LAT, USER_LNG);
    console.log(`  Places API returned: ${data.results?.length || 0} results (page 1)`);
    for (const place of data.results || []) {
      if (!allPlaces.has(place.place_id)) allPlaces.set(place.place_id, place);
    }
    console.log(`  After dedup (page 1): ${allPlaces.size} unique venues`);

    // Fetch next page if we haven't hit the cap and a page token exists
    if (data.next_page_token && allPlaces.size < MAX_RESTAURANTS) {
      await sleep(2000); // Google requires a short delay before using next_page_token
      const page2 = await searchNearbyRestaurants(USER_LAT, USER_LNG, data.next_page_token);
      console.log(`  Places API returned: ${page2.results?.length || 0} results (page 2)`);
      for (const place of page2.results || []) {
        if (!allPlaces.has(place.place_id)) allPlaces.set(place.place_id, place);
      }
      console.log(`  After dedup (page 2): ${allPlaces.size} unique venues`);
    }
  } catch (e) {
    console.error(`❌ Places search failed: ${e.message}`);
    process.exit(1);
  }

  const placesToProcess = [...allPlaces.values()].slice(0, MAX_RESTAURANTS);
  console.log(`✅ ${placesToProcess.length} unique restaurants found\n`);

  if (INSPECT_PLACES_ONLY) {
    console.log("🧪 INSPECT_PLACES_ONLY=1 — printing raw Places results and exiting.\n");
    console.log(JSON.stringify(placesToProcess.map((p, i) => ({
      index: i + 1,
      place_id: p.place_id,
      name:     p.name,
      vicinity: p.vicinity,
      types:    p.types,
      rating:   p.rating ?? null,
      lat:      p.geometry?.location?.lat,
      lng:      p.geometry?.location?.lng,
    })), null, 2));
    return;
  }

  // ── Step 2: Classify + get model recs + explain ──
  console.log("🔍 Step 2: Classifying, running models, generating recommendations…\n");

  const venues          = [];
  const recommendations = {};
  let successCount      = 0;
  let failCount         = 0;

  for (let i = 0; i < placesToProcess.length; i++) {
    const basicPlace = placesToProcess[i];
    console.log(`[${i + 1}/${placesToProcess.length}] ${basicPlace.name}`);

    try {
      // Fetch full place details
      const details = await getPlaceDetails(basicPlace.place_id);
      const coords = resolveVenueCoordinates(details, basicPlace);
      await sleep(150);

      // Classify archetype
      process.stdout.write(`  🏷️  Classifying archetype… `);
      const archetype = await resolveArchetype(details);
      const source    = classifyByPattern(details.name, details.types, USER_COUNTRY) ? "pattern" : "groq";
      console.log(`${archetype} (via ${source})`);

      // Get model recommendations (skip if server is down — flag as low confidence)
      let modelRecs = [];
      if (modelServerUp) {
        process.stdout.write(`  🤖 Model inference (${ARCHETYPE_SEEDS[archetype].length} seeds)… `);
        modelRecs = await getModelRecommendations(archetype, USER_PROFILE.conditions || []);
        if (USER_COUNTRY === "CA" && process.env.CANADA_MODEL_ENABLED !== "1") {
          console.log("skipped until Canadian model is added");
        } else {
          console.log(`${modelRecs.length} ranked dishes`);
        }
      } else {
        console.log(`  ⚠️  Model server offline — skipping inference, using Groq knowledge only`);
      }

      // Groq explain + filter
      process.stdout.write(`  💬 Generating advice (Groq)… `);
      const visibleModelRecs = modelRecs.slice(0, 10);
      const advice = await explainWithGroq(details.name, archetype, visibleModelRecs, USER_PROFILE);
      console.log(`${advice.safeOrders?.length || 0} safe orders, ${advice.avoid?.length || 0} avoids`);

      venues.push(buildVenueObject(details, archetype, coords, coords.coordSource));
      const inferredConfidenceNote =
        archetype === "unknown" || archetype === "unknown_canada"
          ? `Low confidence: venue archetype is unknown, so recommendations use generic ${USER_COUNTRY === "CA" ? "Canadian" : "Nigerian"} restaurant guidance.`
          : null;
      recommendations[details.place_id] = {
        modelRecommendations: visibleModelRecs.map(r => ({
          dish:            r.dish_name,
          similarityScore: parseFloat((r.similarity_score || 0).toFixed(3)),
          healthLabel:     r.health_label || null,
          region:          r.region       || null,
          foodClass:       r.food_class   || null,
          spiceLevel:      r.spice_level  || null,
          priceRange:      r.price_range  || null,
          metadataSource:  r.metadata_source || "model",
        })),
        ...advice,
        confidenceNote: advice.confidenceNote || inferredConfidenceNote,
        modelServerUsed:  modelServerUp,
        archetype,
      };

      successCount++;
    } catch (e) {
      console.warn(`  ❌ ${e.message}`);
      failCount++;
    }

    await sleep(300);
    console.log();
  }

  // ── Step 3: Write output ──
  console.log("══════════════════════════════════════════════════════");
  console.log(`✅ Success: ${successCount}   ❌ Failed/skipped: ${failCount}`);
  console.log(`📦 ${venues.length} venues with recommendations`);
  console.log("\n📝 Writing output…");

  const output = {
    _meta: {
      generatedAt:     new Date().toISOString(),
      pipelineVersion: "2.0.0",
      source:          "Google Maps Places API + Nutrifence joblib models + Groq AI",
      country:         USER_COUNTRY,
      userLocation:    { lat: USER_LAT, lng: USER_LNG, radiusMetres: SEARCH_RADIUS },
      userProfile:     USER_PROFILE,
      venueCount:      venues.length,
      modelServerUsed: modelServerUp,
      groqModel:       GROQ_MODEL,
    },
    venues,
    recommendations,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");

  console.log(`\n🎉 Done! Output saved to:\n   ${OUTPUT_PATH}`);
  console.log(`\n👉 For Flutter integration, pass the JSON to your recommendation service.`);
  console.log(`   Key shape: output.venues[] + output.recommendations[place_id]\n`);
}

main().catch(err => {
  console.error("\n💥 Fatal error:", err.message);
  process.exit(1);
});
