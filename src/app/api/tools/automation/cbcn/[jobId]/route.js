import { NextResponse } from "next/server";
import { buildLookupResponse, getCodeBuddyCnAutomationManager } from "@/lib/oauth/services/codebuddyCnAutomationManager";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const manager = getCodeBuddyCnAutomationManager();
  const resolvedParams = await params;
  const jobId = typeof resolvedParams?.jobId === "string" ? resolvedParams.jobId.trim() : "";

  if (!jobId) {
    return NextResponse.json({
      success: false,
      ...buildLookupResponse(null),
      error: "CodeBuddy CN automation job not found",
    }, { status: 404 });
  }

  const job = await manager.getJobWithPreview(jobId);

  if (!job) {
    return NextResponse.json({
      success: false,
      ...buildLookupResponse(null),
      error: "CodeBuddy CN automation job not found",
    }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ...buildLookupResponse(job),
  });
}
