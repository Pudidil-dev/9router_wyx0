import { describe, expect, it } from "vitest";
import codeBuddyProvider from "../../open-sse/providers/registry/codebuddy.js";
import codeBuddyCnProvider from "../../open-sse/providers/registry/codebuddy-cn.js";

describe("CodeBuddy provider availability", () => {
  it("exposes regular CodeBuddy as a normal, enabled provider", () => {
    expect(codeBuddyProvider.systemDisabled).not.toBe(true);
    expect(codeBuddyProvider.defaultActive).toBeUndefined();
    expect(codeBuddyProvider.display.deprecated).toBeUndefined();
    expect(codeBuddyProvider.display.statusNotice).toBeUndefined();
  });

  it("does not change CodeBuddy CN availability metadata", () => {
    expect(codeBuddyCnProvider.systemDisabled).not.toBe(true);
    expect(codeBuddyCnProvider.defaultActive).toBeUndefined();
  });
});
