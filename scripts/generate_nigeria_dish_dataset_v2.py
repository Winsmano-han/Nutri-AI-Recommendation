from __future__ import annotations

import csv
from pathlib import Path

OUT = Path("data/final/nigeria_dish_features_v2.csv")

COLUMNS = [
    "dish_id", "dish_name", "main_ingredients", "description", "health_label",
    "food_class", "region", "spice_level", "price_range",
    "est_energy_kcal", "est_protein_g", "est_fat_total_g", "est_carbs_total_g",
    "est_fiber_g", "est_sugar_total_g", "est_sodium_mg", "has_recipe",
    "recipe_name", "recipe_procedures", "flag_diabetes_risk", "flag_hypertension_risk",
]

REGION_BY_CUISINE = {
    "yoruba": "South-West",
    "igbo": "South-East",
    "hausa": "North",
    "niger_delta": "South-South",
    "middle_belt": "Middle Belt",
    "urban": "Nationwide",
    "street": "Nationwide",
    "fast_food": "Nationwide",
    "continental_ng": "Nationwide",
}

BASES = [
    # Yoruba / South-West
    ("Amala", "yam flour, water", "swallow", "yoruba", "mild", "inexpensive", 330, 6, 1, 74, 5, 1, 80),
    ("Ewedu Soup", "ewedu leaves, locust beans, crayfish", "soup", "yoruba", "mild", "inexpensive", 140, 8, 6, 13, 6, 2, 520),
    ("Gbegiri Soup", "beans, palm oil, pepper, locust beans", "soup", "yoruba", "medium", "inexpensive", 210, 12, 8, 24, 8, 3, 620),
    ("Efo Riro", "spinach, pepper, palm oil, fish, meat", "soup", "yoruba", "medium", "moderate", 290, 22, 18, 12, 5, 3, 760),
    ("Ofada Rice", "local rice", "main_dish", "yoruba", "mild", "moderate", 420, 9, 3, 88, 4, 1, 180),
    ("Ayamase Sauce", "green pepper, palm oil, locust beans, assorted meat", "stew", "yoruba", "hot", "moderate", 380, 24, 29, 8, 3, 2, 880),
    ("Iyan", "pounded yam", "swallow", "yoruba", "mild", "moderate", 360, 5, 1, 83, 4, 1, 70),
    ("Ikokore", "water yam, fish, pepper, palm oil", "main_dish", "yoruba", "medium", "moderate", 390, 17, 15, 47, 5, 3, 710),
    ("Asaro", "yam, pepper, palm oil, crayfish", "main_dish", "yoruba", "medium", "inexpensive", 430, 9, 13, 70, 6, 4, 610),
    ("Moin Moin", "beans, pepper, onion, oil", "side", "yoruba", "mild", "inexpensive", 260, 15, 9, 30, 8, 3, 480),
    ("Akara", "beans, pepper, onion, oil", "snack", "yoruba", "medium", "inexpensive", 320, 16, 18, 27, 7, 3, 500),
    ("Adalu", "beans, corn, palm oil, pepper", "main_dish", "yoruba", "medium", "inexpensive", 410, 18, 12, 61, 11, 5, 550),
    ("Ewa Agoyin", "beans, pepper sauce, palm oil", "main_dish", "yoruba", "hot", "inexpensive", 460, 20, 17, 58, 13, 5, 720),
    ("Abula", "amala, ewedu, gbegiri, stew", "combo", "yoruba", "medium", "moderate", 620, 25, 20, 86, 12, 5, 1020),

    # Igbo / South-East
    ("Oha Soup", "oha leaves, cocoyam, fish, meat, palm oil", "soup", "igbo", "medium", "moderate", 330, 24, 20, 14, 5, 2, 740),
    ("Ofe Nsala", "catfish, yam, utazi, spices", "soup", "igbo", "medium", "moderate", 260, 27, 11, 13, 2, 1, 820),
    ("Ofe Onugbu", "bitterleaf, cocoyam, fish, meat, palm oil", "soup", "igbo", "medium", "moderate", 350, 25, 21, 16, 6, 2, 780),
    ("Ofe Owerri", "assorted vegetables, fish, meat, palm oil", "soup", "igbo", "medium", "expensive", 390, 30, 24, 13, 6, 2, 850),
    ("Abacha", "cassava, ugba, palm oil, garden egg, fish", "main_dish", "igbo", "medium", "moderate", 430, 14, 20, 54, 7, 3, 790),
    ("Ugba", "oil bean seed, pepper, palm oil, fish", "side", "igbo", "medium", "moderate", 260, 15, 16, 16, 6, 2, 650),
    ("Nkwobi", "cow foot, palm oil, potash, pepper", "protein", "igbo", "hot", "moderate", 520, 34, 38, 8, 2, 1, 1120),
    ("Isi Ewu", "goat head, palm oil, pepper, spices", "protein", "igbo", "hot", "moderate", 560, 39, 41, 8, 2, 1, 1180),
    ("Okpa", "bambara nut flour, palm oil, pepper", "side", "igbo", "mild", "inexpensive", 360, 19, 13, 42, 9, 3, 520),
    ("Achicha", "dried cocoyam, vegetables, oil bean", "main_dish", "igbo", "medium", "moderate", 400, 14, 14, 56, 8, 3, 620),
    ("Ukwa", "breadfruit, potash, palm oil", "main_dish", "igbo", "mild", "moderate", 430, 16, 10, 72, 10, 4, 410),
    ("Afang Soup", "afang leaves, waterleaf, fish, meat, palm oil", "soup", "igbo", "medium", "moderate", 340, 25, 20, 13, 7, 2, 760),
    ("Edikang Ikong", "ugu, waterleaf, fish, meat, palm oil", "soup", "igbo", "medium", "moderate", 360, 27, 22, 12, 7, 2, 780),

    # Hausa / North
    ("Tuwo Shinkafa", "rice flour, water", "swallow", "hausa", "mild", "inexpensive", 350, 6, 1, 78, 2, 1, 60),
    ("Tuwo Masara", "maize flour, water", "swallow", "hausa", "mild", "inexpensive", 340, 8, 2, 72, 5, 1, 70),
    ("Miyan Kuka", "baobab leaves, meat, fish, spices", "soup", "hausa", "medium", "inexpensive", 230, 20, 12, 12, 7, 2, 760),
    ("Miyan Taushe", "pumpkin, groundnut, spinach, meat", "soup", "hausa", "medium", "moderate", 300, 19, 16, 22, 7, 5, 820),
    ("Miyan Wake", "bean soup, spices, meat", "soup", "hausa", "medium", "inexpensive", 280, 18, 11, 28, 9, 3, 760),
    ("Masa", "rice batter, oil", "snack", "hausa", "mild", "inexpensive", 290, 7, 9, 46, 2, 3, 390),
    ("Kilishi", "lean beef, spices, groundnut paste", "snack", "hausa", "hot", "moderate", 310, 37, 15, 8, 2, 2, 980),
    ("Dambu Nama", "shredded beef, spices, oil", "protein", "hausa", "medium", "moderate", 390, 45, 22, 3, 1, 1, 1050),
    ("Fura da Nono", "millet balls, fermented milk", "drink", "hausa", "mild", "inexpensive", 360, 12, 9, 58, 4, 16, 180),
    ("Dan Wake", "bean flour dumplings, pepper, oil", "main_dish", "hausa", "medium", "inexpensive", 410, 18, 14, 54, 8, 3, 650),
    ("Gurasa", "wheat flatbread", "side", "hausa", "mild", "inexpensive", 260, 8, 3, 50, 3, 2, 380),

    # Niger Delta / South-South / Middle belt
    ("Banga Soup", "palm fruit, fish, meat, spices", "soup", "niger_delta", "medium", "moderate", 420, 24, 30, 13, 5, 3, 830),
    ("Starch", "cassava starch, palm oil", "swallow", "niger_delta", "mild", "inexpensive", 360, 2, 8, 70, 2, 1, 80),
    ("Fisherman Soup", "fresh fish, seafood, vegetables, pepper", "soup", "niger_delta", "medium", "expensive", 330, 35, 16, 10, 4, 2, 790),
    ("Editan Soup", "editan leaves, fish, meat, palm oil", "soup", "niger_delta", "medium", "moderate", 320, 24, 19, 12, 7, 2, 760),
    ("Afang Soup", "afang leaves, waterleaf, fish, meat", "soup", "niger_delta", "medium", "moderate", 340, 25, 20, 13, 7, 2, 760),
    ("Ekpang Nkukwo", "cocoyam, cocoyam leaves, fish, periwinkle", "main_dish", "niger_delta", "medium", "moderate", 440, 22, 18, 52, 8, 3, 790),
    ("Owo Soup", "palm oil, potash, fish, meat", "soup", "niger_delta", "medium", "moderate", 360, 23, 25, 10, 3, 2, 880),
    ("Bole", "roasted plantain, groundnut or fish", "main_dish", "niger_delta", "mild", "inexpensive", 390, 12, 10, 68, 6, 18, 260),
    ("Groundnut Soup", "groundnut, vegetables, meat, fish", "soup", "middle_belt", "medium", "moderate", 390, 24, 25, 16, 6, 4, 780),
    ("Okoho Soup", "okoho stem, sesame, fish, meat", "soup", "middle_belt", "mild", "moderate", 270, 20, 12, 18, 5, 2, 650),
    ("Acha Porridge", "fonio, vegetables, pepper", "main_dish", "middle_belt", "mild", "moderate", 330, 10, 7, 59, 6, 3, 430),

    # Nationwide staples / rice / urban restaurants
    ("Jollof Rice", "rice, tomatoes, pepper, onion, oil", "main_dish", "urban", "medium", "moderate", 520, 12, 16, 82, 4, 5, 760),
    ("Fried Rice", "rice, vegetables, oil, liver or chicken", "main_dish", "urban", "mild", "moderate", 540, 16, 18, 78, 5, 4, 820),
    ("Coconut Rice", "rice, coconut milk, vegetables, pepper", "main_dish", "urban", "mild", "moderate", 560, 12, 22, 80, 5, 5, 640),
    ("White Rice and Stew", "rice, tomato stew, oil, pepper", "main_dish", "urban", "medium", "inexpensive", 590, 13, 18, 92, 3, 5, 830),
    ("Beans Porridge", "beans, palm oil, pepper, onion", "main_dish", "urban", "medium", "inexpensive", 430, 21, 13, 58, 14, 5, 580),
    ("Yam Porridge", "yam, pepper, palm oil, fish", "main_dish", "urban", "medium", "inexpensive", 450, 13, 14, 70, 6, 4, 690),
    ("Plantain Porridge", "unripe plantain, vegetables, fish, pepper", "main_dish", "urban", "medium", "moderate", 390, 16, 12, 58, 7, 14, 610),
    ("Boiled Yam", "yam", "side", "urban", "mild", "inexpensive", 320, 5, 1, 74, 4, 1, 45),
    ("Boiled Plantain", "plantain", "side", "urban", "mild", "inexpensive", 280, 3, 1, 67, 5, 20, 15),
    ("Fried Plantain", "plantain, vegetable oil", "side", "urban", "mild", "inexpensive", 360, 3, 14, 58, 4, 22, 90),
    ("Garri", "cassava flakes", "swallow", "urban", "mild", "inexpensive", 330, 2, 1, 80, 4, 1, 30),
    ("Eba", "garri, water", "swallow", "urban", "mild", "inexpensive", 340, 2, 1, 82, 4, 1, 35),
    ("Semovita", "wheat semolina", "swallow", "urban", "mild", "inexpensive", 330, 9, 1, 70, 3, 1, 70),
    ("Wheat Swallow", "whole wheat flour, water", "swallow", "urban", "mild", "moderate", 310, 11, 2, 62, 8, 1, 65),
    ("Egusi Soup", "melon seed, vegetables, fish, meat, palm oil", "soup", "urban", "medium", "moderate", 430, 25, 32, 13, 5, 2, 820),
    ("Okra Soup", "okra, fish, meat, pepper", "soup", "urban", "medium", "moderate", 250, 19, 13, 14, 6, 3, 680),
    ("Ogbono Soup", "ogbono seed, fish, meat, palm oil", "soup", "urban", "medium", "moderate", 380, 22, 27, 12, 5, 2, 780),
    ("Vegetable Soup", "leafy vegetables, fish, meat, pepper", "soup", "urban", "medium", "moderate", 260, 22, 14, 10, 7, 2, 640),
    ("Pepper Soup", "fish or meat, pepper, spices", "soup", "urban", "hot", "moderate", 220, 28, 10, 5, 1, 1, 980),
    ("Catfish Pepper Soup", "catfish, pepper, scent leaf, spices", "soup", "urban", "hot", "moderate", 240, 32, 9, 4, 1, 1, 920),
    ("Goat Meat Pepper Soup", "goat meat, pepper, spices", "soup", "urban", "hot", "moderate", 310, 34, 18, 4, 1, 1, 1050),
    ("Grilled Fish", "fish, pepper, spices", "protein", "urban", "medium", "moderate", 280, 35, 13, 3, 1, 1, 520),
    ("Grilled Chicken", "chicken, pepper, spices", "protein", "urban", "medium", "moderate", 320, 38, 16, 3, 1, 1, 620),
    ("Chicken Suya", "chicken, suya spice, groundnut", "protein", "street", "hot", "moderate", 300, 36, 15, 5, 2, 2, 780),
    ("Beef Suya", "beef, suya spice, groundnut", "protein", "street", "hot", "inexpensive", 340, 34, 21, 5, 2, 2, 890),
    ("Asun", "goat meat, pepper, onion", "protein", "street", "hot", "moderate", 410, 36, 27, 5, 2, 2, 920),
    ("Shawarma", "flatbread, chicken or beef, vegetables, sauce", "main_dish", "fast_food", "medium", "moderate", 610, 28, 26, 67, 4, 8, 970),
    ("Chicken Burger", "bun, chicken patty, lettuce, sauce", "main_dish", "fast_food", "mild", "moderate", 560, 27, 24, 58, 3, 8, 980),
    ("Beef Burger", "bun, beef patty, lettuce, sauce", "main_dish", "fast_food", "mild", "moderate", 620, 30, 32, 55, 3, 8, 1050),
    ("French Fries", "potatoes, vegetable oil, salt", "side", "fast_food", "mild", "moderate", 430, 6, 20, 58, 5, 1, 520),
    ("Chicken Pizza", "pizza dough, cheese, chicken, tomato sauce", "main_dish", "fast_food", "mild", "moderate", 700, 34, 28, 78, 4, 8, 1220),
    ("Vegetable Pizza", "pizza dough, cheese, vegetables, tomato sauce", "main_dish", "fast_food", "mild", "moderate", 620, 25, 22, 78, 6, 9, 1050),
    ("Nigerian Coleslaw", "cabbage, carrot, mayonnaise", "side", "fast_food", "mild", "inexpensive", 210, 3, 16, 14, 4, 7, 260),
    ("Puff Puff", "flour, sugar, yeast, oil", "snack", "street", "mild", "inexpensive", 360, 6, 16, 50, 2, 14, 260),
    ("Meat Pie", "flour, minced meat, potato, carrot, oil", "snack", "street", "mild", "inexpensive", 420, 14, 22, 42, 3, 4, 680),
    ("Fish Roll", "flour, fish, pepper, oil", "snack", "street", "medium", "inexpensive", 370, 13, 18, 40, 2, 3, 610),
    ("Chin Chin", "flour, sugar, milk, oil", "snack", "street", "mild", "inexpensive", 430, 7, 19, 58, 2, 18, 210),
    ("Zobo", "hibiscus, ginger, cloves", "drink", "street", "mild", "inexpensive", 90, 1, 0, 22, 1, 18, 20),
    ("Kunu", "millet, ginger, spices", "drink", "street", "mild", "inexpensive", 170, 4, 2, 35, 3, 12, 60),
]

