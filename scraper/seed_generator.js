/**
 * seed_generator.js — Nutrifence Restaurant Seed Generator v2
 *
 * Design goals:
 *   1. Venue-specific seeds — different archetypes must produce meaningfully
 *      different seed sets so the model doesn't converge on the same dishes.
 *   2. Greedy deduplication — once a term is claimed by a higher-confidence
 *      source it is never re-added by a lower-confidence source, preserving
 *      maxTerms slots for genuinely new information.
 *   3. Diversity enforcement — seeds are drawn from multiple food categories
 *      (protein, starch, vegetable, drink) so the model receives a varied
 *      signal rather than 10 variations of "healthy Nigerian food".
 *   4. Archetype exclusions — each archetype declares which terms are
 *      implausible for that venue type and those terms are never emitted,
 *      even if a lower-level source supplies them.
 *   5. Brand-name-only matching — brand profiles only test against
 *      place.name, never address or editorial text.
 *   6. Safe unknown handling — unknown archetype gets cuisine-signal terms
 *      derived from metadata rather than a generic country prior.
 */

import { loadCountryPack } from "./country_packs/index.js";

// ─── Brand profiles ────────────────────────────────────────────────────────────
// Keyed by country → brand id → { match, terms[], excludeTerms[] }
// match: tested ONLY against place.name
// terms: ordered from most- to least-specific for this brand
// excludeTerms: terms that should never appear in seeds for this brand

const BRAND_PROFILES = {
  NG: [
    {
      id: "chicken_republic",
      match: /chicken republic/i,
      terms: [
        "rotisserie chicken",
        "jollof rice",
        "fried rice",
        "coleslaw",
        "moi moi",
        "chicken rice meal",
        "plantain",
        "water",
      ],
      excludeTerms: ["grilled fish", "pepper soup", "egusi", "amala", "pounded yam"],
    },
    {
      id: "kfc",
      match: /\bkfc\b/i,
      terms: [
        "fried chicken",
        "zinger burger",
        "chicken burger",
        "coleslaw",
        "fries",
        "side salad",
        "water",
      ],
      excludeTerms: ["grilled fish", "jollof rice", "amala", "pounded yam", "egusi"],
    },
    {
      id: "dominos",
      match: /domino'?s?/i,
      terms: [
        "thin crust pizza",
        "vegetable pizza",
        "chicken pizza",
        "pepperoni pizza",
        "garden salad",
        "water",
      ],
      excludeTerms: ["grilled fish", "jollof rice", "amala", "suya", "pepper soup"],
    },
    {
      id: "the_place",
      match: /\bthe place\b/i,
      terms: [
        "jollof rice",
        "ofada rice",
        "fried rice",
        "asun",
        "plantain",
        "salad",
        "pepper soup",
        "water",
      ],
      excludeTerms: ["pizza", "burger", "fries", "shawarma"],
    },
    {
      id: "mr_biggs",
      match: /mr\.?\s*bigg/i,
      terms: [
        "meat pie",
        "jollof rice",
        "fried rice",
        "chicken",
        "moi moi",
        "coleslaw",
        "water",
      ],
      excludeTerms: ["grilled fish", "amala", "egusi", "pizza", "shawarma"],
    },
    {
      id: "tantalizer",
      match: /tantalizer/i,
      terms: [
        "jollof rice",
        "fried rice",
        "chicken",
        "moi moi",
        "coleslaw",
        "salad",
        "water",
      ],
      excludeTerms: ["grilled fish", "amala", "pounded yam", "pizza"],
    },
  ],
  CA: [
    {
      id: "tim_hortons",
      match: /tim hortons?/i,
      terms: [
        "hot oats",
        "egg breakfast sandwich",
        "whole grain toast",
        "black coffee",
        "yogurt parfait",
        "water",
      ],
      excludeTerms: ["grilled fish", "poutine", "fried chicken", "pizza"],
    },
    {
      id: "swiss_chalet",
      match: /swiss chalet/i,
      terms: [
        "rotisserie chicken",
        "side salad",
        "vegetables",
        "baked potato",
        "chicken sandwich",
        "water",
      ],
      excludeTerms: ["grilled fish", "pizza", "shawarma"],
    },
    {
      id: "freshii",
      match: /freshii/i,
      terms: [
        "grain bowl",
        "salad",
        "lentil bowl",
        "smoothie",
        "wrap",
        "water",
      ],
      excludeTerms: ["grilled fish", "fried chicken", "poutine"],
    },
    {
      id: "dominos",
      match: /domino'?s?/i,
      terms: [
        "thin crust vegetable pizza",
        "chicken pizza",
        "garden salad",
        "pepperoni pizza",
        "water",
      ],
      excludeTerms: ["grilled fish", "poutine", "shawarma"],
    },
    {
      id: "kfc",
      match: /\bkfc\b/i,
      terms: [
        "fried chicken",
        "chicken sandwich",
        "coleslaw",
        "side salad",
        "fries",
        "water",
      ],
      excludeTerms: ["grilled fish", "pizza", "poutine"],
    },
  ],
};

