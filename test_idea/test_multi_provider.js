#!/usr/bin/env node

/**
 * Test Script for FULL BATCH Multi-Provider LLM Architecture
 * Classifies ALL restaurants in 1 call, explains ALL in 1 call
 * Realistic: 10-20 restaurants per 3km geofence
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LLMProviderManager } from "./llm_provider_manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from parent scraper directory
function loadDotEnv() {
  const envPath = path.join(__dirname, "..", "scraper", ".env");
  if (!fs.existsSync(envPath)) {
    console.warn("⚠️  No .env file found in scraper directory");
    return;
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

// Mock restaurant data (simulating Google Places results in 3km radius)
const MOCK_RESTAURANTS = [
  { place_id: "place_1", name: "Mama Put Kitchen", types: ["restaurant", "food"], location: "Lagos" },
  { place_id: "place_2", name: "KFC Ikeja", types: ["restaurant", "fast_food"], location: "Lagos" },
  { place_id: "place_3", name: "Chicken Republic", types: ["restaurant", "meal_takeaway"], location: "Lagos" },
  { place_id: "place_4", name: "Bukka Hut", types: ["restaurant", "food"], location: "Lagos" },
  { place_id: "place_5", name: "Dominos Pizza", types: ["restaurant", "meal_delivery"], location: "Lagos" },
  { place_id: "place_6", name: "Mr Biggs", types: ["restaurant", "fast_food"], location: "Lagos" },
  { place_id: "place_7", name: "Yakoyo Restaurant", types: ["restaurant", "point_of_interest"], location: "Lagos" },
  { place_id: "place_8", name: "Shawarma Spot", types: ["restaurant", "meal_takeaway"], location: "Lagos" },
  { place_id: "place_9", name: "The Place", types: ["restaurant", "bar"], location: "Lagos" },
  { place_id: "place_10", name: "Bungalow Restaurant", types: ["restaurant", "fine_dining"], location: "Lagos" },
  { place_id: "place_11", name: "Tastee Fried Chicken", types: ["restaurant", "fast_food"], location: "Lagos" },
  { place_id: "place_12", name: "Tantalizers", types: ["restaurant", "meal_takeaway"], location: "Lagos" },
  { place_id: "place_13", name: "White House Restaurant", types: ["restaurant", "food"], location: "Lagos" },
  { place_id: "place_14", name: "Sweet Sensation", types: ["restaurant", "bakery"], location: "Lagos" },
  { place_id: "place_15", name: "Kilimanjaro", types: ["restaurant", "bar"], location: "Lagos" },
];

// Simulated user profile
const MOCK_USER_PROFILE = {
  conditions: ["diabetes"],
  restrictions: ["low sugar"],
  allergies: ["peanuts"],
  age: 45,
  activityLevel: "moderate",
  gender: "male",
};

// ARCHETYPES (from country pack)
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

// STEP 1: Classify ALL restaurants in a single LLM call
async function classifyAllRestaurants(restaurants, llmManager) {
  const restaurantList = restaurants
    .map((r, i) => `${i + 1}. ${r.name} (types: ${r.types.join(", ")})`)
    .join("\n");

  const prompt = `You are classifying Nigerian restaurants into archetypes.

Restaurants:
${restaurantList}

Archetypes:
${NIGERIAN_ARCHETYPES.join(", ")}

Return ONLY a JSON array with archetype for each restaurant:
[
  {"name": "Restaurant Name", "archetype": "archetype_key"},
  ...
]

No markdown, just the JSON array.`;

  const result = await llmManager.chat([{ role: "user", content: prompt }], {
    temperature: 0,
    maxTokens: 800,
  });

  const cleaned = result.content.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    classifications: parsed,
    provider: result.provider,
    duration: result.duration,
  };
}

// STEP 2: Generate mock model recommendations (simulating model server)
function generateMockModelRecs(archetype) {
  const mockRecs = {
    casual_nigerian: ["Jollof Rice with Grilled Chicken", "Moi Moi", "Efo Riro with Assorted Meat"],
    fast_food_nigerian: ["Grilled Chicken with Rice", "Moi Moi", "Coleslaw"],
    fast_food_western: ["Grilled Chicken", "Side Salad", "Water"],
    fine_dining: ["Grilled Fish", "Steamed Vegetables", "Brown Rice"],
    modern_fusion: ["Grilled Chicken Salad", "Quinoa Bowl", "Fresh Juice"],
    shawarma_pizza: ["Chicken Shawarma (light sauce)", "Small Vegetable Pizza", "Water"],
    unknown: ["Grilled Fish", "Steamed Vegetables", "Water"],
  };
  return mockRecs[archetype] || mockRecs.unknown;
}

// STEP 3: Explain ALL restaurants in a single LLM call
async function explainAllRestaurants(restaurants, archetypes, llmManager) {
  const restaurantData = restaurants
    .map((r, i) => {
      const archetype = archetypes.find((a) => a.name === r.name)?.archetype || "unknown";
      const modelRecs = generateMockModelRecs(archetype);
      return `${i + 1}. ${r.name} (${archetype})\n   Model recommendations: ${modelRecs.join(", ")}`;
    })
    .join("\n\n");

  const prompt = `You are a Nigerian clinical nutrition advisor.

User Profile:
- Conditions: ${MOCK_USER_PROFILE.conditions.join(", ")}
- Restrictions: ${MOCK_USER_PROFILE.restrictions.join(", ")}
- Allergies: ${MOCK_USER_PROFILE.allergies.join(", ")}
- Age: ${MOCK_USER_PROFILE.age} years
- Activity Level: ${MOCK_USER_PROFILE.activityLevel}

Restaurants with model recommendations:
${restaurantData}

TASK: For EACH restaurant, provide 2-3 safe orders, 1-2 avoid items, and 1 tip.

Return ONLY a JSON array (no markdown):
[
  {
    "restaurant": "Restaurant Name",
    "safeOrders": [{"dish": "dish", "reason": "why"}],
    "avoid": [{"item": "item", "reason": "why"}],
    "tip": "practical tip"
  },
  ...
]

No markdown, just the JSON array.`;

  const result = await llmManager.chat([{ role: "user", content: prompt }], {
    temperature: 0.1,
    maxTokens: 3000,
  });

  const cleaned = result.content.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  return {
    recommendations: parsed,
    provider: result.provider,
    duration: result.duration,
  };
}

// Main test function
async function runTest() {
  console.log("🧪 FULL BATCH Multi-Provider LLM Test\n");
  console.log("=" .repeat(60));
  console.log(`📍 Simulating 3km geofence with ${MOCK_RESTAURANTS.length} restaurants`);
  console.log(`👤 User Profile: ${MOCK_USER_PROFILE.conditions.join(", ")}, age ${MOCK_USER_PROFILE.age}`);
  console.log(`🎯 Strategy: 2 LLM calls total (1 classify + 1 explain)`);
  console.log("=" .repeat(60));

  const llmManager = new LLMProviderManager({
    groqKeys: [process.env.GROQ_API_KEY],
    geminiKey: process.env.GEMINI_API_KEY,
    groqModel: "llama-3.3-70b-versatile",
    geminiModel: "gemini-1.5-flash",
    timeout: 45000,
    maxRetryWait: 15000,
  });

  const startTime = Date.now();

  try {
    // STEP 1: Classify ALL restaurants (1 LLM call)
    console.log(`\n🏷️  STEP 1: Classifying ${MOCK_RESTAURANTS.length} restaurants...`);
    const classifyResult = await classifyAllRestaurants(MOCK_RESTAURANTS, llmManager);
    console.log(`   ✅ Complete in ${(classifyResult.duration / 1000).toFixed(2)}s (via ${classifyResult.provider})`);
    console.log(`   📊 Archetypes: ${classifyResult.classifications.map(c => c.archetype).join(", ")}`);

    // STEP 2: Generate model recommendations (local, no API)
    console.log(`\n🤖 STEP 2: Generating model recommendations (local)...`);
    console.log(`   ✅ Complete (no API calls)`);

    // STEP 3: Explain ALL restaurants (1 LLM call)
    console.log(`\n💬 STEP 3: Generating recommendations for ${MOCK_RESTAURANTS.length} restaurants...`);
    const explainResult = await explainAllRestaurants(
      MOCK_RESTAURANTS,
      classifyResult.classifications,
      llmManager
    );
    console.log(`   ✅ Complete in ${(explainResult.duration / 1000).toFixed(2)}s (via ${explainResult.provider})`);

    const totalDuration = Date.now() - startTime;

    // Display results
    console.log("\n" + "=".repeat(60));
    console.log("📊 TEST RESULTS");
    console.log("=".repeat(60));

    console.log(`\n⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`🎯 Total LLM Calls: 2 (1 classify + 1 explain)`);
    console.log(`✅ Restaurants Processed: ${explainResult.recommendations.length}/${MOCK_RESTAURANTS.length}`);

    // Provider distribution
    const providerStats = llmManager.getStats();
    console.log(`\n🔀 Provider Distribution:`);
    providerStats.providers.forEach((p) => {
      const percentage = providerStats.totalCalls > 0
        ? ((p.callCount / providerStats.totalCalls) * 100).toFixed(1)
        : "0.0";
      console.log(`   ${p.id}: ${p.callCount} calls (${percentage}%) - ${p.health.status}`);
    });

    // Sample recommendations
    console.log(`\n📝 Sample Recommendations (first 3):`);
    explainResult.recommendations.slice(0, 3).forEach((rec, index) => {
      console.log(`\n${index + 1}. ${rec.restaurant}:`);
      console.log(`   Safe Orders: ${rec.safeOrders?.length || 0}`);
      console.log(`   Avoid: ${rec.avoid?.length || 0}`);
      console.log(`   Tip: ${rec.tip?.slice(0, 60) || "N/A"}...`);
    });

    // Write detailed results to file
    const outputPath = path.join(__dirname, `test_results_${Date.now()}.json`);
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          testConfig: {
            totalRestaurants: MOCK_RESTAURANTS.length,
            strategy: "full_batch",
            userProfile: MOCK_USER_PROFILE,
          },
          totalDuration,
          llmCalls: 2,
          providerStats,
          classifications: classifyResult.classifications,
          recommendations: explainResult.recommendations,
        },
        null,
        2
      )
    );
    console.log(`\n💾 Detailed results saved to: ${path.basename(outputPath)}`);

    // Performance comparison
    console.log(`\n⚡ Performance Comparison:`);
    console.log(`   OLD (sequential): ~${MOCK_RESTAURANTS.length * 2} LLM calls, ~${(MOCK_RESTAURANTS.length * 6).toFixed(0)} seconds`);
    console.log(`   NEW (full batch): 2 LLM calls, ${(totalDuration / 1000).toFixed(2)} seconds`);
    console.log(`   🚀 Speed improvement: ${((MOCK_RESTAURANTS.length * 6) / (totalDuration / 1000)).toFixed(1)}x faster`);

    console.log("\n" + "=".repeat(60));
    console.log("✅ TEST COMPLETED SUCCESSFULLY");
    console.log("=".repeat(60));
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error("💥 Fatal error:", err.message);
  process.exit(1);
});
