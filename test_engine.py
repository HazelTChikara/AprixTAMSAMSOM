from pathlib import Path

import pandas as pd
import pytest

import engine
from engine import Case

HERE = Path(__file__).parent
XLS = HERE / "TAM SAM SOM - correct industries.xls"


def counts_of(rows):
    table = pd.DataFrame(rows, columns=["Tier", "Companies"])
    table["Companies"] = table["Companies"].astype(float)
    return table


def test_reproduces_aprix_brazil_flat_tam():
    # Brazil review: 566 ICP companies at R$30k MRR = R$203.76M a year.
    counts = counts_of([("Tier 1", 566)])
    result = engine.size_market(counts, Case(1, 360_000, 0, 0))
    assert result["TAM"] == pytest.approx(203.76e6)


def test_reproduces_aprix_brazil_tier_pricing():
    # Brazil review: tier prices give R$255.84M, at an FX of 1 to stay in reais.
    counts = counts_of([("Tier 0", 20), ("Tier 1", 115), ("Tier 2", 190), ("Tier 3", 241)])
    result = engine.size_market(counts, Case(1, engine.BASE_ACV, 0, 0), pricing="tier", fx=1)
    assert result["TAM"] == pytest.approx(255.84e6)


def test_som_is_capped_by_sales_capacity():
    counts = counts_of([("Tier 1", 1000)])
    result = engine.size_market(counts, Case(fit=0.5, acv=100, win_rate=0.5, capacity_per_year=10))
    assert result["SOM clients"] == 30
    assert result["SOM limited by"] == "Sales capacity"


def test_som_uses_win_rate_when_capacity_is_spare():
    counts = counts_of([("Tier 1", 100)])
    result = engine.size_market(counts, Case(fit=0.5, acv=100, win_rate=0.1, capacity_per_year=10))
    assert result["SOM clients"] == 5
    assert result["SOM limited by"] == "Win rate"


@pytest.mark.parametrize("tags,segment", [
    ("Consumer Staples (Primary); Packaged Foods and Meats (Primary)", "Food manufacturing"),
    ("Energy (Primary); Oil and Gas Refining and Marketing (Primary)", "Fuels"),
    ("Consumer Staples (Primary); Food Distributors (Primary)", "Food distribution"),
    ("Industrials (Primary)", None),
    ("Consumer Staples (Primary)", None),
])
def test_classify(tags, segment):
    assert engine.classify(tags) == segment


@pytest.mark.parametrize("revenue,tier", [
    (2000, "Tier 0"), (1999, "Tier 1"), (300, "Tier 1"), (299, "Tier 2"),
    (100, "Tier 2"), (99, "Tier 3"), (40, "Tier 3"), (39, "Below Tier 3"),
])
def test_tier_thresholds_at_five_reais(revenue, tier):
    assert engine.tier_of(revenue) == tier


def test_every_capital_iq_tag_in_the_mapping_exists_in_the_screen():
    data, _ = engine.load_screen(XLS)
    tags = set()
    for value in data["Industry Classifications"]:
        tags |= {t.replace("(Primary)", "").strip() for t in value.split(";")}
    wanted = {tag for _, names in engine.SEGMENTS.values() for tag in names}
    assert wanted <= tags


def test_loads_workbook_and_detects_row_limit():
    data, meta = engine.load_screen(XLS)
    assert meta["exported"] == len(data) == 10_000
    assert 13_660 < meta["screen_count"] < 13_680
    assert meta["likely_capped"]
    assert (meta["screen_min"], meta["screen_max"]) == (50, 1900)


def test_csv_and_workbook_agree():
    from_xls, _ = engine.load_screen(XLS)
    from_csv, _ = engine.load_screen(HERE / "screening.csv")
    assert from_xls["Segment"].value_counts().equals(from_csv["Segment"].value_counts())


def test_cut_off_estimate_is_bounded_by_missing_companies():
    data, meta = engine.load_screen(XLS)
    countries = ["United States", "Canada"]
    estimate = engine.estimate_cut_off(data, meta, list(engine.SEGMENTS),
                                       engine.DEFAULT_REV_RANGE, countries)
    assert 0 < estimate["Companies"].sum() < meta["screen_count"] - meta["exported"]
    assert not len(engine.estimate_cut_off(data, meta, list(engine.SEGMENTS),
                                           (100, 1000), countries))


def test_rejects_files_that_are_not_screens(tmp_path):
    bad = tmp_path / "bad.csv"
    bad.write_text("a,b\n1,2\n")
    with pytest.raises(ValueError):
        engine.load_screen(bad)