// ─── Archetype-specific seed banks ────────────────────────────────────────────
// Each archetype defines:
//   seeds        — ordered from most- to least-representative
//   excludeTerms — terms that make NO sense at this venue type; block them
//                  regardless of which evidence source supplies them

const ARCHETYPE_SEED_BANKS = {
  NG: {
    local_canteen: {
      seeds: [
        "jollof rice",
        "fried rice",
        "beans porridge",
        "vegetable soup",
        "egusi soup",
        "pounded yam",
        "eba",
        "plantain",
        "boiled yam",
        "moi moi",
        "pepper soup",
        "zobo",
        "water",
      ],
      excludeTerms: ["pizza", "burger", "fries", "shawarma", "sushi", "pasta", "grilled fish fillet"],
    },
    fast_food_nigerian: {
      seeds: [
        "jollof rice",
        "fried rice",
        "rotisserie chicken",
        "fried chicken",
        "coleslaw",
        "moi moi",
        "plantain",
        "chicken burger",
        "meat pie",
        "water",
      ],
      excludeTerms: ["amala", "eba", "pounded yam", "egusi", "ewedu", "gbegiri", "ogbono", "pepper soup", "grilled fish", "catfish"],
    },
    fast_food_western: {
      seeds: [
        "chicken burger",
        "beef burger",
        "fries",
        "side salad",
        "coleslaw",
        "fried chicken",
        "sandwich",
        "wrap",
        "water",
      ],
      excludeTerms: ["amala", "eba", "pounded yam", "egusi", "ewedu", "jollof rice", "grilled fish", "pepper soup", "suya"],
    },
    shawarma_pizza: {
      seeds: [
        "chicken shawarma",
        "beef shawarma",
        "vegetable pizza",
        "chicken pizza",
        "thin crust pizza",
        "falafel",
        "wrap",
        "side salad",
        "water",
      ],
      excludeTerms: ["amala", "eba", "pounded yam", "egusi", "jollof rice", "grilled fish", "pepper soup", "suya", "asun"],
    },
    suya_grill: {
      seeds: [
        "beef suya",
        "chicken suya",
        "asun",
        "peppered goat meat",
        "grilled chicken",
        "yaji spice",
        "roasted yam",
        "fresh pepper",
        "water",
      ],
      excludeTerms: ["pizza", "burger", "fries", "shawarma", "pasta", "pounded yam", "eba", "egusi"],
    },
    seafood: {
      seeds: [
        "grilled fish",
        "fried fish",
        "catfish pepper soup",
        "prawns",
        "seafood okra",
        "fish stew",
        "crab",
        "grilled tilapia",
        "water",
      ],
      excludeTerms: ["pizza", "burger", "fries", "shawarma", "suya", "amala", "pounded yam"],
    },
    chinese_asian: {
      seeds: [
        "fried rice",
        "stir fried vegetables",
        "noodles",
        "spring rolls",
        "steamed rice",
        "vegetable soup",
        "chicken stir fry",
        "water",
      ],
      excludeTerms: ["jollof rice", "amala", "eba", "pounded yam", "egusi", "suya", "moi moi"],
    },
    fine_dining: {
      seeds: [
        "grilled chicken breast",
        "salad",
        "pasta",
        "vegetable side",
        "soup",
        "fish fillet",
        "rice",
        "water",
      ],
      excludeTerms: ["eba", "amala", "suya", "shawarma", "burger", "fries", "meat pie"],
    },
    cafe_bakery: {
      seeds: [
        "whole grain toast",
        "egg sandwich",
        "hot oats",
        "pastry",
        "fruit salad",
        "black coffee",
        "tea",
        "yogurt",
        "water",
      ],
      excludeTerms: ["jollof rice", "amala", "eba", "pounded yam", "egusi", "suya", "grilled fish", "pepper soup"],
    },
    unknown: {
      // unknown gets NO hard seeds — they are derived entirely from metadata signals
      // so they are maximally venue-specific. excludeTerms is the only thing set here.
      seeds: [],
      excludeTerms: ["grilled fish", "catfish pepper soup"], // most over-represented items in model
    },
  },
  CA: {
    canadian_fast_food: {
      seeds: [
        "grilled chicken sandwich",
        "side salad",
        "coleslaw",
        "wrap",
        "soup",
        "fries",
        "water",
      ],
      excludeTerms: ["jollof rice", "amala", "suya", "shawarma", "egusi", "grilled whole fish"],
    },
    pizza_canada: {
      seeds: [
        "thin crust vegetable pizza",
        "chicken pizza",
        "garden salad",
        "pasta",
        "garlic bread",
        "water",
      ],
      excludeTerms: ["jollof rice", "suya", "grilled fish", "poutine"],
    },
    healthy_bowl: {
      seeds: [
        "grain bowl",
        "salad",
        "lentil bowl",
        "smoothie",
        "wrap",
        "vegetable soup",
        "water",
      ],
      excludeTerms: ["fried chicken", "poutine", "pizza", "grilled fish"],
    },
    cafe_canada: {
      seeds: [
        "hot oats",
        "egg sandwich",
        "whole grain toast",
        "black coffee",
        "yogurt parfait",
        "fruit cup",
        "water",
      ],
      excludeTerms: ["poutine", "fried chicken", "pizza", "grilled fish"],
    },
    unknown_canada: {
      seeds: [],
      excludeTerms: ["grilled fish", "poutine"],
    },
  },
};

