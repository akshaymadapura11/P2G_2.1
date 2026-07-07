// src/utils/githubStorage.js
// Client for the serverless upload API (/api/uploads).
//
// The GitHub token lives ONLY on the server (Vercel env var GITHUB_TOKEN).
// This browser code never sees it. Users do not need their own token.
//
// An optional shared "access code" (server env UPLOAD_PASSCODE) can gate
// uploads; if the server doesn't require one, the code is simply ignored.

const API = "/api/uploads";
const PASS_KEY = "upload_passcode";

// For display only (the real values live server-side).
export const GH_CONFIG = {
  owner: "akshaymadapura11",
  repo: "P2G_2.1",
  folder: "uploads",
};

export function getPasscode() {
  try {
    return localStorage.getItem(PASS_KEY) || "";
  } catch {
    return "";
  }
}

export function setPasscode(code) {
  try {
    if (code) localStorage.setItem(PASS_KEY, code);
    else localStorage.removeItem(PASS_KEY);
  } catch {
    /* ignore */
  }
}

// UTF-8 safe base64 of a file's bytes.
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

async function readError(res, fallback) {
  try {
    const j = await res.json();
    if (j?.error) return j.error;
  } catch {
    /* ignore */
  }
  return `${fallback} (${res.status})`;
}

/**
 * Upload (create or overwrite) a CSV via the serverless function.
 * Returns { name, path, overwrote, downloadUrl, htmlUrl }.
 */
export async function uploadCsv(file, passcode = getPasscode()) {
  const name = file.name;
  const contentBase64 = await fileToBase64(file);
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, contentBase64, passcode }),
  });
  if (!res.ok) throw new Error(await readError(res, "Upload failed"));
  return res.json();
}

/**
 * List CSV files currently stored in the uploads folder.
 * Returns an array of { name, path, size, downloadUrl, htmlUrl }.
 */
export async function listUploads(passcode = getPasscode()) {
  const qs = passcode ? `?passcode=${encodeURIComponent(passcode)}` : "";
  const res = await fetch(`${API}${qs}`);
  if (!res.ok) throw new Error(await readError(res, "Failed to list files"));
  return res.json();
}
