#!/usr/bin/env node

/**
 * Nutrifence — Restaurant Recommendation Pipeline
 *
 * What this does:
 *   1. Accepts a user GPS location + health profile
 *   2. Searches Google Places API for restaurants within a configurable radius
 *   3. Classifies each restaurant into one of 10 Nigerian food archetypes
 *   4. Generates evidence-based restaurant seed terms → calls FastAPI model server
 *   5. Gemini filters and explains recommendations against the user's clinical profile
 *   6. Outputs recommendations_{timestamp}.json — ready for Flutter to consume
 *
 * Usage:
 *   node nutrifence_pipeline.js
 *
 * Required env vars (add to .env in this folder):
 *   GOOGLE_MAPS_API_KEY   — same key the Flutter app uses
 *   GEMINI_API_KEY        — free at https://aistudio.google.com
 *   MODEL_API_URL         — FastAPI server URL  (default: http://localhost:8000)
 *
 * Optional env vars:
 *   USER_LAT              — user latitude         (default: Ibadan center)
 *   USER_LNG              — user longitude        (default: Ibadan center)
 *   SEARCH_RADIUS         — metres                (default: 2000)
 *   MAX_RESTAURANTS       — cap on venues         (default: 3)
 *   USER_PROFILE          — JSON string of user health profile (see below)
 *
 * USER_PROFILE example:
 *   '{"conditions":["diabetes","hypertension"],"restrictions":["no red meat","low sodium"]}'
 */

import fs   from "fs";
import path from "path";
import dns from "dns";
import { fileURLToPath } from "url";
import { loadCountryPack, normalizeCountry, inferCountryFromCoordinates } from "./country_packs/index.js";
import { loadUserContract, contractStoreInfo } from "./contract_store.js";
import { generateRestaurantSeeds } from "./seed_generator.js";
import { LLMProviderManager } from "./llm_provider_manager.js";
import { batchClassifyRestaurants, batchExplainRecommendations } from "./batch_llm_operations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dns.setDefaultResultOrder("ipv4first");

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
const GEMINI_API_KEY      = process.env.GEMINI_API_KEY;
const MODEL_API_URL       = (process.env.MODEL_API_URL || "http://localhost:8000").replace(/\/$/, "");

if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "YOUR_KEY_HERE") {
  console.error("❌  GOOGLE_MAPS_API_KEY is not set. Add it to .env");
  process.exit(1);
}
if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_KEY_HERE") {
  console.error("❌  GEMINI_API_KEY is required. Add it to .env");
  process.exit(1);
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GOOGLE_TIMEOUT_MS = parseInt(process.env.GOOGLE_TIMEOUT_MS || "20000", 10);
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || "45000", 10);
const MODEL_TIMEOUT_MS = parseInt(process.env.MODEL_TIMEOUT_MS || "20000", 10);
const ENABLE_BATCH_MODE = process.env.ENABLE_BATCH_MODE !== "0"; // Default ON
const SKIP_LLM_CLASSIFY = process.env.SKIP_LLM_CLASSIFY !== "0"; // Default ON: unknown is safer than bad cuisine guesses
const ENABLE_GEMINI_SEARCH = process.env.ENABLE_GEMINI_SEARCH === "1";

// Default coords: Ibadan city center (University of Ibadan area)
const USER_LAT      = parseFloat(process.env.USER_LAT  || "7.3775");
const USER_LNG      = parseFloat(process.env.USER_LNG  || "3.9470");
const SEARCH_RADIUS = parseInt(process.env.SEARCH_RADIUS || "2000", 10);
const MAX_RESTAURANTS = parseInt(process.env.MAX_RESTAURANTS || "20", 10);

// Parse user health profile from env or use empty defaults
let USER_PROFILE = { conditions: [], restrictions: [] };
if (process.env.USER_PROFILE) {
  try {
    USER_PROFILE = JSON.parse(process.env.USER_PROFILE);
  } catch {
    console.warn("⚠️  USER_PROFILE env var is not valid JSON — using empty profile");
  }
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeList(item))
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeGender(value) {
  const gender = String(value || "").trim().toLowerCase();
  if (["male", "m"].includes(gender)) return "male";
  if (["female", "f"].includes(gender)) return "female";
  return null;
}

function normalizeAge(value) {
  const age = parseInt(value, 10);
  return Number.isFinite(age) && age > 0 ? age : null;
}

function normalizeUserProfile(profile = {}) {
  return {
    ...profile,
    conditions: normalizeList(profile.conditions),
    restrictions: normalizeList(profile.restrictions),
    allergies: normalizeList(profile.allergies ?? profile.allergens ?? profile.allergensAvoid),
    age: normalizeAge(profile.age),
    activityLevel: profile.activityLevel || null,
    gender: normalizeGender(profile.gender),
  };
}

USER_PROFILE = normalizeUserProfile(USER_PROFILE);

const USER_COUNTRY =
  normalizeCountry(process.env.USER_COUNTRY || process.env.COUNTRY || USER_PROFILE.country) ||
  inferCountryFromCoordinates(USER_LAT, USER_LNG);
const USER_ID = String(process.env.USER_ID || USER_PROFILE.userId || "").trim();
const COUNTRY_PACK = loadCountryPack(USER_COUNTRY);

const INSPECT_PLACES_ONLY = process.env.INSPECT_PLACES_ONLY === "1";

