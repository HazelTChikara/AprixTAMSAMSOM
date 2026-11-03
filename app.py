"""TAM / SAM / SOM dashboard. Run with: ./run.sh"""
from io import BytesIO
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

import engine
from engine import Case

DEFAULT_FILE = Path(__file__).parent / "TAM SAM SOM - correct industries.xls"

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK_SECONDARY = "#52514e"
GRID = "#e1e0d9"
BLUE = "#2a78d6"
ORANGE = "#eb6834"
CASE_COLORS = {"Low": "#86b6ef", "Base": "#2a78d6", "High": "#184f95"}
TIER_COLORS = {"Below Tier 3": "#b7d3f6", "Tier 3": "#86b6ef", "Tier 2": "#3987e5",
               "Tier 1": "#1c5cab", "Tier 0": "#0d366b"}
TIER_ORDER = ["Tier 0", "Tier 1", "Tier 2", "Tier 3", "Below Tier 3"]
FONT = dict(family='system-ui, -apple-system, "Segoe UI", sans-serif', color=INK, size=13)


def money(value):
    if abs(value) >= 1e9:
        return f"${value / 1e9:.2f}B"
    if abs(value) >= 1e6:
        return f"${value / 1e6:.1f}M"
    if abs(value) >= 1e3:
        return f"${value / 1e3:.0f}K"
    return f"${value:.0f}"


def plain(text):
    """Stop Streamlit reading dollar signs as math."""
    return text.replace("$", r"\$")


def style(fig, height):
    fig.update_layout(height=height, font=FONT, paper_bgcolor=SURFACE, plot_bgcolor=SURFACE,
                      margin=dict(l=8, r=24, t=36, b=8), bargap=0.45,
                      hoverlabel=dict(bgcolor=SURFACE, font_color=INK, bordercolor=GRID))
    fig.update_xaxes(showgrid=True, gridcolor=GRID, zeroline=False, tickfont_color=INK_SECONDARY)
    fig.update_yaxes(showgrid=False, tickfont_color=INK)
    return fig


def funnel_chart(summary):
    """TAM, SAM and SOM by case. Each measure gets its own scale, so SOM stays visible."""
    measures = ["TAM", "SAM", "SOM"]
    fig = make_subplots(rows=1, cols=3, subplot_titles=measures, shared_yaxes=True,
                        horizontal_spacing=0.05)
    cases = list(summary.columns)[::-1]
    for col, measure in enumerate(measures, start=1):
        values = [summary.loc[measure, case] for case in cases]
        fig.add_trace(go.Bar(
            y=cases, x=values, orientation="h", showlegend=False,
            marker=dict(color=[CASE_COLORS[c] for c in cases], cornerradius=4),
            text=[money(v) for v in values], textposition="outside", cliponaxis=False,
            textfont_color=INK,
            hovertemplate=f"{measure}, %{{y}} case: %{{text}}<extra></extra>"), row=1, col=col)
        fig.update_xaxes(range=[0, max(values) * 1.3 or 1], tickformat="$~s", row=1, col=col)
    return style(fig, 250)


def segment_chart(counts):
    """Companies per segment, stacked by Aprix tier."""
    pivot = counts.pivot_table(index="Segment", columns="Tier", values="Companies",
                               aggfunc="sum", fill_value=0)
    pivot = pivot.loc[pivot.sum(axis=1).sort_values().index]
    fig = go.Figure()
    for tier in TIER_ORDER[::-1]:
        if tier in pivot:
            fig.add_trace(go.Bar(
                y=pivot.index, x=pivot[tier], name=tier, orientation="h",
                marker=dict(color=TIER_COLORS[tier], line=dict(color=SURFACE, width=2)),
                hovertemplate="%{y}, " + tier + ": %{x:,.0f} companies<extra></extra>"))
    totals = pivot.sum(axis=1)
    fig.add_trace(go.Scatter(
        y=pivot.index, x=totals, mode="text", text=[f"{t:,.0f}" for t in totals],
        textposition="middle right", textfont_color=INK, showlegend=False, hoverinfo="skip"))
    fig.update_layout(barmode="stack", legend=dict(orientation="h", y=1.1, x=0, traceorder="normal"))
    fig.update_xaxes(range=[0, totals.max() * 1.12], title_text="Companies")
    return style(fig, 130 + 44 * len(pivot))


