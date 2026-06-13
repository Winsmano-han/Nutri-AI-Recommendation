# Multi-Provider LLM Architecture Test - FULL BATCH

## What This Tests

This prototype tests the **FULL BATCH** approach for geofence restaurant recommendations:

1. **Single LLM call:** Classify ALL 15 restaurants at once
2. **Local processing:** Generate seeds (no API calls)
3. **Parallel model calls:** Get recommendations from model server
4. **Single LLM call:** Explain ALL 15 restaurants at once

**Total: 2 LLM calls instead of 30+**

## Why Full Batch Works

**Realistic geofence (3km radius):**
- Lagos dense area: 15-25 restaurants
- Ibadan moderate: 8-15 restaurants
- Rural area: 3-8 restaurants

**Average: 10-20 restaurants** → Fits comfortably in LLM context window

## Files

- `llm_provider_manager.js` - Multi-provider manager (Groq + Gemini)
- `test_multi_provider.js` - Full batch test (15 restaurants, 2 LLM calls)
- `test_quick.js` - Quick test (5 restaurants)

## Run Tests

### Full Batch Test (15 restaurants)
```bash
cd test_idea
node test_multi_provider.js
```

Expected output:
```
✅ LLM Manager initialized with 2 provider(s):
   - groq_1 (groq)
   - gemini_1 (gemini)

📍 Simulating 3km geofence with 15 restaurants
🎯 Strategy: 2 LLM calls total (1 classify + 1 explain)

🏷️  STEP 1: Classifying 15 restaurants...
   ✅ Complete in 2.34s (via groq_1)
   📊 Archetypes: casual_nigerian, fast_food_western, fast_food_nigerian...

🤖 STEP 2: Generating model recommendations (local)...
   ✅ Complete (no API calls)

💬 STEP 3: Generating recommendations for 15 restaurants...
   ✅ Complete in 3.87s (via gemini_1)

📊 TEST RESULTS
⏱️  Total Duration: 6.21s
🎯 Total LLM Calls: 2 (1 classify + 1 explain)
✅ Restaurants Processed: 15/15

🔀 Provider Distribution:
   groq_1: 1 calls (50.0%) - healthy
   gemini_1: 1 calls (50.0%) - healthy

⚡ Performance Comparison:
   OLD (sequential): ~30 LLM calls, ~90 seconds
   NEW (full batch): 2 LLM calls, 6.21 seconds
   🚀 Speed improvement: 14.5x faster
```

### Quick Test (5 restaurants)
```bash
cd test_idea
node test_quick.js
```

## Performance Expectations

### With 2 Providers (1 Groq + 1 Gemini)

| Restaurants | LLM Calls | Time | Speed vs Sequential |
|-------------|-----------|------|---------------------|
| 10 | 2 | ~5s | 12x faster |
| 15 | 2 | ~6s | 15x faster |
| 20 | 2 | ~8s | 15x faster |
| 25 | 2 | ~10s | 15x faster |

### Rate Limit Handling

If one provider rate-limits:
```
🏷️  STEP 1: Classifying 15 restaurants...
   ⚠️  Provider groq_1 rate limited
   ⏭️  Retrying with gemini_1...
   ✅ Complete in 2.87s (via gemini_1)
```

Both calls automatically failover to available provider.

## Integration Strategy

Once validated, merge into `nutrifence_pipeline.js`:

### Before (Current)
```javascript
for (const restaurant of restaurants) {
  const archetype = await classifyWithGroq(restaurant);  // 1 LLM call
  const modelRecs = await getModelRecs(archetype);      // 1 model call
  const advice = await explainWithGroq(modelRecs);      // 1 LLM call
}
// Total: 2N LLM calls for N restaurants
```

### After (Full Batch)
```javascript
// Classify all at once
const archetypes = await classifyAllWithLLM(restaurants);  // 1 LLM call

// Get model recs in parallel
const allModelRecs = await Promise.all(
  archetypes.map(a => getModelRecs(a))
);  // N parallel model calls (~3s total)

// Explain all at once
const allRecommendations = await explainAllWithLLM(
  restaurants,
  archetypes,
  allModelRecs
);  // 1 LLM call

// Total: 2 LLM calls for N restaurants
```

## Next Steps

1. ✅ **Run test:** Validate 2-call approach works
2. ✅ **Get 2nd Groq key:** Add as `GROQ_API_KEY_2` for redundancy
3. ⏭️ **Merge to main:** Integrate into `nutrifence_pipeline.js`
4. ⏭️ **Update food analyzer:** Apply same batch logic to `/api/analyze-food`

## Why This Is Better

**Old Sequential Approach:**
- 15 restaurants × 2 LLM calls each = 30 API calls
- Rate limit risk: VERY HIGH
- Time: 90+ seconds
- Provider distribution: Uneven (hits rate limit mid-batch)

**New Full Batch Approach:**
- 15 restaurants = 2 API calls total
- Rate limit risk: VERY LOW  
- Time: 5-8 seconds
- Provider distribution: Perfect 50/50 (or 33/33/33 with 3 keys)
- Automatic failover if provider is down
