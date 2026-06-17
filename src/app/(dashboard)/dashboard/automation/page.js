"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, BulkAccountAutomationModal, Card, CardSkeleton, KiroOAuthWrapper, Modal, OAuthModal } from "@/shared/components";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { isProviderDisabledFromConnections } from "@/shared/utils/providerConnectionStats";

function getConnectionLabel(count) {
  return `${count} connection${count === 1 ? "" : "s"}`;
}

function getAutomationCardClasses(disabled = false) {
  return `flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border px-4 py-3 text-left transition-colors ${
    disabled
      ? "cursor-not-allowed border-border bg-surface opacity-50"
      : "border-border bg-surface hover:border-primary/40 hover:bg-primary/5"
  }`;
}

function getProviderDisabledMessage(providerInfo, providerId) {
  if (providerInfo?.systemDisabled) {
    return `${providerInfo?.name || providerId} is permanently disabled by the system because the upstream rejects this integration with code 11140: request illegal.`;
  }
  return `${providerInfo?.name || providerId} is disabled. Re-enable it from the Providers tab to use this feature.`;
}

function KiroAutomationPanel({ providerInfo, onRefresh, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [bulkJob, setBulkJob] = useState(null);
  const [initialFlow, setInitialFlow] = useState(null);
  const openFlow = (flow) => {
    if (disabled) return;
    setInitialFlow({ ...flow, key: Date.now() });
    setIsOpen(true);
  };

  const options = [
    {
      id: "bulk-account",
      title: "Auto Login Bulk",
      icon: "group_add",
      description: "Run bulk gmail|password automation with worker progress and manual assist.",
      action: () => openFlow({ method: "import", importMode: "bulk-account" }),
    },
    {
      id: "bulk-token",
      title: "Bulk Token",
      icon: "playlist_add",
      description: "Import many Kiro refresh tokens, one token per line.",
      action: () => openFlow({ method: "import", importMode: "bulk-token" }),
    },
    {
      id: "single-token",
      title: "Single Token",
      icon: "vpn_key",
      description: "Auto-detect or paste one Kiro refresh token.",
      action: () => openFlow({ method: "import", importMode: "single-token" }),
    },
    {
      id: "builder-id",
      title: "AWS Builder ID",
      icon: "shield",
      description: "Open the standard AWS Builder ID device login.",
      action: () => openFlow({ method: "builder-id" }),
    },
    {
      id: "idc",
      title: "AWS IDC",
      icon: "business",
      description: "Enter an IAM Identity Center start URL and region.",
      action: () => openFlow({ method: "idc" }),
    },
    {
      id: "google",
      title: "Google Login",
      icon: "account_circle",
      description: "Open Kiro social Google login with callback capture.",
      action: () => openFlow({ method: "social", provider: "google" }),
    },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={option.action}
            disabled={disabled}
            className={getAutomationCardClasses(disabled)}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
              <span className="material-symbols-outlined text-[20px] text-primary">{option.icon}</span>
              {option.title}
            </span>
            <span className="text-xs leading-relaxed text-text-muted">{option.description}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {bulkJob?.jobId && (
          <Badge variant="default">
            Bulk job: {bulkJob.status}
          </Badge>
        )}
        {bulkJob?.jobId && (
          <Button
            size="sm"
            variant="secondary"
            icon="monitoring"
            disabled={disabled}
            onClick={() => openFlow({ method: "import", importMode: "bulk-account" })}
          >
            Resume Bulk Progress
          </Button>
        )}
      </div>
      <KiroOAuthWrapper
        isOpen={isOpen && !disabled}
        providerInfo={providerInfo}
        onSuccess={onRefresh}
        onRefresh={onRefresh}
        initialBulkJobId={bulkJob?.jobId || null}
        initialFlow={initialFlow}
        onBulkJobChange={setBulkJob}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

function CodeBuddyBulkTokenModal({ isOpen, onClose, onSuccess, disabled = false }) {
  const [tokens, setTokens] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleImport = async () => {
    if (disabled || !tokens.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/oauth/codebuddy/bulk-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) onSuccess?.();
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const successMsg = result?.success
    ? `Imported ${result.imported}/${result.total} tokens.${result.failed ? ` ${result.failed} failed.` : ""}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold text-text-main">CodeBuddy Bulk Token Import</h3>
        <p className="mb-3 text-xs text-text-muted">Paste access tokens, one per line. Each token will be validated and imported as a connection.</p>
        <textarea
          className="mb-3 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-text-main placeholder:text-text-muted focus:border-primary focus:outline-none"
          rows={8}
          placeholder={"eyJhbGciOiJSUzI1NiIs...\neyJhbGciOiJSUzI1NiIs...\neyJhbGciOiJSUzI1NiIs..."}
          value={tokens}
          onChange={(e) => setTokens(e.target.value)}
          disabled={loading || disabled}
        />
        {result && (
          <div className={"mb-3 rounded-lg p-3 text-xs " + (result.success ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
            {successMsg || result.error || "Import failed"}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-text-muted hover:bg-border/50">Close</button>
          <button
            type="button"
            onClick={handleImport}
            disabled={loading || disabled || !tokens.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Importing..." : "Import Tokens"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CodeBuddyAutomationPanel({ providerInfo, onRefresh, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isBulkTokenOpen, setIsBulkTokenOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={() => setIsBulkOpen(true)}
          disabled={disabled}
          className={getAutomationCardClasses(disabled)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">group_add</span>
            Auto Login Bulk
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Run bulk GSuite gmail|password login with worker progress and manual assist.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIsBulkTokenOpen(true)}
          disabled={disabled}
          className={getAutomationCardClasses(disabled)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">playlist_add</span>
            Bulk Token Import
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Paste multiple access tokens directly. No browser needed.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          disabled={disabled}
          className={getAutomationCardClasses(disabled)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">login</span>
            Device OAuth Login
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Open CodeBuddy browser login and poll until the access token is saved.
          </span>
        </button>
      </div>
      <CodeBuddyBulkTokenModal
        isOpen={isBulkTokenOpen && !disabled}
        disabled={disabled}
        onClose={() => setIsBulkTokenOpen(false)}
        onSuccess={onRefresh}
      />
      <BulkAccountAutomationModal
        isOpen={isBulkOpen && !disabled}
        provider="codebuddy"
        title="CodeBuddy Bulk GSuite Login"
        serviceName="CodeBuddy"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
      <OAuthModal
        isOpen={isOpen && !disabled}
        provider="codebuddy"
        providerInfo={providerInfo}
        onSuccess={() => {
          onRefresh?.();
          setIsOpen(false);
        }}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

function QoderAutomationPanel({ providerInfo, onRefresh, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={() => setIsBulkOpen(true)}
          disabled={disabled}
          className={getAutomationCardClasses(disabled)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">group_add</span>
            Auto Login Bulk
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Run bulk Google SSO login for Qoder with worker progress and manual assist.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          disabled={disabled}
          className={getAutomationCardClasses(disabled)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">login</span>
            Device OAuth Login
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Open Qoder device login and poll until the access token is saved.
          </span>
        </button>
      </div>
      <BulkAccountAutomationModal
        isOpen={isBulkOpen && !disabled}
        provider="qoder"
        title="Qoder Bulk Google Login"
        serviceName="Qoder"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
      <OAuthModal
        isOpen={isOpen && !disabled}
        provider="qoder"
        providerInfo={providerInfo}
        onSuccess={() => {
          onRefresh?.();
          setIsOpen(false);
        }}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

function OneMinAutomationPanel({ onRefresh, disabled = false }) {
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const [bulkEnabled, setBulkEnabled] = useState(false);

  const warningText = "This 1min AI bulk login flow is disabled by default because it is still in development and has known rough edges. Creating too many accounts can trigger this response: \"Your IP address (your ip) is locked due to abnormal activity. We will unlock it after 24 hours. Thank you!\" Use only a small number of accounts. If you still want to try it, enable the development flow first.";
  const openBulkFlow = () => {
    if (disabled) return;
    if (!bulkEnabled) {
      setIsWarningOpen(true);
      return;
    }
    setIsBulkOpen(true);
  };

  return (
    <>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-semibold">1min AI bulk automation is disabled by default.</p>
            <p className="mt-1 -rotate-1 text-xs italic leading-relaxed">Development mode. Read the warning before enabling this flow.</p>
          </div>
          <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setIsWarningOpen(true)}>
            {bulkEnabled ? "Read Warning" : "Enable Development Flow"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={openBulkFlow}
          disabled={disabled}
          className={`flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border px-4 py-3 text-left transition-colors ${
            disabled
              ? "cursor-not-allowed border-border bg-surface opacity-50"
              : bulkEnabled
              ? "border-border bg-surface hover:border-primary/40 hover:bg-primary/5"
              : "border-amber-300 bg-amber-50/70 opacity-80 hover:border-amber-400 dark:border-amber-800 dark:bg-amber-900/10"
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">group_add</span>
            Auto Login Bulk
            {!bulkEnabled && <Badge variant="warning" size="sm">Disabled</Badge>}
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            {bulkEnabled
              ? "Run limited 1min AI Google login and create API keys automatically. Use only a few accounts."
              : "Click to read why this development flow is disabled by default."}
          </span>
        </button>
      </div>

      <Modal
        isOpen={isWarningOpen && !disabled}
        title="1min AI Development Warning"
        onClose={() => setIsWarningOpen(false)}
        size="md"
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            {warningText}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setIsWarningOpen(false)}>
              Keep Disabled
            </Button>
            <Button
              onClick={() => {
                setBulkEnabled(true);
                setIsWarningOpen(false);
              }}
            >
              Enable, I Understand
            </Button>
          </div>
        </div>
      </Modal>

      <BulkAccountAutomationModal
        isOpen={isBulkOpen && !disabled}
        provider="1min-ai"
        title="1min AI Bulk Login"
        serviceName="1min AI"
        defaultConcurrency={1}
        maxConcurrency={1}
        accountFormat="gmail|password"
        introText={`${warningText} 1min AI uses a lightweight one-worker browser login: close the intro tour, click Log in with Google, then create an API key.`}
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
    </>
  );
}

const AUTOMATION_PROVIDERS = [
  {
    id: "kiro",
    label: "Kiro AI",
    icon: "psychology_alt",
    description: "Token import, bulk import, and social login automation.",
    supportedModes: ["single-token", "bulk-token", "bulk-account", "social"],
    component: KiroAutomationPanel,
  },
  {
    id: "codebuddy",
    label: "CodeBuddy",
    icon: "smart_toy",
    description: "Bulk GSuite automation and browser OAuth polling login.",
    supportedModes: ["bulk-account", "device-oauth"],
    component: CodeBuddyAutomationPanel,
  },
  {
    id: "qoder",
    label: "Qoder",
    icon: "water_drop",
    description: "Bulk Google SSO automation and browser device login polling.",
    supportedModes: ["bulk-account", "device-oauth"],
    component: QoderAutomationPanel,
  },
  {
    id: "1min-ai",
    label: "1min AI",
    icon: "bolt",
    description: "Simple Google login automation with automatic API key creation.",
    supportedModes: ["bulk-account"],
    component: OneMinAutomationPanel,
  },
];

export default function AutomationPage() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeProviderId, setActiveProviderId] = useState(AUTOMATION_PROVIDERS[0].id);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setConnections(data.connections || []);
    } catch (error) {
      console.log("Error fetching automation connections:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requestedProvider = new URLSearchParams(window.location.search).get("provider");
    if (AUTOMATION_PROVIDERS.some((provider) => provider.id === requestedProvider)) {
      setActiveProviderId(requestedProvider);
    }
  }, []);

  const activeProvider = AUTOMATION_PROVIDERS.find((provider) => provider.id === activeProviderId) || AUTOMATION_PROVIDERS[0];
  const providerInfo = AI_PROVIDERS[activeProvider.id] || { id: activeProvider.id, name: activeProvider.label };
  const ProviderPanel = activeProvider.component;
  const providerStates = useMemo(() => {
    const states = {};
    for (const provider of AUTOMATION_PROVIDERS) {
      const providerConnections = connections.filter((connection) => connection.provider === provider.id);
      states[provider.id] = {
        count: providerConnections.length,
        disabled: (AI_PROVIDERS[provider.id]?.systemDisabled === true)
          || isProviderDisabledFromConnections(providerConnections),
      };
    }
    return states;
  }, [connections]);
  const activeProviderState = providerStates[activeProvider.id] || { count: 0, disabled: false };
  const providerDisabledMessage = getProviderDisabledMessage(providerInfo, activeProvider.id);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Automation</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {AUTOMATION_PROVIDERS.map((provider) => {
          const selected = provider.id === activeProviderId;
          const providerMeta = AI_PROVIDERS[provider.id] || null;
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => setActiveProviderId(provider.id)}
              className={`flex min-w-0 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                selected
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-surface text-text-main hover:border-primary/30 hover:bg-primary/5"
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">{provider.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="block truncate text-sm font-semibold">{provider.label}</span>
                  {providerMeta?.statusLabel && (
                  <Badge variant="error" size="sm">
                      {providerMeta.statusLabel}
                    </Badge>
                  )}
                  {providerStates[provider.id]?.disabled && (
                    <Badge variant="warning" size="sm">
                      Disabled
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {getConnectionLabel(providerStates[provider.id]?.count || 0)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[22px] text-primary">{activeProvider.icon}</span>
                <h2 className="text-lg font-semibold">{activeProvider.label}</h2>
                {providerInfo.statusLabel && (
                  <Badge variant="error" size="sm">
                    {providerInfo.statusLabel}
                  </Badge>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeProvider.supportedModes.map((mode) => (
                  <Badge key={mode} variant="default" size="sm">
                    {mode}
                  </Badge>
                ))}
              </div>
            </div>
            <Badge variant={activeProviderState.disabled ? "warning" : "success"}>
              {getConnectionLabel(activeProviderState.count || 0)}
            </Badge>
          </div>

          {activeProviderState.disabled && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
              providerInfo?.systemDisabled
                ? "border border-red-500/30 bg-red-500/10"
                : "border border-amber-500/30 bg-amber-500/10"
            }`}>
              <span className={`material-symbols-outlined text-[16px] ${
                providerInfo?.systemDisabled ? "text-red-500" : "text-amber-500"
              }`}>block</span>
              <p className={`text-xs leading-relaxed ${
                providerInfo?.systemDisabled ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"
              }`}>{providerDisabledMessage}</p>
            </div>
          )}

          {providerInfo.statusNotice && !providerInfo.systemDisabled && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <span className="material-symbols-outlined text-[16px] text-red-500">block</span>
              <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">{providerInfo.statusNotice}</p>
            </div>
          )}

          <ProviderPanel
            providerInfo={providerInfo}
            onRefresh={fetchConnections}
            disabled={activeProviderState.disabled}
          />
        </div>
      </Card>
    </div>
  );
}
