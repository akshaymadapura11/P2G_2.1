# uploads/

External datasets uploaded through the app's **Upload dataset (CSV)** button land here.

- Files are stored **as-is** — no processing, cleaning, or transformation.
- Uploads go through a serverless function (`api/uploads.js`) that holds the
  GitHub token as a **server-side secret** (Vercel env var `GITHUB_TOKEN`).
  The token never reaches the browser, so end users don't need their own.
- Uploading a file whose name already exists **overwrites** it.

This folder is plain storage; the app's map/dashboard does not read from it.
