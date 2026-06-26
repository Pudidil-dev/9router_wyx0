import { describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(async () => []),
}));

import {
  assertProviderEnabled,
  getProviderDisabledMessage,
  isProviderSystemDisabled,
} from "../../src/lib/providerDisabled.js";

describe("provider system disablement", () => {
  it("keeps regular CodeBuddy and CodeBuddy CN user-enableable", async () => {
    expect(isProviderSystemDisabled("codebuddy")).toBe(false);
    expect(isProviderSystemDisabled("codebuddy-cn")).toBe(false);
    expect(getProviderDisabledMessage("codebuddy")).not.toContain("permanently disabled by the system");
    await expect(assertProviderEnabled("codebuddy")).resolves.toBeUndefined();
  });
});
