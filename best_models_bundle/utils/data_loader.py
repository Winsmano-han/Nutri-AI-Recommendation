from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd
import yaml


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def first_existing(paths: Iterable[Path]) -> Optional[Path]:
    for p in paths:
        if p.exists():
            return p
    return None


def read_wafct_nv(wafct_path: Path, sheet_name: str) -> pd.DataFrame:
    """
    Reads a WAFCT NV sheet and returns a dataframe including group headers.

    WAFCT NV sheets contain multiple non-data rows:
      - row 0: English headers (used as df columns)
      - row 1: French headers
      - row 2: short-code row (e.g., ENERC)
      - row 3+: group header rows + food rows
    """
    df = pd.read_excel(wafct_path, sheet_name=sheet_name, header=0, skiprows=[1, 2])
    if "Code" not in df.columns:
        raise ValueError(f"Expected 'Code' column in WAFCT sheet {sheet_name!r}")
    return df


def wafct_food_rows(df: pd.DataFrame) -> pd.DataFrame:
    code = df["Code"].astype(str)
    is_food = code.str.match(r"^\d{2}_\d+")

    is_group = (~is_food) & df["Code"].notna() & df["Code"].astype(str).str.contains("/")
    group_label = df["Code"].where(is_group).ffill()

    out = df[is_food].copy()
    out["wafct_group_label"] = group_label[is_food].values
    return out


def load_cnf_food_names(cnf_dir: Path) -> pd.DataFrame:
    add = pd.read_excel(cnf_dir / "FOOD NAME ADD.xlsx")
    chg = pd.read_excel(cnf_dir / "FOOD NAME CHANGE.xlsx")
    delete = pd.read_excel(cnf_dir / "FOOD NAME DELETE.xlsx")

    foods = pd.concat([add, chg], ignore_index=True)
    foods = foods[~foods["FoodID"].isin(set(delete["FoodID"]))].drop_duplicates("FoodID")
    return foods


def _normalize_cnf_nutrient_amount_columns(df: pd.DataFrame) -> pd.DataFrame:
    mapping = {}
    for col in df.columns:
        key = str(col).strip().lower().replace(" ", "").replace("_", "")
        if key == "foodid":
            mapping[col] = "FoodID"
        elif key in ("nutrientid", "nutrientnameid"):
            mapping[col] = "NutrientID"
        elif key == "nutrientvalue":
            mapping[col] = "NutrientValue"

    df = df.rename(columns=mapping)
    missing = {"FoodID", "NutrientID", "NutrientValue"} - set(df.columns)
    if missing:
        raise ValueError(f"CNF nutrient amount file missing required columns: {sorted(missing)}")
    return df[["FoodID", "NutrientID", "NutrientValue"]]


def load_cnf_nutrient_amounts(cnf_dir: Path) -> pd.DataFrame:
    add = _normalize_cnf_nutrient_amount_columns(pd.read_excel(cnf_dir / "NUTRIENT AMOUNT ADD.xlsx"))
    chg = _normalize_cnf_nutrient_amount_columns(pd.read_excel(cnf_dir / "NUTRIENT AMOUNT CHANGE.xlsx"))
    delete = _normalize_cnf_nutrient_amount_columns(pd.read_excel(cnf_dir / "NUTRIENT AMOUNT DELETE.xlsx"))

    nutrients = pd.concat([add, chg], ignore_index=True)
    delete_index = delete.set_index(["FoodID", "NutrientID"]).index
    nutrients = nutrients[~nutrients.set_index(["FoodID", "NutrientID"]).index.isin(delete_index)]
    return nutrients


def pivot_cnf_nutrients(
    nutrients_long: pd.DataFrame, nutrient_ids: Optional[set[int]] = None
) -> pd.DataFrame:
    df = nutrients_long.copy()
    df["NutrientID"] = pd.to_numeric(df["NutrientID"], errors="coerce").astype("Int64")
    df["NutrientValue"] = pd.to_numeric(df["NutrientValue"], errors="coerce")
    df = df.dropna(subset=["FoodID", "NutrientID"])

    if nutrient_ids is not None:
        df = df[df["NutrientID"].isin(list(nutrient_ids))]

    wide = (
        df.pivot_table(index="FoodID", columns="NutrientID", values="NutrientValue", aggfunc="first")
        .reset_index()
        .rename_axis(None, axis=1)
    )

    # Rename nutrient columns to a stable prefix form (nutrient_<id>)
    new_cols = []
    for c in wide.columns:
        if c == "FoodID":
            new_cols.append("FoodID")
        else:
            new_cols.append(f"nutrient_{int(c)}")
    wide.columns = new_cols
    return wide

