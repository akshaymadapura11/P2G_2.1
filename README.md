# P2GreeN map

Interactive map/dashboard for the P2GreeN project: nitrogen & phosphorus
fertilizer **supply** (waste-water treatment plants + point datasets such as
airports, prisons, stadiums, universities, etc.) versus agricultural
**demand**, per NUTS-2 province in France, Italy, Hungary and Greece.

Built with **Vite + React + Leaflet**. Data lives as CSVs in `public/data/`.

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build -> dist/
npm run preview  # serve the built dist/
```

> The **Upload dataset (CSV)** button calls a serverless function at
> `/api/uploads`, which does **not** run under `npm run dev`. To exercise it
> locally use `netlify dev` (see below), otherwise test it on the deployed site.

## CSV upload → repo storage

The dashboard has an **⬆ Upload dataset (CSV)** panel that stores CSV files
**as-is** (no processing) into the [`uploads/`](uploads/) folder of this repo.

Uploads go through the Netlify Function
[`netlify/functions/uploads.mjs`](netlify/functions/uploads.mjs), which holds a
GitHub token as a **server-side secret** — the token is never sent to the
browser, so end users don't need one.

- `GET  /api/uploads` — list stored files
- `POST /api/uploads` `{ name, contentBase64 }` — create / overwrite a CSV
- Per-file size cap ≈ 4 MB (function request-body limit).
- Same-name upload **overwrites** the existing file.

## Deploy (Netlify)

1. **Create a GitHub token** — a *fine-grained* Personal Access Token
   (https://github.com/settings/personal-access-tokens/new):
   - Resource owner: your account
   - Repository access: **Only select repositories → this repo**
   - Permissions → **Contents: Read and write**
   - Copy the `github_pat_…` value (shown once).

2. **Connect the repo to Netlify** — https://app.netlify.com → *Add new site →
   Import an existing project* → pick this GitHub repo. Build settings come from
   [`netlify.toml`](netlify.toml) (build `npm run build`, publish `dist`,
   functions `netlify/functions`, plus the `/api/uploads` redirect and SPA
   fallback) — no manual config needed.

3. **Set environment variables** — Netlify → Site → **Site configuration →
   Environment variables**:

   | Name | Required | Purpose |
   |------|----------|---------|
   | `GITHUB_TOKEN` | **yes** | The fine-grained PAT from step 1. Server-side secret. |
   | `UPLOAD_PASSCODE` | no | If set, uploaders must enter this code (gates the open endpoint). |
   | `GH_OWNER` | no | Repo owner (default `akshaymadapura11`). |
   | `GH_REPO` | no | Repo name (default `P2G_2.1`). |
   | `GH_BRANCH` | no | Target branch (default `main`). |
   | `GH_FOLDER` | no | Storage folder (default `uploads`). |

4. **Deploy** (Netlify → *Deploys → Trigger deploy*, or push a commit). The
   upload button now works on the Netlify URL with no per-user token.

> ⚠️ Never commit the token to the repo or put it in client code — anything in
> the browser bundle is public, and GitHub auto-revokes leaked tokens. It must
> only ever live in Netlify's encrypted environment variables.

### Test the function locally (optional)

```bash
npm i -g netlify-cli
netlify dev           # runs Vite + the /api function together
```

Set `GITHUB_TOKEN` for local runs via the Netlify UI (`netlify env:import`) or
a git-ignored `.env` file.
