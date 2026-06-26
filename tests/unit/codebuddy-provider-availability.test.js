import { describe, expect, it } from "vitest";
import codeBuddyProvider from "../../open-sse/providers/registry/codebuddy.js";
import codeBuddyCnProvider from "../../open-sse/providers/registry/codebuddy-cn.js";

describe("CodeBuddy provider availability", () => {
  it("keeps regular CodeBuddy enableable while preserving its warning", () => {
    expect(codeBuddyProvider.systemDisabled).not.toBe(true);
    expect(codeBuddyProvider.defaultActive).not.toBe(false);
    expect(codeBuddyProvider.display.deprecated).toBe(true);
    expect(codeBuddyProvider.display.statusNotice).toContain("enabled");
    expect(codeBuddyProvider.display.statusNotice).toContain("11140");
  });

  it("does not change CodeBuddy CN availability metadata", () => {
    expect(codeBuddyCnProvider.systemDisabled).not.toBe(true);
    expect(codeBuddyCnProvider.defaultActive).toBeUndefined();
  });
});
