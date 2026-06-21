import { describe, expect, it } from "vitest";
import {
  assertProviderEnabled,
  getProviderDisabledMessage,
  isProviderSystemDisabled,
} from "../../src/lib/providerDisabled.js";

describe("provider system disablement", () => {
  it("rejects regular CodeBuddy while leaving CodeBuddy CN available", async () => {
    expect(isProviderSystemDisabled("codebuddy")).toBe(true);
    expect(isProviderSystemDisabled("codebuddy-cn")).toBe(false);
    expect(getProviderDisabledMessage("codebuddy")).toContain("permanently disabled by the system");
    await expect(assertProviderEnabled("codebuddy")).rejects.toMatchObject({ status: 409 });
  });
});
