#!/bin/bash
# Starts the dashboard. The environment lives outside Documents because iCloud
# offloads files there, which makes Python time out.
cd "$(dirname "$0")"
VENV="$HOME/.venvs/tamsamsom"
if [ ! -x "$VENV/bin/streamlit" ]; then
  python3 -m venv "$VENV" && "$VENV/bin/pip" install -q -r requirements.txt
fi
for f in *.xls *.xlsx *.csv; do [ -e "$f" ] && brctl download "$f" 2>/dev/null; done
exec "$VENV/bin/streamlit" run app.py "$@"
