# Nutrifence — Lagos Menu Scraper

This script generates a real `menu_lagos.json` for the Nutrifence Flutter app by:

1. Searching Google Maps for restaurants across 4 Lagos areas (Lagos Island, VI, Ikeja, Lekki)
2. Fetching place details for each one (address, website, cuisine info)
3. Attempting to fetch and read each restaurant's website/menu page
4. Sending all that context to Groq AI to extract structured menu items
5. Outputting `menu_lagos.json` in the exact format the Flutter app expects

---

## Setup

### Requirements
- Node.js 18+
- A Google Maps API key (same one from the Flutter app's `assets/env/maps.env`)
- A Groq API key (get one at https://console.groq.com)

### Make sure these APIs are enabled in Google Cloud Console
- **Places API** (for nearby search + place details)

### Steps

```bash
# 1. Go into this folder
cd scraper/

# 2. Copy the example env file and fill in your keys
cp ../env.example .env
# Edit .env and add your GOOGLE_MAPS_API_KEY and GROQ_API_KEY

# 3. Run it (no npm install needed — uses only Node built-ins)
node scrape_menus.js
```

That's it. No dependencies to install — the script uses only Node's built-in `fetch` (available since Node 18).

---

## Output

The script writes `menu_lagos.json` in the same folder. Drop it into:

```
your_flutter_project/assets/mock/menu_lagos.json
```

The Flutter app will pick it up automatically — no code changes needed.

---

## Output JSON structure

```json
{
  "_meta": { ... },
  "venues": [
    {
      "id": "ChIJ...",          // Google Place ID
      "name": "Yellow Chilli",
      "address": "...",
      "lat": 6.4281,
      "lng": 3.4219,
      "cuisineTags": ["nigerian", "continental"],
      "rating": 4.2,
      "priceLevel": 2,
      "website": "https://..."
    }
  ],
  "menus": {
    "ChIJ...": [
      {
        "id": "yellow_chilli_001",
        "name": "Jollof Rice with Chicken",
        "description": "...",
        "ingredients": ["rice", "tomato", "chicken", ...],
        "allergens": [],
        "cuisineTags": ["nigerian"],
        "nutritionPer100g": {
          "calories": 180,
          "proteinG": 12,
          "carbsG": 24,
          "fatG": 5,
          "sodiumMg": 420,
          "sugarG": 2,
          "fiberG": 1
        },
        "priceNaira": 3500,
        "isVegetarian": false,
        "isVegan": false,
        "spiceLevel": "medium"
      }
    ]
  }
}
```

---

## Tuning

Edit the config block at the top of `scrape_menus.js`:

| Constant | Default | What it does |
|---|---|---|
| `SEARCH_RADIUS` | `5000` | Radius in metres per search |
| `TARGET_RESTAURANT_COUNT` | `30` | How many restaurants to process |
| `searchCenters` | 4 Lagos areas | Where to search — add more for broader coverage |

---

## Notes

- The script is rate-aware: it adds short delays between API calls to avoid hitting Google's QPS limits.
- If no clear menu evidence is available for a restaurant, the scraper returns no items for that venue instead of inventing data.
- If Groq returns malformed JSON, the script does a second repair pass automatically.
- The `_meta` block is ignored by the Flutter app's `MockVenueMenuRepository` — it's just for your reference.

# Nutri-AI-Recommendation
