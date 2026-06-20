import { NextResponse } from "next/server";
import { getCodeBuddyCnAutomationManager } from "@/lib/oauth/services/codebuddyCnAutomationManager";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const manager = getCodeBuddyCnAutomationManager();
  const body = await request.json().catch(() => ({}));
  const requestedJobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  const latestJob = !requestedJobId ? await manager.getLatestJobWithPreview({ includeRecentTerminal: true }) : null;
  const jobId = requestedJobId || latestJob?.jobId || "";

  if (!jobId) {
    return NextResponse.json({ error: "CodeBuddy CN automation job not found" }, { status: 404 });
  }

  const job = manager.cancelJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "CodeBuddy CN automation job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
