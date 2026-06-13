#!/usr/bin/env node

/**
 * Test to see what Gemini is actually returning from Render
 */

const TEST_URL = "https://nutri-ai-recommendation.onrender.com/api/recommendations";

async function testGeminiResponse() {
  console.log("🧪 Testing Gemini Response from Render...\n");
  
  const payload = {
    lat: 9.0820,
    lng: 8.6753,
    country: "NG",
    radius: 1000,
    maxRestaurants: 2, // Small test
    userProfile: {
      conditions: ["diabetes"],
      restrictions: ["low sugar"],
      allergies: []
    }
  };

  const start = Date.now();
  
  try {
    const response = await fetch(TEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    
    if (!response.ok) {
      console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      console.error(text);
      return;
    }

    const data = await response.json();
    
    console.log(`✅ Response received in ${duration}s\n`);
    console.log("📊 Meta Info:");
    console.log(`   Venues: ${data.venues?.length || 0}`);
    console.log(`   Batch Mode: ${data._meta?.batchMode}`);
    console.log(`   LLM Calls: ${data._meta?.llmStats?.totalCalls}`);
    console.log(`   Providers:`, data._meta?.llmStats?.providers?.map(p => `${p.id} (${p.health.status})`).join(", "));
    
    console.log("\n🍽️  First Restaurant:");
    const firstVenue = data.venues?.[0];
    if (!firstVenue) {
      console.log("   ❌ No venues found");
      return;
    }
    
    console.log(`   Name: ${firstVenue.name}`);
    console.log(`   Archetype: ${firstVenue.archetype}`);
    
    const rec = data.recommendations?.[firstVenue.id];
    if (!rec) {
      console.log("   ❌ No recommendations object");
      return;
    }
    
    console.log(`\n📋 Recommendations Structure:`);
    console.log(`   safeOrders: ${Array.isArray(rec.safeOrders) ? rec.safeOrders.length : "NOT ARRAY"}`);
    console.log(`   avoid: ${Array.isArray(rec.avoid) ? rec.avoid.length : "NOT ARRAY"}`);
    console.log(`   tip: ${rec.tip !== undefined ? (rec.tip || "null") : "MISSING"}`);
    console.log(`   confidenceNote: ${rec.confidenceNote !== undefined ? (rec.confidenceNote || "null") : "MISSING"}`);
    
    if (rec.safeOrders && rec.safeOrders.length > 0) {
      console.log(`\n✅ Safe Orders Found:`);
      rec.safeOrders.slice(0, 2).forEach((item, i) => {
        console.log(`   ${i + 1}. ${item.dish}`);
        console.log(`      Reason: ${item.reason}`);
        console.log(`      Source: ${item.source}`);
      });
    } else {
      console.log(`\n❌ NO SAFE ORDERS - This is the problem!`);
      console.log(`\nFull recommendation object for debugging:`);
      console.log(JSON.stringify(rec, null, 2));
    }
    
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
  }
}

testGeminiResponse();
