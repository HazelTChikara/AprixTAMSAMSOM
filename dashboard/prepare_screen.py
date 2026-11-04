"""Turn a Capital IQ export into the dashboard's saved screen.

    ~/.venvs/tamsamsom/bin/python dashboard/prepare_screen.py "<export.xls>" --version 2
    ~/.venvs/tamsamsom/bin/python dashboard/prepare_screen.py "<export.xls>" --version 2 --icp-template
    ~/.venvs/tamsamsom/bin/python dashboard/prepare_screen.py "<export.xls>" --version 2 --icp-answers answers.xlsx

Writes dashboard/data/capital-iq-screen.csv (the columns the dashboard reads) and
dashboard/data/screen_info.csv (version, export date and the screen's true size).
--icp-template also writes dashboard/data/icp-answers-template.csv: the companies in
the segments, with a blank yes/no column per ICP attribute to fill in.
--icp-answers adds a filled-in answers file's columns to the saved screen, by Company Name.
All of these stay out of git: the export is licensed data.
"""
import argparse
import datetime
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import engine  # noqa: E402

COLUMNS = ["Company Name", "Geographic Locations", "Industry Classifications"]
REVENUE = "Total Revenue [LTM] ($USDmm, Historical rate)"


def icp_columns():
    icp = pd.read_csv(HERE / "data" / "icp.csv")
    return icp, list(icp.loc[icp["key"] != "revenue", "column"])


def write_template(data, path):
    icp, cols = icp_columns()
    rev = icp.loc[icp["key"] == "revenue"].iloc[0]
    keep = data["Segment"].notna() & data["Revenue"].between(rev["from_usd_m"], rev["to_usd_m"])
    out = data.loc[keep, ["Company Name", "Segment", "Country", "Revenue"]].rename(columns={"Revenue": "Revenue (US$M)"})
    out.insert(2, "Group", out["Segment"].map(lambda seg: engine.SEGMENTS[seg][0]))
    out = out.sort_values(["Group", "Revenue (US$M)"], ascending=[False, False])  # Core first
    for c in cols:
        out[c] = ""
    out.to_csv(path, index=False)
    print(f"Template for {len(out):,} companies: {path}")


def merge_answers(screen, answers_path):
    _, cols = icp_columns()
    read = pd.read_excel if answers_path.suffix.lower() in (".xlsx", ".xls") else pd.read_csv
    answers = read(answers_path)
    have = [c for c in cols if c in answers.columns]
    if "Company Name" not in answers.columns or not have:
        raise SystemExit(f"{answers_path.name} needs a Company Name column and at least one of: {', '.join(cols)}")
    answers = answers[["Company Name"] + have].drop_duplicates("Company Name")
    merged = screen.merge(answers, on="Company Name", how="left")
    print(f"Answers for {merged[have].notna().any(axis=1).sum():,} companies, columns: {', '.join(have)}")
    return merged


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("export", type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--exported-on", help="YYYY-MM-DD; defaults to the file's date")
    parser.add_argument("--icp-template", action="store_true", help="also write an ICP answers template")
    parser.add_argument("--icp-answers", type=Path, help="filled-in ICP answers (.csv or .xlsx) to add to the screen")
    args = parser.parse_args()

    data, meta = engine.load_screen(args.export)
    out = HERE / "data"
    screen = data.rename(columns={"Revenue": REVENUE})[COLUMNS + [REVENUE]]
    if args.icp_answers:
        screen = merge_answers(screen, args.icp_answers)
    screen.to_csv(out / "capital-iq-screen.csv", index=False)
    if args.icp_template:
        write_template(data, out / "icp-answers-template.csv")

    exported_on = args.exported_on or datetime.date.fromtimestamp(args.export.stat().st_mtime).isoformat()
    info = {
        "version": args.version,
        "label": f"v{args.version} · Capital IQ export of {exported_on}",
        "source_file": args.export.name,
        "exported_on": exported_on,
        "screen_total_companies": meta.get("screen_count", ""),
        "screen_revenue_min_usd_m": meta.get("screen_min", ""),
        "screen_revenue_max_usd_m": meta.get("screen_max", ""),
    }
    with open(out / "screen_info.csv", "w") as f:
        f.write(",".join(info) + "\n" + ",".join(str(v) for v in info.values()) + "\n")

    print(f"{len(data):,} companies exported; screen holds {meta.get('screen_count', 'unknown')}.")
    if meta.get("likely_capped"):
        print("The export hit Capital IQ's row limit; the dashboard estimates the cut-off.")


if __name__ == "__main__":
    main()
