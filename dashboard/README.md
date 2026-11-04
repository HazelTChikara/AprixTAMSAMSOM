# TAM / SAM / SOM dashboard

Source for the published claude.ai dashboard. It runs the same method as `engine.py`
in the browser, and its Base case matches it (TAM $35.1M, SOM $246K on the default screen).

The page runs inside a claude.ai Dashboard artifact, which supplies the `dash` data API and
`d3`, so these files don't open as a standalone page.

- `index.html`: the page, its controls and styles (Aprix palette)
- `model.js`: the TAM/SAM/SOM model, the Monte Carlo SOM simulation, and the reader for
  Capital IQ exports (CSV or .xlsx, from a dropped file), and the ICP scoring
- `charts.js`: the charts, drawn with d3
- `data/`: the assumption files the dashboard reads: cases, segment mapping, Aprix tiers
  and settings

The dashboard opens on a saved Capital IQ screen, versioned in `screen_info.csv`. Viewers
can also load their own export on the Data panel; that file is read in their browser and
never uploaded. The saved screen is licensed data, so it is not in this repo.

## Updating the saved screen

1. Run `~/.venvs/tamsamsom/bin/python dashboard/prepare_screen.py "<new export.xls>" --version 2`.
   It writes `data/capital-iq-screen.csv` and `data/screen_info.csv`.
2. In the dashboard's Sources, replace the "Capital IQ screen" and "Screen version" files
   with those two, or ask Claude to do it.

## Ideal customer profile (ICP)

`data/icp.csv` lists the ICP: revenue US$50M–1.9B (checked from the screen) plus five yes/no
attributes the export doesn't carry: hundreds of SKUs, multiple sales channels, a structured
pricing team, a high volume of pricing decisions, and pricing dependent on Excel. Each has an
assumed share, used only for companies without an answer; the shares are placeholders.

The dashboard ranks companies by ICP fit and can use expected ICP matches as SAM.
To add answers:

1. `prepare_screen.py "<export>" --version N --icp-template` writes
   `data/icp-answers-template.csv` (core segments first). Fill the ICP columns with yes or no.
2. Either drop the filled file on "Drop ICP answers" in the Data panel (stays in your browser),
   or save it into the screen with `prepare_screen.py "<export>" --version N --icp-answers <file>`
   and replace the "Capital IQ screen" source.