// ─── Metadata cuisine-signal rules ────────────────────────────────────────────
// Tested against name + types + editorial (NOT address, website, or archetype label)
// to avoid false positive cuisine matches from unrelated text.
// Rules are ordered from most-specific to most-generic.

const METADATA_RULES = [
  {
    match: /shawarma|kebab|falafel|gyro|middle.?east|lebanese/i,
    terms: ["chicken shawarma", "beef shawarma", "falafel wrap", "tabbouleh", "water"],
    category: "levantine",
  },
  {
    match: /suya|asun|kilishi/i,
    terms: ["beef suya", "chicken suya", "asun", "peppered goat meat", "water"],
    category: "nigerian_grill",
  },
  {
    match: /pizza|pizzeria/i,
    terms: ["thin crust vegetable pizza", "chicken pizza", "garden salad", "water"],
    category: "pizza",
  },
  {
    match: /bbq|barbeque|grill/i,
    terms: ["grilled chicken", "bbq ribs", "grilled vegetables", "water"],
    category: "grill",
  },
  {
    match: /seafood|fish(?:erman|monger)?|lobster|crab|prawn|shrimp/i,
    terms: ["grilled tilapia", "seafood okra", "catfish pepper soup", "prawns", "water"],
    category: "seafood",
  },
  {
    match: /cafe|coffee|bakery|pastry|breakfast|brunch|bagel|donut|doughnut/i,
    terms: ["whole grain toast", "egg sandwich", "hot oats", "black coffee", "water"],
    category: "cafe",
  },
  {
    match: /asian|chinese|thai|sushi|korean|vietnam|pho|ramen|wok|teriyaki/i,
    terms: ["stir fried vegetables", "steamed rice", "noodles", "spring rolls", "water"],
    category: "asian",
  },
  {
    match: /indian|punjabi|tandoor|curry|biryani|dosa/i,
    terms: ["tandoori chicken", "dal", "chana masala", "vegetable curry", "water"],
    category: "indian",
  },
  {
    match: /salad|bowl|smoothie|healthy|fresh(?:ii)?/i,
    terms: ["salad", "grain bowl", "smoothie", "lentil bowl", "water"],
    category: "health",
  },
  {
    match: /hotel|suite|lodge|guest.?house|restaurant/i,
    terms: ["rice meal", "vegetable soup", "grilled chicken", "salad", "water"],
    category: "generic_restaurant",
  },
  // Generic fast food — only if nothing more specific matched
  {
    match: /fast.?food|meal_takeaway|quick.?service|takeaway/i,
    terms: ["chicken", "rice", "salad", "wrap", "water"],
    category: "fast_food_generic",
    fallbackOnly: true,
  },
];

