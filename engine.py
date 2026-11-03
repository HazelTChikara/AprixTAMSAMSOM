"""TAM / SAM / SOM engine for Capital IQ company screens.

Follows the Aprix team method: count target companies (TAM), keep the share that
fits (SAM), then apply a win rate capped by sales capacity over three years (SOM).
All money is annual recurring revenue in US$.
"""
import io
import re
from dataclasses import dataclass

import pandas as pd

YEARS = 3
BASE_ACV = 60_000
DEFAULT_FX = 5.0  # BRL per USD, the rate used in the team's analysis deck
DEFAULT_REV_RANGE = (50.0, 1000.0)  # US$M, from the team's sizing slide
TOP_DOWN_RANGE = (400e6, 500e6)  # published North America estimates

# Aprix's Brazil tiers: name, minimum annual revenue (R$M), target MRR (R$).
TIERS = [
    ("Tier 0", 10_000, 100_000),
    ("Tier 1", 1_500, 60_000),
    ("Tier 2", 500, 40_000),
    ("Tier 3", 200, 20_000),
]
TIER_NAMES = [t[0] for t in TIERS]
BELOW_TIERS = "Below Tier 3"

# Capital IQ classifications that map to each segment.
SEGMENTS = {
    "Food manufacturing": ("Core", ["Packaged Foods and Meats"]),
    "Beverages": ("Core", ["Brewers", "Distillers and Vintners",
                           "Soft Drinks and Non-alcoholic Beverages"]),
    "Household & personal care": ("Core", ["Household Products", "Personal Care Products"]),
    "Fuels": ("Core", ["Oil and Gas Refining and Marketing"]),
    "Agricultural inputs & products": ("Adjacent", ["Fertilizers and Agricultural Chemicals",
                                                    "Agricultural Products and Services"]),
    "Food distribution": ("Adjacent", ["Food Distributors"]),
    "Food & drug retail": ("Adjacent", ["Food Retail", "Drug Retail",
                                        "Consumer Staples Merchandise Retail"]),
    "Health plans": ("Adjacent", ["Managed Health Care"]),
}
CORE_SEGMENTS = [name for name, (group, _) in SEGMENTS.items() if group == "Core"]


@dataclass(frozen=True)
class Case:
    fit: float
    acv: float
    win_rate: float
    capacity_per_year: float


# From the team's sizing slide.
DEFAULT_CASES = {
    "Low": Case(fit=0.20, acv=40_000, win_rate=0.01, capacity_per_year=5),
    "Base": Case(fit=0.35, acv=60_000, win_rate=0.02, capacity_per_year=10),
    "High": Case(fit=0.50, acv=90_000, win_rate=0.04, capacity_per_year=20),
}


def _read_metadata(book):
    """Pull the true screen size and revenue bounds from a Capital IQ workbook."""
    meta = {}
    if "Aggregates" in book.sheet_names:
        rows = pd.read_excel(book, "Aggregates", header=None).dropna(how="all")
        values = {str(r[0]).strip(): r[1] for r in rows.itertuples(index=False)}
        total, average = values.get("Total"), values.get("Average")
        if total and average:
            meta["screen_count"] = round(float(total) / float(average))
            meta["screen_revenue"] = float(total)
    if "Screen Criteria" in book.sheet_names:
        text = " ".join(pd.read_excel(book, "Screen Criteria", header=None)[0].dropna().astype(str))
        match = re.search(r"Total Revenue.*?between ([\d.,]+) and ([\d.,]+)", text)
        if match:
            meta["screen_min"] = float(match[1].replace(",", ""))
            meta["screen_max"] = float(match[2].replace(",", ""))
    return meta


