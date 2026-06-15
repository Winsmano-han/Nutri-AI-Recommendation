const archetypes = {
  fast_food_nigerian:   "Nigerian fast food chain (Chicken Republic, Mr Bigg's, Tastee Fried Chicken)",
  fast_food_western:    "Western fast food chain (KFC, Domino's, Subway, Burger King)",
  local_canteen:        "Local Nigerian canteen or buka (mama put, local chop house)",
  suya_grill:           "Suya spot or roadside Nigerian grill (suya, asun, kilishi)",
  seafood_joint:        "Seafood restaurant (fresh fish, prawns, crab, lobster)",
  pepper_soup_joint:    "Pepper soup bar or Nigerian pub-style spot",
  chinese_continental:  "Chinese or continental/intercontinental restaurant",
  shawarma_pizza:       "Shawarma, pizza, or Middle Eastern fast food spot",
  fine_dining_nigerian: "Upscale Nigerian or Afro-fusion fine dining restaurant",
  unknown:              "Restaurant type could not be determined — Nigerian food likely",
};

const archetypeSeeds = {
  fast_food_nigerian:   ["jollof rice chicken", "fried rice", "coleslaw", "moi moi", "puff puff", "meat pie"],
  fast_food_western:    ["fried chicken", "burger", "french fries", "chicken wrap", "coleslaw", "chicken tenders"],
  local_canteen:        ["egusi soup", "vegetable soup", "beans porridge", "jollof rice", "amala ewedu", "ofada rice"],
  suya_grill:           ["beef suya", "chicken suya", "asun peppered goat", "grilled fish", "yaji spice", "fried plantain"],
  seafood_joint:        ["peppered fish", "grilled tilapia", "catfish pepper soup", "prawn stir fry", "seafood okra soup", "fish stew"],
  pepper_soup_joint:    ["goat meat pepper soup", "catfish pepper soup", "cow leg pepper soup", "chicken pepper soup", "assorted meat pepper soup", "point and kill"],
  chinese_continental:  ["fried rice", "noodles", "sweet sour chicken", "vegetable stir fry", "spring rolls", "egg fried rice"],
  shawarma_pizza:       ["chicken shawarma", "beef shawarma", "pepperoni pizza", "chicken pizza", "vegetable pizza", "cheese pizza"],
  fine_dining_nigerian: ["ofada rice ayamase", "banga soup starch", "oha soup", "nkwobi", "abacha", "ugba"],
  unknown:              ["jollof rice", "vegetable soup", "beans", "fried rice", "pepper soup", "plantain"],
};

function classifyByPattern(name, types) {
  const n = String(name || "").toLowerCase();
  const t = (types || []).join(" ").toLowerCase();

  if (n.match(/chicken republic|mr bigg|tastee|tantalizer|sweet sensation|debonairs/)) return "fast_food_nigerian";
  if (n.match(/\bkfc\b|domino|subway|burger king|cold stone|pizza hut|hardee/)) return "fast_food_western";
  if (n.match(/suya|asun|kilishi|bbq|barbeque|grill(?!e)/) && !n.match(/restaurant/)) return "suya_grill";
  if (n.match(/seafood|lobster|crab|prawn|fish ?house|fish ?spot/)) return "seafood_joint";
  if (n.match(/pepper.?soup|nkwobi|point.?and.?kill/)) return "pepper_soup_joint";
  if (n.match(/chinese|asian|wok|dragon|jade|dynasty|continental|intercontinental/)) return "chinese_continental";
  if (n.match(/shawarma|pizza|wraps?|middle.?east|lebanese|turkish/) && !n.match(/hotel|suite|lodge/)) return "shawarma_pizza";
  if (n.match(/restaurant(?! canteen| buka)/) && t.includes("restaurant") && !t.includes("fast_food")) return null;
  if (t.includes("fast_food") || t.includes("meal_takeaway")) return "fast_food_nigerian";
  if (n.match(/mama|buka|bukas|canteen|eatery|chophouse|chop.?house|joint|spot/)) return "local_canteen";
  if (n.match(/ad[uù]n|ile|eko|naija|9ja|afro|lagos|abuja|ibile/)) return "fine_dining_nigerian";
  return null;
}

export default {
  countryCode: "NG",
  countryLabel: "Nigerian",
  contractFile: "nutrition_contract.json",
  baselineName: "Nigerian Food-Based Dietary Guidelines",
  modelMode: "nigeria_model",
  unknownArchetype: "unknown",
  archetypes,
  archetypeSeeds,
  classifyByPattern,
};
