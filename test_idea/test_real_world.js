#!/usr/bin/env node

/**
 * REAL WORLD TEST - Full Batch with Google Places API
 * Fetches actual restaurants from Google Places and processes with 2 LLM calls
 */

import fs from "fs";
import path from "path";
import dns from "dns";
import { fileURLToPath } from "url";
import { LLMProviderManager } from "./llm_provider_manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dns.setDefaultResultOrder("ipv4first");

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", "scraper", ".env");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env file not found at:", envPath);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || rest.length === 0) continue;
    if (!(key.trim() in process.env)) {
      process.env[key.trim()] = rest.join("=").trim();
    }
  }
}

loadDotEnv();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "YOUR_KEY_HERE") {
  console.error("❌ GOOGLE_MAPS_API_KEY not set in scraper/.env");
  process.exit(1);
}

if (!GROQ_API_KEY || GROQ_API_KEY === "YOUR_KEY_HERE") {
  console.error("❌ GROQ_API_KEY not set in scraper/.env");
  process.exit(1);
}

// Test location: Lagos, Nigeria (Victoria Island)
const TEST_LAT = 6.4281; // Victoria Island, Lagos
const TEST_LNG = 3.4219;
const SEARCH_RADIUS = 2000; // 2km radius
const MAX_RESTAURANTS = 15;

// Nigerian archetypes
const NIGERIAN_ARCHETYPES = [
  "casual_nigerian",
  "fast_food_nigerian",
  "fast_food_western",
  "fine_dining",
  "modern_fusion",
  "shawarma_pizza",
  "street_food",
  "bukka",
  "hotel_restaurant",
  "unknown",
];

// User profile for testing
const TEST_USER_PROFILE = {
  conditions: ["diabetes"],
  restrictions: ["low sugar"],
  allergies: ["peanuts"],
  age: 45,
  activityLevel: "moderate",
  gender: "male",
};

// Fetch restaurants from Google Places
async function fetchNearbyRestaurants(lat, lng, radius) {
  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${lat},${lng}` +
    `&radius=${radius}` +
    `&type=restaurant` +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  console.log(`📍 Fetching restaurants within ${radius}m of (${lat}, ${lng})...`);

  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const data = await response.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places API error: ${data.status} - ${data.error_message || ""}`);
  }

  const restaurants = (data.results || []).slice(0, MAX_RESTAURANTS).map((place) => ({
    place_id: place.place_id,
    name: place.name,
    types: place.types || [],
    vicinity: place.vicinity || "",
    rating: place.rating || null,
    user_ratings_total: place.user_ratings_total || null,
  }));

  console.log(`✅ Found ${restaurants.length} restaurants\n`);
  return restaurants;
}

// STEP 1: Classify ALL restaurants in a single LLM call
async function classifyAllRestaurants(restaurants, llmManager) {
  const restaurantList = restaurants
    .map((r, i) => `${i + 1}. ${r.name} (types: ${r.types.slice(0, 3).join(", ")})`)
    .join("\n");

  const prompt = `You are classifying Nigerian restaurants into archetypes.

Restaurants:
${restaurantList}

Valid archetypes:
${NIGERIAN_ARCHETYPES.join(", ")}

Return ONLY a JSON array with archetype for each restaurant:
[
  {"name": "Restaurant Name", "archetype": "archetype_key"},
  ...
]

No markdown, just the JSON array.`;

  console.log(`🏷️  STEP 1: Classifying ${restaurants.length} restaurants (1 LLM call)...`);
  const startTime = Date.now();

  const result = await llmManager.chat([{ role: "user", content: prompt }], {
    temperature: 0,
    maxTokens: 1000,
  });

  const duration = Date.now() - startTime;
  const cleaned = result.content.replace(/```json|```/g, "").trim();
  
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.log(`   ⚠️  JSON parse failed, attempting repair...`);
    const repairResult = await llmManager.chat(
      [
        {
          role: "system",
          content: "You fix malformed JSON. Return ONLY the corrected JSON array, nothing else.",
        },
        {
          role: "user",
          content: `Fix this JSON and return it clean:\n\n${cleaned.slice(0, 4000)}`,
        },
      ],
      { temperature: 0, maxTokens: 1500 }
    );
    const repairedCleaned = repairResult.content.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(repairedCleaned);
    console.log(`   ✅ JSON repaired successfully`);
  }

  console.log(`   ✅ Complete in ${(duration / 1000).toFixed(2)}s (via ${result.provider})`);
  console.log(`   📊 Archetypes: ${parsed.map((c) => c.archetype).join(", ")}\n`);

  return {
    classifications: parsed,
    provider: result.provider,
    duration,
  };
}

