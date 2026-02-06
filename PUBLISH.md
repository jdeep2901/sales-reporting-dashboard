# Publish the Sales Reporting Page

You already have a deploy-ready static package:
- `/Users/jaideepallam/Documents/AI Projects/codex/sales-reporting-site.zip`

## Fastest (no git): Netlify Drop
1. Go to https://app.netlify.com/drop
2. Drag and drop `sales-reporting-site.zip`
3. Netlify gives you a live URL instantly
4. (Optional) set a custom site name in Netlify settings

## GitHub Pages (recommended for stable sharing)
1. Create a new GitHub repo (for example `sales-reporting-dashboard`)
2. In that repo, upload these two files from `/Users/jaideepallam/Documents/AI Projects/codex/deploy/`:
   - `index.html`
   - `crosstab_data.json`
3. In GitHub repo settings:
   - Open `Pages`
   - Source: `Deploy from a branch`
   - Branch: `main`, folder: `/ (root)`
4. Your site will be available at:
   - `https://<your-username>.github.io/<repo-name>/`

## Important
- The site is fully static. No backend needed.
- If data changes weekly, regenerate `crosstab_data.json` and re-upload (or commit) the updated file.
