#!/usr/bin/env node

/**
 * Test script for deployed Nutrifence API
 * Tests all endpoints with sample data
 * 
 * Usage:
 *   node test_deployment.js https://your-service.onrender.com
 */

const BASE_URL = process.argv[2] || "http://127.0.0.1:8090";

console.log(`🧪 Testing Nutrifence API at: ${BASE_URL}\n`);

async function testHealth() {
  console.log("1️⃣  Testing health endpoint...");
  try {
    const res = await fetch(`${BASE_URL}/health`);
    const data = await res.json();
    
    if (data.status === "ok") {
      console.log("   ✅ Health check passed");
      console.log(`   Service: ${data.service}`);
      console.log(`   Port: ${data.port}`);
    } else {
      console.log("   ❌ Unexpected response:", data);
    }
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
  }
  console.log();
}

async function testRecommendations() {
  console.log("2️⃣  Testing recommendations endpoint...");
  console.log("   Location: Oluyole, Ibadan (7.3775, 3.9470)");
  
  try {
    const res = await fetch(`${BASE_URL}/api/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: 7.3775,
        lng: 3.9470,
        radius: 2000,
        maxRestaurants: 3,
        userProfile: {
          conditions: [],
          restrictions: []
        }
      })
    });
    
    const data = await res.json();
    
    if (data.error) {
      console.log(`   ❌ Error: ${data.error}`);
    } else if (data.venues) {
      console.log(`   ✅ Recommendations received`);
      console.log(`   Venues found: ${data.venues?.length || 0}`);
      
      if (data.venues?.length > 0) {
        const venue = data.venues[0];
        console.log(`   Sample venue: ${venue.name}`);
        console.log(`   Distance: ${venue.distance_m}m`);
        
        const recs = data.recommendations?.[venue.place_id];
        if (recs) {
          console.log(`   Model recommendations: ${recs.modelRecommendations?.length || 0}`);
          console.log(`   Safe orders: ${recs.safeOrders?.length || 0}`);
          console.log(`   Avoid: ${recs.avoid?.length || 0}`);
        }
      }
    } else {
      console.log("   ⚠️  Unexpected response format");
      console.log("   Response keys:", Object.keys(data));
    }
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
  }
  console.log();
}

async function testRecommendationsWithCondition() {
  console.log("3️⃣  Testing recommendations with diabetes condition...");
  console.log("   Location: Victoria Island, Lagos (6.4281, 3.4219)");
  
  try {
    const res = await fetch(`${BASE_URL}/api/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: 6.4281,
        lng: 3.4219,
        radius: 3000,
        maxRestaurants: 2,
        userProfile: {
          conditions: ["diabetes"],
          restrictions: ["low sugar"]
        }
      })
    });
    
    const data = await res.json();
    
    if (data.error) {
      console.log(`   ❌ Error: ${data.error}`);
    } else if (data.venues) {
      console.log(`   ✅ Recommendations received`);
      console.log(`   Venues found: ${data.venues?.length || 0}`);
      console.log(`   User profile applied: diabetes, low sugar`);
      
      if (data.venues?.length > 0) {
        const venue = data.venues[0];
        const recs = data.recommendations?.[venue.place_id];
        if (recs?.tip) {
          console.log(`   Sample tip: ${recs.tip.slice(0, 80)}...`);
        }
      }
    } else {
      console.log("   ⚠️  Unexpected response format");
    }
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
  }
  console.log();
}

async function testIngestReport() {
  console.log("4️⃣  Testing report ingestion endpoint...");
  
  try {
    const res = await fetch(`${BASE_URL}/api/ingest-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "test_user_001",
        reportText: "Patient should avoid high sugar foods and limit sodium intake. Recommended daily calories: 1800."
      })
    });
    
    const data = await res.json();
    
    if (data.error) {
      console.log(`   ❌ Error: ${data.error}`);
    } else if (data.success) {
      console.log(`   ✅ Report ingested successfully`);
      console.log(`   User ID: ${data.userId}`);
      console.log(`   Conditions: ${data.conditions?.join(", ") || "none"}`);
      console.log(`   Report ID: ${data.reportId || "N/A"}`);
    } else {
      console.log("   ⚠️  Unexpected response format");
      console.log("   Response:", data);
    }
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
  }
  console.log();
}

async function runTests() {
  console.log("═".repeat(60));
  console.log("  NUTRIFENCE API TEST SUITE");
  console.log("═".repeat(60));
  console.log();
  
  await testHealth();
  await testRecommendations();
  await testRecommendationsWithCondition();
  await testIngestReport();
  
  console.log("═".repeat(60));
  console.log("  TEST SUITE COMPLETE");
  console.log("═".repeat(60));
  console.log();
  console.log("💡 Tips:");
  console.log("   - If health check fails, both servers may not be running");
  console.log("   - If recommendations fail, check Google Maps API key");
  console.log("   - If Groq errors occur, check Groq API key and rate limits");
  console.log("   - On Render free tier, first request may take 30-60s (cold start)");
}

runTests().catch(console.error);
