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
> locally use `vercel dev` (see below), otherwise test it on the deployed site.

## CSV upload → repo storage

The dashboard has an **⬆ Upload dataset (CSV)** panel that stores CSV files
**as-is** (no processing) into the [`uploads/`](uploads/) folder of this repo.

Uploads go through the serverless function [`api/uploads.js`](api/uploads.js),
which holds a GitHub token as a **server-side secret** — the token is never
sent to the browser, so end users don't need one.

- `GET  /api/uploads` — list stored files
- `POST /api/uploads` `{ name, contentBase64 }` — create / overwrite a CSV
- Per-file size cap ≈ 4 MB (serverless request-body limit).
- Same-name upload **overwrites** the existing file.

## Deploy (Vercel)

1. **Create a GitHub token** — a *fine-grained* Personal Access Token
   (https://github.com/settings/personal-access-tokens/new):
   - Resource owner: your account
   - Repository access: **Only select repositories → this repo**
   - Permissions → **Contents: Read and write**
   - Copy the `github_pat_…` value (shown once).

2. **Import to Vercel** — https://vercel.com/new → import this GitHub repo.
   Framework is auto-detected as **Vite** (build `npm run build`, output `dist`).
   `vercel.json` is already included for SPA routing + the `/api` function.

3. **Set environment variables** — Vercel → Project → **Settings →
   Environment Variables**:

   | Name | Required | Purpose |
   |------|----------|---------|
   | `GITHUB_TOKEN` | **yes** | The fine-grained PAT from step 1. Server-side secret. |
   | `UPLOAD_PASSCODE` | no | If set, uploaders must enter this code (gates the open endpoint). |
   | `GH_OWNER` | no | Repo owner (default `akshaymadapura11`). |
   | `GH_REPO` | no | Repo name (default `P2G_2.1`). |
   | `GH_BRANCH` | no | Target branch (default `main`). |
   | `GH_FOLDER` | no | Storage folder (default `uploads`). |

4. **Deploy.** The upload button now works on the Vercel URL with no per-user
   token.

> ⚠️ Never commit the token to the repo or put it in client code — anything in
> the browser bundle is public, and GitHub auto-revokes leaked tokens. It must
> only ever live in Vercel's encrypted environment variables.

### Test the function locally (optional)

```bash
npm i -g vercel
vercel dev            # runs Vite + the /api function together
```

Set the same env vars locally with `vercel env pull` or a `.env` file
(already git-ignored).
