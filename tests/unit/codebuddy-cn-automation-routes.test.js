import { beforeEach, describe, expect, it, vi } from "vitest";

const managerMock = {
  startJob: vi.fn(),
  getJobWithPreview: vi.fn(),
  getLatestJobWithPreview: vi.fn(),
  cancelJob: vi.fn(),
  getBalanceSnapshot: vi.fn(),
  warmupConnections: vi.fn(),
};
const assertProviderEnabled = vi.fn();

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/lib/oauth/services/codebuddyCnAutomationManager", () => ({
  buildLookupResponse: vi.fn((job, extras = {}) => ({
    found: Boolean(job),
    stale: Boolean(extras.stale),
    recoverable: Boolean(job),
    job: job || null,
  })),
  parseCodeBuddyCnAutomationAccounts: vi.fn((accounts = [], count = 0) => {
    const array = Array.isArray(accounts) ? accounts : [];
    const parsed = array
      .filter(Boolean)
      .map((entry, index) => ({
        line: index + 1,
        label: typeof entry === "string" ? entry : entry.label || `Account ${index + 1}`,
      }));
    if (!parsed.length && Number(count) > 0) {
      return {
        parsed: Array.from({ length: Number(count) }, (_, index) => ({
          line: index + 1,
          label: `Account ${index + 1}`,
        })),
        invalidLines: [],
      };
    }
    return {
      parsed,
      invalidLines: [],
    };
  }),
  getCodeBuddyCnAutomationManager: vi.fn(() => managerMock),
}));

vi.mock("@/lib/providerDisabled", () => ({
  assertProviderEnabled,
}));

