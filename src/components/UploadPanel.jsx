// src/components/UploadPanel.jsx
import { useEffect, useRef, useState } from "react";
import {
  GH_CONFIG,
  getToken,
  setToken,
  uploadCsv,
  listUploads,
} from "../utils/githubStorage";

function fmtSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPanel() {
  const [open, setOpen] = useState(false);
  const [token, setTokenState] = useState(getToken());
  const [editingToken, setEditingToken] = useState(!getToken());
  const [tokenDraft, setTokenDraft] = useState("");

  const [files, setFiles] = useState([]); // selected File objects
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { type: "ok"|"err", text }
  const [uploaded, setUploaded] = useState([]); // list from repo
  const [listErr, setListErr] = useState("");
  const inputRef = useRef(null);

  const hasToken = !!token;

  async function refreshList() {
    if (!token) return;
    setListErr("");
    try {
      const items = await listUploads(token);
      setUploaded(items);
    } catch (e) {
      setListErr(e?.message || "Failed to list files");
    }
  }

  useEffect(() => {
    if (open && token) refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);

  function saveToken() {
    const t = tokenDraft.trim();
    setToken(t);
    setTokenState(t);
    setEditingToken(false);
    setTokenDraft("");
    setStatus(null);
  }

  function clearToken() {
    setToken("");
    setTokenState("");
    setUploaded([]);
    setEditingToken(true);
  }

  function onPick(e) {
    const picked = Array.from(e.target.files || []).filter((f) =>
      f.name.toLowerCase().endsWith(".csv")
    );
    setFiles(picked);
    setStatus(null);
  }

  async function doUpload() {
    if (!token) {
      setStatus({ type: "err", text: "Set a GitHub token first." });
      return;
    }
    if (!files.length) {
      setStatus({ type: "err", text: "Choose one or more .csv files." });
      return;
    }
    setBusy(true);
    setStatus(null);
    const results = [];
    try {
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        const r = await uploadCsv(f, token);
        results.push(r);
      }
      const overwrote = results.filter((r) => r.overwrote).length;
      setStatus({
        type: "ok",
        text: `Uploaded ${results.length} file${results.length > 1 ? "s" : ""} to ${GH_CONFIG.folder}/${
          overwrote ? ` (${overwrote} overwritten)` : ""
        }`,
      });
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      await refreshList();
    } catch (e) {
      setStatus({ type: "err", text: e?.message || "Upload failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel upload">
      <button
        type="button"
        className="uploadToggle"
        onClick={() => setOpen((o) => !o)}
      >
        ⬆ UPLOAD DATASET (CSV) {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="uploadBody">
          <p className="panelSub" style={{ marginTop: 8 }}>
            Stores CSV files as-is in <code>{GH_CONFIG.owner}/{GH_CONFIG.repo}</code> →{" "}
            <code>{GH_CONFIG.folder}/</code>. No processing.
          </p>

          {/* Token */}
          {editingToken ? (
            <div className="uploadTokenRow">
              <input
                className="panelInput uploadTokenInput"
                type="password"
                placeholder="GitHub personal access token"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                autoComplete="off"
              />
              <button type="button" className="uploadBtn" onClick={saveToken} disabled={!tokenDraft.trim()}>
                Save
              </button>
            </div>
          ) : (
            <div className="uploadTokenRow">
              <span className="uploadTokenOk">✓ Token saved</span>
              <button type="button" className="uploadLinkBtn" onClick={() => setEditingToken(true)}>
                Change
              </button>
              <button type="button" className="uploadLinkBtn" onClick={clearToken}>
                Remove
              </button>
            </div>
          )}
          {editingToken && (
            <p className="uploadHint">
              Use a fine-grained token scoped to this repo with <strong>Contents: Read and write</strong>.
              It is kept only in this browser.
            </p>
          )}

          {/* File pick + upload */}
          <div className="uploadPickRow">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={onPick}
              disabled={!hasToken || busy}
            />
            <button
              type="button"
              className="uploadBtn"
              onClick={doUpload}
              disabled={!hasToken || busy || !files.length}
            >
              {busy ? "Uploading…" : `Upload${files.length ? ` (${files.length})` : ""}`}
            </button>
          </div>

          {status && (
            <div className={status.type === "ok" ? "uploadOk" : "uploadErr"}>{status.text}</div>
          )}

          {/* Existing files */}
          {hasToken && (
            <div className="uploadList">
              <div className="uploadListHead">
                <span>Stored files</span>
                <button type="button" className="uploadLinkBtn" onClick={refreshList} disabled={busy}>
                  Refresh
                </button>
              </div>
              {listErr && <div className="uploadErr">{listErr}</div>}
              {!listErr && uploaded.length === 0 && (
                <div className="uploadEmpty">No files uploaded yet.</div>
              )}
              {uploaded.map((f) => (
                <div key={f.path} className="uploadItem">
                  <a href={f.downloadUrl} target="_blank" rel="noreferrer" title="Download raw CSV">
                    {f.name}
                  </a>
                  <span className="uploadItemSize">{fmtSize(f.size)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