const OUTPUT_PATH = path.join(
  __dirname,
  `recommendations_${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
const CONTRACT_PATHS = {
  NG: path.join(__dirname, "nutrition_contract.json"),
  CA: path.join(__dirname, "nutrition_contract_canada.json"),
};

// ─── Country pack taxonomy ───────────────────────────────────────────────────

const ARCHETYPES = COUNTRY_PACK.archetypes;
const ARCHETYPE_SEEDS = COUNTRY_PACK.archetypeSeeds;
// In-memory cache: placeId → archetype (avoids reclassifying same venue twice)
const archetypeCache = new Map();

// ─── AI Seed Generation for Unknown Restaurants ────────────────────────

async function generateAISeedsForUnknown(llmManager, restaurants, country) {
  const countryLabel = country === "CA" ? "Canadian" : "Nigerian";
  
  const restaurantList = restaurants
    .map((r, i) => {
      const types = (r.types || []).join(", ");
      const editorial = r.editorial ? `\nDescription: ${r.editorial}` : "";
      return `${i + 1}. place_id: ${r.placeId}\n   Name: "${r.name}"\n   Google Types: ${types}${editorial}`;
    })
    .join("\n\n");
  
  const prompt = `You are analyzing ${restaurants.length} ${countryLabel} restaurant(s) with ambiguous names or limited metadata.

RESTAURANTS:
${restaurantList}

TASK:
For EACH restaurant, infer 5-8 likely menu items based on:
- Restaurant name cultural/functional signals
- Google types
- Description (if available)
- ${countryLabel} food culture

RULES:
- Return SPECIFIC dish names, not categories (e.g., "jollof rice" not "rice dishes")
- Focus on common, widely available items for that venue type
- Avoid generic terms like "grilled chicken" unless clearly appropriate
- For local canteens: prioritize swallows, soups, rice dishes
- For unknown spots: infer from name patterns (e.g., "Mama X" = local food)

RETURN FORMAT (JSON object, not array):
{
  "place_id_1": ["dish1", "dish2", "dish3", "dish4", "dish5"],
  "place_id_2": ["dish1", "dish2", "dish3", "dish4", "dish5"]
}

Do not include markdown code fences or explanatory text. Return ONLY the JSON object.`;
  
  const messages = [{ role: "user", content: prompt }];
  const response = await llmManager.chat(messages, { temperature: 0.3, maxTokens: 1500 });
  
  let parsed;
  try {
    // More aggressive cleaning
    let cleaned = response.content.trim();
    // Remove markdown code fences
    cleaned = cleaned.replace(/```(?:json)?\n?/g, "").replace(/```/g, "");
    // Remove any text before first { and after last }
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
    }
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.warn(`  ⚠️  Failed to parse AI seed response: ${err.message}`);
    console.warn(`  Raw response: ${response.content.substring(0, 200)}...`);
    return new Map();
  }
  
  const resultMap = new Map();
  for (const restaurant of restaurants) {
    const seeds = parsed[restaurant.placeId];
    if (Array.isArray(seeds) && seeds.length > 0) {
      resultMap.set(restaurant.placeId, seeds.map(s => String(s).toLowerCase().trim()).filter(Boolean));
    }
  }
  
  return resultMap;
}

// ─── Nutrition contract helpers ───────────────────────────────────────────────

async function loadActiveContract(userProfile) {
  const contractPath = CONTRACT_PATHS[COUNTRY_PACK.countryCode] || CONTRACT_PATHS.NG;
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
  if (USER_ID) {
    try {
      userContract = await loadUserContract(USER_ID);
    } catch (err) {
      console.warn(`⚠️  Could not load user contract for ${USER_ID}: ${err.message}`);
    }
  }

  return {
    defaultContract,
    userContract,
    activeTables,
    normalizedConditions,
    country: COUNTRY_PACK.countryCode,
    contractSource: defaultContract?.source || null,
    userContractUsed: Boolean(userContract),
  };
}

function buildNutritionPromptBlock(contractData, userProfile) {
  const { defaultContract, userContract, activeTables, country } = contractData;
  const restrictions = (userProfile?.restrictions || []).filter(Boolean);
  const allergies = (userProfile?.allergies || []).filter(Boolean);
  const age = userProfile?.age;
  const activityLevel = userProfile?.activityLevel;
  const gender = userProfile?.gender;
  
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

  if (age || activityLevel || gender) {
    lines.push("");
    lines.push("USER DEMOGRAPHICS:");
    if (age) lines.push(`- Age: ${age} years`);
    if (gender) lines.push(`- Gender: ${gender}`);
    if (activityLevel) lines.push(`- Activity Level: ${activityLevel}`);
  }

  if (restrictions.length > 0) {
    lines.push("");
    lines.push("USER DIETARY RESTRICTIONS:");
    for (const r of restrictions) lines.push(`- ${r}`);
  }

  if (allergies.length > 0) {
    lines.push("");
    lines.push("USER ALLERGIES (hard exclusions):");
    for (const allergy of allergies) lines.push(`- ${allergy}`);
  }

  if (userContract && Array.isArray(userContract.llmInstructions) && userContract.llmInstructions.length) {
    lines.push("");
    lines.push(`USER DOCTOR/NUTRITIONIST PLAN (${userContract.source || "uploaded report"}):`);
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

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`Google Places nearby search fetch failed: ${err.message}`);
  }
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
    "website",
    "url",
  ].join(",");

  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${placeId}` +
    `&fields=${fields}` +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(`Google Place Details fetch failed for ${placeId}: ${err.message}`);
  }
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
  return COUNTRY_PACK.classifyByPattern(name, types, country);
}

/**
 * Groq-assisted classifier for ambiguous names.
 * Returns one of the 10 archetype keys as a string.
 */
