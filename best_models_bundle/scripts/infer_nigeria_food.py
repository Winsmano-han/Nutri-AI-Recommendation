from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils.recommender import load_artifact, recommend


def main() -> int:
    parser = argparse.ArgumentParser(description="Inference for recommender_nigeria.joblib")
    parser.add_argument("--like-food-name", type=str, default="", help="Seed by food name text, e.g. 'rice'.")
    parser.add_argument("--like-food-id", type=str, default="", help="Seed by food id.")
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--min-fbdg", type=float, default=None)
    parser.add_argument("--exclude-allergens", type=str, default="")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    model_path = root / "models" / "recommender_nigeria.joblib"
    artifact = load_artifact(model_path)

    exclude = set([x.strip() for x in args.exclude_allergens.split(",") if x.strip()])
    recs = recommend(
        artifact,
        like_food_id=args.like_food_id or None,
        like_food_name=args.like_food_name or None,
        top_k=args.top_k,
        min_fbdg_score=args.min_fbdg,
        exclude_allergens=exclude or None,
    )

    if recs.empty:
        print("No recommendations returned.")
        return 0

    cols = [c for c in ["food_id", "food_name", "category_main", "fbdg_score", "allergen_summary", "similarity"] if c in recs.columns]
    print(recs[cols].to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