def load_screen(source, name=None):
    """Read a Capital IQ export (.xls, .xlsx or .csv). Returns (companies, metadata)."""
    name = name or getattr(source, "name", str(source))
    if name.lower().endswith((".xls", ".xlsx")):
        book = pd.ExcelFile(source)
        sheet = "Screening" if "Screening" in book.sheet_names else book.sheet_names[0]
        raw = pd.read_excel(book, sheet, header=None)
        header_rows = raw.index[raw.eq("Company Name").any(axis=1)]
        if len(header_rows) == 0:
            raise ValueError(f"No 'Company Name' header found on sheet '{sheet}'.")
        data = raw.iloc[header_rows[0] + 1:].copy()
        data.columns = raw.iloc[header_rows[0]]
        data.columns.name = None
        meta = _read_metadata(book)
    else:
        data = pd.read_csv(source)
        meta = {}

    revenue_cols = [c for c in data.columns if str(c).startswith("Total Revenue")]
    required = {"Company Name", "Industry Classifications", "Geographic Locations"}
    if not revenue_cols or not required <= set(data.columns):
        raise ValueError("This doesn't look like a Capital IQ screen: expected company name, "
                         "industry, location and Total Revenue columns.")

    data = data.dropna(subset=["Company Name"]).rename(columns={revenue_cols[0]: "Revenue"})
    data["Revenue"] = pd.to_numeric(data["Revenue"], errors="coerce")
    data = data.dropna(subset=["Revenue"]).drop_duplicates(["Company Name", "Revenue"])
    data["Country"] = data["Geographic Locations"].str.contains("Canada", regex=False).map(
        {True: "Canada", False: "United States"})
    data["Segment"] = data["Industry Classifications"].map(classify)

    meta["exported"] = len(data)
    meta["export_floor"] = float(data["Revenue"].min())
    meta["likely_capped"] = (meta.get("screen_count", 0) > len(data) * 1.001
                             or (not meta.get("screen_count") and len(data) % 10_000 == 0))
    return data.reset_index(drop=True), meta


def classify(classifications):
    """Map a Capital IQ classification string to a segment, or None if out of scope."""
    tags = {t.replace("(Primary)", "").strip() for t in str(classifications).split(";")}
    for segment, (_, wanted) in SEGMENTS.items():
        if tags.intersection(wanted):
            return segment
    return None


def tier_of(revenue_usd_m, fx=DEFAULT_FX):
    """Aprix tier for a company's revenue (US$M), using its R$ thresholds."""
    for name, min_brl_m, _ in TIERS:
        if revenue_usd_m * fx >= min_brl_m:
            return name
    return BELOW_TIERS


def tier_acv(fx=DEFAULT_FX):
    """Aprix's target yearly contract value per tier, converted to US$."""
    acv = {name: mrr * 12 / fx for name, _, mrr in TIERS}
    acv[BELOW_TIERS] = acv["Tier 3"]
    return acv


def select_companies(data, segments, rev_range, countries, fx=DEFAULT_FX):
    """Companies in scope, with their Aprix tier."""
    low, high = rev_range
    keep = (data["Segment"].isin(segments) & data["Revenue"].between(low, high)
            & data["Country"].isin(countries))
    chosen = data[keep].copy()
    chosen["Tier"] = chosen["Revenue"].map(lambda r: tier_of(r, fx))
    chosen["Group"] = chosen["Segment"].map(lambda s: SEGMENTS[s][0])
    return chosen


def count_companies(chosen):
    counts = chosen.groupby(["Segment", "Group", "Tier", "Country"], as_index=False).size()
    counts = counts.rename(columns={"size": "Companies"})
    counts["Companies"] = counts["Companies"].astype(float)
    counts["Estimated"] = False
    return counts


