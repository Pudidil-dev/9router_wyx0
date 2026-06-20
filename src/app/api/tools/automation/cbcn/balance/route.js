import { NextResponse } from "next/server";
import { getCodeBuddyCnAutomationManager } from "@/lib/oauth/services/codebuddyCnAutomationManager";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const manager = getCodeBuddyCnAutomationManager();
    const snapshot = await manager.getBalanceSnapshot();

    return NextResponse.json({
      success: true,
      ...snapshot,
    });
  } catch (error) {
    return NextResponse.json({
      error: error?.message || "Failed to fetch CodeBuddy CN balance",
    }, { status: 500 });
  }
}
