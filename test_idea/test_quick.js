#!/usr/bin/env node

/**
 * Quick Test - 5 Restaurants
 * Fast test to validate multi-provider setup before running full scale
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { LLMProviderManager } from "./llm_provider_manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", "scraper", ".env");
  if (!fs.existsSync(envPath)) {
    console.warn("⚠️  No .env file found");
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

const RESTAURANTS = [
  { name: "Mama Put Kitchen", archetype: "casual_nigerian" },
  { name: "KFC Ikeja", archetype: "fast_food_western" },
  { name: "Chicken Republic", archetype: "fast_food_nigerian" },
  { name: "Dominos Pizza", archetype: "pizza_chain" },
  { name: "The Place Restaurant", archetype: "modern_fusion" },
];

async function quickTest() {
  console.log("🚀 Quick Test - Multi-Provider Architecture\n");

  const llmManager = new LLMProviderManager({
    groqKeys: [process.env.GROQ_API_KEY],
    geminiKey: process.env.GEMINI_API_KEY,
  });

  console.log(`\n📍 Testing with ${RESTAURANTS.length} restaurants...\n`);

  for (const restaurant of RESTAURANTS) {
    try {
      const prompt = `You are a Nigerian nutrition advisor. For "${restaurant.name}" (${restaurant.archetype}), recommend ONE safe dish for a diabetic person. Reply in 20 words or less.`;

      const result = await llmManager.chat([{ role: "user", content: prompt }], {
        maxTokens: 100,
      });

      console.log(`✅ ${restaurant.name}`);
      console.log(`   Provider: ${result.provider}`);
      console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
      console.log(`   Response: ${result.content.slice(0, 80)}...\n`);
    } catch (err) {
      console.log(`❌ ${restaurant.name}`);
      console.log(`   Error: ${err.message}\n`);
    }
  }

  console.log("\n📊 Final Stats:");
  const stats = llmManager.getStats();
  stats.providers.forEach((p) => {
    console.log(`   ${p.id}: ${p.callCount} calls - ${p.health.status}`);
  });
}

quickTest().catch((err) => {
  console.error("💥 Error:", err.message);
  process.exit(1);
});
