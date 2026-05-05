"""
Nutrifence — Model Server
=========================
FastAPI server that loads both .joblib recommendation models and exposes
clean HTTP endpoints for the Node.js pipeline to call.

Models served:
  - recommender_nigeria_dishes_extended.joblib  →  /recommend  (primary)
  - recommender_nigeria.joblib                  →  /recommend/food  (ingredient-level)

Usage:
  uvicorn model_server:app --host 0.0.0.0 --port 8000 --reload

Required:
  pip install fastapi uvicorn joblib scikit-learn pandas numpy

Environment variables (optional):
  DISH_MODEL_PATH   — path to dish joblib file  (default: models/recommender_nigeria_dishes_extended.joblib)
  FOOD_MODEL_PATH   — path to food joblib file  (default: models/recommender_nigeria.joblib)
"""

import os
import logging
import sys
from contextlib import asynccontextmanager
from typing import Optional

import joblib
import numpy as np
import pandas as pd
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Ensure bundled utils modules are importable for joblib artifacts.
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BUNDLE_ROOT = os.path.join(PROJECT_ROOT, "best_models_bundle")
if BUNDLE_ROOT not in sys.path:
    sys.path.insert(0, BUNDLE_ROOT)

from utils.dish_recommender import recommend_dishes as dish_recommend_fn
from utils.recommender import recommend as food_recommend_fn

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("nutrifence")

# ─── Model paths ──────────────────────────────────────────────────────────────

DISH_MODEL_PATH = os.getenv(
    "DISH_MODEL_PATH",
    os.path.join(BUNDLE_ROOT, "models", "recommender_nigeria_dishes_extended.joblib")
)
FOOD_MODEL_PATH = os.getenv(
    "FOOD_MODEL_PATH",
    os.path.join(BUNDLE_ROOT, "models", "recommender_nigeria.joblib")
)

# ─── Global model state ───────────────────────────────────────────────────────

models: dict = {}