PROTEINS = [
    ("with Grilled Chicken", "chicken", 165, 31, 7, 0, 0, 0, 220),
    ("with Fish", "fish", 140, 26, 5, 0, 0, 0, 180),
    ("with Turkey", "turkey", 170, 30, 8, 0, 0, 0, 260),
    ("with Beef", "beef", 210, 28, 12, 0, 0, 0, 300),
    ("with Goat Meat", "goat meat", 190, 29, 9, 0, 0, 0, 280),
    ("with Egg", "egg", 80, 7, 5, 1, 0, 0, 70),
]

METHODS = [
    ("Boiled", -40, -5, -80, "mild"),
    ("Grilled", 20, 2, 60, "medium"),
    ("Fried", 120, 12, 120, "medium"),
    ("Spicy", 10, 0, 90, "hot"),
    ("Low Oil", -70, -8, -60, "mild"),
]

COMBOS = [
    ("with Eba", "eba", 330, 2, 1, 80, 4, 1, 40),
    ("with Amala", "amala", 320, 5, 1, 72, 5, 1, 60),
    ("with Pounded Yam", "pounded yam", 360, 5, 1, 83, 4, 1, 70),
    ("with Semovita", "semovita", 330, 9, 1, 70, 3, 1, 70),
    ("with Wheat Swallow", "wheat swallow", 310, 11, 2, 62, 8, 1, 65),
    ("with White Rice", "white rice", 350, 7, 1, 78, 1, 1, 20),
    ("with Boiled Plantain", "boiled plantain", 280, 3, 1, 67, 5, 20, 15),
]


