import { describe, expect, it } from "vitest";
import { isProviderSystemDisabled } from "../../src/lib/providerDisabled.js";

describe("provider system disablement", () => {
  it("no longer system-disables regular CodeBuddy or CodeBuddy CN", () => {
    expect(isProviderSystemDisabled("codebuddy")).toBe(false);
    expect(isProviderSystemDisabled("codebuddy-cn")).toBe(false);
  });
});
