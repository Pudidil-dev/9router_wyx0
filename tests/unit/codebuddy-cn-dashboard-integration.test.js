import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import codeBuddyProvider from "../../open-sse/providers/registry/codebuddy.js";
import codeBuddyCnProvider from "../../open-sse/providers/registry/codebuddy-cn.js";

const root = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("CodeBuddy CN dashboard integration", () => {
  it("places CodeBuddy CN directly after regular CodeBuddy outside OAuth Providers", () => {
    expect(codeBuddyProvider.category).toBe("free");
    expect(codeBuddyCnProvider.category).toBe("free");
    expect(codeBuddyCnProvider.priority).toBe(codeBuddyProvider.priority + 1);
  });

  it("routes the CodeBuddy CN provider detail action to Automation", () => {
    const source = read("src/app/(dashboard)/dashboard/providers/[id]/page.js");

    expect(source).toContain('providerId === "codebuddy-cn"');
    expect(source).toContain("/dashboard/automation?provider=${providerId}");
  });

  it("registers a separate CodeBuddy CN automation panel after CodeBuddy", () => {
    const source = read("src/app/(dashboard)/dashboard/automation/page.js");
    const codeBuddyIndex = source.indexOf('id: "codebuddy"');
    const codeBuddyCnIndex = source.indexOf('id: "codebuddy-cn"');

    expect(codeBuddyIndex).toBeGreaterThan(-1);
    expect(codeBuddyCnIndex).toBeGreaterThan(codeBuddyIndex);
    expect(source).toContain("CodeBuddyCnAutomationPanel");
    expect(source).toContain("5sim Bulk Registration");
    expect(source).toContain("OAuth Login");
  });

  it("uses a dedicated resumable CBCN modal and tool routes", () => {
    const modalPath = "src/shared/components/CodeBuddyCnAutomationModal.js";
    expect(fs.existsSync(path.join(root, modalPath))).toBe(true);

    const source = read(modalPath);
    expect(source).toContain('/api/tools/automation/cbcn/start');
    expect(source).toContain('/api/tools/automation/cbcn/logs');
    expect(source).toContain('/api/tools/automation/cbcn/cancel');
    expect(source).not.toContain('/api/oauth/codebuddy-cn/bulk-import');
  });
});
