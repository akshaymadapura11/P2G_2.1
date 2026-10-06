// src/components/UploadPanel.jsx
import { useRef, useState } from "react";
import { getPasscode, setPasscode, uploadCsv } from "../utils/githubStorage";

export default function UploadPanel() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(getPasscode());
  const [showCode, setShowCode] = useState(false);

  const [files, setFiles] = useState([]); // selected File objects
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { type: "ok"|"err", text }
  const inputRef = useRef(null);

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
      setStatus({
        type: "ok",
        text: `Uploaded ${results.length} file${results.length > 1 ? "s" : ""}. Thank you!`,
      });
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
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

        </div>
      )}
    </div>
  );
}
