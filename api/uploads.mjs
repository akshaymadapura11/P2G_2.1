// api/uploads.js — Vercel serverless function
//
// Holds the GitHub token as a SERVER-SIDE secret (never sent to the browser)
// and proxies CSV uploads / listing to the repo's uploads/ folder.
//
// Required env var (set in Vercel → Project → Settings → Environment Variables):
//   GITHUB_TOKEN   fine-grained PAT for this repo with Contents: Read and write
// Optional env vars:
//   GH_OWNER, GH_REPO, GH_BRANCH, GH_FOLDER   (defaults below)
//   UPLOAD_PASSCODE   if set, callers must supply a matching code to upload/list
//
// GET  /api/uploads            -> list stored files
// POST /api/uploads { name, contentBase64 } -> create/overwrite a CSV

const OWNER = process.env.GH_OWNER || "akshaymadapura11";
const REPO = process.env.GH_REPO || "P2G_2.1";
const BRANCH = process.env.GH_BRANCH || "main";
const FOLDER = process.env.GH_FOLDER || "uploads";
const TOKEN = process.env.GITHUB_TOKEN;
const PASSCODE = process.env.UPLOAD_PASSCODE || "";

const MAX_BYTES = 4 * 1024 * 1024; // ~4 MB raw file cap (serverless body limit)

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentsUrl(path) {
  const p = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
  return `https://api.github.com/repos/${OWNER}/${REPO}/contents${p}`;
}

async function ghError(r) {
  let detail = "";
  try {
    detail = (await r.json())?.message || "";
  } catch {
    /* ignore */
  }
  return `GitHub API ${r.status}${detail ? `: ${detail}` : ""}`;
}

function sanitizeFilename(name) {
  const base = String(name || "upload.csv").split(/[\\/]/).pop();
  const clean = base.replace(/[^A-Za-z0-9._ ()-]/g, "_").trim();
  return clean || "upload.csv";
}

export default async function handler(req, res) {
  if (!TOKEN) {
    return res.status(500).json({ error: "Server is missing the GITHUB_TOKEN environment variable." });
  }

  // Optional shared access code
  const provided =
    req.headers["x-upload-passcode"] ||
    (req.body && req.body.passcode) ||
    (req.query && req.query.passcode) ||
    "";
  if (PASSCODE && provided !== PASSCODE) {
    return res.status(401).json({ error: "Access code required or incorrect." });
  }

  try {
    if (req.method === "GET") {
      const r = await fetch(`${contentsUrl(FOLDER)}?ref=${BRANCH}`, { headers: ghHeaders() });
      if (r.status === 404) return res.status(200).json([]); // folder not created yet
      if (!r.ok) return res.status(r.status).json({ error: await ghError(r) });
      const list = await r.json();
      if (!Array.isArray(list)) return res.status(200).json([]);
      const files = list
        .filter((f) => f.type === "file")
        .map((f) => ({
          name: f.name,
          path: f.path,
          size: f.size,
          downloadUrl: f.download_url,
          htmlUrl: f.html_url,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json(files);
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const name = sanitizeFilename(body.name);
      const contentBase64 = body.contentBase64;

      if (!name.toLowerCase().endsWith(".csv")) {
        return res.status(400).json({ error: "Only .csv files are allowed." });
      }
      if (!contentBase64 || typeof contentBase64 !== "string") {
        return res.status(400).json({ error: "Missing file content." });
      }
      // rough size check on decoded length
      if ((contentBase64.length * 3) / 4 > MAX_BYTES) {
        return res.status(413).json({ error: "File too large (max ~4 MB)." });
      }

      const path = `${FOLDER}/${name}`;

      // Need the current sha to overwrite an existing file.
      let sha = null;
      const head = await fetch(`${contentsUrl(path)}?ref=${BRANCH}`, { headers: ghHeaders() });
      if (head.ok) {
        sha = (await head.json())?.sha || null;
      } else if (head.status !== 404) {
        return res.status(head.status).json({ error: await ghError(head) });
      }

      const put = await fetch(contentsUrl(path), {
        method: "PUT",
        headers: { ...ghHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `${sha ? "Update" : "Add"} uploaded dataset ${name}`,
          content: contentBase64,
          branch: BRANCH,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!put.ok) return res.status(put.status).json({ error: await ghError(put) });
      const pj = await put.json();
      return res.status(200).json({
        name,
        path,
        overwrote: !!sha,
        downloadUrl: pj?.content?.download_url || "",
        htmlUrl: pj?.content?.html_url || "",
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
