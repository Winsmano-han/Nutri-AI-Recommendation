#!/usr/bin/env node

/**
 * Health check script for Render deployment
 * Verifies both Python model server and Node.js API server are running
 */

async function checkHealth() {
  console.log("🏥 Running health checks...\n");

  // Check Node.js API server
  try {
    const apiPort = process.env.API_PORT || process.env.PORT || 8090;
    const apiUrl = `http://127.0.0.1:${apiPort}/health`;
    console.log(`Checking Node.js API server: ${apiUrl}`);
    
    const apiRes = await fetch(apiUrl);
    const apiData = await apiRes.json();
    
    if (apiData.status === "ok") {
      console.log("✅ Node.js API server is healthy");
      console.log(`   Service: ${apiData.service}`);
      console.log(`   Port: ${apiData.port}`);
    } else {
      console.log("❌ Node.js API server returned unexpected response");
      console.log(apiData);
    }
  } catch (e) {
    console.log("❌ Node.js API server is not responding");
    console.log(`   Error: ${e.message}`);
  }

  console.log();

  // Check Python model server
  try {
    const modelUrl = process.env.MODEL_API_URL || "http://127.0.0.1:8011";
    const healthUrl = `${modelUrl}/health`;
    console.log(`Checking Python model server: ${healthUrl}`);
    
    const modelRes = await fetch(healthUrl);
    const modelData = await modelRes.json();
    
    if (modelData.status === "ok") {
      console.log("✅ Python model server is healthy");
      console.log(`   Models loaded: ${modelData.models_loaded?.join(", ") || "none"}`);
      console.log(`   Dish model path: ${modelData.dish_model_path}`);
      console.log(`   Food model path: ${modelData.food_model_path}`);
    } else {
      console.log("❌ Python model server returned unexpected response");
      console.log(modelData);
    }
  } catch (e) {
    console.log("❌ Python model server is not responding");
    console.log(`   Error: ${e.message}`);
  }

  console.log("\n✅ Health check complete");
}

checkHealth().catch(console.error);
