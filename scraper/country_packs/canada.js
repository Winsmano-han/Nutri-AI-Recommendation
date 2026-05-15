const archetypes = {
  canadian_fast_food:    "Canadian fast food chain or quick-service restaurant",
  coffee_bakery:         "Coffee shop, cafe, bakery, or breakfast pastry spot",
  casual_dining:         "Canadian casual dining restaurant or pub-style restaurant",
  pizza_canada:          "Pizza restaurant common in Canada",
  burger_grill_canada:   "Burger, grill, or sandwich restaurant common in Canada",
  asian_canadian:        "Asian restaurant in Canada (Chinese, Japanese, Thai, Korean, Vietnamese)",
  middle_eastern_canada: "Middle Eastern, shawarma, kebab, or Mediterranean restaurant in Canada",
  indian_canada:         "Indian or South Asian restaurant in Canada",
  caribbean_canada:      "Caribbean restaurant in Canada",
  healthy_bowl_salad:    "Health-focused salad, bowl, smoothie, or fresh food restaurant",
  seafood_canada:        "Seafood restaurant in Canada",
  breakfast_brunch:      "Breakfast or brunch restaurant in Canada",
  unknown_canada:        "Restaurant type could not be determined — Canadian restaurant guidance likely",
};

const archetypeSeeds = {
  canadian_fast_food:    ["grilled chicken sandwich", "side salad", "apple slices", "burger", "fries", "sugary drink"],
  coffee_bakery:         ["oatmeal", "egg breakfast sandwich", "whole grain toast", "black coffee", "muffin", "donut", "sweetened latte"],
  casual_dining:         ["grilled salmon", "chicken salad", "vegetable soup", "steak with vegetables", "poutine", "fried wings"],
  pizza_canada:          ["thin crust vegetable pizza", "grilled chicken pizza", "garden salad", "pepperoni pizza", "cheesy bread"],
  burger_grill_canada:   ["grilled chicken sandwich", "lettuce wrap burger", "side salad", "beef burger", "fries", "milkshake"],
  asian_canadian:        ["steamed rice vegetables", "stir fried vegetables", "grilled teriyaki chicken", "fried rice", "sweet sour chicken"],
  middle_eastern_canada: ["chicken shawarma plate", "falafel salad", "lentil soup", "tabbouleh", "shawarma wrap", "garlic potatoes"],
  indian_canada:         ["tandoori chicken", "dal", "chana masala", "vegetable curry", "naan", "butter chicken"],
  caribbean_canada:      ["jerk chicken", "rice and peas", "vegetable stew", "curry goat", "fried plantain", "patty"],
  healthy_bowl_salad:    ["grain bowl", "salad with grilled chicken", "lentil bowl", "vegetable soup", "smoothie", "sweetened juice"],
  seafood_canada:        ["grilled salmon", "baked cod", "shrimp salad", "fish and chips", "clam chowder"],
  breakfast_brunch:      ["oatmeal", "egg omelette vegetables", "whole grain toast", "fruit bowl", "pancakes syrup", "bacon"],
  unknown_canada:        ["grilled chicken", "vegetable salad", "whole grain sandwich", "vegetable soup", "fries", "sugary drink"],
};

function classifyByPattern(name, types) {
  const n = String(name || "").toLowerCase();
  const t = (types || []).join(" ").toLowerCase();

  if (n.match(/tim hortons?|starbucks|second cup|coffee|cafe|bakery|bagel|donut|doughnut/)) return "coffee_bakery";
  if (n.match(/mcdonald|wendy|a&w|harvey|subway|popeyes|kfc|burger king|dairy queen|taco bell/)) return "canadian_fast_food";
  if (n.match(/pizza|domino|pizza pizza|pizzaiolo|little caesars|241 pizza|panago/)) return "pizza_canada";
  if (n.match(/burger|grill|smash|sandwich|deli/)) return "burger_grill_canada";
  if (n.match(/sushi|thai|chinese|korean|vietnam|pho|ramen|wok|asian|teriyaki/)) return "asian_canadian";
  if (n.match(/shawarma|kebab|falafel|lebanese|middle.?east|mediterranean|gyro/)) return "middle_eastern_canada";
  if (n.match(/indian|punjabi|tandoor|curry|biryani|dosa|pakistani|south asian/)) return "indian_canada";
  if (n.match(/caribbean|jamaican|jerk|roti|trini|west indian/)) return "caribbean_canada";
  if (n.match(/salad|freshii|fresh|bowl|smoothie|juice|healthy/)) return "healthy_bowl_salad";
  if (n.match(/seafood|fish|lobster|oyster|clam|crab/)) return "seafood_canada";
  if (n.match(/breakfast|brunch|pancake|waffle|egg/)) return "breakfast_brunch";
  if (t.includes("cafe") || t.includes("bakery")) return "coffee_bakery";
  if (t.includes("fast_food") || t.includes("meal_takeaway")) return "canadian_fast_food";
  return null;
}

export default {
  countryCode: "CA",
  countryLabel: "Canadian",
  contractFile: "nutrition_contract_canada.json",
  baselineName: "Canada's Food Guide",
  modelMode: "canada_fallback_ai",
  unknownArchetype: "unknown_canada",
  archetypes,
  archetypeSeeds,
  classifyByPattern,
};
