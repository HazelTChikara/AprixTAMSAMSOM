# TAM / SAM / SOM tool

Sizes a market from a Capital IQ company screen, using the Aprix team's method.

    ./run.sh

The first run takes a minute or two to install. The dashboard opens in your browser.

- **TAM:** companies in the chosen segments and revenue range × yearly contract value
- **SAM:** TAM × share of companies that fit
- **SOM:** SAM companies × win rate by year 3, capped at 3 years of sales capacity

It loads `TAM SAM SOM - correct industries.xls` by default, or upload another screen in the
sidebar. Use Capital IQ's Excel export: only that includes the true company count, so the
tool can tell when an export was cut off at 10,000 rows.

Capital IQ exports are licensed data and are not committed: put your export in this folder to
run the app. The `dashboard/` folder holds the browser version published on claude.ai; see its
README.

Edit the Low, Base and High inputs in the table at the top of the dashboard. Segment mappings,
tiers and default inputs are at the top of `engine.py`. Run the tests with
`~/.venvs/tamsamsom/bin/python -m pytest`.
