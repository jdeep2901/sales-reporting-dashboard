# Sales Reporting Dashboard

Recovered working copy of the `jdeep2901/sales-reporting-dashboard` project from the published GitHub Pages site and the GitHub repository.

## Quick Start

This project is primarily a static dashboard.

1. Start a local server from the repo root:

```bash
python3 -m http.server 8000
```

2. Open `http://127.0.0.1:8000/`

## What Is Here

- `index.html`: main single-page dashboard app
- `crosstab_data.json`: static data used by the GitHub Pages deployment
- `assets/`: logos and UI icons
- `deploy/`: deploy-ready static bundle
- `supabase/`: backend config, migrations, and edge functions for shared state, auth, and Monday sync
- `build_crosstab_data.py`: helper script for rebuilding the crosstab dataset
- `HANDOVER_CONTEXT.md`: business rules and reporting conventions
- `PUBLISH.md`: publishing notes for GitHub Pages / static hosting

## Notes

- GitHub Pages can serve the static dashboard directly.
- Some admin and refresh features depend on Supabase and Monday.com connectivity.
- The repo remote points to `https://github.com/jdeep2901/sales-reporting-dashboard.git`.