// ─── Country prior — used ONLY as last resort when all other sources have
//     produced fewer than MIN_TERMS_BEFORE_PRIOR terms ──────────────────────

const MIN_TERMS_BEFORE_PRIOR = 5;

const COUNTRY_PRIORS = {
  NG: {
    terms: ["jollof rice", "fried rice", "beans porridge", "plantain", "moi moi", "water"],
    confidence: 0.30,
  },
  CA: {
    terms: ["salad", "grain bowl", "soup", "wrap", "grilled chicken", "water"],
    confidence: 0.30,
  },
};

// ─── Utilities ─────────────────────────────────────────────────────────────────

function normalizeTerms(items) {
  return [...new Set(
    items
      .map(item => String(item || "").toLowerCase().trim())
      .filter(item => item.length >= 3)
  )];
}

function parseMenuTerms(menuText) {
  const text = String(menuText || "");
  if (!text.trim()) return [];

  return normalizeTerms(
    text
      .split(/\r?\n|,|;|\|/)
      .map(item => item.replace(/\s+\d+(\.\d{1,2})?$/g, "").trim())
      .filter(item => item.length >= 3)
      .slice(0, 25)
  );
}

/**
 * Greedy term collector — the core of the new deduplication strategy.
 *
 * Instead of collecting all terms then deduplicating at the end (which wastes
 * slots on redundant low-confidence terms), we track a "claimed" set.
 * Each evidence source only contributes terms that haven't been claimed yet.
 * This means high-confidence sources (menu, brand) fill slots first, and
 * low-confidence sources (country prior) only contribute genuinely new terms.
 *
 * @param {string[]} excludeSet  — terms blocked for this archetype/brand
 * @param {number}   maxTerms
 * @returns {{ add(terms, source, confidence): string[], result(): string[] }}
 */
function createGreedyCollector(excludeSet, maxTerms) {
  const claimed  = new Set(normalizeTerms(excludeSet));
  const collected = [];      // [{ term, source, confidence }]

  return {
    /**
     * Add terms from one evidence source.
     * Returns only the terms that were actually accepted (not already claimed,
     * not excluded, not over the cap).
     */
    add(terms, source, confidence) {
      const accepted = [];
      for (const raw of terms) {
        if (collected.length >= maxTerms) break;
        const t = String(raw || "").toLowerCase().trim();
        if (!t || t.length < 3) continue;
        if (claimed.has(t)) continue;
        claimed.add(t);
        collected.push({ term: t, source, confidence });
        accepted.push(t);
      }
      return accepted;
    },
    result() {
      return collected.map(e => e.term);
    },
    entries() {
      return collected;
    },
    size() {
      return collected.length;
    },
  };
}

// ─── Source finders ────────────────────────────────────────────────────────────

function findBrandProfile(countryCode, name) {
  const profiles = BRAND_PROFILES[countryCode] || BRAND_PROFILES.NG;
  // Only match against name — never address, editorial, or website text
  return profiles.find(p => p.match.test(String(name || ""))) || null;
}

/**
 * Returns metadata-derived terms by testing ONLY the food-signal text
 * (name + types + editorial). Address and website are excluded to avoid
 * false cuisine matches from street names or unrelated domain text.
 */
function deriveMetadataTerms(foodSignalText) {
  const text = String(foodSignalText || "");
  const terms = [];
  let genericFallback = null;

  for (const rule of METADATA_RULES) {
    if (rule.fallbackOnly) {
      genericFallback = rule;
      continue;
    }
    if (rule.match.test(text)) {
      terms.push(...rule.terms);
    }
  }

  // Only use generic fast-food fallback if nothing specific matched
  if (terms.length === 0 && genericFallback && genericFallback.match.test(text)) {
    terms.push(...genericFallback.terms);
  }

  return normalizeTerms(terms);
}

/**
 * Returns the archetype seed bank for the given country + archetype.
 * Falls back gracefully if the archetype key is missing.
 */