def load_models():
    """Load both joblib models at startup. Logs clearly if a model file is missing."""
    loaded = []

    if os.path.exists(DISH_MODEL_PATH):
        log.info(f"Loading dish model from {DISH_MODEL_PATH}…")
        models["dish"] = joblib.load(DISH_MODEL_PATH)
        loaded.append("dish_model")
        log.info("  ✅ Dish model loaded")
        try:
            dish_df = getattr(models["dish"], "dish_df", None)
            if dish_df is not None and hasattr(dish_df, "columns"):
                sample_cols = list(dish_df.columns)
                wanted = ["dish_name", "health_label", "region", "food_class", "spice_level", "price_range"]
                present = [c for c in wanted if c in sample_cols]
                log.info(f"  ℹ️ Dish artifact columns present: {present}")
        except Exception as e:
            log.warning(f"  ⚠️ Could not inspect dish artifact columns: {e}")
    else:
        log.warning(f"  ⚠️  Dish model not found at {DISH_MODEL_PATH} — /recommend will return []")

    if os.path.exists(FOOD_MODEL_PATH):
        log.info(f"Loading food model from {FOOD_MODEL_PATH}…")
        models["food"] = joblib.load(FOOD_MODEL_PATH)
        loaded.append("food_model")
        log.info("  ✅ Food model loaded")
    else:
        log.warning(f"  ⚠️  Food model not found at {FOOD_MODEL_PATH} — /recommend/food will return []")

    return loaded


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models at startup, clean up at shutdown."""
    log.info("🍽️  Nutrifence Model Server starting…")
    loaded = load_models()
    log.info(f"Ready — models loaded: {loaded}")
    yield
    models.clear()
    log.info("Model server shut down.")


# ─── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Nutrifence Model Server",
    description="Recommendation endpoints backed by Nigerian food/dish joblib models",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Tighten this in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Request / Response schemas ───────────────────────────────────────────────

class DishRecommendRequest(BaseModel):
    like_text: Optional[str]      = Field(None, description="Free-text seed e.g. 'jollof rice chicken'")
    like_dish_name: Optional[str] = Field(None, description="Exact dish name seed")
    like_dish_id: Optional[str]   = Field(None, description="Dish ID seed")
    top_k: int                    = Field(8, ge=1, le=30, description="Number of recommendations")
    condition: Optional[str]      = Field(None, description="'diabetes' or 'hypertension'")
    region: Optional[str]         = Field(None, description="Optional region filter e.g. 'South-West'")


class FoodRecommendRequest(BaseModel):
    like_food_name: Optional[str] = Field(None, description="Seed food name e.g. 'rice'")
    like_food_id: Optional[str]   = Field(None, description="Seed food ID")
    top_k: int                    = Field(8, ge=1, le=30)
    min_fbdg_score: Optional[float] = Field(None, description="Minimum FBDG score filter")
    exclude_allergens: Optional[list[str]] = Field(None, description="Allergens to exclude")


class RecommendationItem(BaseModel):
    dish_name: str
    similarity_score: float
    health_label: Optional[str]   = None
    region: Optional[str]         = None
    food_class: Optional[str]     = None
    spice_level: Optional[str]    = None
    price_range: Optional[str]    = None
    description: Optional[str]    = None


class FoodRecommendationItem(BaseModel):
    food_name: str
    food_id: Optional[str]        = None
    similarity_score: float
    category: Optional[str]       = None
    fbdg_score: Optional[float]   = None
    energy_kcal: Optional[float]  = None
    protein_g: Optional[float]    = None
    is_vegan: Optional[bool]      = None
    is_halal: Optional[bool]      = None


# ─── Health endpoint ──────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models_loaded": list(models.keys()),
        "dish_model_path": DISH_MODEL_PATH,
        "food_model_path": FOOD_MODEL_PATH,
    }


@app.post("/extract-pdf")
async def extract_pdf(file: UploadFile = File(...)):
    """
    Extract raw text from an uploaded PDF.
    Used by report_ingestion.js before Groq parses report text into a contract.
    """
    try:
        import pdfplumber
        import tempfile

        contents = await file.read()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        page_count = 0
        text_parts = []
        with pdfplumber.open(tmp_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                text_parts.append(page.extract_text() or "")

        os.unlink(tmp_path)
        return {"text": "\n".join(text_parts).strip(), "pages": page_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF extraction failed: {str(e)}")


# ─── Dish recommendation endpoint ─────────────────────────────────────────────

@app.post("/recommend", response_model=dict)
async def recommend_dishes(req: DishRecommendRequest):
    """
    Primary endpoint. Uses recommender_nigeria_dishes_extended.joblib.
    Accepts free text, dish name, or dish ID as seed.
    Optionally filters by health condition and region.
    """
    if "dish" not in models:
        log.warning("Dish model not loaded — returning empty recommendations")
        return {"recommendations": [], "warning": "Dish model not loaded"}

    recommender = models["dish"]

    # Build kwargs for the recommender's recommend() method
    # The dish recommender (utils/dish_recommender.py) accepts:
    #   like_dish_id, like_dish_name, like_text, top_k, region, condition
    kwargs = {"top_k": req.top_k}

    if req.like_dish_id:
        kwargs["like_dish_id"] = req.like_dish_id
    elif req.like_dish_name:
        kwargs["like_dish_name"] = req.like_dish_name
    elif req.like_text:
        kwargs["like_text"] = req.like_text
    else:
        raise HTTPException(status_code=422, detail="Provide one of: like_text, like_dish_name, like_dish_id")

    if req.region:
        kwargs["region"] = req.region

    if req.condition and req.condition.lower() in ("diabetes", "hypertension"):
        kwargs["condition"] = req.condition.lower()

    try:
        if hasattr(recommender, "recommend"):
            raw_results = recommender.recommend(**kwargs)
        else:
            raw_results = dish_recommend_fn(
                recommender,
                like_dish_id=kwargs.get("like_dish_id"),
                like_dish_name=kwargs.get("like_dish_name"),
                like_text=kwargs.get("like_text"),
                top_k=kwargs.get("top_k", 8),
                condition=kwargs.get("condition"),
                region_filter=kwargs.get("region"),
            )
    except Exception as e:
        log.error(f"Dish model inference error: {e}")
        raise HTTPException(status_code=500, detail=f"Model inference error: {str(e)}")

    # Normalise results to a consistent list of dicts regardless of model's return format
    items = _normalise_dish_results(raw_results)

    return {"recommendations": items, "seed": req.like_text or req.like_dish_name or req.like_dish_id}


def _normalise_dish_results(raw) -> list[dict]:
    """
    The dish recommender returns a DataFrame or list of dicts.
    Normalise to a clean list the Node pipeline and Flutter can consume.
    """
    if raw is None:
        return []

    # If it's a DataFrame
    if hasattr(raw, "to_dict"):
        records = raw.to_dict(orient="records")
    elif isinstance(raw, list):
        records = raw
    else:
        return []

    if records:
        try:
            log.info(f"Raw model output columns: {list(records[0].keys())}")
        except Exception:
            pass

    results = []
    for r in records:
        dish_name = str(r.get("dish_name") or r.get("name") or "")
        description = str(r.get("description") or "")
        ingredients = str(r.get("main_ingredients") or "")

        health_label_raw = _pick_text(r, ["health_label"])
        food_class_raw = _pick_text(r, ["food_class"])
        region_raw = _pick_text(r, ["region"])
        spice_level_raw = _pick_text(r, ["spice_level"])
        price_range_raw = _pick_text(r, ["price_range"])

        inferred_food_class = _infer_food_class(dish_name, description, ingredients)
        inferred_spice_level = _infer_spice_level(dish_name, description, ingredients)
        inferred_price_range = _infer_price_range(dish_name, description)

        item = {
            "dish_name":       dish_name,
            "similarity_score": float(r.get("similarity_score") or r.get("similarity") or 0.0),
            "health_label":    health_label_raw,
            "region":          region_raw,
            "food_class":      food_class_raw or inferred_food_class,
            "spice_level":     spice_level_raw or inferred_spice_level,
            "price_range":     price_range_raw or inferred_price_range,
            "description":     description or None,
            "metadata_source": "model"
            if (food_class_raw or spice_level_raw or price_range_raw)
            else "inferred",
        }
        # Only include items with a real name
        if item["dish_name"]:
            results.append(item)

    return results


# ─── Food (ingredient) recommendation endpoint ────────────────────────────────

@app.post("/recommend/food", response_model=dict)
async def recommend_foods(req: FoodRecommendRequest):
    """
    Secondary endpoint. Uses recommender_nigeria.joblib.
    Best for ingredient substitution and nutrition-aware alternatives.
    """
    if "food" not in models:
        log.warning("Food model not loaded — returning empty recommendations")
        return {"recommendations": [], "warning": "Food model not loaded"}

    recommender = models["food"]

    kwargs = {"top_k": req.top_k}

    if req.like_food_id:
        kwargs["like_food_id"] = req.like_food_id
    elif req.like_food_name:
        kwargs["like_food_name"] = req.like_food_name
    else:
        raise HTTPException(status_code=422, detail="Provide one of: like_food_name, like_food_id")

    if req.min_fbdg_score is not None:
        kwargs["min_fbdg_score"] = req.min_fbdg_score

    if req.exclude_allergens:
        kwargs["exclude_allergens"] = req.exclude_allergens

    try:
        if hasattr(recommender, "recommend"):
            raw_results = recommender.recommend(**kwargs)
        else:
            raw_results = food_recommend_fn(
                recommender,
                like_food_id=kwargs.get("like_food_id"),
                like_food_name=kwargs.get("like_food_name"),
                top_k=kwargs.get("top_k", 8),
                min_fbdg_score=kwargs.get("min_fbdg_score"),
                exclude_allergens=set(kwargs.get("exclude_allergens") or []),
            )
    except Exception as e:
        log.error(f"Food model inference error: {e}")
        raise HTTPException(status_code=500, detail=f"Model inference error: {str(e)}")

    items = _normalise_food_results(raw_results)

    return {
        "recommendations": items,
        "seed": req.like_food_name or req.like_food_id,
    }


def _normalise_food_results(raw) -> list[dict]:
    if raw is None:
        return []

    if hasattr(raw, "to_dict"):
        records = raw.to_dict(orient="records")
    elif isinstance(raw, list):
        records = raw
    else:
        return []

    results = []
    for r in records:
        name = str(r.get("food_name") or r.get("name") or "")
        if not name:
            continue
        results.append({
            "food_name":       name,
            "food_id":         r.get("food_id"),
            "similarity_score": float(r.get("similarity_score") or r.get("similarity") or 0.0),
            "category":        r.get("category_main") or r.get("category"),
            "fbdg_score":      _safe_float(r.get("fbdg_score")),
            "energy_kcal":     _safe_float(r.get("energy_kcal") or r.get("energy")),
            "protein_g":       _safe_float(r.get("protein_g") or r.get("protein")),
            "is_vegan":        _safe_bool(r.get("is_vegan")),
            "is_halal":        _safe_bool(r.get("is_halal")),
        })

    return results


# ─── Batch endpoint — for pipeline efficiency ─────────────────────────────────

class BatchDishRequest(BaseModel):
    seeds: list[str]  = Field(..., description="List of seed texts to run in one call")
    top_k: int        = Field(6, ge=1, le=20)
    condition: Optional[str] = None


@app.post("/recommend/batch", response_model=dict)
async def recommend_batch(req: BatchDishRequest):
    """
    Runs multiple seed texts through the dish model in one HTTP call.
    More efficient than the Node pipeline calling /recommend N times per restaurant.
    Returns a dict keyed by seed text.
    """
    if "dish" not in models:
        return {"results": {}, "warning": "Dish model not loaded"}

    recommender = models["dish"]
    results = {}

    for seed in req.seeds:
        kwargs = {"like_text": seed, "top_k": req.top_k}
        if req.condition and req.condition.lower() in ("diabetes", "hypertension"):
            kwargs["condition"] = req.condition.lower()

        try:
            if hasattr(recommender, "recommend"):
                raw = recommender.recommend(**kwargs)
            else:
                raw = dish_recommend_fn(
                    recommender,
                    like_text=kwargs.get("like_text"),
                    top_k=kwargs.get("top_k", 6),
                    condition=kwargs.get("condition"),
                )
            results[seed] = _normalise_dish_results(raw)
        except Exception as e:
            log.warning(f"Batch seed '{seed}' failed: {e}")
            results[seed] = []

    return {"results": results}


# ─── Utility helpers ──────────────────────────────────────────────────────────

def _safe_float(val) -> Optional[float]:
    try:
        f = float(val)
        return None if (np.isnan(f) or np.isinf(f)) else round(f, 3)
    except (TypeError, ValueError):
        return None


def _safe_bool(val) -> Optional[bool]:
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return bool(val)
    if isinstance(val, str):
        return val.lower() in ("true", "1", "yes")
    return None


def _pick_text(record: dict, keys: list[str]) -> Optional[str]:
    for k in keys:
        v = record.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return None


def _infer_food_class(dish_name: str, description: str, ingredients: str) -> Optional[str]:
    t = f"{dish_name} {description} {ingredients}".lower()
    if any(k in t for k in ["juice", "drink", "tea", "smoothie"]):
        return "drink"
    if any(k in t for k in ["soup", "pepper soup", "broth"]):
        return "soup"
    if any(k in t for k in ["snack", "chips", "nuts", "puff", "dough"]):
        return "snack"
    if any(k in t for k in ["rice", "yam", "amala", "garri", "iyan", "swallow", "pizza", "shawarma"]):
        return "main_dish"
    return "main_dish"


def _infer_spice_level(dish_name: str, description: str, ingredients: str) -> Optional[str]:
    t = f"{dish_name} {description} {ingredients}".lower()
    if any(k in t for k in ["pepper soup", "suya", "pepper", "spicy", "hot"]):
        return "hot"
    if any(k in t for k in ["grill", "bbq", "asun"]):
        return "medium"
    return "mild"


def _infer_price_range(dish_name: str, description: str) -> Optional[str]:
    t = f"{dish_name} {description}".lower()
    if any(k in t for k in ["pizza", "seafood", "steak", "grilled fish"]):
        return "moderate"
    if any(k in t for k in ["snack", "dough", "juice", "coleslaw"]):
        return "inexpensive"
    return "moderate"


# ─── Run directly ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "model_server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
