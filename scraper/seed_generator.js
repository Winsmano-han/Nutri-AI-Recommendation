import { loadCountryPack } from "./country_packs/index.js";

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
  {
    country: "CA",
    id: "tim_hortons",
    match: /tim hortons?/i,
    terms: ["hot oats", "egg breakfast sandwich", "whole grain toast", "black coffee", "muffin", "donut", "sweetened latte"],
  },
  {
    country: "CA",
    id: "swiss_chalet",
    match: /swiss chalet/i,
    terms: ["rotisserie chicken", "side salad", "vegetables", "baked potato", "fries", "gravy"],
  },
  {
    country: "CA",
    id: "freshii",
    match: /freshii/i,
    terms: ["grain bowl", "salad", "grilled chicken", "lentil bowl", "smoothie", "sweetened juice"],
  },
  {
    country: "CA",
    id: "dominos",
    match: /domino'?s?/i,
    terms: ["thin crust vegetable pizza", "grilled chicken pizza", "garden salad", "pepperoni pizza", "cheesy bread", "soda"],
  },
  {
    country: "CA",
    id: "kfc",
    match: /\bkfc\b/i,
    terms: ["grilled chicken sandwich", "fried chicken", "coleslaw", "side salad", "fries", "soft drink"],
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
  CA: ["grilled chicken", "vegetable salad", "whole grain sandwich", "vegetable soup", "baked salmon", "water"],
};

function unique(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function parseMenuTerms(menuText) {
  const text = String(menuText || "");
  if (!text.trim()) return [];

  return unique(
    text
      .split(/\r?\n|,|;|\|/)
      .map((item) => item.replace(/\s+\d+(\.\d{1,2})?$/g, "").trim())
      .filter((item) => item.length >= 3)
      .slice(0, 20)
  );
}

function scoreEvidence({ source, confidence, terms, reason }) {
  return { source, confidence, terms: unique(terms), reason };
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

function archetypeTerms(countryPack, archetype) {
  return unique(countryPack.archetypeSeeds?.[archetype] || []);
}

export function generateRestaurantSeeds({
  place,
  archetype,
  country = "NG",
  menuText = null,
  maxTerms = 10,
}) {
  const countryPack = loadCountryPack(country);
  const name = place?.name || "";
  const address = place?.formatted_address || place?.vicinity || "";
  const types = (place?.types || []).join(" ");
  const editorial = place?.editorial_summary?.overview || "";
  const website = place?.website || "";
  const text = [name, address, types, editorial, website, archetype, countryPack.archetypes?.[archetype]]
    .filter(Boolean)
    .join(" ");
  const foodSignalText = [name, types, editorial, archetype, countryPack.archetypes?.[archetype]]
    .filter(Boolean)
    .join(" ");

  const evidence = [];
  const menuTerms = parseMenuTerms(menuText);
  if (menuTerms.length) {
    evidence.push(scoreEvidence({
      source: "menu_text",
      confidence: 0.98,
      terms: menuTerms,
      reason: "Seed terms were extracted from supplied menu text.",
    }));
  }

  // Brand profiles should match the venue name only. Full metadata can contain
  // unrelated domains, addresses, or summaries that create false brand matches.
  const brand = findBrandProfile(countryPack.countryCode, name);
  if (brand) {
    evidence.push(scoreEvidence({
      source: `brand_profile:${brand.id}`,
      confidence: 0.9,
      terms: brand.terms,
      reason: `Known brand profile matched restaurant metadata.`,
    }));
  }

  const metadata = metadataTerms(foodSignalText);
  if (metadata.length) {
    evidence.push(scoreEvidence({
      source: "google_metadata",
      confidence: 0.72,
      terms: metadata,
      reason: "Google Places name/types/address/website contain food or cuisine signals.",
    }));
  }

  const fromArchetype = archetypeTerms(countryPack, archetype);
  if (fromArchetype.length) {
    evidence.push(scoreEvidence({
      source: "restaurant_archetype",
      confidence: archetype === countryPack.unknownArchetype ? 0.42 : 0.62,
      terms: fromArchetype,
      reason: "Fallback terms from the classified restaurant archetype.",
    }));
  }

  evidence.push(scoreEvidence({
    source: "country_prior",
    confidence: 0.35,
    terms: COUNTRY_PRIORS[countryPack.countryCode] || COUNTRY_PRIORS.NG,
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