def tornado_chart(table, base_som):
    """One driver at a time: how far each moves Base SOM."""
    rows = table.iloc[::-1]
    fig = go.Figure()
    for column, label, color in (("Low case", "Driver at Low", ORANGE),
                                 ("High case", "Driver at High", BLUE)):
        fig.add_trace(go.Bar(
            y=rows["Driver"], x=rows[column] - base_som, base=base_som, name=label,
            orientation="h", marker=dict(color=color, line=dict(color=SURFACE, width=2)),
            customdata=[money(v) for v in rows[column]],
            hovertemplate="%{y}: SOM %{customdata}<extra>" + label + "</extra>"))
    fig.add_vline(x=base_som, line_color=INK_SECONDARY, line_width=1)
    fig.add_annotation(x=base_som, y=1.0, yref="paper", yanchor="bottom", showarrow=False,
                       text=f"Base SOM {money(base_som)}", font_color=INK_SECONDARY)
    fig.update_layout(barmode="overlay", legend=dict(orientation="h", y=-0.12, x=0))
    fig.update_xaxes(tickformat="$~s")
    return style(fig, 300)


@st.cache_data(show_spinner=False)
def read_upload(content, name):
    return engine.load_screen(BytesIO(content), name=name)


@st.cache_data(show_spinner=False)
def read_default():
    return engine.load_screen(DEFAULT_FILE)


def edit_cases():
    """Editable Low / Base / High inputs, in the same layout as the team's slide."""
    d = engine.DEFAULT_CASES
    grid = pd.DataFrame(
        {name: [d[name].fit * 100, d[name].acv, d[name].win_rate * 100, d[name].capacity_per_year]
         for name in d},
        index=["Share that fit (%)", "Yearly contract (US$)", "Win rate by year 3 (%)",
               "Clients signed per year"])
    edited = st.data_editor(grid, width="stretch", key="cases")
    return {name: Case(fit=edited[name].iloc[0] / 100, acv=float(edited[name].iloc[1]),
                       win_rate=edited[name].iloc[2] / 100,
                       capacity_per_year=float(edited[name].iloc[3])) for name in d}


st.set_page_config(page_title="TAM SAM SOM", layout="wide")
st.title("TAM / SAM / SOM")

with st.sidebar:
    st.header("Data")
    upload = st.file_uploader("Capital IQ screen (.xls, .xlsx or .csv)",
                              type=["xls", "xlsx", "csv"])
    try:
        if upload:
            data, meta = read_upload(upload.getvalue(), upload.name)
            source_name = upload.name
        elif DEFAULT_FILE.exists():
            data, meta = read_default()
            source_name = DEFAULT_FILE.name
        else:
            st.info("Upload a Capital IQ screen to begin.")
            st.stop()
    except Exception as error:
        st.error(f"Couldn't read that file: {error}")
        st.stop()
    st.caption(f"Using {source_name}")

    st.header("Who counts")
    segments = st.multiselect("Segments", list(engine.SEGMENTS), default=engine.CORE_SEGMENTS,
                              help="Default is the four core industries from the team's slide.")
    countries = st.multiselect("Countries", ["United States", "Canada"],
                               default=["United States", "Canada"])
    low_rev, high_rev = st.slider("Company revenue (US$M)", 0, 2000,
                                  tuple(int(v) for v in engine.DEFAULT_REV_RANGE), step=10)
    include_estimate = False
    if meta["likely_capped"] and meta.get("screen_count"):
        include_estimate = st.checkbox(
            "Add estimate for companies cut off by the export", value=False,
            help="Capital IQ stops at 10,000 rows, so the smallest companies are missing.")

    st.header("Price and FX")
    pricing_label = st.radio("Contract value", ["Flat, by case", "Aprix tier prices"])
    pricing = "tier" if pricing_label == "Aprix tier prices" else "flat"
    fx = st.number_input("BRL per USD", min_value=1.0, value=engine.DEFAULT_FX, step=0.1)

if not segments or not countries:
    st.warning("Choose at least one segment and one country.")
    st.stop()

st.subheader("Assumptions")
cases = edit_cases()

rev_range = (float(low_rev), float(high_rev))
chosen = engine.select_companies(data, segments, rev_range, countries, fx)
counted = engine.count_companies(chosen)
estimate = engine.estimate_cut_off(data, meta, segments, rev_range, countries, fx)
counts = pd.concat([counted, estimate], ignore_index=True) if include_estimate else counted
if counts.empty:
    st.warning("No companies match these filters.")
    st.stop()

