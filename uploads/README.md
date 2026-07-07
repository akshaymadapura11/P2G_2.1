# uploads/

External datasets uploaded through the app's **Upload dataset (CSV)** button land here.

- Files are stored **as-is** — no processing, cleaning, or transformation.
- Uploads are committed via the GitHub Contents API from the browser, using a
  personal access token the user supplies at runtime (kept in the browser's
  localStorage, never committed).
- Uploading a file with a name that already exists **overwrites** it.

This folder is plain storage; the app's map/dashboard does not read from it.
