import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "..", "src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js"),
  "utf8"
);

describe("Endpoint Headroom UI source", () => {
  it("uses official Compress context wording while preserving Headroom setup affordance", () => {
    expect(source).toContain("Compress context");
    expect(source).toContain("Compress prompts via /v1/compress before routing to the model");
    expect(source).toContain("Setup Headroom");
    expect(source).toContain('pip install "headroom-ai[proxy]"');
    expect(source).toContain("Recheck");
    expect(source).toContain("Done");
  });

  it("keeps Wyx0 Headroom logic hooks in place", () => {
    expect(source).toContain("handleHeadroomToggle");
    expect(source).toContain("checkHeadroomStatus");
    expect(source).toContain("handleHeadroomUrlChange");
    expect(source).toContain("headroomEnabled && headroomStatus.running");
  });

  it("does not keep the older fork-only Headroom copy", () => {
    expect(source).not.toContain("Compress prompts via local proxy → 40-60% fewer input tokens");
    expect(source).not.toContain('title="Headroom Setup"');
    expect(source).not.toContain("Start Proxy");
    expect(source).not.toContain("Stop Proxy");
  });
});
