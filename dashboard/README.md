# TAM / SAM / SOM dashboard

Source for the published claude.ai dashboard. It runs the same method as `engine.py`
in the browser, and its Base case matches it (TAM $35.1M, SOM $246K on the default screen).

The page runs inside a claude.ai Dashboard artifact, which supplies the `dash` data API and
`d3`, so these files don't open as a standalone page.

- `index.html`: the page, its controls and styles (Aprix palette)
- `model.js`: the TAM/SAM/SOM model, the Monte Carlo SOM simulation, and the reader for
  Capital IQ exports (CSV or .xlsx, from a dropped file or a Google Drive link)
- `charts.js`: the charts, drawn with d3
- `data/`: the assumption files the dashboard reads: cases, segment mapping, Aprix tiers
  and settings

The Capital IQ screen itself is licensed data and is not in this repo. Load an export on
the dashboard's Data panel, or replace the screen file in the dashboard's Sources.
