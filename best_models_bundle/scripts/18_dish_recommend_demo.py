from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils.data_loader import repo_root
from utils.dish_recommender import load_artifact, recommend_dishes


def main() -> int:
    parser = argparse.ArgumentParser(description="Demo: query the trained Nigeria dish recommender.")
    parser.add_argument("--like", type=str, default="", help="Seed text (e.g., 'jollof, rice, spicy').")
    parser.add_argument("--region", type=str, default="", help="Optional region filter (e.g., 'South-West').")
    parser.add_argument("--top-k", type=int, default=10)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    root = repo_root()
    model_path = root / "models" / "recommender_nigeria_dishes.joblib"
    artifact = load_artifact(model_path)

    recs = recommend_dishes(
        artifact,
        like_text=args.like or None,
        region_filter=args.region or None,
        top_k=args.top_k,
    )
    if recs.empty:
        print("No dish recommendations (filters may be too strict).")
        return 0

    cols = [c for c in ["dish_id", "dish_name", "region", "spice_level", "price_range", "similarity"] if c in recs.columns]
    print(recs[cols].to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

