#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from scraper folder
const envPath = path.join(__dirname, "..", "scraper", ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
}

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const USER_LAT = 6.4281;
const USER_LNG = 3.4219;
const SEARCH_RADIUS = 3000;

// ─── Seed Generation Logic (copied from main pipeline) ─────────────────────

const ARCHETYPES = {
  fast_food_nigerian: "Nigerian fast food chain (Chicken Republic, Mr Bigg's, Tastee Fried Chicken)",
  fast_food_western: "Western fast food chain (KFC, Domino's, Subway, Burger King)",
  local_canteen: "Local Nigerian canteen or buka (mama put, local chop house)",
  suya_grill: "Suya spot or roadside Nigerian grill (suya, asun, kilishi)",
  seafood_joint: "Seafood restaurant (fresh fish, prawns, crab, lobster)",
  pepper_soup_joint: "Pepper soup bar or Nigerian pub-style spot",
  chinese_continental: "Chinese or continental/intercontinental restaurant",
  shawarma_pizza: "Shawarma, pizza, or Middle Eastern fast food spot",
  fine_dining_nigerian: "Upscale Nigerian or Afro-fusion fine dining restaurant",
  unknown: "Restaurant type could not be determined — Nigerian food likely",
};

const ARCHETYPE_SEEDS = {
  fast_food_nigerian: ["jollof rice chicken", "fried rice coleslaw", "puff puff chips", "grilled chicken wings"],
  fast_food_western: ["fried chicken burger", "french fries", "grilled chicken wrap", "coleslaw"],
  local_canteen: ["egusi soup pounded yam", "jollof rice fried plantain", "ofe onugbu garri", "amala ewedu gbegiri"],
  suya_grill: ["beef suya", "chicken suya", "asun peppered goat meat", "grilled fish pepper sauce"],
  seafood_joint: ["peppered fish", "grilled tilapia", "prawn stir fry", "seafood okra soup"],
  pepper_soup_joint: ["goat meat pepper soup", "catfish pepper soup", "cow leg pepper soup", "assorted meat pepper soup"],
  chinese_continental: ["fried rice egg", "noodles chicken", "sweet sour chicken", "vegetable stir fry"],
  shawarma_pizza: ["chicken shawarma", "beef shawarma", "pepperoni pizza", "chicken pizza"],
  fine_dining_nigerian: ["ofada rice ayamase sauce", "banga soup starch", "oha soup", "nkwobi cow leg"],
  unknown: ["jollof rice", "egusi soup pounded yam", "grilled chicken", "fried plantain", "pepper soup", "ofada rice"],
};

const BRAND_PROFILES = [
  {
    country: "NG",
    id: "chicken_republic",
    match: /chicken republic/i,
    terms: ["grilled chicken", "chicken rice meal", "jollof rice", "fried rice", "coleslaw", "chips", "sugary drink"],
  },
  {
    country: "NG",
    id: "dominos",
    match: /domino'?s?/i,
    terms: ["thin crust pizza", "vegetable pizza", "chicken pizza", "pepperoni pizza", "salad", "sugary drink"],
  },
  {
    country: "NG",
    id: "kfc",
    match: /\bkfc\b/i,
    terms: ["grilled chicken", "fried chicken", "chicken burger", "coleslaw", "fries", "sugary drink"],
  },
  {
    country: "NG",
    id: "the_place",
    match: /\bthe place\b/i,
    terms: ["jollof rice", "fried rice", "grilled chicken", "asun", "plantain", "salad"],
  },
];