async function classifyWithGroq(name, address, types, editorial, country = USER_COUNTRY) {
  const countryLabel = COUNTRY_PACK.countryLabel;
  const fallbackKey = COUNTRY_PACK.unknownArchetype;
  const allowedKeys = Object.keys(ARCHETYPES);
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

  const fallbackKey = COUNTRY_PACK.unknownArchetype;
  const patternResult = classifyByPattern(
    place.name,
    place.types,
    USER_COUNTRY
  );

  const archetype = patternResult
    ? patternResult
    : (process.env.SKIP_GROQ_CLASSIFY === "1")
      ? fallbackKey
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
 * Runs all evidence-based seed terms for a restaurant through the model server
 * in one batch call. Returns a deduplicated, similarity-sorted list.
 */
async function getModelRecommendations(seedTerms, userConditions) {
  const seeds = Array.isArray(seedTerms) && seedTerms.length
    ? seedTerms
    : (ARCHETYPE_SEEDS[COUNTRY_PACK.unknownArchetype] || []);
  const modelApiUrl =
    USER_COUNTRY === "CA"
      ? (process.env.CANADA_MODEL_API_URL || MODEL_API_URL).replace(/\/$/, "")
      : MODEL_API_URL;

  // Map first condition to model-compatible string (model supports one at a time)
  const primaryCondition = userConditions.find(c =>
    ["diabetes", "hypertension"].includes(c.toLowerCase())
  ) || null;

  const body = { seeds, top_k: 6, country: USER_COUNTRY };
  if (primaryCondition) body.condition = primaryCondition;

  let response;
  try {
    response = await fetch(`${modelApiUrl}/recommend/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Model server batch fetch failed for ${modelApiUrl}/recommend/batch: ${err.message}`);
  }

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

function shouldSkipModelForArchetype(archetype) {
  return false;
}

function filterModelRecommendationsForArchetype(archetype, recommendations) {
  const items = Array.isArray(recommendations) ? recommendations : [];
  if (USER_COUNTRY !== "NG") return items;

  if (archetype === "fast_food_western" || archetype === "fast_food_nigerian" || archetype === "shawarma_pizza") {
    const implausibleFastFoodTerms = [
      "amala",
      "eba",
      "semovita",
      "wheat swallow",
      "pounded yam",
      "iyan",
      "tuwo",
      "starch",
      "egusi",
      "ewedu",
      "gbegiri",
      "ogbono",
      "oha soup",
      "banga soup",
      "pepper soup",
    ];
    return items.filter((item) => {
      const dish = String(item.dish_name || "").toLowerCase();
      return !implausibleFastFoodTerms.some((term) => dish.includes(term));
    });
  }

  return items;
}

// ─── Groq recommendation explainer ───────────────────────────────────────────

function getBrandGuidance(restaurantName, archetype) {
  const name = String(restaurantName || "").toLowerCase();

  const profiles = [
    {
      match: /\bdomino'?s?\b|pizza hut|pizza pizza/,
      label: "pizza_chain",
      likelySafe: [
        "thin-crust vegetable or chicken pizza in a moderate portion",
        "side salad if available",
        "water instead of soda",
      ],
      likelyAvoid: ["extra cheese", "large portions", "stuffed crust", "sugary drinks"],
      note: "Focus on thin crust with vegetable toppings and portion control.",
    },
    {
      match: /\bkfc\b/,
      label: "fried_chicken_chain",
      likelySafe: [
        "grilled chicken if available, otherwise skinless pieces in small portions",
        "coleslaw or green beans if available",
        "water instead of soda",
      ],
      likelyAvoid: ["fried chicken bucket or large portions", "biscuits", "sugary drinks", "creamy sauces"],
      note: "If grilled is unavailable, recommend smaller portions with vegetable sides.",
    },
    {
      match: /chicken republic|mr bigg|tastee|tantalizer|sweet sensation/,
      label: "nigerian_fast_food_chain",
      likelySafe: [
        "jollof rice with grilled or rotisserie chicken in moderate portions",
        "fried rice with vegetable sides",
        "moi moi",
        "coleslaw",
        "water or zobo without added sugar",
      ],
      likelyAvoid: ["fried chicken", "large rice portions", "meat pie", "sugary drinks"],
      note: "These chains often have rice-based meals; prioritize grilled protein and moderate portions.",
    },
    {
      match: /shawarma|pizzadey|wrap/,
      label: "shawarma_pizza_spot",
      likelySafe: [
        "chicken shawarma with extra vegetables and light sauce",
        "vegetable or chicken pizza in moderate portions",
        "grilled chicken if available",
        "water instead of soda",
      ],
      likelyAvoid: ["extra mayonnaise or creamy sauces", "extra cheese", "large portions", "fries combo"],
      note: "Shawarma and pizza can work with sauce/portion modifications.",
    },
  ];

  const matched = profiles.find((profile) => profile.match.test(name));
  if (matched) return matched;

  if (archetype === "shawarma_pizza" || archetype === "pizza_canada") {
    return profiles[3];
  }
  if (archetype === "fast_food_western" || archetype === "canadian_fast_food") {
    return {
      label: "generic_fast_food",
      likelySafe: ["smaller portions with vegetable sides", "water instead of soda"],
      likelyAvoid: ["large fried sides", "sugary drinks", "extra sauces"],
      note: "Use realistic fast-food modifications instead of generic recommendations.",
    };
  }
  if (archetype === "local_canteen") {
    return {
      label: "nigerian_local",
      likelySafe: ["vegetable soup with whole grain swallow", "beans porridge", "boiled or grilled proteins"],
      likelyAvoid: ["excessive oil in soups", "refined swallows like eba or semovita", "fried proteins"],
      note: "Local canteens often offer traditional Nigerian dishes; prioritize whole grains and boiled/grilled preparations.",
    };
  }

  return null;
}

function buildBrandGuidanceBlock(restaurantName, archetype) {
  const profile = getBrandGuidance(restaurantName, archetype);
  if (!profile) return "";

  return `BRAND / VENUE REALISM GUIDANCE:
Detected profile: ${profile.label}
Likely safer options to consider: ${profile.likelySafe.join(", ")}
Likely items to limit or avoid: ${profile.likelyAvoid.join(", ")}
Venue note: ${profile.note}
Use this guidance to keep recommendations realistic for the restaurant brand/type.`;
}

/**
 * Takes the raw model recommendations and asks Groq to:
 *   1. Filter against the user's full clinical profile (all conditions + restrictions)
 *   2. Produce 3-5 "safe to order" dishes with plain-language reasoning
 *   3. Produce 2-3 "avoid" flags specific to this restaurant type
 *   4. Give 1 practical ordering tip for this venue type in Nigeria
 *
 * Returns a structured object the Flutter app can render directly.
 */
async function explainWithGroq(restaurantName, archetype, modelRecs, userProfile, contractData = null) {
  contractData = contractData || await loadActiveContract(userProfile);
  const nutritionBlock = buildNutritionPromptBlock(contractData, userProfile);
  const archetypeDesc = ARCHETYPES[archetype];
  const conditions = contractData.normalizedConditions.join(", ") || "none";
  const restrictions = (userProfile?.restrictions || []).join(", ") || "none";
  const allergies = (userProfile?.allergies || []).join(", ") || "none";
  const age = userProfile?.age;
  const activityLevel = userProfile?.activityLevel;
  const gender = userProfile?.gender;
  
  const hasActiveHealthFilters =
    contractData.normalizedConditions.length > 0 ||
    (userProfile?.restrictions || []).length > 0 ||
    (userProfile?.allergies || []).length > 0;
  const countryLabel = USER_COUNTRY === "CA" ? "Canadian" : "Nigerian";
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
    .slice(0, 15)
    .map((r, i) => `${i + 1}. ${r.dish_name} (similarity: ${(r.similarity_score || 0).toFixed(2)}, health_label: ${r.health_label || "unknown"})`)
    .join("\n");

  // Build demographic context
  let demographicContext = "";
  if (age || activityLevel || gender) {
    demographicContext += "\n\nUSER DEMOGRAPHICS:";
    if (age) {
      demographicContext += `\n- Age: ${age} years`;
      if (age < 30) {
        demographicContext += " (young adult - may need adequate energy if active, but still follow all active health restrictions)";
      } else if (age >= 30 && age < 50) {
        demographicContext += " (adult - moderate energy needs, watch portion sizes)";
      } else if (age >= 50 && age < 65) {
        demographicContext += " (middle-aged - lower energy needs, prioritize nutrient density, smaller portions)";
      } else {
        demographicContext += " (senior - lower energy needs, prioritize easy-to-digest foods, smaller portions, adequate protein to prevent muscle loss)";
      }
    }
    if (gender) demographicContext += `\n- Gender: ${gender}`;
    if (activityLevel) {
      demographicContext += `\n- Activity Level: ${activityLevel}`;
      if (activityLevel.toLowerCase().includes("sedentary") || activityLevel.toLowerCase().includes("low")) {
        demographicContext += " (minimal activity - reduce portion sizes, limit carbs)";
      } else if (activityLevel.toLowerCase().includes("moderate")) {
        demographicContext += " (moderate activity - standard portions acceptable)";
      } else if (activityLevel.toLowerCase().includes("active") || activityLevel.toLowerCase().includes("high")) {
        demographicContext += " (highly active - may need adequate energy and protein, while still respecting active health conditions)";
      }
    }
  }

  const prompt = `You are a ${countryLabel} clinical nutrition advisor. A user is at a restaurant and needs safe meal guidance.

Restaurant: "${restaurantName}"
Type: ${archetypeDesc}
Country context: ${USER_COUNTRY}

User Profile:
- Conditions: ${conditions}
- Restrictions: ${restrictions}
- Allergies: ${allergies}${demographicContext}

${nutritionBlock}

${buildBrandGuidanceBlock(restaurantName, archetype)}

The following dishes were ranked by our AI recommendation model for this restaurant type:
${recList || "(no model recommendations available)"}

TASK:
1. Filter the model recommendations against the user's profile.
2. If a model recommendation violates a restriction (e.g., "low sugar" vs "Caramelized Coconut"), you MUST DISCARD it.
3. Select 3-5 "safeOrders".
4. Identify 2-3 "avoid" items.

**CRITICAL: ADJUST RECOMMENDATIONS BASED ON USER DEMOGRAPHICS:**
${age || activityLevel ? "- Demographics may adjust portion and practical advice, but must never override medical conditions, allergies, restrictions, or doctor/nutritionist instructions." : ""}
${age && age >= 65 ? `- User is an older adult (${age} years): Prioritize nutrient-dense foods, moderate portions, and adequate protein. Avoid heavy portions when safer alternatives exist.` : ""}
${age && age < 30 && activityLevel && activityLevel.toLowerCase().includes("active") ? `- User is young and active (${age} years, ${activityLevel}): Prioritize adequate protein and balanced energy, while still respecting all active health restrictions.` : ""}
${age && age >= 50 && activityLevel && activityLevel.toLowerCase().includes("sedentary") ? `- User is older and sedentary (${age} years, ${activityLevel}): Recommend smaller portions, nutrient-dense foods, limit heavy starches.` : ""}

Return a JSON object:
{
  "safeOrders": [
    { "dish": "dish name", "reason": "one sentence why it is safe", "source": "model|ai_knowledge" }
  ],
  "avoid": [
    { "item": "dish or category", "reason": "one sentence why to avoid" }
  ],
  "tip": "one practical ordering tip",
  "confidenceNote": "short note if confidence is low, else null"
}

CRITICAL RULES:
- NEVER suggest a dish that violates "USER DIETARY RESTRICTIONS" or "AVOID" lists in the nutrition contract.
- Allergies are hard exclusions. Never recommend dishes containing listed allergens.
- If the model list contains high-sugar or fried items and the user is on "weight_loss" or "low sugar", move those items to the "avoid" list instead.
- Active health filters present: ${hasActiveHealthFilters ? "yes" : "no"}.
- If active health filters are "no", do NOT behave like a strict therapeutic diet. Recommend balanced, realistic restaurant choices with portion/sauce modifications.
- If active health filters are "no", pizza, shawarma, rice, and swallow dishes are not automatically avoid items. They can be safeOrders when portion size is moderate and vegetables/lean protein are included.
- Treat health_label="Limit" as "limit portion or modify" when there are no active health filters. Only move it to avoid if it is clearly excessive for this venue or conflicts with active conditions/restrictions.
- source: "model" ONLY if the dish is in the ranked list above AND you kept it.
- tip: must be specific to ${contextTip}.
- Return ONLY the JSON object.`;

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
async function groqWithRetry(url, options, maxRetries = parseInt(process.env.GROQ_MAX_RETRIES || "3", 10)) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(GROQ_TIMEOUT_MS),
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const baseWait = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.pow(2, attempt + 3) * 1000; // 8s, 16s, 32s...
        const jitter = baseWait * 0.2 * (Math.random() * 2 - 1);
        const wait = Math.max(1000, Math.round(baseWait + jitter));
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : null;

        if (wait > GROQ_MAX_RETRY_WAIT_MS) {
          throw new Error(
            `Groq rate limit 429: retry-after=${retryAfterSeconds ?? "not provided"}s exceeds max local wait ` +
            `${Math.round(GROQ_MAX_RETRY_WAIT_MS / 1000)}s`
          );
        }

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
      if (/Groq rate limit 429: .*exceeds max local wait/i.test(err.message || "")) {
        throw err;
      }
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      if (attempt < maxRetries) {
        const wait = Math.pow(2, attempt + 3) * 1000;
        console.warn(`  ⏳ Groq ${isTimeout ? "timeout" : "network error"} (${err.message}) — retrying in ${wait / 1000}s...`);
        await sleep(wait);
      }
    }
  }

  const timedOut = lastError?.name === "TimeoutError" || lastError?.name === "AbortError";
  throw new Error(
    timedOut
      ? `Groq request timed out after ${GROQ_TIMEOUT_MS}ms while calling ${url}`
      : `Groq fetch failed for ${url}: ${lastError?.message || "request failed after max retries"}`
  );
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
    website:       place.website       ?? null,
    hasOnlineMenu: Boolean(place.website),
    onlineMenuUrl: place.website       ?? null,
    googleMapsUrl: place.url           ?? null,
    menuEnrichment: {
      attempted: false,
      onlineMenuUrl: place.website ?? null,
      source: place.website ? "website_available" : null,
      note: place.website
        ? "Official website is available for future menu extraction, but menu enrichment is not enabled yet."
        : "No official website returned by Places Details.",
    },
  };
}