function getArchetypeBank(countryCode, archetype) {
  const banks = ARCHETYPE_SEED_BANKS[countryCode] || ARCHETYPE_SEED_BANKS.NG;
  return banks[archetype] || banks["unknown"] || { seeds: [], excludeTerms: [] };
}

/**
 * Infers archetype from name etymology patterns.
 * Returns archetype key or null if no pattern matches.
 */
function inferArchetypeFromName(name) {
  const text = String(name || "").toLowerCase();
  
  // Nigerian cultural markers
  if (/\b(mama|iya|buka|bukateria|chophouse|chop|canteen|kitchen|eatery)\b/i.test(text)) {
    return "local_canteen";
  }
  if (/\b(suya|asun|kilishi|grill|roast|bbq|barbeque|smoke|flame)\b/i.test(text)) {
    return "suya_grill";
  }
  if (/\b(pepper.?soup|point.?and.?kill|joint|spot|native)\b/i.test(text)) {
    return "local_canteen"; // pepper soup joints often sell local food too
  }
  if (/\b(seafood|fish|ocean|lagoon|marine|aquatic)\b/i.test(text)) {
    return "seafood";
  }
  if (/\b(shawarma|pizza|wrap|kebab|lebanese|turkish)\b/i.test(text)) {
    return "shawarma_pizza";
  }
  if (/\b(cafe|coffee|bakery|pastry|lounge|bar|bistro)\b/i.test(text)) {
    return "cafe_bakery";
  }
  if (/\b(eko|lagos|naija|9ja|abuja|ile|adun|ibile|afro|yoruba|igbo|hausa)\b/i.test(text)) {
    return "fine_dining";
  }
  
  return null;
}

/**
 * Merges exclusion lists from the archetype bank AND the matched brand profile
 * (if any). This is the complete set of terms that must never appear in output.
 */
function buildExcludeSet(archetypeBank, brandProfile) {
  return [
    ...(archetypeBank.excludeTerms || []),
    ...(brandProfile?.excludeTerms || []),
  ];
}

// ─── Evidence record ───────────────────────────────────────────────────────────

