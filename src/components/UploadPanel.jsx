// src/components/UploadPanel.jsx
import { useEffect, useRef, useState } from "react";
import {
  GH_CONFIG,
  getPasscode,
  setPasscode,
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
  const [code, setCode] = useState(getPasscode());
  const [showCode, setShowCode] = useState(false);

  const [files, setFiles] = useState([]); // selected File objects
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { type: "ok"|"err", text }
  const [uploaded, setUploaded] = useState([]); // list from repo
  const [listErr, setListErr] = useState("");
  const inputRef = useRef(null);

  async function refreshList() {
    setListErr("");
    try {
      const items = await listUploads(code);
      setUploaded(items);
    } catch (e) {
      setListErr(e?.message || "Failed to list files");
    }
  }

  useEffect(() => {
    if (open) refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onPick(e) {
    const picked = Array.from(e.target.files || []).filter((f) =>
      f.name.toLowerCase().endsWith(".csv")
    );
    setFiles(picked);
    setStatus(null);
  }

  async function doUpload() {
    if (!files.length) {
      setStatus({ type: "err", text: "Choose one or more .csv files." });
      return;
    }
    setBusy(true);
    setStatus(null);
    setPasscode(code); // remember any access code for next time
    const results = [];
    try {
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        const r = await uploadCsv(f, code);
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
      <button type="button" className="uploadToggle" onClick={() => setOpen((o) => !o)}>
        ⬆ UPLOAD DATASET (CSV) {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="uploadBody">
          <p className="panelSub" style={{ marginTop: 8 }}>
            If you would like to contribute your data to this platform, please upload it in CSV
            format. Make sure your file includes the following columns: longitude, latitude, and
            capacity.
          </p>

          {/* File pick + upload */}
          <div className="uploadPickRow">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={onPick}
              disabled={busy}
            />
            <button
              type="button"
              className="uploadBtn"
              onClick={doUpload}
              disabled={busy || !files.length}
            >
              {busy ? "Uploading…" : `Upload${files.length ? ` (${files.length})` : ""}`}
            </button>
          </div>

          {status && (
            <div className={status.type === "ok" ? "uploadOk" : "uploadErr"}>{status.text}</div>
          )}

          {/* Optional access code (only if the server requires one) */}
          <button type="button" className="uploadLinkBtn" onClick={() => setShowCode((s) => !s)}>
            {showCode ? "Hide access code" : "Access code (if required)"}
          </button>
          {showCode && (
            <div className="uploadTokenRow">
              <input
                className="panelInput uploadTokenInput"
                type="password"
                placeholder="Access code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {/* Existing files */}
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
        </div>
      )}
    </div>
  );
}
