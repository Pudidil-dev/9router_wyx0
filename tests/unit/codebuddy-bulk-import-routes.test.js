import { beforeEach, describe, expect, it, vi } from "vitest";

const managerMock = {
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

vi.mock("@/lib/oauth/services/codebuddyBulkImportManager", () => ({
  getCodeBuddyBulkImportManager: vi.fn(() => managerMock),
}));

describe("CodeBuddy bulk import routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const { POST } = await import("../../src/app/api/oauth/codebuddy/bulk-import/[jobId]/cancel/route.js");
    const response = await POST({}, { params: Promise.resolve({ jobId: "job-1" }) });

    expect(response.status).toBe(200);
    expect(managerMock.cancelJob).toHaveBeenCalledWith("job-1");
    expect(response.body.job.status).toBe("cancelled");
  });

  it("returns JSON when the job is missing", async () => {
    managerMock.cancelJob.mockReturnValue(null);

    const { POST } = await import("../../src/app/api/oauth/codebuddy/bulk-import/[jobId]/cancel/route.js");
    const response = await POST({}, { params: Promise.resolve({ jobId: "missing" }) });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Bulk import job not found");
  });
});
