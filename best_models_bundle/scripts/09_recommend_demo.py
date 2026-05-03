from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils.data_loader import repo_root
from utils.recommender import load_artifact, recommend


def main() -> int:
    parser = argparse.ArgumentParser(description="Demo: query the trained recommender index.")
    parser.add_argument("--country", type=str, required=True, help="Nigeria or Canada (matches the trained artifact).")
    parser.add_argument("--like-food-id", type=str, default="", help="Seed by food_id.")
    parser.add_argument("--like-food-name", type=str, default="", help="Seed by substring match on food_name.")
    parser.add_argument("--top-k", type=int, default=10, help="Number of recommendations.")
    parser.add_argument("--min-fbdg", type=float, default=None, help="Minimum fbdg_score.")
    parser.add_argument(
        "--exclude-allergens",
        type=str,
        default="",
        help="Comma-separated allergen keys to exclude (e.g., gluten,peanuts,tree_nuts,dairy,eggs,fish,shellfish,wheat,soy,sesame,sulfites,mustard,celery).",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    root = repo_root()
    model_path = root / "models" / f"recommender_{args.country.lower()}.joblib"
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
        print("No recommendations (filters may be too strict).")
        return 0

    cols = [c for c in ["food_id", "food_name", "category_main", "fbdg_score", "allergen_summary", "similarity"] if c in recs.columns]
    print(recs[cols].to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

