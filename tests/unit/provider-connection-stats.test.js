import { describe, expect, it } from "vitest";
import {
  getProviderConnectionsForSummary,
  getEffectiveConnectionStatus,
  isConnectionIssue,
  summarizeProviderConnections,
} from "../../src/shared/utils/providerConnectionStats.js";

describe("provider connection stats", () => {
  it("treats unavailable connections with expired cooldown as active", () => {
    expect(getEffectiveConnectionStatus({
      testStatus: "unavailable",
      modelLock_chat: "2000-01-01T00:00:00.000Z",
    })).toBe("active");
  });

  it("counts restricted accounts as issues instead of missing connections", () => {
    const summary = summarizeProviderConnections([
      {
        testStatus: "failed_restricted",
        lastError: "Account access restricted",
        lastErrorType: "upstream_auth_error",
        isActive: true,
      },
    ]);

    expect(isConnectionIssue({
      testStatus: "failed_restricted",
      lastError: "Account access restricted",
      lastErrorType: "upstream_auth_error",
      isActive: true,
    })).toBe(true);
    expect(summary.total).toBe(1);
    expect(summary.connected).toBe(0);
    expect(summary.issue).toBe(1);
    expect(summary.added).toBe(0);
  });

  it("keeps untested saved accounts in added state instead of error", () => {
    const summary = summarizeProviderConnections([
      {
        testStatus: "unknown",
        isActive: true,
      },
    ]);

    expect(summary.total).toBe(1);
    expect(summary.connected).toBe(0);
    expect(summary.issue).toBe(0);
    expect(summary.added).toBe(1);
  });

  it("falls back to saved provider connections when overview authType does not match", () => {
    const connections = [
      {
        id: "cb-1",
        provider: "codebuddy",
        authType: "apikey",
        testStatus: "active",
        isActive: true,
      },
      {
        id: "cb-2",
        provider: "codebuddy",
        authType: "apikey",
        testStatus: "error",
        lastError: "Provider test not supported",
        isActive: true,
      },
    ];

    const resolvedConnections = getProviderConnectionsForSummary(connections, "codebuddy", "oauth");
    const summary = summarizeProviderConnections(resolvedConnections);

    expect(resolvedConnections).toHaveLength(2);
    expect(summary.total).toBe(2);
    expect(summary.connected).toBe(1);
    expect(summary.issue).toBe(1);
  });
});
