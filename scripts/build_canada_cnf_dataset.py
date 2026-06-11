#!/usr/bin/env python3
"""Build a Canada training dataset from Health Canada's Canadian Nutrient File API.

The raw nutrient amount endpoint is large, so this script stores it compressed
locally and emits a compact CSV with the same core schema used by the Nigerian
food recommender training data.
"""

from __future__ import annotations

import csv
import gzip
import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw" / "canada_cnf_2026"
FINAL_PATH = ROOT / "data" / "final" / "canada_dish_features_cnf_2026.csv"
BASE_URL = "https://food-nutrition.canada.ca/api/canadian-nutrient-file"

ENDPOINTS = {
    "food": f"{BASE_URL}/food/?lang=en&type=json",
    "nutrient_name": f"{BASE_URL}/nutrientname/?lang=en&type=json",
    "nutrient_amount": f"{BASE_URL}/nutrientamount/?lang=en&type=json",
}

# Canonical output nutrient -> accepted CNF nutrient_web_name values.
NUTRIENT_ALIASES = {
    "est_energy_kcal": ["Energy (kcal)"],
    "est_protein_g": ["Protein"],
    "est_fat_total_g": ["Total Fat", "Fat (Total Lipids)", "Fat, total"],
    "est_carbs_total_g": ["Carbohydrate", "Carbohydrate, total"],
    "est_fiber_g": ["Fibre, total dietary"],
    "est_sugar_total_g": ["Sugars, total"],
    "est_sodium_mg": ["Sodium, Na"],
    "est_sat_fat_g": ["Fatty acids, saturated, total", "Saturated fatty acids, total"],
}

CSV_FIELDS = [
    "dish_id",
    "dish_name",
    "main_ingredients",
    "description",
    "health_label",
    "food_class",
    "region",
    "spice_level",
    "price_range",
    "est_energy_kcal",
    "est_protein_g",
    "est_fat_total_g",
    "est_carbs_total_g",
    "est_fiber_g",
    "est_sugar_total_g",
    "est_sodium_mg",
    "has_recipe",
    "recipe_name",
    "recipe_procedures",
    "flag_diabetes_risk",
    "flag_hypertension_risk",
    "data_source",
    "source_food_code",
    "canada_food_guide_group",
    "est_sat_fat_g",
]


