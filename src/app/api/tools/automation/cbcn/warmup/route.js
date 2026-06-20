import { NextResponse } from "next/server";
import { getCodeBuddyCnAutomationManager } from "@/lib/oauth/services/codebuddyCnAutomationManager";
import { assertProviderEnabled } from "@/lib/providerDisabled";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await assertProviderEnabled("codebuddy-cn");
    const body = await request.json().catch(() => ({}));
    const connectionId = typeof body?.connectionId === "string" ? body.connectionId.trim() : "";
    const manager = getCodeBuddyCnAutomationManager();
    const snapshot = await manager.warmupConnections({
      connectionId: connectionId || null,
    });

    return NextResponse.json({
      success: true,
      ...snapshot,
    });
  } catch (error) {
    return NextResponse.json({
      error: error?.message || "Failed to warm up CodeBuddy CN connections",
    }, { status: error?.status || 500 });
  }
}