def estimate_cut_off(data, meta, segments, rev_range, countries, fx=DEFAULT_FX):
    """Estimate in-scope companies lost when an export hits Capital IQ's row limit.

    Exports are sorted by revenue, so the missing rows sit just below the export
    floor. Assumes they split across segments like companies just above it.
    """
    empty = pd.DataFrame(columns=["Segment", "Group", "Tier", "Country", "Companies", "Estimated"])
    missing = meta.get("screen_count", 0) - meta["exported"]
    floor, screen_min = meta["export_floor"], meta.get("screen_min")
    if missing <= 0 or screen_min is None or rev_range[0] >= floor:
        return empty

    in_range = (floor - max(rev_range[0], screen_min)) / (floor - screen_min)
    nearby = data[data["Revenue"].between(floor, floor * 1.5)]
    similar = nearby[nearby["Segment"].isin(segments) & nearby["Country"].isin(countries)]
    if similar.empty:
        return empty

    estimate = similar.groupby(["Segment", "Country"], as_index=False).size()
    estimate["Companies"] = estimate["size"] / len(nearby) * missing * in_range
    estimate["Group"] = estimate["Segment"].map(lambda s: SEGMENTS[s][0])
    estimate["Tier"] = tier_of((screen_min + floor) / 2, fx)
    estimate["Estimated"] = True
    return estimate[empty.columns.tolist()]


def size_market(counts, case, pricing="flat", fx=DEFAULT_FX):
    """TAM, SAM and SOM for one case.

    pricing="flat" uses the case's contract value for every company. pricing="tier"
    uses Aprix's tier prices, scaled by the case's contract value against Base.
    """
    companies = counts["Companies"].sum()
    acv = case.acv
    if pricing == "tier" and companies:
        prices = tier_acv(fx)
        tiered = (counts["Tier"].map(prices) * counts["Companies"]).sum() / companies
        acv = tiered * case.acv / BASE_ACV

    sam_companies = companies * case.fit
    wanted = sam_companies * case.win_rate
    capacity = case.capacity_per_year * YEARS
    clients = min(wanted, capacity)
    return {
        "TAM companies": companies,
        "SAM companies": sam_companies,
        "SOM clients": clients,
        "Average contract": acv,
        "TAM": companies * acv,
        "SAM": sam_companies * acv,
        "SOM": clients * acv,
        "SOM limited by": "Sales capacity" if wanted > capacity else "Win rate",
    }


def sensitivity(counts, cases, pricing="flat", fx=DEFAULT_FX):
    """Base SOM when one driver moves to its Low or High value, biggest swing first."""
    base = cases["Base"]
    drivers = {"Yearly contract value": "acv", "Win rate by year 3": "win_rate",
               "Share of companies that fit": "fit", "Clients signed per year": "capacity_per_year"}
    rows = []
    for label, field in drivers.items():
        results = {}
        for case_name in ("Low", "High"):
            moved = {**base.__dict__, field: getattr(cases[case_name], field)}
            results[case_name] = size_market(counts, Case(**moved), pricing, fx)["SOM"]
        rows.append({"Driver": label, "Low case": results["Low"], "High case": results["High"]})
    table = pd.DataFrame(rows)
    table["Swing"] = (table["High case"] - table["Low case"]).abs()
    return table.sort_values("Swing", ascending=False, ignore_index=True)


def summary_table(counts, cases, pricing="flat", fx=DEFAULT_FX):
    return pd.DataFrame({name: size_market(counts, case, pricing, fx)
                         for name, case in cases.items()})


def to_excel(summary, cases, counts, chosen, notes):
    """Workbook with the numbers, the inputs and the company list behind them."""
    assumptions = pd.DataFrame({name: case.__dict__ for name, case in cases.items()})
    by_segment = counts.groupby(["Group", "Segment", "Tier"], as_index=False)["Companies"].sum()
    by_country = counts.groupby("Country", as_index=False)["Companies"].sum()
    companies = chosen[["Company Name", "Segment", "Group", "Tier", "Revenue", "Country",
                        "Geographic Locations"]].sort_values("Revenue", ascending=False)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        summary.to_excel(writer, sheet_name="Summary")
        assumptions.to_excel(writer, sheet_name="Assumptions")
        by_segment.to_excel(writer, sheet_name="By segment", index=False)
        by_country.to_excel(writer, sheet_name="By country", index=False)
        companies.to_excel(writer, sheet_name="Companies", index=False)
        pd.DataFrame({"Notes": notes}).to_excel(writer, sheet_name="Notes", index=False)
    return buffer.getvalue()