function makeEvidence(source, confidence, terms, reason) {
  return {
    source,
    confidence,
    terms: normalizeTerms(terms),
    reason,
  };
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * generateRestaurantSeeds
 *
 * @param {object} options
 * @param {object} options.place         — Google Places result object
 * @param {string} options.archetype     — classified archetype key
 * @param {string} [options.country]     — ISO country code (default: "NG")
 * @param {string|null} [options.menuText] — raw menu text if available
 * @param {number} [options.maxTerms]    — max seed terms to emit (default: 10)
 *
 * @returns {{
 *   seedTerms: string[],
 *   seedQuery: string,
 *   seedSource: string,
 *   seedConfidence: number,
 *   excludeTerms: string[],
 *   evidence: Array<{ source, confidence, terms, reason }>
 * }}
 */
export function generateRestaurantSeeds({
  place,
  archetype,
  country = "NG",
  menuText = null,
  maxTerms = 10,
}) {
  const countryPack   = loadCountryPack(country);
  const countryCode   = countryPack.countryCode;

  // ── Venue text fields ──────────────────────────────────────────────────────
  const name      = String(place?.name || "").trim();
  const types     = (place?.types || []).join(" ");
  const editorial = String(place?.editorial_summary?.overview || "").trim();

  // Food-signal text: name + types + editorial ONLY.
  // Address and website are intentionally excluded — they cause false cuisine
  // matches (e.g. a street name containing "fish" or a .pizza TLD).
  const foodSignalText = [name, types, editorial].filter(Boolean).join(" ");

  // ── Build archetype bank and exclusion set ─────────────────────────────────
  const archetypeBank = getArchetypeBank(countryCode, archetype);
  const brandProfile  = findBrandProfile(countryCode, name);
  const excludeSet    = buildExcludeSet(archetypeBank, brandProfile);

  // ── Collector — greedy, exclusion-aware, capped at maxTerms ───────────────
  const collector = createGreedyCollector(excludeSet, maxTerms);
  const evidence  = [];

  // ── Source 1: Menu text (highest confidence) ───────────────────────────────
  const menuTerms = parseMenuTerms(menuText);
  if (menuTerms.length) {
    const accepted = collector.add(menuTerms, "menu_text", 0.98);
    if (accepted.length) {
      evidence.push(makeEvidence(
        "menu_text",
        0.98,
        accepted,
        "Terms extracted directly from the venue's menu — highest signal fidelity.",
      ));
    }
  }

  // ── Source 2: Brand profile (second highest) ───────────────────────────────
  if (brandProfile) {
    const accepted = collector.add(brandProfile.terms, `brand_profile:${brandProfile.id}`, 0.90);
    if (accepted.length) {
      evidence.push(makeEvidence(
        `brand_profile:${brandProfile.id}`,
        0.90,
        accepted,
        `Recognised chain "${brandProfile.id}" — known menu profile applied.`,
      ));
    }
  }

  // ── Source 3: Archetype seed bank ─────────────────────────────────────────
  // Unknown archetype intentionally has no seeds here — we rely on metadata
  // signals to be maximally venue-specific rather than emitting generic terms.
  if (archetypeBank.seeds.length) {
    const accepted = collector.add(archetypeBank.seeds, "archetype_bank", 0.72);
    if (accepted.length) {
      const conf = archetype === countryPack.unknownArchetype ? 0.42 : 0.72;
      evidence.push(makeEvidence(
        "archetype_bank",
        conf,
        accepted,
        `Archetype "${archetype}" seed bank — venue-type-specific food terms.`,
      ));
    }
  }

  // ── Source 4: Metadata cuisine signals ────────────────────────────────────
  const metaTerms = deriveMetadataTerms(foodSignalText);
  if (metaTerms.length) {
    const accepted = collector.add(metaTerms, "metadata_signal", 0.65);
    if (accepted.length) {
      evidence.push(makeEvidence(
        "metadata_signal",
        0.65,
        accepted,
        "Cuisine signals extracted from venue name, Google types, and editorial summary.",
      ));
    }
  }

  // ── Source 4.5: AI seed inference (for unknown archetype with weak metadata) ─
  // Only fires when archetype is unknown AND we have few terms so far.
  // Uses LLM to intelligently infer likely menu items from name + types + editorial.
  const isUnknown = archetype === countryPack.unknownArchetype || 
                    archetype === "unknown" || 
                    archetype === "unknown_canada";
  if (isUnknown && collector.size() < 5) {
    // Try name etymology first (fast, no API call)
    const nameInferredArchetype = inferArchetypeFromName(name);
    if (nameInferredArchetype) {
      const inferredBank = getArchetypeBank(countryCode, nameInferredArchetype);
      if (inferredBank.seeds.length) {
        const accepted = collector.add(inferredBank.seeds, "name_etymology", 0.58);
        if (accepted.length) {
          evidence.push(makeEvidence(
            "name_etymology",
            0.58,
            accepted,
            `Name contains "${nameInferredArchetype}" cultural markers — using inferred archetype seeds.`,
          ));
        }
      }
    }
    
    // If still need more terms, use AI to generate seeds
    // Note: This is marked for async implementation - placeholder returns empty for now
    // TODO: Implement inferSeedsWithAI(name, types, editorial, countryCode)
  }

  // ── Source 5: Country prior — only if we still need more terms ────────────
  const prior = COUNTRY_PRIORS[countryCode] || COUNTRY_PRIORS.NG;
  if (collector.size() < MIN_TERMS_BEFORE_PRIOR) {
    const accepted = collector.add(prior.terms, "country_prior", prior.confidence);
    if (accepted.length) {
      evidence.push(makeEvidence(
        "country_prior",
        prior.confidence,
        accepted,
        `Country prior (${countryCode}) used as last-resort fallback — low confidence.`,
      ));
    }
  }

  // ── Finalise ───────────────────────────────────────────────────────────────
  const seedTerms = collector.result();

  // Primary source = highest-confidence evidence entry
  const topEvidence = evidence.length
    ? evidence.reduce((best, e) => (e.confidence > best.confidence ? e : best), evidence[0])
    : null;

  return {
    seedTerms,
    seedQuery: seedTerms.join("; "),
    seedSource: topEvidence?.source || "none",
    seedConfidence: topEvidence?.confidence || 0,
    excludeTerms: [...new Set(normalizeTerms(excludeSet))],
    evidence,
  };
}