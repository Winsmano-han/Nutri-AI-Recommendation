from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.preprocessing import OneHotEncoder


@dataclass(frozen=True)
class DishRecommenderArtifact:
    country: str
    dish_df: pd.DataFrame
    pipeline: Pipeline
    nn: NearestNeighbors
    embedding: np.ndarray
    feature_columns: list[str]


def _make_text_series(df: pd.DataFrame, text_cols: list[str]) -> pd.Series:
    parts = []
    for c in text_cols:
        if c not in df.columns:
            parts.append(pd.Series([""] * len(df), index=df.index))
        else:
            parts.append(df[c].fillna("").astype(str))
    return parts[0].str.cat(parts[1:], sep=" | ")


def train_dish_recommender(
    dish_df: pd.DataFrame,
    *,
    country: str = "Nigeria",
    text_cols: Optional[list[str]] = None,
    categorical_cols: Optional[list[str]] = None,
    numeric_cols: Optional[list[str]] = None,
) -> DishRecommenderArtifact:
    text_cols = text_cols or ["dish_name", "main_ingredients", "description"]
    categorical_cols = categorical_cols or ["health_label", "food_class", "region", "spice_level", "price_range"]
    numeric_cols = numeric_cols or [
        "est_energy_kcal",
        "est_protein_g",
        "est_fat_total_g",
        "est_carbs_total_g",
        "est_fiber_g",
        "est_sugar_total_g",
        "est_sodium_mg",
    ]

    df = dish_df.copy().reset_index(drop=True)
    if df.empty:
        raise ValueError("Dish dataset is empty.")

    # Stable ID
    if "dish_id" not in df.columns:
        df["dish_id"] = [f"NG_DISH_{i:04d}" for i in range(1, len(df) + 1)]

    df["text"] = _make_text_series(df, text_cols=text_cols)
    for c in categorical_cols:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str)

    for c in numeric_cols:
        if c not in df.columns:
            df[c] = 0.0
        s = pd.to_numeric(df[c], errors="coerce")
        df[c] = s.fillna(s.median() if s.notna().any() else 0.0)

    pre = ColumnTransformer(
        transformers=[
            (
                "text",
                TfidfVectorizer(
                    lowercase=True,
                    ngram_range=(1, 2),
                    min_df=1,
                    max_features=5000,
                    stop_words="english",
                ),
                "text",
            ),
            ("num", StandardScaler(with_mean=True, with_std=True), numeric_cols),
            ("cat", OneHotEncoder(handle_unknown="ignore"), categorical_cols),
        ],
        remainder="drop",
        sparse_threshold=0.3,
    )
    pipeline = Pipeline([("preprocess", pre)])
    embedding = pipeline.fit_transform(df)
    if not isinstance(embedding, np.ndarray):
        embedding = embedding.toarray()

    nn = NearestNeighbors(metric="cosine", algorithm="auto")
    nn.fit(embedding)

    feature_columns = ["text", *numeric_cols, *categorical_cols]
    keep_cols = ["dish_id", "dish_name", "main_ingredients", "description", *categorical_cols]
    # Keep numeric cols if present (for UI + health filters)
    keep_cols += [c for c in numeric_cols if c in df.columns]
    keep_cols += [c for c in ["has_recipe", "recipe_name", "recipe_procedures", "flag_diabetes_risk", "flag_hypertension_risk"] if c in df.columns]
    for c in keep_cols:
        if c not in df.columns:
            df[c] = ""

    return DishRecommenderArtifact(
        country=country,
        dish_df=df[keep_cols].copy(),
        pipeline=pipeline,
        nn=nn,
        embedding=embedding,
        feature_columns=feature_columns,
    )


def save_artifact(artifact: DishRecommenderArtifact, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, path)


def load_artifact(path: Path) -> DishRecommenderArtifact:
    return joblib.load(path)


