/**
 * Batch LLM Operations
 * Classifies and explains multiple restaurants in single LLM calls
 * Reduces 2N LLM calls to just 2 calls total
 */

/**
 * Batch classify multiple restaurants in one LLM call
 * @param {Array} restaurants - Array of {place_id, name, address, types, editorial}
 * @param {Object} archetypes - Map of archetype keys to descriptions
 * @param {string} countryLabel - "Nigerian" or "Canadian"
 * @param {string} fallbackKey - Archetype key for unknown venues
 * @returns {Map} placeId → archetype key
 */
export async function batchClassifyRestaurants(llmManager, restaurants, archetypes, countryLabel, fallbackKey) {
  const allowedKeys = Object.keys(archetypes);
  const archetypeList = allowedKeys.map((key) => `  "${key}": ${archetypes[key]}`).join("\n");

  const restaurantList = restaurants
    .map((r, i) => {
      const types = (r.types || []).join(", ");
      const editorial = r.editorial ? `\nDescription: ${r.editorial}` : "";
      return `${i + 1}. place_id: ${r.place_id}\n   Name: ${r.name}\n   Address: ${r.address || countryLabel}\n   Types: ${types}${editorial}`;
    })
    .join("\n\n");

  const prompt = `You are classifying ${restaurants.length} ${countryLabel} restaurants into archetypes.

ARCHETYPES:
${archetypeList}

RESTAURANTS:
${restaurantList}

IMPORTANT JSON FORMAT:
Return ONLY a valid JSON object (not an array) mapping place_id to archetype key.
Do not include markdown code fences.
Do not include any explanatory text.

Example format:
{
  "place_id_123": "archetype_key",
  "place_id_456": "archetype_key"
}

Your response:`;

  const messages = [{ role: "user", content: prompt }];
  const response = await llmManager.chat(messages, { temperature: 0, maxTokens: 1500 });

  console.log(`  ✅ Batch classification completed via ${response.provider} in ${(response.duration / 1000).toFixed(1)}s`);

  let parsed;
  try {
    const cleaned = response.content.replace(/```json|```|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    parsed = await repairJSON(llmManager, response.content);
  }

  // Build result map
  const resultMap = new Map();
  for (const restaurant of restaurants) {
    const archetype = parsed[restaurant.place_id];
    resultMap.set(
      restaurant.place_id,
      allowedKeys.includes(archetype) ? archetype : fallbackKey
    );
  }

  return resultMap;
}

/**
 * Batch explain recommendations for multiple restaurants in one LLM call
 * @param {Array} restaurantData - Array of {place_id, name, archetype, modelRecs}
 * @param {Object} userProfile - User health profile
 * @param {string} nutritionBlock - Formatted nutrition contract text
 * @param {Object} archetypes - Map of archetype keys to descriptions
 * @param {Function} brandGuidanceBuilder - Function to build brand guidance
 * @returns {Map} placeId → {safeOrders, avoid, tip, confidenceNote}
 */
export async function batchExplainRecommendations(
  llmManager,
  restaurantData,
  userProfile,
  nutritionBlock,
  archetypes,
  brandGuidanceBuilder,
  countryLabel,
  contextTip
) {
  const conditions = (userProfile?.conditions || []).join(", ") || "none";
  const restrictions = (userProfile?.restrictions || []).join(", ") || "none";
  const allergies = (userProfile?.allergies || []).join(", ") || "none";
  const age = userProfile?.age;
  const activityLevel = userProfile?.activityLevel;
  const gender = userProfile?.gender;

  const hasActiveHealthFilters =
    (userProfile?.conditions || []).length > 0 ||
    (userProfile?.restrictions || []).length > 0 ||
    (userProfile?.allergies || []).length > 0;

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

  const restaurantBlocks = restaurantData.map((r, i) => {
    const recList = r.modelRecs
      .slice(0, 15)
      .map((rec, j) => `${j + 1}. ${rec.dish_name} (similarity: ${(rec.similarity_score || 0).toFixed(2)}, health_label: ${rec.health_label || "unknown"})`)
      .join("\n");

    const brandGuidance = brandGuidanceBuilder(r.name, r.archetype);

    const searchHint = r.modelRecs.length === 0 
      ? `\n\nNOTE: You have access to real-time search. Since no model recommendations exist for "${r.name}", you may search for "${r.name} menu ${countryLabel}" or "${r.name} restaurant" to find actual menu items and make more accurate recommendations.`
      : "";

    return `RESTAURANT ${i + 1}:
place_id: ${r.place_id}
Name: "${r.name}"
Type: ${archetypes[r.archetype] || r.archetype}

${brandGuidance}

Model recommendations:
${recList || "(no model recommendations available)"}${searchHint}`;
  }).join("\n\n" + "=".repeat(80) + "\n\n");

  const prompt = `You are a ${countryLabel} clinical nutrition advisor. You will provide safe meal guidance for ${restaurantData.length} restaurants.

User Profile:
- Conditions: ${conditions}
- Restrictions: ${restrictions}
- Allergies: ${allergies}${demographicContext}

${nutritionBlock}

${restaurantBlocks}

TASK:
For EACH restaurant, provide:
1. 3-5 "safeOrders" (filter model recs against user profile, discard violations)
2. 2-3 "avoid" items

CRITICAL RULES:
- NEVER suggest dishes that violate restrictions or allergies
- Active health filters: ${hasActiveHealthFilters ? "yes" : "no"}
- If no active filters, don't behave like strict therapeutic diet
- If no active filters, pizza/shawarma/rice are NOT automatically avoid items
${age && age >= 65 ? `- User is senior (${age}): prioritize nutrient-dense foods, moderate portions, adequate protein` : ""}
${age && age < 30 && activityLevel?.toLowerCase().includes("active") ? `- User is young/active (${age}, ${activityLevel}): adequate protein and energy, respect restrictions` : ""}

IMPORTANT JSON FORMAT:
Return ONLY a valid JSON object (not an array) mapping place_id to recommendation.
Do not include markdown code fences (no \`\`\`json or \`\`\`).
Do not include any explanatory text before or after the JSON.

Example format:
{
  "place_id_1": {
    "safeOrders": [{"dish": "...", "reason": "...", "source": "model"}],
    "avoid": [{"item": "...", "reason": "..."}],
    "tip": null,
    "confidenceNote": null
  },
  "place_id_2": { ... }
}

Your response (JSON only):`;

  const messages = [{ role: "user", content: prompt }];
  const response = await llmManager.chat(messages, { temperature: 0.1, maxTokens: 8000 });

  console.log(`  ✅ Batch explanation completed via ${response.provider} in ${(response.duration / 1000).toFixed(1)}s`);

  let parsed;
  try {
    const cleaned = response.content.replace(/```json|```|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    parsed = await repairJSON(llmManager, response.content);
  }

  // Build result map
  const resultMap = new Map();
  for (const restaurant of restaurantData) {
    const advice = parsed[restaurant.place_id] || {
      safeOrders: [],
      avoid: [],
      tip: null,
      confidenceNote: "Could not generate structured advice for this venue.",
    };

    // Attach source tags to safeOrders
    const modelDishNames = new Set(
      restaurant.modelRecs.map((r) => String(r.dish_name || "").toLowerCase()).filter(Boolean)
    );
    advice.safeOrders = (advice.safeOrders || []).map((item) => {
      const dish = String(item?.dish || "").toLowerCase();
      return {
        ...item,
        source: modelDishNames.has(dish) ? "model" : "ai_knowledge",
      };
    });

    resultMap.set(restaurant.place_id, advice);
  }

  return resultMap;
}

/**
 * Repair malformed JSON using a second LLM call
 */
async function repairJSON(llmManager, brokenText) {
  const messages = [
    {
      role: "system",
      content: "You fix malformed JSON. Return ONLY the corrected JSON object, nothing else.",
    },
    {
      role: "user",
      content: `Fix this JSON and return it clean:\n\n${brokenText}`,
    },
  ];

  const response = await llmManager.chat(messages, { temperature: 0, maxTokens: 4000 });
  const cleaned = response.content.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("  ❌ JSON repair failed, returning empty structure");
    return {};
  }
}