function confidenceGuidance(overall) {
  if (overall >= 0.75) {
    return {
      label: "high",
      display: "High guidance",
      explanation: "Recommendation is strongly supported by venue type, model output, and active nutrition contract.",
    };
  }
  if (overall >= 0.55) {
    return {
      label: "medium",
      display: "Medium guidance",
      explanation: "Recommendation is usable, but at least one signal is limited, usually no verified menu or only partial model support.",
    };
  }
  return {
    label: "estimated",
    display: "Estimated guidance",
    explanation: "Recommendation is estimated from restaurant type or general food-guide knowledge because menu/model evidence is weak.",
  };
}

function buildConfidence({ archetype, modelUsed, userContractUsed, menuAvailable }) {
  const unknown = archetype === COUNTRY_PACK.unknownArchetype || archetype === "unknown" || archetype === "unknown_canada";
  const venueArchetype = unknown ? 0.35 : 0.8;
  const menuAvailability = menuAvailable ? 0.45 : 0.15;
  const modelScore = modelUsed ? 0.85 : 0.45;
  const contractScore = userContractUsed ? 0.95 : 0.75;
  const overall = Number(((venueArchetype * 0.3) + (menuAvailability * 0.2) + (modelScore * 0.25) + (contractScore * 0.25)).toFixed(2));
  const guidance = confidenceGuidance(overall);

  return {
    overall,
    label: guidance.label,
    display: guidance.display,
    explanation: guidance.explanation,
    venueArchetype,
    menuAvailability,
    modelUsed,
    contractUsed: true,
    userContractUsed,
    menuEnrichmentUsed: false,
  };
}

