import { beforeEach, describe, expect, it, vi } from "vitest";

const managerMock = {
  startJob: vi.fn(),
  cancelJob: vi.fn(),
};

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/lib/oauth/services/qoderBulkImportManager", () => ({
  getQoderBulkImportManager: vi.fn(() => managerMock),
  parseQoderBulkAccounts: vi.fn((accounts = []) => {
    const parsed = [];
    const invalidLines = [];
    accounts.forEach((line, index) => {
      const raw = String(line || "").trim();
      if (!raw) return;
      const [email = "", ...passwordParts] = raw.split("|");
      const password = passwordParts.join("|").trim();
      if (!email.trim() || !password) invalidLines.push(index + 1);
      else parsed.push({ email: email.trim(), password, line: index + 1 });
    });
    return { parsed, invalidLines };
  }),
}));

describe("Qoder bulk import routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a bulk import job", async () => {
    managerMock.startJob.mockResolvedValue({
      jobId: "job-1",
      status: "running",
      summary: { total: 1, queued: 1, running: 0, success: 0, failed: 0, needs_manual: 0 },
      accounts: [],
      concurrency: 2,
      createdAt: "2026-06-13T00:00:00.000Z",
      startedAt: "2026-06-13T00:00:01.000Z",
      finishedAt: null,
    });

    const { POST } = await import("../../src/app/api/oauth/qoder/bulk-import/route.js");
    const response = await POST({
      json: async () => ({
        accounts: ["user@example.com|secret"],
        concurrency: 2,
      }),
    });

    expect(response.status).toBe(200);
    expect(managerMock.startJob).toHaveBeenCalledWith({
      accounts: ["user@example.com|secret"],
      concurrency: 2,
    });
    expect(response.body.success).toBe(true);
    expect(response.body.job.jobId).toBe("job-1");
  });

  it("rejects invalid bulk import lines", async () => {
    const { POST } = await import("../../src/app/api/oauth/qoder/bulk-import/route.js");
    const response = await POST({
      json: async () => ({
        accounts: ["broken-line"],
      }),
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Invalid account format");
    expect(response.body.invalidLines).toEqual([1]);
  });

  it("cancels a known job", async () => {
    managerMock.cancelJob.mockReturnValue({
      jobId: "job-1",
      status: "cancelled",
      summary: { total: 1, queued: 0, running: 0, success: 0, failed: 0, needs_manual: 0 },
      accounts: [],
      concurrency: 1,
      createdAt: "2026-06-13T00:00:00.000Z",
      startedAt: "2026-06-13T00:00:01.000Z",
      finishedAt: "2026-06-13T00:00:02.000Z",
    });

    const { POST } = await import("../../src/app/api/oauth/qoder/bulk-import/[jobId]/cancel/route.js");
    const response = await POST({}, { params: Promise.resolve({ jobId: "job-1" }) });

    expect(response.status).toBe(200);
    expect(managerMock.cancelJob).toHaveBeenCalledWith("job-1");
    expect(response.body.job.status).toBe("cancelled");
  });
});