describe("CodeBuddy CN automation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a cbcn automation job", async () => {
    managerMock.startJob.mockResolvedValue({
      jobId: "cbcn-1",
      status: "running",
      summary: { total: 1, queued: 1, running: 0, success: 0, failed: 0, needs_manual: 0, cancelled: 0 },
      accounts: [],
      activity: [],
      createdAt: "2026-06-20T00:00:00.000Z",
      startedAt: "2026-06-20T00:00:00.000Z",
      finishedAt: null,
      concurrency: 2,
      browser: "chrome",
      options: {},
      error: null,
      preview: null,
    });

    const { POST } = await import("../../src/app/api/tools/automation/cbcn/start/route.js");
    const response = await POST({
      json: async () => ({
        accounts: [{ label: "Account A", accessToken: "token-a" }],
        concurrent: 3,
        browser: "chrome",
      }),
    });

    expect(response.status).toBe(200);
    expect(managerMock.startJob).toHaveBeenCalledWith(expect.objectContaining({
      accounts: [{ label: "Account A", accessToken: "token-a" }],
      concurrent: 3,
      browser: "chrome",
    }));
    expect(response.body.job.jobId).toBe("cbcn-1");
  });

  it("rejects start when no accounts or count are provided", async () => {
    const { POST } = await import("../../src/app/api/tools/automation/cbcn/start/route.js");
    const response = await POST({
      json: async () => ({}),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("At least one CodeBuddy CN account or count is required");
    expect(managerMock.startJob).not.toHaveBeenCalled();
  });

  it("starts a 5sim cbcn automation job without accounts by inferring one slot", async () => {
    managerMock.startJob.mockResolvedValue({
      jobId: "cbcn-5sim",
      status: "running",
      summary: { total: 1, queued: 1, running: 0, success: 0, failed: 0, needs_manual: 0, cancelled: 0 },
      accounts: [],
      activity: [],
      createdAt: "2026-06-20T00:00:00.000Z",
      startedAt: "2026-06-20T00:00:00.000Z",
      finishedAt: null,
      concurrency: 2,
      browser: "chrome",
      options: {
        fiveSimApiKey: "five-sim-token",
      },
      error: null,
      preview: null,
    });

    const { POST } = await import("../../src/app/api/tools/automation/cbcn/start/route.js");
    const response = await POST({
      json: async () => ({
        fiveSimApiKey: "five-sim-token",
      }),
    });

    expect(response.status).toBe(200);
    expect(managerMock.startJob).toHaveBeenCalledWith(expect.objectContaining({
      accounts: [],
      count: 1,
      fiveSimApiKey: "five-sim-token",
    }));
    expect(response.body.job.jobId).toBe("cbcn-5sim");
  });

  it("returns latest cbcn logs payload", async () => {
    managerMock.getLatestJobWithPreview.mockResolvedValue({
      jobId: "cbcn-logs",
      status: "running",
      summary: { total: 1, queued: 0, running: 1, success: 0, failed: 0, needs_manual: 0, cancelled: 0 },
      accounts: [],
      activity: [],
      preview: null,
    });

    const { GET } = await import("../../src/app/api/tools/automation/cbcn/logs/route.js");
    const response = await GET({ url: "http://localhost/api/tools/automation/cbcn/logs" });

    expect(response.status).toBe(200);
    expect(managerMock.getLatestJobWithPreview).toHaveBeenCalledWith({ includeRecentTerminal: false });
    expect(response.body.job.jobId).toBe("cbcn-logs");
  });

  it("returns cbcn job by id payload", async () => {
    managerMock.getJobWithPreview.mockResolvedValue({
      jobId: "cbcn-specific",
      status: "running",
      summary: { total: 1, queued: 0, running: 1, success: 0, failed: 0, needs_manual: 0, cancelled: 0 },
      accounts: [],
      activity: [],
      preview: null,
    });

    const { GET } = await import("../../src/app/api/tools/automation/cbcn/[jobId]/route.js");
    const response = await GET({}, {
      params: Promise.resolve({
        jobId: "cbcn-specific",
      }),
    });

    expect(response.status).toBe(200);
    expect(managerMock.getJobWithPreview).toHaveBeenCalledWith("cbcn-specific");
    expect(response.body.job.jobId).toBe("cbcn-specific");
  });

  it("cancels the latest cbcn job when jobId is omitted", async () => {
    managerMock.getLatestJobWithPreview.mockResolvedValue({
      jobId: "cbcn-2",
      status: "running",
      summary: { total: 1, queued: 0, running: 1, success: 0, failed: 0, needs_manual: 0, cancelled: 0 },
      accounts: [],
      activity: [],
      preview: null,
    });
    managerMock.cancelJob.mockReturnValue({
      jobId: "cbcn-2",
      status: "cancelled",
      summary: { total: 1, queued: 0, running: 0, success: 0, failed: 0, needs_manual: 0, cancelled: 1 },
      accounts: [],
      activity: [],
      preview: null,
    });

    const { POST } = await import("../../src/app/api/tools/automation/cbcn/cancel/route.js");
    const response = await POST({
      json: async () => ({}),
    });

    expect(response.status).toBe(200);
    expect(managerMock.cancelJob).toHaveBeenCalledWith("cbcn-2");
    expect(response.body.job.status).toBe("cancelled");
  });

  it("returns balance snapshot", async () => {
    managerMock.getBalanceSnapshot.mockResolvedValue({
      provider: "codebuddy-cn",
      jobId: "cbcn-3",
      connectedCount: 1,
      accounts: [{
        connectionId: "conn-1",
        name: "CodeBuddy CN",
        authKind: "access_token",
        usage: { plan: "CodeBuddy CN", quotas: {} },
      }],
    });

    const { GET } = await import("../../src/app/api/tools/automation/cbcn/balance/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.connectedCount).toBe(1);
    expect(managerMock.getBalanceSnapshot).toHaveBeenCalled();
  });

  it("warms up saved CodeBuddy CN connections", async () => {
    managerMock.warmupConnections.mockResolvedValue({
      provider: "codebuddy-cn",
      warmedCount: 1,
      total: 1,
      results: [{
        connectionId: "conn-1",
        name: "CodeBuddy CN",
        warmed: true,
        usage: { plan: "CodeBuddy CN", quotas: {} },
      }],
    });

    const { POST } = await import("../../src/app/api/tools/automation/cbcn/warmup/route.js");
    const response = await POST({
      json: async () => ({}),
    });

    expect(response.status).toBe(200);
    expect(managerMock.warmupConnections).toHaveBeenCalledWith({ connectionId: null });
    expect(response.body.warmedCount).toBe(1);
  });
});