function makeUnknownAdviceSafer(advice, archetype) {
  const unknown = archetype === COUNTRY_PACK.unknownArchetype || archetype === "unknown" || archetype === "unknown_canada";
  if (!unknown) return advice;

  return {
    ...advice,
    safeOrders: (advice.safeOrders || []).map((item) => ({
      ...item,
      dish: /^ask if available:/i.test(item.dish || "") ? item.dish : `Ask if available: ${item.dish}`,
    })),
    confidenceNote:
      advice.confidenceNote ||
      "No menu was available and venue type is uncertain. These are general healthy options to ask for, not confirmed menu items.",
  };
}

function fallbackSafeOrders(archetype) {
  // Only use fallbacks when absolutely necessary - LLM should provide recommendations
  // Fallbacks are now more diverse and archetype-specific
  const nigerianLocalFallback = [
    { dish: "Ask if available: vegetable soup with whole grain swallow", reason: "It provides vegetables and fibre when prepared with minimal oil.", source: "ai_knowledge" },
    { dish: "Ask if available: beans porridge", reason: "It is a high-fibre, plant-based protein option aligned with FBDG guidance.", source: "ai_knowledge" },
    { dish: "Ask if available: water or zobo without added sugar", reason: "It avoids sugary drinks and supports the active nutrition guidance.", source: "ai_knowledge" },
  ];

  const fastFoodFallback = USER_COUNTRY === "CA"
    ? [
        { dish: "Ask if available: side salad with dressing on the side", reason: "It increases vegetable intake and helps control sodium and fat from sauces.", source: "ai_knowledge" },
        { dish: "Ask if available: grilled protein if offered", reason: "It is a leaner cooking method than fried options when available.", source: "ai_knowledge" },
        { dish: "Ask if available: water or unsweetened tea", reason: "It avoids sugary drinks and aligns with nutrition guidance.", source: "ai_knowledge" },
      ]
    : [
        { dish: "Ask if available: coleslaw or vegetable side", reason: "It adds vegetables while avoiding fried sides.", source: "ai_knowledge" },
        { dish: "Ask if available: smaller portion of main item", reason: "It helps control carbohydrate and calorie intake.", source: "ai_knowledge" },
        { dish: "Ask if available: water instead of soft drinks", reason: "It avoids added sugar and supports the active nutrition guidance.", source: "ai_knowledge" },
      ];

  if (archetype === "fast_food_western" || archetype === "canadian_fast_food" || archetype === "fast_food_nigerian") {
    return fastFoodFallback;
  }
  
  if (archetype === "local_canteen" || archetype === "unknown") {
    return nigerianLocalFallback;
  }
  
  if (archetype === "suya_grill") {
    return [
      { dish: "Ask if available: grilled protein with minimal sauce", reason: "It reduces added oil and sodium when sauce is served on the side.", source: "ai_knowledge" },
      { dish: "Ask if available: yaji spice on the side", reason: "It allows control over sodium and spice level.", source: "ai_knowledge" },
      { dish: "Ask if available: water or fresh juice", reason: "It supports hydration without added sugar.", source: "ai_knowledge" },
    ];
  }

  return USER_COUNTRY === "CA" ? fastFoodFallback : nigerianLocalFallback;
}

