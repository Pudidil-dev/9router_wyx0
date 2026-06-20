import { NextResponse } from "next/server";
import { buildLookupResponse, getCodeBuddyCnAutomationManager } from "@/lib/oauth/services/codebuddyCnAutomationManager";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const manager = getCodeBuddyCnAutomationManager();
  const searchParams = new URL(request.url).searchParams;
  const scope = searchParams.get("scope");
  const includeRecentTerminal = scope === "recent" || scope === "recoverable" || scope === "all";
  const job = await manager.getLatestJobWithPreview({ includeRecentTerminal });

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