// STEP 2: Generate mock model recommendations
function generateMockModelRecs(archetype) {
  const mockRecs = {
    casual_nigerian: ["Jollof Rice with Grilled Chicken", "Moi Moi", "Efo Riro with Fish"],
    fast_food_nigerian: ["Grilled Chicken with Rice", "Moi Moi", "Coleslaw"],
    fast_food_western: ["Grilled Chicken", "Side Salad", "Water"],
    fine_dining: ["Grilled Fish", "Steamed Vegetables", "Brown Rice"],
    modern_fusion: ["Grilled Chicken Salad", "Quinoa Bowl", "Fresh Juice"],
    shawarma_pizza: ["Chicken Shawarma (light sauce)", "Vegetable Pizza", "Water"],
    hotel_restaurant: ["Grilled Fish", "Garden Salad", "Herbal Tea"],
    bukka: ["Ewa Agoyin with Plantain", "White Rice with Vegetable Soup", "Water"],
    street_food: ["Suya (small portion)", "Roasted Plantain", "Water"],
    unknown: ["Grilled Fish", "Steamed Vegetables", "Water"],
  };
  return mockRecs[archetype] || mockRecs.unknown;
}

// STEP 3: Explain ALL restaurants in a single LLM call
async function explainAllRestaurants(restaurants, classifications, llmManager) {
  const restaurantData = restaurants
    .map((r, i) => {
      const classification = classifications.find((c) => c.name === r.name);
      const archetype = classification?.archetype || "unknown";
      const modelRecs = generateMockModelRecs(archetype);
      return (
        `${i + 1}. ${r.name} (${archetype}, ${r.vicinity})\n` +
        `   Rating: ${r.rating || "N/A"} (${r.user_ratings_total || 0} reviews)\n` +
        `   Model recommendations: ${modelRecs.join(", ")}`
      );
    })
    .join("\n\n");

  const prompt = `You are a Nigerian clinical nutrition advisor.

User Profile:
- Conditions: ${TEST_USER_PROFILE.conditions.join(", ")}
- Restrictions: ${TEST_USER_PROFILE.restrictions.join(", ")}
- Allergies: ${TEST_USER_PROFILE.allergies.join(", ")}
- Age: ${TEST_USER_PROFILE.age} years
- Activity Level: ${TEST_USER_PROFILE.activityLevel}
- Gender: ${TEST_USER_PROFILE.gender}

Restaurants with model recommendations:
${restaurantData}

TASK: For EACH restaurant, provide 2-3 safe orders, 1-2 avoid items, and 1 practical tip.

Return ONLY a JSON array (no markdown):
[
  {
    "restaurant": "Restaurant Name",
    "safeOrders": [{"dish": "dish name", "reason": "why safe"}],
    "avoid": [{"item": "item name", "reason": "why avoid"}],
    "tip": "one practical ordering tip"
  },
  ...
]

No markdown, just the JSON array.`;

  console.log(`💬 STEP 3: Generating recommendations for ${restaurants.length} restaurants (1 LLM call)...`);
  const startTime = Date.now();

  const result = await llmManager.chat([{ role: "user", content: prompt }], {
    temperature: 0.1,
    maxTokens: 4000,
  });

  const duration = Date.now() - startTime;
  const cleaned = result.content.replace(/```json|```/g, "").trim();
  
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.log(`   ⚠️  JSON parse failed, attempting repair...`);
    // Try to repair JSON by asking LLM again
    const repairResult = await llmManager.chat(
      [
        {
          role: "system",
          content: "You fix malformed JSON. Return ONLY the corrected JSON array, nothing else.",
        },
        {
          role: "user",
          content: `Fix this JSON and return it clean:\n\n${cleaned.slice(0, 8000)}`,
        },
      ],
      { temperature: 0, maxTokens: 4000 }
    );
    const repairedCleaned = repairResult.content.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(repairedCleaned);
    console.log(`   ✅ JSON repaired successfully`);
  }

  console.log(`   ✅ Complete in ${(duration / 1000).toFixed(2)}s (via ${result.provider})\n`);

  return {
    recommendations: parsed,
    provider: result.provider,
    duration,
  };
}

