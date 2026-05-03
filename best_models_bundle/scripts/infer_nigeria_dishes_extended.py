from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils.dish_recommender import load_artifact, recommend_dishes


def main() -> int:
    parser = argparse.ArgumentParser(description="Inference for recommender_nigeria_dishes_extended.joblib")
    parser.add_argument("--like", type=str, default="", help="Seed free text, e.g. 'rice spicy tomato'.")
    parser.add_argument("--region", type=str, default="", help="Optional region filter.")
    parser.add_argument("--condition", type=str, default="", help="Optional: diabetes or hypertension.")
    parser.add_argument("--top-k", type=int, default=10)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    model_path = root / "models" / "recommender_nigeria_dishes_extended.joblib"
    artifact = load_artifact(model_path)

    recs = recommend_dishes(
        artifact,
        like_text=args.like or None,
        region_filter=args.region or None,
        condition=args.condition or None,
        top_k=args.top_k,
    )

    if recs.empty:
        print("No recommendations returned.")
        return 0

    cols = [c for c in ["dish_id", "dish_name", "region", "food_class", "spice_level", "price_range", "similarity"] if c in recs.columns]
    print(recs[cols].to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
