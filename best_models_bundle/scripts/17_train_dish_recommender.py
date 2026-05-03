from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils.data_loader import repo_root
from utils.dish_recommender import save_artifact, train_dish_recommender

log = logging.getLogger("train_dish_recommender")


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a Nigeria dish recommender (dish catalog similarity).")
    parser.add_argument(
        "--input",
        type=str,
        default="",
        help=(
            "Path to dish dataset CSV. Defaults to data/final/nigeria_dish_features.csv if present "
            "(includes estimated nutrients), otherwise falls back to nigeria_dish_catalog_extended.csv."
        ),
    )
    parser.add_argument("--out", type=str, default="models/recommender_nigeria_dishes.joblib", help="Output path.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    root = repo_root()
    if args.input:
        in_path = Path(args.input)
    else:
        features = root / "data" / "final" / "nigeria_dish_features.csv"
        if features.exists():
            in_path = features
        else:
            extended = root / "data" / "final" / "nigeria_dish_catalog_extended.csv"
            in_path = extended if extended.exists() else (root / "data" / "final" / "nigeria_dish_catalog.csv")
    if not in_path.exists():
        raise FileNotFoundError(f"Missing input: {in_path}. Run scripts/14_ingest_curated_meals.py first.")

    df = pd.read_csv(in_path, encoding_errors="replace", low_memory=False)
    df.columns = [c.strip() for c in df.columns]
    for c in df.columns:
        if df[c].dtype == object:
            df[c] = df[c].fillna("").astype(str).str.strip()
    df = df[df.get("dish_name", "").astype(str).str.len() > 0].drop_duplicates(subset=["dish_name"])

    artifact = train_dish_recommender(df, country="Nigeria")
    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = root / out_path
    save_artifact(artifact, out_path)
    log.info("Saved %s (%d dishes)", out_path, len(artifact.dish_df))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