// Main test function
async function runRealWorldTest() {
  console.log("🌍 REAL WORLD TEST - Full Batch with Google Places API\n");
  console.log("=" .repeat(70));
  console.log(`📍 Location: Victoria Island, Lagos (${TEST_LAT}, ${TEST_LNG})`);
  console.log(`🔍 Search Radius: ${SEARCH_RADIUS}m (2km)`);
  console.log(`👤 User: ${TEST_USER_PROFILE.age}yo ${TEST_USER_PROFILE.gender}, ${TEST_USER_PROFILE.conditions.join(", ")}`);
  console.log(`🎯 Strategy: 2 LLM calls total (classify + explain)`);
  console.log("=" .repeat(70));
  console.log();

  const llmManager = new LLMProviderManager({
    groqKeys: [GROQ_API_KEY],
    geminiKey: GEMINI_API_KEY,
    groqModel: "llama-3.3-70b-versatile",
    geminiModel: "gemini-2.5-flash",
    timeout: 45000,
    maxRetryWait: 15000,
  });

  const overallStart = Date.now();

  try {
    // STEP 0: Fetch restaurants from Google Places
    const restaurants = await fetchNearbyRestaurants(TEST_LAT, TEST_LNG, SEARCH_RADIUS);

    if (restaurants.length === 0) {
      console.log("⚠️  No restaurants found in this area. Try a different location.");
      return;
    }

    // STEP 1: Classify all restaurants (1 LLM call)
    const classifyResult = await classifyAllRestaurants(restaurants, llmManager);

    // STEP 2: Generate model recommendations (local, no API)
    console.log(`🤖 STEP 2: Generating model recommendations (local)...`);
    console.log(`   ✅ Complete (no API calls)\n`);

    // STEP 3: Explain all restaurants (1 LLM call)
    const explainResult = await explainAllRestaurants(
      restaurants,
      classifyResult.classifications,
      llmManager
    );

    const totalDuration = Date.now() - overallStart;

    // Display results
    console.log("=" .repeat(70));
    console.log("📊 TEST RESULTS");
    console.log("=" .repeat(70));
    console.log();

    console.log(`⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`   - Google Places fetch: ~${((totalDuration - classifyResult.duration - explainResult.duration) / 1000).toFixed(2)}s`);
    console.log(`   - LLM classification: ${(classifyResult.duration / 1000).toFixed(2)}s`);
    console.log(`   - LLM explanation: ${(explainResult.duration / 1000).toFixed(2)}s`);
    console.log();

    console.log(`🎯 Total LLM Calls: 2 (1 classify + 1 explain)`);
    console.log(`✅ Restaurants Processed: ${explainResult.recommendations.length}/${restaurants.length}`);
    console.log();

    // Provider stats
    const providerStats = llmManager.getStats();
    console.log(`🔀 Provider Distribution:`);
    providerStats.providers.forEach((p) => {
      const percentage =
        providerStats.totalCalls > 0
          ? ((p.callCount / providerStats.totalCalls) * 100).toFixed(1)
          : "0.0";
      console.log(`   ${p.id}: ${p.callCount} calls (${percentage}%) - ${p.health.status}`);
    });
    console.log();

    // Sample recommendations
    console.log(`📝 Sample Recommendations (first 3):`);
    explainResult.recommendations.slice(0, 3).forEach((rec, index) => {
      const restaurant = restaurants.find((r) => r.name === rec.restaurant);
      console.log(`\n${index + 1}. ${rec.restaurant}`);
      console.log(`   Location: ${restaurant?.vicinity || "N/A"}`);
      console.log(`   Rating: ${restaurant?.rating || "N/A"} (${restaurant?.user_ratings_total || 0} reviews)`);
      console.log(`   Safe Orders: ${rec.safeOrders?.length || 0} items`);
      if (rec.safeOrders && rec.safeOrders[0]) {
        console.log(`      → ${rec.safeOrders[0].dish}`);
        console.log(`        ${rec.safeOrders[0].reason}`);
      }
      console.log(`   Avoid: ${rec.avoid?.length || 0} items`);
      if (rec.avoid && rec.avoid[0]) {
        console.log(`      → ${rec.avoid[0].item}: ${rec.avoid[0].reason}`);
      }
      console.log(`   Tip: ${rec.tip?.slice(0, 80) || "N/A"}...`);
    });

    // Performance comparison
    console.log(`\n${"=".repeat(70)}`);
    console.log(`⚡ Performance Comparison:`);
    console.log(`   OLD (sequential): ~${restaurants.length * 2} LLM calls, ~${(restaurants.length * 6).toFixed(0)} seconds`);
    console.log(`   NEW (full batch): 2 LLM calls, ${(totalDuration / 1000).toFixed(2)} seconds`);
    console.log(`   🚀 Speed improvement: ${((restaurants.length * 6) / (totalDuration / 1000)).toFixed(1)}x faster`);
    console.log(`${"=".repeat(70)}`);

    // Save results
    const outputPath = path.join(__dirname, `real_world_test_${Date.now()}.json`);
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          testConfig: {
            location: { lat: TEST_LAT, lng: TEST_LNG },
            radius: SEARCH_RADIUS,
            maxRestaurants: MAX_RESTAURANTS,
            userProfile: TEST_USER_PROFILE,
          },
          totalDuration,
          llmCalls: 2,
          providerStats,
          restaurants: restaurants.map((r, i) => ({
            ...r,
            archetype: classifyResult.classifications[i]?.archetype,
          })),
          recommendations: explainResult.recommendations,
        },
        null,
        2
      )
    );
    console.log(`\n💾 Detailed results saved to: ${path.basename(outputPath)}`);
    console.log(`\n✅ REAL WORLD TEST COMPLETED SUCCESSFULLY\n`);
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runRealWorldTest().catch((err) => {
  console.error("💥 Fatal error:", err.message);
  process.exit(1);
});