const SPECIFIC_METADATA_RULES = [
  { match: /pizza|pizzeria|domino/i, terms: ["pizza", "vegetable pizza", "chicken pizza", "salad"] },
  { match: /shawarma|kebab|falafel|gyro|middle.?east|lebanese/i, terms: ["chicken shawarma", "falafel salad", "lentil soup", "tabbouleh"] },
  { match: /suya|asun|kilishi|bbq|barbeque|grill/i, terms: ["grilled chicken", "grilled fish", "beef suya", "peppered goat meat"] },
  { match: /seafood|fish|lobster|crab|prawn|shrimp/i, terms: ["grilled fish", "baked fish", "seafood soup", "shrimp salad"] },
  { match: /cafe|coffee|bakery|breakfast|brunch|bagel|donut|doughnut/i, terms: ["hot oats", "egg sandwich", "whole grain toast", "coffee", "muffin"] },
  { match: /asian|chinese|thai|sushi|korean|vietnam|pho|ramen|wok|teriyaki/i, terms: ["stir fried vegetables", "steamed rice", "grilled chicken", "vegetable soup", "noodles"] },
  { match: /indian|punjabi|tandoor|curry|biryani|dosa/i, terms: ["tandoori chicken", "dal", "chana masala", "vegetable curry", "naan"] },
  { match: /salad|bowl|smoothie|healthy|fresh/i, terms: ["salad", "grain bowl", "grilled chicken", "lentil bowl", "vegetable soup"] },
  { match: /hotel|suite|lodge|guest.?house/i, terms: ["grilled fish", "rice meal", "vegetable soup", "chicken", "salad"] },
];

const GENERIC_METADATA_RULES = [
  { match: /fast.?food|meal_takeaway|quick.?service/i, terms: ["grilled chicken", "burger", "fries", "side salad", "sugary drink"] },
];

const COUNTRY_PRIORS = {
  NG: ["jollof rice", "grilled chicken", "vegetable soup", "beans", "grilled fish", "pepper soup"],
};

