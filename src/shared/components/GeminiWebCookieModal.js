"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

/**
 * Gemini Web Cookie Authentication Modal
 *
 * Two paths to capture the 6 required Google cookies (SID, HSID, SSID, APISID,
 * SAPISID, __Secure-1PSID). Both flows hit the same /api/providers/gemini-web/cookie
 * endpoint, which auto-detects format.
 *
 *   1. cURL paste (recommended): user right-clicks any gemini.google.com request
 *      in DevTools Network panel → Copy → Copy as cURL → pastes here. We extract
 *      the Cookie header. Works because the browser sends HttpOnly cookies in
 *      real requests (which document.cookie cannot read from the console).
 *   2. Manual paste (legacy): user navigates DevTools Application → Cookies →
 *      copies values one by one. Slower but works without using Network panel.
 *
 * Reverse-engineered protocol; account ban risk applies. Use a burner Google
 * account.
 */
export default function GeminiWebCookieModal({ isOpen, onSuccess, onClose }) {
  const [mode, setMode] = useState("curl"); // "curl" | "manual"
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [missing, setMissing] = useState([]);
  const [success, setSuccess] = useState(false);

  async function persistCookieString(cookieOrCurl) {
    const res = await fetch("/api/providers/gemini-web/cookie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cookie: cookieOrCurl }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (Array.isArray(data.missing) && data.missing.length > 0) setMissing(data.missing);
      throw new Error(data.error || "Authentication failed");
    }
    return data;
  }

  async function handleSubmit() {
    if (!input.trim()) {
      setError(mode === "curl" ? "Please paste your cURL command" : "Please paste your cookie string");
      return;
    }
    setLoading(true);
    setError(null);
    setMissing([]);
    try {
      await persistCookieString(input.trim());
      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setInput("");
    setError(null);
    setMissing([]);
    setSuccess(false);
    setMode("curl");
    onClose?.();
  }

  function switchMode(next) {
    setMode(next);
    setInput("");
    setError(null);
    setMissing([]);
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Gemini Web Cookie Authentication">
      <div className="space-y-4">
        {success ? (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">✅</div>
            <p className="text-lg font-medium text-text-primary">Authentication Successful!</p>
            <p className="text-sm text-text-muted mt-2">Cookies saved and XSRF token bootstrapped</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <span className="material-symbols-outlined text-[16px] text-amber-500 mt-0.5 shrink-0">science</span>
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                Experimental. Use a burner Google account — the upstream is reverse-engineered and accounts may be restricted.
              </p>
            </div>

            {/* Mode tabs */}
            <div className="flex gap-1 p-1 bg-surface-secondary rounded-lg">
              <button
                type="button"
                onClick={() => switchMode("curl")}
                disabled={loading}
                className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
                  mode === "curl"
                    ? "bg-surface text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[16px] align-middle mr-1">terminal</span>
                Paste cURL
                <span className="ml-1 text-[10px] opacity-70">(recommended)</span>
              </button>
              <button
                type="button"
                onClick={() => switchMode("manual")}
                disabled={loading}
                className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${
                  mode === "manual"
                    ? "bg-surface text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[16px] align-middle mr-1">edit_note</span>
                Manual cookie
              </button>
            </div>

            {mode === "curl" ? (
              <div className="space-y-3">
                <div className="bg-surface-secondary p-3 rounded-lg text-xs space-y-2">
                  <p className="font-medium text-text-primary">How to copy as cURL:</p>
                  <ol className="list-decimal list-inside space-y-1 text-text-muted">
                    <li>
                      Open{" "}
                      <a
                        href="https://gemini.google.com/app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        gemini.google.com
                      </a>{" "}
                      in your browser (signed in to your burner account)
                    </li>
                    <li>Open DevTools (F12) → <span className="font-medium">Network</span> tab</li>
                    <li>Send any short prompt to Gemini (e.g. <code className="font-mono">hi</code>) so requests appear in the panel</li>
                    <li>
                      Find a request named <code className="font-mono">StreamGenerate?...</code> (or any{" "}
                      <code className="font-mono">batchexecute?...</code> works too) — it must be a request to{" "}
                      <code className="font-mono">gemini.google.com</code>
                    </li>
                    <li>
                      Right-click that request → <span className="font-medium">Copy</span> → choose one:
                      <ul className="list-none mt-1 ml-3 space-y-1">
                        <li className="flex items-baseline gap-2">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium whitespace-nowrap">
                            <span className="material-symbols-outlined text-[12px] leading-none">check_circle</span>
                            Copy as cURL (bash)
                          </span>
                          <span className="text-text-muted">— recommended, works on every OS</span>
                        </li>
                        <li className="flex items-baseline gap-2">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-400 font-medium whitespace-nowrap">
                            Copy as cURL (cmd)
                          </span>
                          <span className="text-text-muted">— Windows-only menu option, also works</span>
                        </li>
                        <li className="flex items-baseline gap-2">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-text-muted/10 text-text-muted font-medium whitespace-nowrap">
                            Copy as cURL
                          </span>
                          <span className="text-text-muted">— Firefox label, also works</span>
                        </li>
                      </ul>
                    </li>
                    <li>Paste the entire cURL command into the box below</li>
                  </ol>
                  <p className="text-amber-600 dark:text-amber-400 pt-1 leading-relaxed">
                    <span className="font-medium">Don't pick:</span>{" "}
                    <code className="font-mono">Copy as PowerShell</code>,{" "}
                    <code className="font-mono">Copy as fetch</code>, or{" "}
                    <code className="font-mono">Copy as Node.js fetch</code> — those formats aren't supported.
                  </p>
                  <p className="text-text-muted pt-1">
                    We extract the <code className="font-mono">Cookie:</code> header automatically — including HttpOnly cookies that{" "}
                    <code className="font-mono">document.cookie</code> can't read from the console.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-text-primary">cURL command</label>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={`curl 'https://gemini.google.com/_/BardChatUi/...' \\\n  -H 'Cookie: SID=...; HSID=...; ...' \\\n  -H 'User-Agent: ...' \\\n  ...`}
                    className="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary resize-none font-mono"
                    rows={7}
                    disabled={loading}
                    spellCheck={false}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-surface-secondary p-3 rounded-lg text-xs space-y-2">
                  <p className="font-medium text-text-primary">How to copy the Cookie header manually:</p>
                  <ol className="list-decimal list-inside space-y-1 text-text-muted">
                    <li>Open <code className="font-mono">gemini.google.com</code> (signed in)</li>
                    <li>Open DevTools (F12) → <span className="font-medium">Network</span> tab</li>
                    <li>Send any prompt</li>
                    <li>Click any request → <span className="font-medium">Headers → Request Headers</span></li>
                    <li>Copy the full <code className="font-mono">Cookie:</code> value</li>
                  </ol>
                  <p className="text-text-muted pt-1">
                    Required: <span className="font-mono">SID, HSID, SSID, APISID, SAPISID, __Secure-1PSID</span>
                  </p>
                  <p className="text-amber-600 dark:text-amber-400 pt-1 text-[11px]">
                    Note: copying from DevTools <span className="font-medium">Application → Cookies</span> works too, but the Network panel is faster.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-text-primary">Cookie String</label>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="SID=...; HSID=...; SSID=...; APISID=...; SAPISID=...; __Secure-1PSID=...; ..."
                    className="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary resize-none font-mono"
                    rows={6}
                    disabled={loading}
                    spellCheck={false}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-error/10 border border-error/20 rounded-lg space-y-1">
                <p className="text-sm text-error">{error}</p>
                {missing.length > 0 && (
                  <p className="text-xs text-error/80">
                    Missing cookies: <span className="font-mono">{missing.join(", ")}</span>
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={handleClose} disabled={loading} fullWidth>
                Cancel
              </Button>
              <Button onClick={handleSubmit} loading={loading} fullWidth>
                Authenticate
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

GeminiWebCookieModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
};
