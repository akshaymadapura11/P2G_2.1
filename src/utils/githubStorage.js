// src/utils/githubStorage.js
// Minimal client-side storage of CSV files into a GitHub repo folder
// via the GitHub Contents API. No backend required.
//
// The token is supplied by the user at runtime (stored in localStorage,
// never committed to the repo). Use a fine-grained Personal Access Token
// scoped to this repository with "Contents: Read and write" permission.

export const GH_CONFIG = {
  owner: "akshaymadapura11",
  repo: "P2G_2.1",
  branch: "main",
  folder: "uploads", // files land in <repo>/uploads/
};

const TOKEN_KEY = "gh_upload_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore storage errors */
  }
}

function apiBase() {
  const { owner, repo } = GH_CONFIG;
  return `https://api.github.com/repos/${owner}/${repo}/contents`;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// UTF-8 safe base64 encoding of a file's bytes.
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

// Keep the original name but strip path separators / unsafe chars.
export function sanitizeFilename(name) {
  const base = String(name || "upload.csv").split(/[\\/]/).pop();
  return base.replace(/[^A-Za-z0-9._ ()-]/g, "_").trim() || "upload.csv";
}

async function getExistingSha(path, token) {
  const url = `${apiBase()}/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${GH_CONFIG.branch}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await describeError(res));
  const json = await res.json();
  return json?.sha || null;
}

async function describeError(res) {
  let detail = "";
  try {
    const j = await res.json();
    detail = j?.message || "";
  } catch {
    /* ignore */
  }
  if (res.status === 401) return "Unauthorized — check your token (401).";
  if (res.status === 403) return `Forbidden — token lacks permission or rate-limited (403). ${detail}`;
  if (res.status === 404) return `Not found — repo/branch/path wrong or token can't see it (404). ${detail}`;
  if (res.status === 409) return `Conflict (409). ${detail}`;
  if (res.status === 422) return `Unprocessable (422). ${detail}`;
  return `GitHub API error ${res.status}. ${detail}`.trim();
}

/**
 * Upload (create or overwrite) a CSV file into the repo's uploads folder.
 * Returns { name, path, htmlUrl, downloadUrl }.
 */
export async function uploadCsv(file, token) {
  if (!token) throw new Error("No GitHub token set.");
  const name = sanitizeFilename(file.name);
  const path = `${GH_CONFIG.folder}/${name}`;
  const content = await fileToBase64(file);

  // If the file already exists we must pass its sha to overwrite it.
  const sha = await getExistingSha(path, token);

  const url = `${apiBase()}/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  const body = {
    message: `${sha ? "Update" : "Add"} uploaded dataset ${name}`,
    content,
    branch: GH_CONFIG.branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await describeError(res));
  const json = await res.json();
  return {
    name,
    path,
    overwrote: !!sha,
    htmlUrl: json?.content?.html_url || "",
    downloadUrl: json?.content?.download_url || "",
  };
}

/**
 * List CSV files currently stored in the uploads folder.
 * Returns an array of { name, path, size, downloadUrl, htmlUrl }.
 */
export async function listUploads(token) {
  if (!token) throw new Error("No GitHub token set.");
  const url = `${apiBase()}/${GH_CONFIG.folder}?ref=${GH_CONFIG.branch}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return []; // folder doesn't exist yet
  if (!res.ok) throw new Error(await describeError(res));
  const json = await res.json();
  if (!Array.isArray(json)) return [];
  return json
    .filter((f) => f.type === "file")
    .map((f) => ({
      name: f.name,
      path: f.path,
      size: f.size,
      downloadUrl: f.download_url,
      htmlUrl: f.html_url,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