function unique(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function findBrandProfile(country, text) {
  return BRAND_PROFILES.find((profile) => (
    (!profile.country || profile.country === country) && profile.match.test(text)
  ));
}

function metadataTerms(text) {
  const terms = [];
  for (const rule of SPECIFIC_METADATA_RULES) {
    if (rule.match.test(text)) terms.push(...rule.terms);
  }
  if (terms.length === 0) {
    for (const rule of GENERIC_METADATA_RULES) {
      if (rule.match.test(text)) terms.push(...rule.terms);
    }
  }
  return unique(terms);
}

function archetypeTerms(archetype) {
  return unique(ARCHETYPE_SEEDS?.[archetype] || []);
}

function scoreEvidence({ source, confidence, terms, reason }) {
  return { source, confidence, terms: unique(terms), reason };
}

function generateRestaurantSeeds({ place, archetype, country = "NG", maxTerms = 10 }) {
  const name = place?.name || "";
  const address = place?.formatted_address || place?.vicinity || "";
  const types = (place?.types || []).join(" ");
  const editorial = place?.editorial_summary?.overview || "";
  const website = place?.website || "";
  const text = [name, address, types, editorial, website, archetype, ARCHETYPES?.[archetype]]
    .filter(Boolean)
    .join(" ");

  const evidence = [];

  // Brand profile (name only)
  const brand = findBrandProfile(country, name);
  if (brand) {
    evidence.push(scoreEvidence({
      source: `brand_profile:${brand.id}`,
      confidence: 0.9,
      terms: brand.terms,
      reason: `Known brand profile matched restaurant metadata.`,
    }));
  }

  // Metadata terms
  const metadata = metadataTerms(text);
  if (metadata.length) {
    evidence.push(scoreEvidence({
      source: "google_metadata",
      confidence: 0.72,
      terms: metadata,
      reason: "Google Places name/types/address/website contain food or cuisine signals.",
    }));
  }

  // Archetype terms
  const fromArchetype = archetypeTerms(archetype);
  if (fromArchetype.length) {
    evidence.push(scoreEvidence({
      source: "restaurant_archetype",
      confidence: archetype === "unknown" ? 0.42 : 0.62,
      terms: fromArchetype,
      reason: "Fallback terms from the classified restaurant archetype.",
    }));
  }

  // Country prior
  evidence.push(scoreEvidence({
    source: "country_prior",
    confidence: 0.35,
    terms: COUNTRY_PRIORS[country] || COUNTRY_PRIORS.NG,
    reason: "Broad country food prior used only as a low-confidence fallback.",
  }));

  evidence.sort((a, b) => b.confidence - a.confidence);

  const weightedTerms = [];
  for (const item of evidence) {
    for (const term of item.terms) weightedTerms.push(term);
  }

  const seedTerms = unique(weightedTerms).slice(0, maxTerms);
  const topEvidence = evidence[0];

  return {
    seedTerms,
    seedQuery: seedTerms.join("; "),
    seedSource: topEvidence?.source || "none",
    seedConfidence: topEvidence?.confidence || 0,
    evidence,
  };
}

function classifyByPattern(name, types) {
  const n = String(name || "").toLowerCase();
  const t = (types || []).join(" ").toLowerCase();

  if (n.match(/chicken republic|mr bigg|tastee|tantalizer|sweet sensation|debonairs/)) return "fast_food_nigerian";
  if (n.match(/\bkfc\b|domino|subway|burger king|cold stone|pizza hut|hardee/)) return "fast_food_western";
  if (n.match(/suya|asun|kilishi|bbq|barbeque|grill(?!e)/)) return "suya_grill";
  if (n.match(/seafood|lobster|crab|prawn|fish ?house|fish ?spot/)) return "seafood_joint";
  if (n.match(/pepper.?soup|nkwobi|point.?and.?kill/)) return "pepper_soup_joint";
  if (n.match(/chinese|asian|wok|dragon|jade|dynasty|continental|intercontinental/)) return "chinese_continental";
  if (n.match(/shawarma|pizza|wraps?|middle.?east|lebanese|turkish/)) return "shawarma_pizza";
  if (n.match(/restaurant(?! canteen| buka)/) && t.includes("restaurant") && !t.includes("fast_food")) return null;
  if (t.includes("fast_food") || t.includes("meal_takeaway")) return "fast_food_nigerian";
  if (n.match(/mama|buka|bukas|canteen|eatery|chophouse|chop.?house|joint|spot/)) return "local_canteen";
  if (n.match(/ad[uù]n|ile|eko|naija|9ja|afro|lagos|abuja|ibile/)) return "fine_dining_nigerian";
  return null;
}

// ─── Google Places helpers ─────────────────────────────────────────────────

async function searchNearbyRestaurants(lat, lng) {
  const url =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${lat},${lng}` +
    `&radius=${SEARCH_RADIUS}` +
    `&type=restaurant` +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();
  return data.results || [];
}

async function getPlaceDetails(placeId) {
  const fields = ["place_id", "name", "geometry", "formatted_address", "editorial_summary", "types", "website"].join(",");
  const url =
    `https://maps.googleapis.com/maps/api/place/details/json` +
    `?place_id=${placeId}` +
    `&fields=${fields}` +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();
  return data.result;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Fetching real restaurants from Google Places...\n");
  
  const places = await searchNearbyRestaurants(USER_LAT, USER_LNG);
  console.log(`✅ Found ${places.length} restaurants\n`);

  const results = [];

  for (let i = 0; i < Math.min(5, places.length); i++) {
    const place = places[i];
    console.log(`[${i + 1}/${Math.min(5, places.length)}] ${place.name}`);

    const details = await getPlaceDetails(place.place_id);
    const archetype = classifyByPattern(details.name, details.types) || "unknown";
    console.log(`  Archetype: ${archetype}`);

    const seedInfo = generateRestaurantSeeds({
      place: details,
      archetype,
      country: "NG",
      maxTerms: 10,
    });

    console.log(`  Seed source: ${seedInfo.seedSource}`);
    console.log(`  Seed confidence: ${seedInfo.seedConfidence.toFixed(2)}`);
    console.log(`  Seed terms (${seedInfo.seedTerms.length}): ${seedInfo.seedTerms.join(", ")}`);
    console.log(`  Evidence chain:`);
    for (const ev of seedInfo.evidence) {
      console.log(`    - ${ev.source} (conf: ${ev.confidence.toFixed(2)}): ${ev.terms.join(", ")}`);
    }
    console.log();

    results.push({
      name: details.name,
      archetype,
      seedInfo,
    });

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  const output = path.join(__dirname, "seed_test_results.json");
  fs.writeFileSync(output, JSON.stringify(results, null, 2));
  console.log(`✅ Results saved to: ${output}`);
}

main().catch(console.error);
