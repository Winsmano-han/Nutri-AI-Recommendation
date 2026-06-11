#!/usr/bin/env node

import { generateRestaurantSeeds } from "../scraper/seed_generator.js";
import { loadCountryPack } from "../scraper/country_packs/index.js";

const cases = [
  {
    label: "Known brand: Domino's Nigeria",
    country: "NG",
    archetype: "fast_food_western",
    place: {
      name: "Domino's Pizza Ring Road",
      formatted_address: "MKO Abiola Way, Ibadan, Nigeria",
      types: ["restaurant", "meal_takeaway", "food"],
      website: "https://dominos.ng",
    },
  },
  {
    label: "Known brand: Chicken Republic",
    country: "NG",
    archetype: "fast_food_nigerian",
    place: {
      name: "Chicken Republic - Lekki",
      formatted_address: "Lekki Phase 1, Lagos, Nigeria",
      types: ["restaurant", "fast_food", "food"],
    },
  },
  {
    label: "Weak name: hotel restaurant",
    country: "NG",
    archetype: "unknown",
    place: {
      name: "Horizon Suite Hotel",
      formatted_address: "Oluyole, Ibadan, Nigeria",
      types: ["lodging", "restaurant", "food"],
    },
  },
  {
    label: "Weak name: local Nigerian restaurant",
    country: "NG",
    archetype: "fine_dining_nigerian",
    place: {
      name: "Adùn",
      formatted_address: "Ibadan, Oyo, Nigeria",
      types: ["restaurant", "food"],
      editorial_summary: { overview: "Local Nigerian restaurant serving meals in a sit-down setting." },
    },
  },
  {
    label: "Ambiguous but cuisine signal: Zen Garden",
    country: "NG",
    archetype: "chinese_continental",
    place: {
      name: "Zen Garden",
      formatted_address: "Lagos, Nigeria",
      types: ["restaurant", "food"],
      editorial_summary: { overview: "Chinese and Asian dining restaurant." },
    },
  },
  {
    label: "Menu text beats weak name",
    country: "NG",
    archetype: "unknown",
    place: {
      name: "Mainstay Suites",
      formatted_address: "Akala Express, Ibadan, Nigeria",
      types: ["lodging", "restaurant", "food"],
    },
    menuText: "Grilled fish\nVegetable soup\nJollof rice with chicken\nFried yam\nPepper soup\nFresh salad",
  },
  {
    label: "Known brand: Tim Hortons Canada",
    country: "CA",
    archetype: "coffee_bakery",
    place: {
      name: "Tim Hortons",
      formatted_address: "Toronto, Ontario, Canada",
      types: ["cafe", "bakery", "restaurant", "food"],
    },
  },
  {
    label: "Canada weak name but type says casual dining",
    country: "CA",
    archetype: "casual_dining",
    place: {
      name: "The Local",
      formatted_address: "Toronto, Ontario, Canada",
      types: ["restaurant", "bar", "food"],
      editorial_summary: { overview: "Casual dining and pub-style restaurant." },
    },
  },
  {
    label: "Canada cuisine signal: Shawarma Palace",
    country: "CA",
    archetype: "middle_eastern_canada",
    place: {
      name: "Shawarma Palace",
      formatted_address: "Ottawa, Ontario, Canada",
      types: ["restaurant", "meal_takeaway", "food"],
    },
  },
];

const start = performance.now();

for (const testCase of cases) {
  const pack = loadCountryPack(testCase.country);
  const result = generateRestaurantSeeds(testCase);
  const oldSeeds = pack.archetypeSeeds[testCase.archetype] || [];

  console.log("\n" + "=".repeat(88));
  console.log(testCase.label);
  console.log(`Country: ${testCase.country}`);
  console.log(`Restaurant: ${testCase.place.name}`);
  console.log(`Archetype: ${testCase.archetype}`);
  console.log(`Old archetype seeds: ${oldSeeds.join(" | ")}`);
  console.log(`New seed source: ${result.seedSource}`);
  console.log(`New seed confidence: ${result.seedConfidence}`);
  console.log(`New seed terms: ${result.seedTerms.join(" | ")}`);
  console.log("Evidence:");
  for (const evidence of result.evidence.slice(0, 4)) {
    console.log(`- ${evidence.source} (${evidence.confidence}): ${evidence.terms.join(" | ")}`);
  }
}

const elapsed = performance.now() - start;
console.log("\n" + "=".repeat(88));
console.log(`Generated ${cases.length} seed sets in ${elapsed.toFixed(2)} ms`);
