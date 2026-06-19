import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  __test__,
  KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY,
  KIRO_BULK_IMPORT_MAX_CONCURRENCY,
  KIRO_BULK_IMPORT_MIN_CONCURRENCY,
  KiroBulkImportManager,
} from "../../src/lib/oauth/services/kiroBulkImportManager.js";

function createFakeBrowser() {
  const fakePage = {
    on() {},
    off() {},
    url() {
      return "about:blank";
    },
    bringToFront: async () => null,
    context() {
      return {};
    },
  };

  return {
    async newContext() {
      return {
        async newPage() {
          return fakePage;
        },
        on() {},
        off() {},
        async close() {
          return null;
        },
      };
    },
    async close() {
      return null;
    },
  };
}

async function waitFor(fn, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

describe("kiro bulk import manager helpers", () => {
  it("parses gmail|password lines and reports invalid lines", () => {
    const { parsed, invalidLines } = __test__.parseKiroBulkAccounts([
      "user1@gmail.com|pw1",
      "broken-line",
      "user2@gmail.com|pw2",
      "",
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].email).toBe("user1@gmail.com");
    expect(parsed[1].password).toBe("pw2");
    expect(invalidLines).toEqual([2]);
  });

  it("clamps concurrency to configured min/max with default fallback", () => {
    expect(__test__.clampConcurrency(undefined)).toBe(KIRO_BULK_IMPORT_DEFAULT_CONCURRENCY);
    expect(__test__.clampConcurrency("0")).toBe(KIRO_BULK_IMPORT_MIN_CONCURRENCY);
    expect(__test__.clampConcurrency("999")).toBe(KIRO_BULK_IMPORT_MAX_CONCURRENCY);
    expect(__test__.clampConcurrency("3")).toBe(3);
  });
});

describe("KiroBulkImportManager", () => {
  it("processes accounts once and completes with saved connections", async () => {
    const processed = [];
    const manager = new KiroBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      kiroServiceFactory: () => ({
        createSocialAuthorization() {
          return {
            authUrl: "https://example.com",
            codeVerifier: "verifier",
          };
        },
      }),
      googleAutomation: async ({ email }) => {
        processed.push(email);
        return {
          status: "success",
          code: `code-${email}`,
        };
      },
      socialExchange: async ({ code }) => ({
        connection: {
          id: `conn-${code}`,
        },
      }),
    });

    const startedJob = await manager.startJob({
      accounts: [
        "user1@gmail.com|pw1",
        "user2@gmail.com|pw2",
      ],
      concurrency: 4,
    });

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "completed" ? job : null;
    });

    expect(processed.sort()).toEqual(["user1@gmail.com", "user2@gmail.com"]);
    expect(finishedJob.summary.success).toBe(2);
    expect(finishedJob.summary.failed).toBe(0);
    expect(finishedJob.accounts.every((account) => account.connectionId)).toBe(true);
  });

  it("keeps a fully saved job completed even if cancellation was requested late", async () => {
    let releaseAutomation;
    const automationCanFinish = new Promise((resolve) => {
      releaseAutomation = resolve;
    });
    const manager = new KiroBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      kiroServiceFactory: () => ({
        createSocialAuthorization() {
          return {
            authUrl: "https://example.com",
            codeVerifier: "verifier",
          };
        },
      }),
      googleAutomation: async () => {
        await automationCanFinish;
        return {
          status: "success",
          code: "code",
        };
      },
      socialExchange: async () => ({
        connection: { id: "conn-1" },
      }),
    });

    const startedJob = await manager.startJob({
      accounts: ["user1@gmail.com|pw1"],
      concurrency: 1,
    });

    releaseAutomation();
    await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job?.summary?.success === 1 ? job : null;
    });
    manager.cancelJob(startedJob.jobId);

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "completed" ? job : null;
    });

    expect(finishedJob.status).toBe("completed");
    expect(finishedJob.summary.success).toBe(1);
    expect(finishedJob.summary.cancelled).toBe(0);
    expect(finishedJob.accounts[0].status).toBe("success");
  });

  it("cancels queued work and marks the job cancelled", async () => {
    const manager = new KiroBulkImportManager({
      browserLauncher: async () => createFakeBrowser(),
      kiroServiceFactory: () => ({
        createSocialAuthorization() {
          return {
            authUrl: "https://example.com",
            codeVerifier: "verifier",
          };
        },
      }),
      googleAutomation: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          status: "success",
          code: "code",
        };
      },
      socialExchange: async () => ({
        connection: { id: "conn-1" },
      }),
    });

    const startedJob = await manager.startJob({
      accounts: [
        "user1@gmail.com|pw1",
        "user2@gmail.com|pw2",
        "user3@gmail.com|pw3",
      ],
      concurrency: 1,
    });

    manager.cancelJob(startedJob.jobId);

    const finishedJob = await waitFor(() => {
      const job = manager.getJob(startedJob.jobId);
      return job && job.status === "cancelled" ? job : null;
    });

    expect(finishedJob.status).toBe("cancelled");
    expect(finishedJob.summary.cancelled).toBeGreaterThan(0);
    expect(
      finishedJob.accounts.some((account) => account.status === "cancelled")
    ).toBe(true);
  });

  it("marks persisted active snapshots cancelled when no worker is attached", () => {
    const storageName = `kiro-bulk-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const manager = new KiroBulkImportManager({ storageName });
    const jobId = "job-persisted-active";
    const jobFile = path.join(manager.storageDir, `${jobId}.json`);

    try {
      fs.mkdirSync(manager.storageDir, { recursive: true });
      fs.writeFileSync(jobFile, JSON.stringify({
        jobId,
        status: "running",
        summary: { total: 1, queued: 0, running: 1, success: 0, failed: 0, needs_manual: 0 },
        concurrency: 1,
        createdAt: "2026-06-13T00:00:00.000Z",
        startedAt: "2026-06-13T00:00:01.000Z",
        finishedAt: null,
        error: null,
        accounts: [{
          line: 1,
          email: "user@gmail.com",
          status: "running",
          error: null,
          connectionId: null,
          workerId: 1,
          currentStep: "opening_google",
          updatedAt: "2026-06-13T00:00:01.000Z",
          logs: [],
        }],
        activity: [],
        preview: null,
      }), "utf8");

      const cancelled = manager.cancelJob(jobId);
      const persisted = JSON.parse(fs.readFileSync(jobFile, "utf8"));

      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.accounts[0].status).toBe("cancelled");
      expect(persisted.status).toBe("cancelled");
      expect(persisted.accounts[0].currentStep).toBe("cancelled");
    } finally {
      fs.rmSync(manager.storageDir, { recursive: true, force: true });
    }
  });

  it("opens a manual session for a blocked worker", async () => {
    const manager = new KiroBulkImportManager();
    const manualPage = {
      bringToFront: async () => null,
      context() {
        return {};
      },
    };

    manager.jobs.set("job-manual", {
      jobId: "job-manual",
      status: "running",
      concurrency: 1,
      createdAt: "2026-06-08T00:00:00.000Z",
      startedAt: "2026-06-08T00:00:01.000Z",
      finishedAt: null,
      error: null,
      accounts: [{
        line: 1,
        email: "user@gmail.com",
        status: "needs_manual",
        error: "Manual assist required",
        connectionId: null,
        workerId: 1,
        manualSession: {
          page: manualPage,
          opened: false,
          openedAt: null,
        },
      }],
    });

    const result = await manager.openManualSession("job-manual", 1);

    expect(result.ok).toBe(true);
    expect(result.account.manualSessionAvailable).toBe(true);
    expect(result.account.manualSessionOpened).toBe(true);
  });

  it("clears stale previews when no worker page remains", async () => {
    const storageName = `kiro-bulk-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const manager = new KiroBulkImportManager({ storageName });
    const job = {
      jobId: "job-clear-preview",
      status: "completed",
      concurrency: 1,
      browserChoice: "google-chrome",
      createdAt: "2026-06-13T00:00:00.000Z",
      startedAt: "2026-06-13T00:00:01.000Z",
      finishedAt: "2026-06-13T00:00:10.000Z",
      error: null,
      lastPreview: {
        email: "user@gmail.com",
        workerId: 1,
        status: "running",
        step: "polling_qoder_token",
        updatedAt: "2026-06-13T00:00:09.000Z",
        imageData: null,
      },
      lastPreviewCapturedAt: 0,
      persistPromise: Promise.resolve(),
      accounts: [{
        line: 1,
        email: "user@gmail.com",
        password: undefined,
        status: "failed",
        error: "closed",
        connectionId: null,
        workerId: 1,
        manualSession: null,
        runtimeSession: null,
        currentStep: "failed",
        updatedAt: "2026-06-13T00:00:10.000Z",
        logs: [],
      }],
    };

    try {
      await manager.persistJobSnapshot(job, { forcePreview: true });
      const persisted = JSON.parse(fs.readFileSync(path.join(manager.storageDir, `${job.jobId}.json`), "utf8"));

      expect(job.lastPreview).toBeNull();
      expect(persisted.preview).toBeNull();
      expect(persisted.accounts[0].status).toBe("failed");
    } finally {
      fs.rmSync(manager.storageDir, { recursive: true, force: true });
    }
  });

  it("hides stale previews from persisted terminal jobs", async () => {
    const storageName = `kiro-bulk-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const manager = new KiroBulkImportManager({ storageName });
    const jobId = "job-legacy-preview";
    const jobFile = path.join(manager.storageDir, `${jobId}.json`);

    try {
      fs.mkdirSync(manager.storageDir, { recursive: true });
      fs.writeFileSync(jobFile, JSON.stringify({
        jobId,
        status: "completed",
        summary: { total: 1, queued: 0, running: 0, success: 0, failed: 1, needs_manual: 0 },
        concurrency: 1,
        browser: "google-chrome",
        createdAt: "2026-06-13T00:00:00.000Z",
        startedAt: "2026-06-13T00:00:01.000Z",
        finishedAt: "2026-06-13T00:00:10.000Z",
        accounts: [{
          line: 1,
          email: "user@gmail.com",
          status: "failed",
          error: "closed",
          connectionId: null,
          workerId: 1,
          currentStep: "failed",
          updatedAt: "2026-06-13T00:00:10.000Z",
          logs: [],
        }],
        activity: [],
        error: null,
        preview: {
          email: "user@gmail.com",
          workerId: 1,
          status: "running",
          step: "polling_qoder_token",
          updatedAt: "2026-06-13T00:00:09.000Z",
          imageData: null,
        },
      }), "utf8");

      const job = await manager.getJobWithPreview(jobId);

      expect(job.status).toBe("completed");
      expect(job.preview).toBeNull();
    } finally {
      fs.rmSync(manager.storageDir, { recursive: true, force: true });
    }
  });

  it("restores only active latest jobs by default", async () => {
    const manager = new KiroBulkImportManager();

    manager.latestJobId = "job-terminal";
    manager.jobs.set("job-terminal", {
      jobId: "job-terminal",
      status: "failed",
      concurrency: 1,
      createdAt: "2026-06-08T00:00:00.000Z",
      startedAt: "2026-06-08T00:00:01.000Z",
      finishedAt: new Date().toISOString(),
      error: "failed",
      lastPreview: null,
      lastPreviewCapturedAt: 0,
      accounts: [],
      persistPromise: Promise.resolve(),
    });

    const activeOnly = await manager.getLatestJobWithPreview();
    const withRecentTerminal = await manager.getLatestJobWithPreview({ includeRecentTerminal: true });

    expect(activeOnly).toBeNull();
    expect(withRecentTerminal?.jobId).toBe("job-terminal");
  });
});