def label_for(name, food_class, kcal, fat, carbs, fiber, sugar, sodium):
    n = name.lower()
    if any(term in n for term in ["fries", "fried", "chips", "puff puff", "chin chin", "soft drink", "sugary"]):
        return "Limit"
    if any(term in n for term in ["burger", "pizza", "shawarma"]) and (kcal > 500 or sodium > 800 or fat > 20):
        return "Limit"
    if sugar > 15 or sodium > 1000 or fat > 28 or kcal > 700 or (carbs > 80 and fiber < 5):
        return "Limit"
    if food_class in {"soup", "protein", "side"} and fiber >= 4 and sodium <= 800 and fat <= 22:
        return "FBDG-friendly"
    return "Moderate"


def row(dish_id, name, ingredients, desc, food_class, cuisine, spice, price, kcal, protein, fat, carbs, fiber, sugar, sodium):
    health = label_for(name, food_class, kcal, fat, carbs, fiber, sugar, sodium)
    n = name.lower()
    diabetes = sugar > 15 or (carbs > 80 and fiber < 6) or (carbs > 55 and fat > 15 and fiber < 6) or any(term in n for term in ["puff puff", "chin chin", "soft drink", "sugary drink", "fries", "pizza", "burger"])
    hypertension = sodium > 900
    return {
        "dish_id": dish_id,
        "dish_name": name,
        "main_ingredients": ingredients,
        "description": desc,
        "health_label": health,
        "food_class": food_class,
        "region": REGION_BY_CUISINE[cuisine],
        "spice_level": spice,
        "price_range": price,
        "est_energy_kcal": round(kcal, 1),
        "est_protein_g": round(protein, 1),
        "est_fat_total_g": round(fat, 1),
        "est_carbs_total_g": round(carbs, 1),
        "est_fiber_g": round(fiber, 1),
        "est_sugar_total_g": round(sugar, 1),
        "est_sodium_mg": round(sodium, 1),
        "has_recipe": False,
        "recipe_name": "",
        "recipe_procedures": "",
        "flag_diabetes_risk": diabetes,
        "flag_hypertension_risk": hypertension,
    }


