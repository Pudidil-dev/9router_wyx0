import { NextResponse } from "next/server";
import { getCodeBuddyCnAutomationManager } from "@/lib/oauth/services/codebuddyCnAutomationManager";
import { assertProviderEnabled } from "@/lib/providerDisabled";

export const dynamic = "force-dynamic";

/**
 * POST /api/tools/automation/cbcn/manual-login/start
 *
 * Opens a visible (headful) CodeBuddy CN sandbox browser for the operator to log
 * in manually — no 5sim. The manager detects the live session via the backend
 * /console/accounts probe, mints the API key via the backend, and saves the
 * connection automatically. Progress is tracked as a normal cbcn job, so the
 * existing [jobId] / cancel routes apply.
 */
export async function POST(request) {
  try {
    await assertProviderEnabled("codebuddy-cn");
    const body = await request.json().catch(() => ({}));

    const manager = getCodeBuddyCnAutomationManager();
    const job = await manager.startManualSandboxLogin({
      browser: body?.browser,
      name: body?.name,
      manualTimeout: body?.manualTimeout,
    });

    return NextResponse.json({ success: true, job });
  } catch (error) {
    return NextResponse.json(
      { error: error?.error || error?.message || "Failed to start CodeBuddy CN sandbox login" },
      { status: error?.status || 500 }
    );
  }
}