function normaliseAdviceShape(advice, archetype) {
  const safeOrders = Array.isArray(advice.safeOrders) ? advice.safeOrders : [];
  const avoid = Array.isArray(advice.avoid) ? advice.avoid : [];
  const existing = new Set(safeOrders.map((item) => String(item.dish || "").toLowerCase()));

  // Only add fallbacks if LLM returned absolutely nothing (< 2 items)
  // This prevents overriding LLM's specific recommendations
  if (safeOrders.length < 2) {
    for (const item of fallbackSafeOrders(archetype)) {
      if (safeOrders.length >= 3) break;
      const key = String(item.dish || "").toLowerCase();
      if (!existing.has(key)) {
        safeOrders.push(item);
        existing.add(key);
      }
    }
  }

  return {
    ...advice,
    safeOrders: safeOrders.slice(0, 5),
    avoid: avoid.slice(0, 3),
  };
}

// ─── Health the model server before starting ──────────────────────────────────

async function checkModelServer() {
  try {
    const res = await fetch(`${MODEL_API_URL}/health`, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
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
  console.log(`   Mode       : ${ENABLE_BATCH_MODE ? "BATCH (2 LLM calls total)" : "SEQUENTIAL (2N LLM calls)"}`);
  console.log(`   Model API  : ${MODEL_API_URL}`);
  console.log(`   Country    : ${USER_COUNTRY}`);
  console.log(`   Location   : ${USER_LAT}, ${USER_LNG}  radius ${SEARCH_RADIUS}m`);
  console.log(`   Profile    : conditions=[${USER_PROFILE.conditions}]  restrictions=[${USER_PROFILE.restrictions}]`);
  console.log("══════════════════════════════════════════════════════\n");

  // Initialize Gemini LLM
  const llmManager = new LLMProviderManager({
    geminiKey: GEMINI_API_KEY,
    geminiModel: GEMINI_MODEL,
    timeout: LLM_TIMEOUT_MS,
    enableGoogleSearch: ENABLE_GEMINI_SEARCH,
  });
  console.log();

  // ── Step 0: Health-check model server ──
  console.log("🔌 Step 0: Checking model server…");
  const modelServerUp = await checkModelServer();
  const activeContractData = await loadActiveContract(USER_PROFILE);
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

  // ── Step 2: Fetch details for all restaurants ──
  console.log("🔍 Step 2: Fetching place details for all restaurants…\n");
  
  const placeDetailsMap = new Map();
  for (let i = 0; i < placesToProcess.length; i++) {
    const basicPlace = placesToProcess[i];
    console.log(`[${i + 1}/${placesToProcess.length}] ${basicPlace.name}`);
    try {
      const details = await getPlaceDetails(basicPlace.place_id);
      const coords = resolveVenueCoordinates(details, basicPlace);
      placeDetailsMap.set(basicPlace.place_id, { details, coords, basicPlace });
      await sleep(150);
    } catch (e) {
      console.warn(`  ❌ Failed to fetch details: ${e.message}`);
    }
  }
  
  console.log(`\n✅ Fetched details for ${placeDetailsMap.size}/${placesToProcess.length} restaurants\n`);

  if (placeDetailsMap.size === 0) {
    throw new Error("No restaurant details could be fetched");
  }

  // ── Step 3: Batch classify restaurants (1 LLM call) ──
  console.log("🏷️  Step 3: Batch classifying restaurant archetypes…\n");
  
  // Pattern-match what we can, collect rest for LLM
  const archetypeMap = new Map();
  const needsLLMClassification = [];
  
  for (const [placeId, data] of placeDetailsMap) {
    const patternResult = classifyByPattern(data.details.name, data.details.types, USER_COUNTRY);
    if (patternResult) {
      archetypeMap.set(placeId, patternResult);
      console.log(`  ✓ ${data.details.name}: ${patternResult} (pattern)`);
    } else {
      needsLLMClassification.push({
        place_id: placeId,
        name: data.details.name,
        address: data.details.formatted_address,
        types: data.details.types,
        editorial: data.details.editorial_summary?.overview,
      });
    }
  }
  
  if (needsLLMClassification.length > 0 && SKIP_LLM_CLASSIFY) {
    console.log(`\n  ↪ ${needsLLMClassification.length} ambiguous restaurants set to ${COUNTRY_PACK.unknownArchetype} (SKIP_LLM_CLASSIFY=1)`);
    for (const restaurant of needsLLMClassification) {
      archetypeMap.set(restaurant.place_id, COUNTRY_PACK.unknownArchetype);
    }
  } else if (needsLLMClassification.length > 0 && ENABLE_BATCH_MODE) {
    console.log(`\n  🤖 Batch classifying ${needsLLMClassification.length} ambiguous restaurants via LLM…`);
    const batchClassifications = await batchClassifyRestaurants(
      llmManager,
      needsLLMClassification,
      ARCHETYPES,
      COUNTRY_PACK.countryLabel,
      COUNTRY_PACK.unknownArchetype
    );
    for (const [placeId, archetype] of batchClassifications) {
      archetypeMap.set(placeId, archetype);
      const data = placeDetailsMap.get(placeId);
      console.log(`  ✓ ${data.details.name}: ${archetype} (llm)`);
    }
  } else if (needsLLMClassification.length > 0) {
    // Fallback to unknown if batch mode disabled
    for (const restaurant of needsLLMClassification) {
      archetypeMap.set(restaurant.place_id, COUNTRY_PACK.unknownArchetype);
    }
  }

  // ── Step 4: Generate seeds and get model recommendations ──
  console.log("\n🌱 Step 4: Generating seeds and fetching model recommendations…\n");
  
  const restaurantData = [];
  const unknownRestaurants = []; // Collect ALL unknown archetypes for AI seed generation
  
  for (const [placeId, data] of placeDetailsMap) {
    const archetype = archetypeMap.get(placeId) || COUNTRY_PACK.unknownArchetype;
    
    const seedInfo = generateRestaurantSeeds({
      place: data.details,
      archetype,
      country: USER_COUNTRY,
      maxTerms: 10,
    });
    
    // If archetype is unknown, ALWAYS mark for AI enhancement
    const isUnknown = archetype === COUNTRY_PACK.unknownArchetype || archetype === "unknown";
    if (isUnknown) {
      unknownRestaurants.push({
        placeId,
        name: data.details.name,
        types: data.details.types,
        editorial: data.details.editorial_summary?.overview,
        seedInfo,
      });
    }
    
    console.log(`[${data.details.name}]`);
    console.log(`  🏷️  ${archetype}`);
    console.log(`  🌱 Seeds: ${seedInfo.seedSource} (conf: ${seedInfo.seedConfidence.toFixed(2)}, ${seedInfo.seedTerms.length} terms)`);
    
    let modelRecs = [];
    if (modelServerUp && !shouldSkipModelForArchetype(archetype)) {
      try {
        modelRecs = await getModelRecommendations(seedInfo.seedTerms, USER_PROFILE.conditions || []);
        modelRecs = filterModelRecommendationsForArchetype(archetype, modelRecs);
        console.log(`  🤖 Model: ${modelRecs.length} dishes`);
      } catch (e) {
        console.warn(`  ⚠️  Model error: ${e.message}`);
      }
    }
    
    restaurantData.push({
      place_id: placeId,
      name: data.details.name,
      archetype,
      details: data.details,
      coords: data.coords,
      seedInfo,
      modelRecs: modelRecs.slice(0, 15),
    });
  }
  
  // AI-enhance seeds for ALL unknown restaurants in ONE batch call
  if (unknownRestaurants.length > 0) {
    console.log(`\n  🧠 Enhancing ${unknownRestaurants.length} unknown restaurant(s) with AI seed generation…`);
    try {
      const aiSeeds = await generateAISeedsForUnknown(llmManager, unknownRestaurants, USER_COUNTRY);
      // Update seedInfo for restaurants that got AI-enhanced seeds
      for (const [placeId, enhancedSeeds] of aiSeeds) {
        const restaurant = restaurantData.find(r => r.place_id === placeId);
        if (restaurant && enhancedSeeds.length > 0) {
          // Replace existing seeds with AI seeds (they're more venue-specific)
          restaurant.seedInfo.seedTerms = enhancedSeeds.slice(0, 10);
          restaurant.seedInfo.seedSource = "ai_inference";
          restaurant.seedInfo.seedConfidence = 0.75;
          console.log(`  ✓ ${restaurant.name}: ${enhancedSeeds.length} AI-inferred seeds`);
          
          // Re-run model with AI seeds if model server is up
          if (modelServerUp && !shouldSkipModelForArchetype(restaurant.archetype)) {
            try {
              const newRecs = await getModelRecommendations(enhancedSeeds.slice(0, 10), USER_PROFILE.conditions || []);
              restaurant.modelRecs = filterModelRecommendationsForArchetype(restaurant.archetype, newRecs).slice(0, 15);
              console.log(`    → Model re-run: ${restaurant.modelRecs.length} dishes`);
            } catch (e) {
              // Keep original model recs if enhancement fails
            }
          }
        }
      }
    } catch (e) {
      console.warn(`  ⚠️  AI seed generation failed: ${e.message}`);
    }
  }

  // ── Step 5: Batch explain recommendations (1 LLM call) ──
  console.log("\n💬 Step 5: Batch generating nutrition advice for all restaurants…\n");
  
  const nutritionBlock = buildNutritionPromptBlock(activeContractData, USER_PROFILE);
  const countryLabel = USER_COUNTRY === "CA" ? "Canadian" : "Nigerian";
  const contextTip = USER_COUNTRY === "CA"
    ? "Canadian context (e.g. sauces/dressings/gravy on the side, water instead of pop, grilled/baked instead of fried, salad/vegetables instead of fries or poutine)"
    : "Nigerian context (e.g. ask for soup without stock cubes, choose grilled/boiled instead of fried)";
  
  let adviceMap = new Map();
  if (ENABLE_BATCH_MODE) {
    adviceMap = await batchExplainRecommendations(
      llmManager,
      restaurantData,
      USER_PROFILE,
      nutritionBlock,
      ARCHETYPES,
      buildBrandGuidanceBlock,
      countryLabel,
      contextTip,
      { enableGoogleSearch: ENABLE_GEMINI_SEARCH }
    );
  } else {
    // Sequential Gemini fallback: keep one LLM call per restaurant without using
    // the removed Groq-specific explainer path.
    for (const restaurant of restaurantData) {
      const singleAdvice = await batchExplainRecommendations(
        llmManager,
        [restaurant],
        USER_PROFILE,
        nutritionBlock,
        ARCHETYPES,
        buildBrandGuidanceBlock,
        countryLabel,
        contextTip,
        { enableGoogleSearch: ENABLE_GEMINI_SEARCH }
      );
      adviceMap.set(
        restaurant.place_id,
        singleAdvice.get(restaurant.place_id) || {
          safeOrders: [],
          avoid: [],
          tip: null,
          confidenceNote: "Could not generate structured advice for this venue.",
        }
      );
    }
  }

  // ── Step 6: Build final output ──
  console.log("\n📦 Step 6: Building final recommendation output…\n");
  
  const venues = [];
  const recommendations = {};
  let successCount = 0;
  const failures = [];
  
  for (const restaurant of restaurantData) {
    try {
      let advice = adviceMap.get(restaurant.place_id) || {
        safeOrders: [],
        avoid: [],
        tip: null,
        confidenceNote: "Could not generate advice for this venue.",
      };
      
      advice = normaliseAdviceShape(advice, restaurant.archetype);
      advice = makeUnknownAdviceSafer(advice, restaurant.archetype);
      
      venues.push(buildVenueObject(restaurant.details, restaurant.archetype, restaurant.coords, restaurant.coords.coordSource));
      
      const inferredConfidenceNote =
        restaurant.archetype === "unknown" || restaurant.archetype === "unknown_canada"
          ? `Low confidence: venue archetype is unknown, so recommendations use generic ${USER_COUNTRY === "CA" ? "Canadian" : "Nigerian"} restaurant guidance.`
          : null;
      
      recommendations[restaurant.place_id] = {
        modelRecommendations: restaurant.modelRecs.map(r => ({
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
        confidence: buildConfidence({
          archetype: restaurant.archetype,
          modelUsed: modelServerUp && restaurant.modelRecs.length > 0,
          userContractUsed: activeContractData.userContractUsed,
          menuAvailable: Boolean(restaurant.details.website),
        }),
        seed: {
          source: restaurant.seedInfo.seedSource,
          confidence: restaurant.seedInfo.seedConfidence,
          terms: restaurant.seedInfo.seedTerms,
          evidence: restaurant.seedInfo.evidence.map((item) => ({
            source: item.source,
            confidence: item.confidence,
            terms: item.terms,
            reason: item.reason,
          })),
        },
        modelServerUsed: modelServerUp,
        archetype: restaurant.archetype,
      };
      
      successCount++;
    } catch (e) {
      failures.push({
        venue: restaurant.name,
        placeId: restaurant.place_id,
        error: e.message,
      });
    }
  }
  
  const failCount = failures.length;

  // ── Step 3: Write output ──
  console.log("══════════════════════════════════════════════════════");
  console.log(`✅ Success: ${successCount}   ❌ Failed/skipped: ${failCount}`);
  console.log(`📦 ${venues.length} venues with recommendations`);
  console.log("\n📝 Writing output…");

  if (successCount === 0 && failCount > 0) {
    const lastFailure = failures[failures.length - 1];
    throw new Error(
      `Recommendation pipeline failed for all ${failCount} venues. ` +
      `Last failure at "${lastFailure?.venue || "unknown venue"}": ${lastFailure?.error || "unknown error"}`
    );
  }

  const llmStats = llmManager.getStats();
  console.log(`\n📊 LLM Provider: ${llmStats.provider.id} (${llmStats.totalCalls} calls, ${llmStats.provider.health.status})`);

  const output = {
    _meta: {
      generatedAt:     new Date().toISOString(),
      pipelineVersion: "3.0.0-batch",
      source:          "Google Maps Places API + Nutrifence joblib models + Multi-Provider LLM",
      country:         USER_COUNTRY,
      apiVersion:      "1.2",
      contractSource:  activeContractData.contractSource,
      contractStore:   contractStoreInfo(),
      modelFamily:     USER_COUNTRY === "CA" ? "canada_cnf_2026_model" : COUNTRY_PACK.modelMode,
      userId:          USER_ID || null,
      userLocation:    { lat: USER_LAT, lng: USER_LNG, radiusMetres: SEARCH_RADIUS },
      userProfile:     USER_PROFILE,
      venueCount:      venues.length,
      failures,
      modelServerUsed: modelServerUp,
      batchMode:       ENABLE_BATCH_MODE,
      geminiSearchEnabled: ENABLE_GEMINI_SEARCH,
      groundingMetadata: adviceMap.groundingMetadata || null,
      llmStats:        llmStats,
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