def main():
    rows = []
    seen = set()

    def add(name, ingredients, desc, food_class, cuisine, spice, price, kcal, protein, fat, carbs, fiber, sugar, sodium):
        key = name.lower().strip()
        if key in seen:
            return
        seen.add(key)
        dish_id = f"NGV2_{len(rows)+1:04d}"
        rows.append(row(dish_id, name, ingredients, desc, food_class, cuisine, spice, price, kcal, protein, fat, carbs, fiber, sugar, sodium))

    for base in BASES:
        name, ing, cls, cuisine, spice, price, kcal, protein, fat, carbs, fiber, sugar, sodium = base
        add(name, ing, f"{name} is a Nigerian {cls.replace('_', ' ')} commonly eaten in {REGION_BY_CUISINE[cuisine]} or urban restaurants.", cls, cuisine, spice, price, kcal, protein, fat, carbs, fiber, sugar, sodium)

        fast_or_complete = cuisine == "fast_food" or any(term in name.lower() for term in ["burger", "pizza", "shawarma", "fries", "coleslaw"])
        if cls in {"main_dish", "swallow", "side"} and not fast_or_complete:
            for suffix, p_ing, pk, pp, pf, pc, pfi, psu, pna in PROTEINS[:4]:
                add(f"{name} {suffix}", f"{ing}, {p_ing}", f"A protein-enriched version of {name}.", "combo" if cls != "side" else "main_dish", cuisine, spice, price, kcal + pk, protein + pp, fat + pf, carbs + pc, fiber + pfi, sugar + psu, sodium + pna)
        if cls == "soup":
            for suffix, c_ing, ck, cp, cf, cc, cfi, csu, cna in COMBOS[:5]:
                add(f"{name} {suffix}", f"{ing}, {c_ing}", f"{name} served with {c_ing}; portion size should be moderated for calorie and carbohydrate control.", "combo", cuisine, spice, price, kcal + ck, protein + cp, fat + cf, carbs + cc, fiber + cfi, sugar + csu, sodium + cna)
        already_method = any(name.lower().startswith(prefix.lower()) for prefix, *_ in METHODS)
        if cls == "protein" and not already_method:
            for prefix, dk, df, dna, new_spice in METHODS[:3]:
                add(f"{prefix} {name}", ing, f"{prefix.lower()} preparation of {name}.", cls, cuisine, new_spice, price, max(50, kcal + dk), protein, max(0, fat + df), carbs, fiber, sugar, max(0, sodium + dna))

    # Add common rice/swallow/soup plates explicitly for restaurant menus.
    soups = [b for b in BASES if b[2] == "soup"]
    swallows = ["Eba", "Amala", "Pounded Yam", "Semovita", "Wheat Swallow", "Tuwo Shinkafa", "Starch"]
    swallow_nutrients = {
        "Eba": (340, 2, 1, 82, 4, 1, 35),
        "Amala": (320, 5, 1, 72, 5, 1, 60),
        "Pounded Yam": (360, 5, 1, 83, 4, 1, 70),
        "Semovita": (330, 9, 1, 70, 3, 1, 70),
        "Wheat Swallow": (310, 11, 2, 62, 8, 1, 65),
        "Tuwo Shinkafa": (350, 6, 1, 78, 2, 1, 60),
        "Starch": (360, 2, 8, 70, 2, 1, 80),
    }
    for s_name, s_ing, s_cls, cuisine, spice, price, kcal, protein, fat, carbs, fiber, sugar, sodium in soups:
        for swallow in swallows:
            sk, sp, sf, sc, sfi, ssu, sna = swallow_nutrients[swallow]
            add(f"{swallow} and {s_name}", f"{swallow.lower()}, {s_ing}", f"Classic Nigerian swallow plate served with {s_name}.", "combo", cuisine, spice, price, kcal + sk, protein + sp, fat + sf, carbs + sc, fiber + sfi, sugar + ssu, sodium + sna)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows[:560])
    print(f"Wrote {min(len(rows), 560)} rows to {OUT}")


if __name__ == "__main__":
    main()
