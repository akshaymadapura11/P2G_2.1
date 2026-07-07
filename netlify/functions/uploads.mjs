// netlify/functions/uploads.mjs — Netlify Function (v2)
//
// Holds the GitHub token as a SERVER-SIDE secret (never sent to the browser)
// and proxies CSV uploads / listing to the repo's uploads/ folder.
//
// Set in Netlify → Site settings → Environment variables:
//   GITHUB_TOKEN   fine-grained PAT for this repo with Contents: Read and write
// Optional:
//   GH_OWNER, GH_REPO, GH_BRANCH, GH_FOLDER, UPLOAD_PASSCODE
//
// Exposed at /api/uploads via the redirect in netlify.toml.
//   GET  -> list stored files
//   POST { name, contentBase64 } -> create / overwrite a CSV

const OWNER = process.env.GH_OWNER || "akshaymadapura11";
const REPO = process.env.GH_REPO || "P2G_2.1";
const BRANCH = process.env.GH_BRANCH || "main";
const FOLDER = process.env.GH_FOLDER || "uploads";
const TOKEN = process.env.GITHUB_TOKEN;
const PASSCODE = process.env.UPLOAD_PASSCODE || "";

const MAX_BYTES = 4 * 1024 * 1024; // ~4 MB raw file cap

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

export default async (req) => {
  if (!TOKEN) {
    return json(500, { error: "Server is missing the GITHUB_TOKEN environment variable." });
  }

  const url = new URL(req.url);
  let body = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const provided =
    req.headers.get("x-upload-passcode") ||
    body.passcode ||
    url.searchParams.get("passcode") ||
    "";
  if (PASSCODE && provided !== PASSCODE) {
    return json(401, { error: "Access code required or incorrect." });
  }

  try {
    if (req.method === "GET") {
      const r = await fetch(`${contentsUrl(FOLDER)}?ref=${BRANCH}`, { headers: ghHeaders() });
      if (r.status === 404) return json(200, []); // folder not created yet
      if (!r.ok) return json(r.status, { error: await ghError(r) });
      const list = await r.json();
      if (!Array.isArray(list)) return json(200, []);
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
      return json(200, files);
    }

    if (req.method === "POST") {
      const name = sanitizeFilename(body.name);
      const contentBase64 = body.contentBase64;

      if (!name.toLowerCase().endsWith(".csv")) {
        return json(400, { error: "Only .csv files are allowed." });
      }
      if (!contentBase64 || typeof contentBase64 !== "string") {
        return json(400, { error: "Missing file content." });
      }
      if ((contentBase64.length * 3) / 4 > MAX_BYTES) {
        return json(413, { error: "File too large (max ~4 MB)." });
      }

      const path = `${FOLDER}/${name}`;

      // Need the current sha to overwrite an existing file.
      let sha = null;
      const head = await fetch(`${contentsUrl(path)}?ref=${BRANCH}`, { headers: ghHeaders() });
      if (head.ok) {
        sha = (await head.json())?.sha || null;
      } else if (head.status !== 404) {
        return json(head.status, { error: await ghError(head) });
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
      if (!put.ok) return json(put.status, { error: await ghError(put) });
      const pj = await put.json();
      return json(200, {
        name,
        path,
        overwrote: !!sha,
        downloadUrl: pj?.content?.download_url || "",
        htmlUrl: pj?.content?.html_url || "",
      });
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    return json(500, { error: e?.message || "Server error" });
  }
};
