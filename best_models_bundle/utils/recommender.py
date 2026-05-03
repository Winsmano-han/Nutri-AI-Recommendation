from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


@dataclass(frozen=True)
class RecommenderArtifact:
    country: str
    food_df: pd.DataFrame
    pipeline: Pipeline
    nn: NearestNeighbors
    embedding: np.ndarray
    feature_columns: list[str]


def _safe_bool(df: pd.DataFrame, cols: Iterable[str]) -> pd.DataFrame:
    out = df.copy()
    for c in cols:
        if c not in out.columns:
            out[c] = False
        out[c] = out[c].fillna(False).astype(bool)
    return out


def build_item_pipeline(numeric_cols: list[str], categorical_cols: list[str]) -> Pipeline:
    pre = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(with_mean=True, with_std=True), numeric_cols),
            ("cat", OneHotEncoder(handle_unknown="ignore"), categorical_cols),
        ],
        remainder="drop",
        sparse_threshold=0.3,
    )
    return Pipeline([("preprocess", pre)])


def train_country_recommender(
    master_df: pd.DataFrame,
    country: str,
    *,
    numeric_cols: list[str],
    categorical_cols: list[str],
    required_cols: Optional[list[str]] = None,
) -> RecommenderArtifact:
    df = master_df[master_df["country"].astype(str) == country].copy()
    if df.empty:
        raise ValueError(f"No rows found for country={country!r}")

    required_cols = required_cols or []
    for c in ["food_id", "food_name", "category_main", "fbdg_score", *required_cols]:
        if c not in df.columns:
            df[c] = np.nan

    # Keep core metadata and feature columns
    df = df.reset_index(drop=True)

    # Fill missing numeric values with column medians (robust to sparse nutrients)
    for c in numeric_cols:
        if c not in df.columns:
            df[c] = np.nan
        series = pd.to_numeric(df[c], errors="coerce")
        if series.notna().any():
            med = series.median()
        else:
            med = 0.0
        df[c] = series.fillna(med)

    for c in categorical_cols:
        if c not in df.columns:
            df[c] = ""
        df[c] = df[c].fillna("").astype(str)

    pipeline = build_item_pipeline(numeric_cols=numeric_cols, categorical_cols=categorical_cols)
    embedding = pipeline.fit_transform(df)
    if not isinstance(embedding, np.ndarray):
        embedding = embedding.toarray()

    nn = NearestNeighbors(metric="cosine", algorithm="auto")
    nn.fit(embedding)

    feature_columns = [*numeric_cols, *categorical_cols]
    return RecommenderArtifact(
        country=country,
        food_df=df[
            [
                "food_id",
                "food_name",
                "category_main",
                "fbdg_score",
                "food_kind",
                "is_prepared_dish",
                "allergen_summary",
            ]
        ].copy()
        if "allergen_summary" in df.columns and "food_kind" in df.columns and "is_prepared_dish" in df.columns
        else df[
            [
                "food_id",
                "food_name",
                "category_main",
                "fbdg_score",
            ]
        ].copy(),
        pipeline=pipeline,
        nn=nn,
        embedding=embedding,
        feature_columns=feature_columns,
    )


def save_artifact(artifact: RecommenderArtifact, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, path)


def load_artifact(path: Path) -> RecommenderArtifact:
    return joblib.load(path)


def recommend(
    artifact: RecommenderArtifact,
    *,
    like_food_id: Optional[str] = None,
    like_food_ids: Optional[list[str]] = None,
    like_food_name: Optional[str] = None,
    like_food_names: Optional[list[str]] = None,
    top_k: int = 10,
    min_fbdg_score: Optional[float] = None,
    exclude_allergens: Optional[set[str]] = None,
) -> pd.DataFrame:
    df = artifact.food_df.copy()
    exclude_allergens = exclude_allergens or set()

    if min_fbdg_score is not None and "fbdg_score" in df.columns:
        df = df[pd.to_numeric(df["fbdg_score"], errors="coerce").fillna(-1) >= float(min_fbdg_score)]

    if exclude_allergens and "allergen_summary" in df.columns:
        def has_excluded(s: str) -> bool:
            present = set([x.strip() for x in (s or "").split(",") if x.strip()])
            return len(present & exclude_allergens) > 0

        mask = ~df["allergen_summary"].fillna("").astype(str).apply(has_excluded)
        df = df[mask]

    if df.empty:
        return df

    # Build seed vector (single or centroid of multiple)
    seed_indices: list[int] = []

    if like_food_ids:
        for fid in like_food_ids:
            hits = artifact.food_df.index[artifact.food_df["food_id"].astype(str) == str(fid)].tolist()
            if hits:
                seed_indices.append(hits[0])
    if like_food_id:
        hits = artifact.food_df.index[artifact.food_df["food_id"].astype(str) == str(like_food_id)].tolist()
        if hits:
            seed_indices.append(hits[0])

    if like_food_names:
        for name in like_food_names:
            s = str(name).strip().lower()
            hits = artifact.food_df.index[
                artifact.food_df["food_name"].astype(str).str.lower().str.contains(s, na=False)
            ].tolist()
            if hits:
                seed_indices.append(hits[0])
    if like_food_name:
        s = str(like_food_name).strip().lower()
        hits = artifact.food_df.index[
            artifact.food_df["food_name"].astype(str).str.lower().str.contains(s, na=False)
        ].tolist()
        if hits:
            seed_indices.append(hits[0])

    if not seed_indices:
        seed_indices = [int(artifact.food_df["fbdg_score"].fillna(0).astype(float).idxmax())]

    seed_vec = artifact.embedding[seed_indices].mean(axis=0, keepdims=True)

    distances, indices = artifact.nn.kneighbors(seed_vec, n_neighbors=min(top_k + len(seed_indices), len(artifact.food_df)))
    indices = [i for i in indices[0].tolist() if i not in set(seed_indices)][:top_k]
    recs = artifact.food_df.iloc[indices].copy()
    # Convert cosine distance -> similarity
    recs["similarity"] = (1 - distances[0][: len(indices)]).tolist()

    # Apply post-filter after similarity (keeps nearest-neighbor semantics)
    if min_fbdg_score is not None:
        recs = recs[pd.to_numeric(recs["fbdg_score"], errors="coerce").fillna(-1) >= float(min_fbdg_score)]
    if exclude_allergens and "allergen_summary" in recs.columns:
        def has_excluded2(s: str) -> bool:
            present = set([x.strip() for x in (s or "").split(",") if x.strip()])
            return len(present & exclude_allergens) > 0

        recs = recs[~recs["allergen_summary"].fillna("").astype(str).apply(has_excluded2)]

    return recs.reset_index(drop=True)
