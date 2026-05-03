from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils.data_loader import repo_root
from utils.recommender import save_artifact, train_country_recommender


log = logging.getLogger("train_recommender")


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a simple content-based recommender (per-country index).")
    parser.add_argument(
        "--input",
        type=str,
        default="",
        help="Path to master_food_database.csv (defaults to data/final/master_food_database.csv).",
    )
    parser.add_argument("--outdir", type=str, default="models", help="Output directory for saved artifacts.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    root = repo_root()
    in_path = Path(args.input) if args.input else (root / "data" / "final" / "master_food_database.csv")
    if not in_path.exists():
        raise FileNotFoundError(f"Missing input: {in_path}")

    df = pd.read_csv(in_path)
    if "country" not in df.columns:
        raise ValueError("master_food_database.csv missing 'country' column")

    base_numeric_cols = [
        "energy_kcal",
        "protein_g",
        "fat_total_g",
        "carbs_total_g",
        "fiber_g",
        "saturated_fat_g",
        "sugar_total_g",
        "sodium_mg",
        "fbdg_score",
        "completeness_score",
    ]
    # Treat boolean flags as numeric so they influence similarity:
    # - allergen flags: contains_*
    # - dietary tags: is_*
    bool_numeric_cols = sorted(
        [
            c
            for c in df.columns
            if c.startswith("contains_")
            or c in {"is_prepared_dish", "is_vegan", "is_vegetarian", "is_halal"}
        ]
    )

    numeric_cols = [c for c in [*base_numeric_cols, *bool_numeric_cols] if c]

    categorical_cols = [
        c for c in ["category_main", "food_kind", "fbdg_category", "data_quality_flag"] if c in df.columns or c in {"category_main", "food_kind"}
    ]

    outdir = root / args.outdir
    outdir.mkdir(parents=True, exist_ok=True)

    countries = sorted([c for c in df["country"].dropna().astype(str).unique().tolist() if c.strip()])
    for country in countries:
        log.info("Training index for country=%s", country)
        artifact = train_country_recommender(
            df,
            country,
            numeric_cols=numeric_cols,
            categorical_cols=categorical_cols,
            required_cols=[],
        )
        out_path = outdir / f"recommender_{country.lower()}.joblib"
        save_artifact(artifact, out_path)
        log.info("Saved %s (%d foods)", out_path, len(artifact.food_df))

    log.info("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