summary = engine.summary_table(counts, cases, pricing, fx)
base = summary["Base"]

for column, label, detail in zip(
        st.columns(3), ["TAM", "SAM", "SOM"],
        [f"{base['TAM companies']:,.0f} companies", f"{base['SAM companies']:,.0f} companies",
         f"{base['SOM clients']:.1f} clients by year 3"]):
    column.metric(f"{label}, Base", money(base[label]), help=detail)
    column.caption(plain(f"{detail} · Low {money(summary['Low'][label])}, "
                         f"High {money(summary['High'][label])}"))

top_low, top_high = engine.TOP_DOWN_RANGE
notes = [
    f"Source: {source_name}.",
    f"TAM counts {base['TAM companies']:,.0f} companies with US${low_rev:,}M to "
    f"US${high_rev:,}M revenue. SAM applies the fit share. SOM applies the win rate to SAM, "
    f"capped at {engine.YEARS} years of sales capacity.",
    f"Base TAM is {base['TAM'] / top_high:.0%} to {base['TAM'] / top_low:.0%} of the published "
    f"top-down estimate of {money(top_low)} to {money(top_high)}.",
]
if (summary.loc["SOM limited by"] == "Win rate").all():
    notes.append("Sales capacity never limits SOM in these cases, so the win rate decides it "
                 "and changing clients signed per year has no effect.")
if meta["likely_capped"]:
    if meta.get("screen_count"):
        cut = meta["screen_count"] - meta["exported"]
        extra = estimate["Companies"].sum()
        added = "are included" if include_estimate else "are not included"
        notes.append(f"Export is incomplete: {meta['exported']:,} of about "
                     f"{meta['screen_count']:,} companies. About {cut:,} below "
                     f"US${meta['export_floor']:.1f}M are missing, of which an estimated "
                     f"{extra:,.0f} are in scope and {added}.")
    else:
        notes.append(f"Export has exactly {meta['exported']:,} rows, so it was probably cut off "
                     "at Capital IQ's limit. Use the .xls export to confirm.")
if high_rev > meta.get("screen_max", high_rev):
    notes.append(f"The screen stops at US${meta['screen_max']:,.0f}M revenue, so larger "
                 "companies are not counted.")

st.subheader("Size by case")
st.plotly_chart(funnel_chart(summary), width="stretch")

left, right = st.columns(2)
with left:
    st.subheader("Companies by segment and Aprix tier")
    st.plotly_chart(segment_chart(counts), width="stretch")
with right:
    st.subheader("What moves SOM most")
    table = engine.sensitivity(counts, cases, pricing, fx)
    st.plotly_chart(tornado_chart(table, base["SOM"]), width="stretch")

st.subheader("Notes")
for note in notes:
    st.markdown(plain(f"- {note}"))

st.subheader("Tables")
display = summary.copy().astype(object)
for row in ("TAM", "SAM", "SOM", "Average contract"):
    display.loc[row] = [money(v) for v in summary.loc[row]]
for row in ("TAM companies", "SAM companies"):
    display.loc[row] = [f"{v:,.0f}" for v in summary.loc[row]]
display.loc["SOM clients"] = [f"{v:.1f}" for v in summary.loc["SOM clients"]]
tab_summary, tab_segments, tab_sensitivity, tab_companies = st.tabs(
    ["Summary", "Segments", "Sensitivity", "Companies"])
with tab_summary:
    st.dataframe(display, width="stretch")
with tab_segments:
    st.dataframe(counts.pivot_table(index=["Group", "Segment"], columns="Country",
                                    values="Companies", aggfunc="sum", fill_value=0,
                                    margins=True, margins_name="Total").round(0), width="stretch")
with tab_sensitivity:
    shown = table.copy()
    for column in ("Low case", "High case", "Swing"):
        shown[column] = shown[column].map(money)
    st.dataframe(shown, width="stretch", hide_index=True)
with tab_companies:
    st.dataframe(chosen[["Company Name", "Segment", "Tier", "Revenue", "Country"]]
                 .sort_values("Revenue", ascending=False), width="stretch", hide_index=True)

st.download_button("Download Excel workbook",
                   engine.to_excel(summary, cases, counts, chosen, notes),
                   file_name="TAM_SAM_SOM.xlsx")
