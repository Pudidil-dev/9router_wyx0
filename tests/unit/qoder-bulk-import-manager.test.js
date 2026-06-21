import { describe, expect, it } from "vitest";
import { QoderBulkImportManager } from "../../src/lib/oauth/services/qoderBulkImportManager.js";

function createFakeBrowser() {
  return {
    async newContext() {
      return {
        async newPage() {
          return {};
        },
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

describe("QoderBulkImportManager", () => {
  it("accepts raw account lines and normalizes them before starting a job", async () => {
    const launchedBrowsers = [];
    const manager = new QoderBulkImportManager({
      browserLauncher: async () => {
        const browser = createFakeBrowser();
        browser.closeCalls = 0;
        browser.close = async () => {
          browser.closeCalls += 1;
        };
        launchedBrowsers.push(browser);
        return browser;
      },
      requestDeviceCodeFn: async () => ({
        verification_uri_complete: "https://qoder.example/device",
        device_code: "device-code",
        codeVerifier: "verifier",
      }),
      pollToken: async () => ({ success: false, pending: false, error: "test_failed" }),
      googleAutomation: async ({ successPromise }) => {
        await successPromise.catch(() => null);
        return { status: "failed", error: "Expected test failure" };
      },
    });

    const job = manager.startJob({
      accounts: ["user@example.com|password"],
      concurrency: 1,
    });

    expect(job.summary.total).toBe(1);
    expect(job.accounts[0].email).toBe("user@example.com");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(launchedBrowsers).toHaveLength(1);
    expect(launchedBrowsers[0].closeCalls).toBeGreaterThan(0);
  });
});
