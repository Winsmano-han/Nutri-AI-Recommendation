#!/usr/bin/env python3
"""Train the Canadian dish recommender from the CNF-derived CSV.

The raw Canadian Nutrient File contains many foods that are not useful for
restaurant recommendations (baby foods, alcohol-only records, oils, lab-style
ingredients). This script filters those out and trains a text-forward content
model that still retains nutrient features for condition filtering.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "best_models_bundle"
if str(BUNDLE) not in sys.path:
    sys.path.insert(0, str(BUNDLE))

from utils.dish_recommender import save_artifact, train_dish_recommender

INPUT = ROOT / "data" / "final" / "canada_dish_features_cnf_2026.csv"
OUTPUT = BUNDLE / "models" / "recommender_canada_dishes_cnf_2026.joblib"

EXCLUDE_RE = re.compile(
    r"\b("
    r"babyfood|infant|formula|alcohol|wine|beer|liqueur|vodka|whisky|rum|gin|"
    r"oil,\s|fish oil|shortening|lard|margarine|butter oil|"
    r"stomach contents|seal oil|caribou.*stomach|"
    r"raw,? not further specified"
    r")\b",
    re.IGNORECASE,
)

PREFERRED_RE = re.compile(
    r"\b("
    r"fast foods?|pizza|sandwich|burger|salad|soup|stew|chili|poutine|"
    r"chicken|turkey|beef|fish|salmon|tuna|shrimp|egg|tofu|bean|lentil|"
    r"rice|pasta|bread|oatmeal|cereal|yogou?rt|cheese|vegetable|fruit|"
    r"potato|fries|wrap|noodles|curry"
    r")\b",
    re.IGNORECASE,
)


def main() -> int:
    if not INPUT.exists():
        raise FileNotFoundError(f"Missing dataset: {INPUT}")

    df = pd.read_csv(INPUT, encoding_errors="replace", low_memory=False)
    df.columns = [c.strip() for c in df.columns]
    df["dish_name"] = df["dish_name"].fillna("").astype(str).str.strip()
    df = df[df["dish_name"].str.len() > 0].drop_duplicates(subset=["dish_name"]).copy()

    text = (
        df["dish_name"].fillna("").astype(str) + " " +
        df.get("description", "").fillna("").astype(str) + " " +
        df.get("main_ingredients", "").fillna("").astype(str)
    )

    keep = ~text.str.contains(EXCLUDE_RE, regex=True, na=False)
    # Keep restaurant/common-food-like rows. This removes many obscure raw CNF rows
    # while preserving enough variety for Canadian restaurant archetypes.
    keep &= text.str.contains(PREFERRED_RE, regex=True, na=False)
    df = df[keep].copy()

    if len(df) < 500:
        raise ValueError(f"Filtered Canada dataset is too small: {len(df)} rows")

    artifact = train_dish_recommender(
        df,
        country="Canada",
        text_weight=4.0,
        numeric_weight=0.2,
        categorical_weight=0.7,
    )
    save_artifact(artifact, OUTPUT)
    print(f"Saved {OUTPUT} ({len(artifact.dish_df)} foods)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
