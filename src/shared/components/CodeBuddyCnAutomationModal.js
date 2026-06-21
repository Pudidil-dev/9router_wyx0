"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";

const ACTIVE_JOB_STORAGE_KEY = "codebuddy-cn-automation-active-job";
const TERMINAL_JOB_STATUSES = new Set(["completed", "cancelled", "failed"]);
const DEFAULT_ROUTE = {
  country: "hongkong",
  operator: "virtual54",
  product: "codebuddy",
};

function isTerminalJob(status) {
  return TERMINAL_JOB_STATUSES.has(status);
}

function statusVariant(status) {
  if (status === "success" || status === "completed") return "success";
  if (status === "failed" || status === "failed_timeout") return "error";
  if (status === "cancelled" || status === "needs_manual") return "warning";
  return "default";
}

async function readResponse(response, fallback) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(data?.error || fallback);
  return data;
}

export default function CodeBuddyCnAutomationModal({
  isOpen,
  onClose,
  onSuccess,
  disabled = false,
}) {
  const [fiveSimApiKey, setFiveSimApiKey] = useState("");
  const [count, setCount] = useState("1");
  const [concurrent, setConcurrent] = useState("1");
  const [country, setCountry] = useState(DEFAULT_ROUTE.country);
  const [operator, setOperator] = useState(DEFAULT_ROUTE.operator);
  const [product, setProduct] = useState(DEFAULT_ROUTE.product);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [restoreNotice, setRestoreNotice] = useState("");
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const notifiedJobRef = useRef(null);

  const rememberJob = useCallback((nextJob) => {
    setJob(nextJob || null);
    if (typeof window === "undefined") return;
    if (nextJob?.jobId && !isTerminalJob(nextJob.status)) {
      window.localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, nextJob.jobId);
    } else {
      window.localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    }
  }, []);

  const fetchJob = useCallback(async (jobId) => {
    const response = await fetch(`/api/tools/automation/cbcn/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    return await readResponse(response, "Failed to load the CodeBuddy CN automation job");
  }, []);

  const fetchLatestJob = useCallback(async () => {
    const response = await fetch("/api/tools/automation/cbcn/logs?scope=recoverable", {
      cache: "no-store",
    });
    if (response.status === 404) return null;
    return await readResponse(response, "Failed to restore the latest CodeBuddy CN job");
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;

    const restore = async () => {
      setError("");
      const storedJobId = typeof window !== "undefined"
        ? window.localStorage.getItem(ACTIVE_JOB_STORAGE_KEY)
        : null;
      try {
        const payload = storedJobId
          ? await fetchJob(storedJobId).catch(() => fetchLatestJob())
          : await fetchLatestJob();
        if (cancelled || !payload?.job) return;
        rememberJob(payload.job);
        setRestoreNotice("Restored the latest CodeBuddy CN automation job.");
      } catch (restoreError) {
        if (!cancelled) setError(restoreError.message);
      }
    };

    void restore();
    return () => { cancelled = true; };
  }, [fetchJob, fetchLatestJob, isOpen, rememberJob]);

  useEffect(() => {
    if (!isOpen || !job?.jobId || isTerminalJob(job.status)) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const payload = await fetchJob(job.jobId);
        if (!cancelled && payload?.job) {
          rememberJob(payload.job);
          setError("");
        }
      } catch (pollError) {
        if (!cancelled) setError(pollError.message);
      }
    };

    void poll();
    const timer = window.setInterval(poll, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fetchJob, isOpen, job?.jobId, job?.status, rememberJob]);

  useEffect(() => {
    if (!job?.jobId || !isTerminalJob(job.status) || notifiedJobRef.current === job.jobId) return;
    notifiedJobRef.current = job.jobId;
    if (job.summary?.success > 0) onSuccess?.();
  }, [job, onSuccess]);

  const handleStart = async () => {
    const parsedCount = Number.parseInt(count, 10);
    const parsedConcurrent = Number.parseInt(concurrent, 10);
    if (!fiveSimApiKey.trim()) {
      setError("Enter your 5sim API key.");
      return;
    }
    if (!Number.isFinite(parsedCount) || parsedCount < 1) {
      setError("Account count must be at least 1.");
      return;
    }

    setStarting(true);
    setError("");
    setRestoreNotice("");
    try {
      const response = await fetch("/api/tools/automation/cbcn/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: parsedCount,
          concurrent: Number.isFinite(parsedConcurrent) ? parsedConcurrent : 1,
          fiveSimApiKey: fiveSimApiKey.trim(),
          fiveSimCountry: country.trim() || DEFAULT_ROUTE.country,
          fiveSimOperator: operator.trim() || DEFAULT_ROUTE.operator,
          fiveSimProduct: product.trim() || DEFAULT_ROUTE.product,
        }),
      });
      const payload = await readResponse(response, "Failed to start CodeBuddy CN bulk registration");
      notifiedJobRef.current = null;
      rememberJob(payload.job);
      setFiveSimApiKey("");
    } catch (startError) {
      setError(startError.message);
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!job?.jobId) return;
    setCancelling(true);
    setError("");
    try {
      const response = await fetch("/api/tools/automation/cbcn/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.jobId }),
      });
      const payload = await readResponse(response, "Failed to cancel CodeBuddy CN automation");
      rememberJob(payload.job);
    } catch (cancelError) {
      setError(cancelError.message);
    } finally {
      setCancelling(false);
    }
  };

  const handleClose = () => {
    setFiveSimApiKey("");
    setError("");
    onClose?.();
  };

  const resetJob = () => {
    notifiedJobRef.current = null;
    setRestoreNotice("");
    rememberJob(null);
  };

  const active = Boolean(job?.jobId && !isTerminalJob(job.status));
  const summary = job?.summary || {};

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="CodeBuddy CN 5sim Bulk Registration"
      size="full"
      closeOnOverlay={!starting && !cancelling}
    >
      <div className="flex min-w-0 flex-col gap-5">
        {!active && (
          <div className="grid gap-3 rounded-xl border border-border bg-background/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input
              label="5sim API Key"
              type="password"
              value={fiveSimApiKey}
              onChange={(event) => setFiveSimApiKey(event.target.value)}
              placeholder="Enter 5sim API key"
              disabled={disabled || starting}
              required
            />
            <Input
              label="Accounts"
              type="number"
              min="1"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              disabled={disabled || starting}
            />
            <Input
              label="Workers"
              type="number"
              min="1"
              max="8"
              value={concurrent}
              onChange={(event) => setConcurrent(event.target.value)}
              disabled={disabled || starting}
            />
            <Input label="5sim Country" value={country} onChange={(event) => setCountry(event.target.value)} disabled={disabled || starting} />
            <Input label="5sim Operator" value={operator} onChange={(event) => setOperator(event.target.value)} disabled={disabled || starting} />
            <Input label="5sim Product" value={product} onChange={(event) => setProduct(event.target.value)} disabled={disabled || starting} />
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <Button onClick={handleStart} loading={starting} disabled={disabled || !fiveSimApiKey.trim()} icon="play_arrow">
                Start Bulk Registration
              </Button>
              {job?.jobId && isTerminalJob(job.status) && (
                <Button variant="secondary" onClick={resetJob} icon="refresh">
                  Clear Previous Result
                </Button>
              )}
            </div>
          </div>
        )}

        {restoreNotice && (
          <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">{restoreNotice}</p>
        )}
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {job?.jobId && (
          <>
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-text-main">Bulk job</h3>
                  <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                </div>
                <p className="mt-1 break-all text-xs text-text-muted">{job.jobId}</p>
              </div>
              {active && (
                <Button variant="danger" icon="stop" loading={cancelling} onClick={handleCancel}>
                  Cancel Job
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {[
                ["Total", summary.total],
                ["Queued", summary.queued],
                ["Running", summary.running],
                ["Success", summary.success],
                ["Failed", summary.failed],
                ["Manual", summary.needs_manual],
                ["Cancelled", summary.cancelled],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border bg-background/40 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
                  <p className="text-lg font-semibold text-text-main">{value || 0}</p>
                </div>
              ))}
            </div>

            {job.preview?.imageData && (
              <div className="overflow-hidden rounded-xl border border-border bg-black">
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-xs text-white/70">
                  <span>Live Browser Preview</span>
                  <span>{job.preview.label || "CodeBuddy CN"} · {job.preview.step || job.preview.status}</span>
                </div>
                <img src={job.preview.imageData} alt="CodeBuddy CN browser preview" className="max-h-[420px] w-full object-contain" />
              </div>
            )}

            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <section className="min-w-0 rounded-xl border border-border p-4">
                <h3 className="mb-3 font-semibold text-text-main">Accounts</h3>
                <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto pr-1">
                  {(job.accounts || []).map((account) => (
                    <div key={`${account.line}-${account.label}`} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-main">{account.label}</p>
                          <p className="text-xs text-text-muted">Line {account.line} · Worker {account.workerId || "—"}</p>
                        </div>
                        <Badge variant={statusVariant(account.status)} size="sm">{account.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-text-muted">{account.currentStep || "queued"}</p>
                      {account.error && <p className="mt-1 text-xs text-red-500">{account.error}</p>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="min-w-0 rounded-xl border border-border p-4">
                <h3 className="mb-3 font-semibold text-text-main">Live Activity</h3>
                <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto pr-1">
                  {(job.activity || []).slice().reverse().map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-xs font-medium text-text-main">{entry.label}</p>
                        <span className="shrink-0 text-[11px] text-text-muted">{entry.at ? new Date(entry.at).toLocaleTimeString() : ""}</span>
                      </div>
                      <p className="mt-1 text-xs text-text-muted">Worker {entry.workerId || "—"} · {entry.step}</p>
                      <p className="mt-1 break-words text-xs text-text-main">{entry.message}</p>
                    </div>
                  ))}
                  {(job.activity || []).length === 0 && <p className="text-sm text-text-muted">No activity yet.</p>}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
