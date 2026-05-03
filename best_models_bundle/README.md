# Best Models Bundle (Nigeria)

This folder contains the 2 recommended production models from this project, plus their training and inference scripts.

## Why these 2 models

1. `recommender_nigeria.joblib`
- Best core food-item recommender for Nigeria.
- High recommendation consistency and category coherence in evaluation.
- Supports practical filtering (`min_fbdg_score`, allergen exclusions).

2. `recommender_nigeria_dishes_extended.joblib`
- Best dish-level discovery model for user-facing meal ideas.
- Larger catalog than the base dish model, so users get wider options.
- Supports region and health-condition filters (`diabetes`, `hypertension`).

---

## Folder contents

- `models/recommender_nigeria.joblib`
- `models/recommender_nigeria_dishes_extended.joblib`

Training scripts (copied from project):
- `scripts/08_train_recommender.py`
- `scripts/17_train_dish_recommender.py`

Original demo inference scripts (copied from project):
- `scripts/09_recommend_demo.py`
- `scripts/18_dish_recommend_demo.py`

Ready-to-run inference scripts for these exact 2 models:
- `scripts/infer_nigeria_food.py`
- `scripts/infer_nigeria_dishes_extended.py`

Core model logic files:
- `utils/recommender.py`
- `utils/dish_recommender.py`
- `utils/data_loader.py`

---

## How Model 1 works: `recommender_nigeria.joblib`

Implementation source: `utils/recommender.py`

### Objective
Recommend foods similar to a seed food (e.g., user asks for "rice") using food composition and metadata.

### Feature engineering
The model combines:
- Numeric nutrition features: energy, protein, fat, carbs, fiber, saturated fat, sugar, sodium, fbdg score, completeness score.
- Boolean flags as numeric features: allergen flags (`contains_*`) and dietary tags (`is_vegan`, `is_vegetarian`, `is_halal`, `is_prepared_dish`).
- Categorical metadata: `category_main`, `food_kind`, `fbdg_category`, `data_quality_flag`.

Missing numeric values are median-imputed per column.
Categorical values are normalized as strings.

### Pipeline and model
- Numeric features -> `StandardScaler`
- Categorical features -> `OneHotEncoder`
- Combined with `ColumnTransformer`
- Similarity search with `NearestNeighbors(metric="cosine")`

During inference:
1. Resolve seed by `food_id` or `food_name`.
2. Build seed vector (single or centroid).
3. Query nearest neighbors.
4. Convert cosine distance to similarity via `1 - distance`.
5. Apply filters (minimum FBDG, allergen exclusion).

---

## How Model 2 works: `recommender_nigeria_dishes_extended.joblib`

Implementation source: `utils/dish_recommender.py`

### Objective
Recommend Nigerian dishes similar to a dish/text request (e.g., "rice spicy tomato") with optional health and region constraints.

### Feature engineering
The model combines:
- Text features from `dish_name`, `main_ingredients`, `description` into a single text field.
- Categorical features: `health_label`, `food_class`, `region`, `spice_level`, `price_range`.
- Numeric estimated nutrients: energy, protein, fat, carbs, fiber, sugar, sodium.

Missing numeric values are median-imputed.
Missing categorical/text values are filled as empty strings.

### Pipeline and model
- Text -> `TfidfVectorizer(ngram_range=(1,2), max_features=5000)`
- Numeric -> `StandardScaler`
- Categorical -> `OneHotEncoder`
- Combined with `ColumnTransformer`
- Similarity search with `NearestNeighbors(metric="cosine")`

During inference:
1. Build seed from `like_dish_id`, `like_dish_name`, or free-text (`like_text`).
2. Query nearest neighbors and compute similarity.
3. Optionally filter by region.
4. Optionally apply condition filter:
   - `diabetes`: remove high-risk flagged items and high sugar/carb-risk dishes.
   - `hypertension`: remove high-risk flagged items and high sodium dishes.

---

## How these models were built

### A) Food model training (`recommender_nigeria.joblib`)
Script: `scripts/08_train_recommender.py`

Typical command in project root:

```bash
python scripts/08_train_recommender.py --input data/final/master_food_database.csv --outdir models
```

This script trains one model per country and writes:
- `models/recommender_nigeria.joblib`
- `models/recommender_canada.joblib`

### B) Dish model training (`recommender_nigeria_dishes_extended.joblib`)
Script: `scripts/17_train_dish_recommender.py`

To reproduce the extended model output explicitly:

```bash
python scripts/17_train_dish_recommender.py --input data/final/nigeria_dish_features.csv --out models/recommender_nigeria_dishes_extended.joblib
```

---

## Inference usage (the scripts in this folder)

### 1) Food recommendations for "rice"

```bash
python best_models_bundle/scripts/infer_nigeria_food.py --like-food-name rice --top-k 10
```

Optional stricter query:

```bash
python best_models_bundle/scripts/infer_nigeria_food.py --like-food-name rice --top-k 10 --min-fbdg 50 --exclude-allergens peanuts,gluten
```

### 2) Dish recommendations for "rice"

```bash
python best_models_bundle/scripts/infer_nigeria_dishes_extended.py --like "rice" --top-k 10
```

Health-constrained example:

```bash
python best_models_bundle/scripts/infer_nigeria_dishes_extended.py --like "rice" --condition diabetes --top-k 10
```

Regional example:

```bash
python best_models_bundle/scripts/infer_nigeria_dishes_extended.py --like "rice" --region "South-West" --top-k 10
```

---

## Practical recommendation for product integration

- Use `recommender_nigeria.joblib` for ingredient/food substitution and nutrition-aware alternatives.
- Use `recommender_nigeria_dishes_extended.joblib` for user meal discovery and richer dish exploration.
- If dish outputs are too broad for a specific UX page, add a reranking step by `food_class` or fallback to the smaller base dish model.

---

## Environment note

These models were serialized with an older scikit-learn version than some modern runtime environments. For stable deployment, keep training and serving environments version-aligned (or retrain and re-save with your deployment version).