def download(url: str, path: Path, compress: bool = False) -> None:
    if path.exists() and path.stat().st_size > 0:
        print(f"Using cached {path.relative_to(ROOT)}")
        return

    print(f"Downloading {url}")
    request = Request(url, headers={"User-Agent": "NutrifenceDatasetBuilder/1.0"})
    with urlopen(request, timeout=180) as response:
        data = response.read()

    path.parent.mkdir(parents=True, exist_ok=True)
    if compress:
        with gzip.open(path, "wb") as f:
            f.write(data)
    else:
        path.write_bytes(data)
    print(f"Saved {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


def load_json(path: Path):
    if path.suffix == ".gz":
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_number(value):
    if value in (None, "", "N/A"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:64]


def classify_food(name: str) -> tuple[str, str]:
    n = name.lower()
    has_word = lambda pattern: re.search(pattern, n) is not None
    dessertish = any(k in n for k in ["cake", "cookie", "candy", "chocolate", "ice cream", "dessert", "pie", "pudding", "doughnut", "donut"])
    restaurant_main = (
        any(k in n for k in ["pizza", "poutine", "wrap", "entrée", "entree", "meal", "dinner", "french fried potatoes", "fries"]) or
        has_word(r"\b(cheeseburger|hamburger|burger)\b") or
        ("sandwich" in n and not dessertish)
    )
    if restaurant_main:
        return "main_dish", "mixed_dish"
    if any(k in n for k in ["soup", "stew", "chili", "sauce"]):
        return "soup", "mixed_dish"
    if any(k in n for k in ["salad", "coleslaw", "vegetable", "broccoli", "carrot", "spinach", "lettuce", "tomato"]):
        return "side", "vegetables_and_fruits"
    if any(k in n for k in ["apple", "banana", "orange", "berry", "fruit", "grape", "melon", "peach"]):
        return "snack", "vegetables_and_fruits"
    if any(k in n for k in ["beef", "chicken", "turkey", "pork", "fish", "salmon", "tuna", "egg", "tofu", "bean", "lentil", "pea"]):
        return "protein", "protein_foods"
    if any(k in n for k in ["milk", "yogurt", "cheese", "dairy"]):
        return "protein", "protein_foods"
    if has_word(r"\b(juice|drink|beverage|coffee|tea|soda|pop|water)\b"):
        return "drink", "beverages"
    if dessertish:
        return "dessert", "other_foods"
    if any(k in n for k in ["bread", "rice", "pasta", "cereal", "oat", "wheat", "grain", "bagel", "tortilla"]):
        return "main_dish", "whole_grain_foods"
    if any(k in n for k in ["nut", "seed", "chips", "cracker", "snack"]):
        return "snack", "other_foods"
    return "main_dish", "mixed_dish"


def infer_health_label(name: str, nutrients: dict) -> str:
    n = name.lower()
    energy = nutrients.get("est_energy_kcal") or 0
    sugar = nutrients.get("est_sugar_total_g") or 0
    sodium = nutrients.get("est_sodium_mg") or 0
    sat_fat = nutrients.get("est_sat_fat_g") or 0
    fiber = nutrients.get("est_fiber_g") or 0
    protein = nutrients.get("est_protein_g") or 0

    limit_keywords = ["fried", "deep fried", "candy", "chocolate", "soda", "pop", "cake", "cookie", "donut", "doughnut", "poutine"]
    if sodium >= 900 or sugar >= 25 or sat_fat >= 10 or energy >= 800 or any(k in n for k in limit_keywords):
        return "limit"
    if (fiber >= 4 or protein >= 12) and sodium < 600 and sugar < 15 and sat_fat < 5:
        return "fbdg_friendly"
    return "moderate"


def build_dataset() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    download(ENDPOINTS["food"], RAW_DIR / "food.json")
    download(ENDPOINTS["nutrient_name"], RAW_DIR / "nutrient_name.json")
    download(ENDPOINTS["nutrient_amount"], RAW_DIR / "nutrient_amount.json.gz", compress=True)

    foods = load_json(RAW_DIR / "food.json")
    nutrient_amounts = load_json(RAW_DIR / "nutrient_amount.json.gz")

    food_map = {str(item["food_code"]): item["food_description"] for item in foods}
    nutrient_by_food: dict[str, dict[str, float]] = {code: {} for code in food_map}

    alias_to_field = {
        alias.lower(): field
        for field, aliases in NUTRIENT_ALIASES.items()
        for alias in aliases
    }

    for item in nutrient_amounts:
        field = alias_to_field.get(str(item.get("nutrient_web_name", "")).lower())
        if not field:
            continue
        code = str(item.get("food_code"))
        if code not in nutrient_by_food:
            continue
        value = normalize_number(item.get("nutrient_value"))
        if value is not None:
            nutrient_by_food[code][field] = value

    rows = []
    for code, name in food_map.items():
        nutrients = nutrient_by_food.get(code, {})
        # Keep only foods with enough core nutrition data for model training.
        required = ["est_energy_kcal", "est_protein_g", "est_fat_total_g", "est_carbs_total_g", "est_sodium_mg"]
        if not all(k in nutrients for k in required):
            continue

        food_class, cfg_group = classify_food(name)
        health_label = infer_health_label(name, nutrients)
        diabetes_risk = bool((nutrients.get("est_sugar_total_g") or 0) >= 20 or ((nutrients.get("est_carbs_total_g") or 0) >= 70 and (nutrients.get("est_fiber_g") or 0) < 5))
        hypertension_risk = bool((nutrients.get("est_sodium_mg") or 0) >= 700)

        row = {
            "dish_id": f"ca_cnf_{code}",
            "dish_name": name,
            "main_ingredients": name,
            "description": f"Canadian Nutrient File food item: {name}. Nutrient values are reported per 100 g edible portion.",
            "health_label": health_label,
            "food_class": food_class,
            "region": "Canada",
            "spice_level": "mild",
            "price_range": "moderate",
            "est_energy_kcal": nutrients.get("est_energy_kcal"),
            "est_protein_g": nutrients.get("est_protein_g"),
            "est_fat_total_g": nutrients.get("est_fat_total_g"),
            "est_carbs_total_g": nutrients.get("est_carbs_total_g"),
            "est_fiber_g": nutrients.get("est_fiber_g"),
            "est_sugar_total_g": nutrients.get("est_sugar_total_g"),
            "est_sodium_mg": nutrients.get("est_sodium_mg"),
            "has_recipe": False,
            "recipe_name": "",
            "recipe_procedures": "",
            "flag_diabetes_risk": diabetes_risk,
            "flag_hypertension_risk": hypertension_risk,
            "data_source": "Health Canada Canadian Nutrient File 2026 API",
            "source_food_code": code,
            "canada_food_guide_group": cfg_group,
            "est_sat_fat_g": nutrients.get("est_sat_fat_g"),
        }
        rows.append(row)

    rows.sort(key=lambda r: (r["food_class"], r["dish_name"]))
    FINAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with FINAL_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    source_md = RAW_DIR / "SOURCE.md"
    source_md.write_text(
        "# Canada CNF 2026 Raw Dataset\n\n"
        "Source: Health Canada Canadian Nutrient File (CNF) API.\n\n"
        "The CNF is the standard reference food composition database for foods commonly consumed in Canada. "
        "The API provides food descriptions, nutrient names, and nutrient amounts per 100 g edible portion.\n\n"
        "Downloaded endpoints:\n"
        f"- {ENDPOINTS['food']}\n"
        f"- {ENDPOINTS['nutrient_name']}\n"
        f"- {ENDPOINTS['nutrient_amount']}\n\n"
        "Generated training CSV:\n"
        f"- {FINAL_PATH.relative_to(ROOT)}\n",
        encoding="utf-8",
    )

    print(f"Wrote {FINAL_PATH.relative_to(ROOT)} with {len(rows):,} rows")
    print(f"Wrote {source_md.relative_to(ROOT)}")


if __name__ == "__main__":
    try:
        build_dataset()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