def recommend_dishes(
    artifact: DishRecommenderArtifact,
    *,
    like_dish_id: Optional[str] = None,
    like_dish_name: Optional[str] = None,
    like_text: Optional[str] = None,
    region_filter: Optional[str] = None,
    condition: Optional[str] = None,
    top_k: int = 10,
) -> pd.DataFrame:
    df = artifact.dish_df.copy()
    if df.empty:
        return df

    rf = str(region_filter).strip().lower() if region_filter else ""
    region_series = df.get("region", "").fillna("").astype(str).str.lower()
    region_mask = None
    if rf:
        # Keep matching region, "Nationwide", or unknown/blank (many external datasets won't have a region field).
        region_mask = (
            region_series.str.contains(rf, na=False)
            | region_series.str.contains("nationwide", na=False)
            | (region_series.str.strip() == "")
        )

    seed_indices: list[int] = []

    if like_dish_id:
        hits = df.index[df["dish_id"].astype(str) == str(like_dish_id)].tolist()
        if hits:
            seed_indices.append(hits[0])

    if like_dish_name:
        s = str(like_dish_name).strip().lower()
        hits = df.index[df["dish_name"].astype(str).str.lower().str.contains(s, na=False)].tolist()
        if hits:
            seed_indices.append(hits[0])

    if like_text:
        # Use a synthetic seed vector from free-text (TF-IDF space).
        # We build a 1-row dataframe with the same columns used in training.
        txt = str(like_text).strip()
        if txt:
            tmp = pd.DataFrame({"text": [txt]})
            # Provide missing expected columns for the pipeline
            for c in artifact.feature_columns:
                if c == "text":
                    continue
                if c not in tmp.columns:
                    tmp[c] = 0.0 if c.startswith("est_") else ""
            seed_vec = artifact.pipeline.transform(tmp)
            if not isinstance(seed_vec, np.ndarray):
                seed_vec = seed_vec.toarray()
            n_neighbors = min(max(top_k * 20, top_k), len(df))
            distances, indices = artifact.nn.kneighbors(seed_vec, n_neighbors=n_neighbors)
            idxs = indices[0].tolist()
            sims = (1 - distances[0]).tolist()
            pairs = list(zip(idxs, sims))
            if region_mask is not None:
                pairs = [(i, s) for (i, s) in pairs if bool(region_mask.iat[i])]
            pairs = pairs[:top_k]
            recs = df.iloc[[i for i, _ in pairs]].copy()
            recs["similarity"] = [s for _, s in pairs]
            recs = recs.reset_index(drop=True)
            return _apply_condition_filter(recs, condition)

    if not seed_indices:
        seed_indices = [0]

    seed_vec = artifact.embedding[seed_indices].mean(axis=0, keepdims=True)
    n_neighbors = min(max(top_k * 20, top_k + len(seed_indices) + 10), len(df))
    distances, indices = artifact.nn.kneighbors(seed_vec, n_neighbors=n_neighbors)
    idxs = [i for i in indices[0].tolist() if i not in set(seed_indices)]
    sims = (1 - distances[0]).tolist()
    pairs = [(i, sims[j]) for j, i in enumerate(indices[0].tolist()) if i in set(idxs)]
    if region_mask is not None:
        pairs = [(i, s) for (i, s) in pairs if bool(region_mask.iat[i])]
    pairs = pairs[:top_k]
    recs = df.iloc[[i for i, _ in pairs]].copy()
    recs["similarity"] = [s for _, s in pairs]
    recs = recs.reset_index(drop=True)
    return _apply_condition_filter(recs, condition)


def _apply_condition_filter(recs: pd.DataFrame, condition: Optional[str]) -> pd.DataFrame:
    c = (condition or "").strip().lower()
    if not c or recs.empty:
        return recs
    if c == "diabetes":
        # First, apply any precomputed risk flags (from dish feature builder).
        if "flag_diabetes_risk" in recs.columns:
            recs = recs[~recs["flag_diabetes_risk"].fillna(False).astype(bool)].copy()
        # Then apply lightweight numeric + keyword heuristics as a safety net.
        # Check both dish name and ingredient text if present.
        def _col_series(col: str) -> pd.Series:
            if col in recs.columns:
                return recs[col].fillna("").astype(str).str.lower()
            return pd.Series([""] * len(recs), index=recs.index, dtype=str)

        name_l = _col_series("dish_name")
        ing_l = _col_series("main_ingredients") + " " + _col_series("recipe_ingredients")
        text_l = name_l + " " + ing_l
        bad_kw = text_l.str.contains(
            r"\bsweet\b|\bsugar\b|\bcaramel\w*\b|\bsoda\b|\bsoft drink\b|\bjuice\b|\bsyrup\b|\bhoney\b",
            regex=True,
            na=False,
        )
        recs = recs[~bad_kw].copy()
        if "est_sugar_total_g" in recs.columns:
            sugar = pd.to_numeric(recs["est_sugar_total_g"], errors="coerce").fillna(0.0)
            recs = recs[sugar <= 25.0].copy()
        if "est_carbs_total_g" in recs.columns and "est_fiber_g" in recs.columns:
            carbs = pd.to_numeric(recs["est_carbs_total_g"], errors="coerce").fillna(0.0)
            fiber = pd.to_numeric(recs["est_fiber_g"], errors="coerce").fillna(0.0)
            recs = recs[~((carbs > 80.0) & (fiber < 8.0))].copy()
        return recs.reset_index(drop=True)
    if c == "hypertension":
        if "flag_hypertension_risk" in recs.columns:
            recs = recs[~recs["flag_hypertension_risk"].fillna(False).astype(bool)].copy()
        if "est_sodium_mg" in recs.columns:
            sodium = pd.to_numeric(recs["est_sodium_mg"], errors="coerce").fillna(0.0)
            recs = recs[sodium <= 1000.0].copy()
        return recs.reset_index(drop=True)
    return recs
