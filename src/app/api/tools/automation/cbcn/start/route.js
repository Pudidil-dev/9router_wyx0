import { NextResponse } from "next/server";
import { getCodeBuddyCnAutomationManager, parseCodeBuddyCnAutomationAccounts } from "@/lib/oauth/services/codebuddyCnAutomationManager";
import { assertProviderEnabled } from "@/lib/providerDisabled";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await assertProviderEnabled("codebuddy-cn");
    const body = await request.json().catch(() => ({}));
    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    const fiveSimApiKey = String(body?.fiveSimApiKey || "").trim();
    const requestedCount = Number.parseInt(body?.count, 10);
    const count = Number.isFinite(requestedCount) && requestedCount > 0
      ? requestedCount
      : (fiveSimApiKey ? 1 : body?.count);
    const { parsed, invalidLines } = parseCodeBuddyCnAutomationAccounts(accounts, count);

    if (!parsed.length) {
      return NextResponse.json({
        error: fiveSimApiKey
          ? "Failed to prepare CodeBuddy CN automation job from the provided 5sim configuration"
          : "At least one CodeBuddy CN account or count is required",
      }, { status: 400 });
    }

    if (invalidLines.length > 0) {
      return NextResponse.json({
        error: "Invalid CodeBuddy CN account payload",
        invalidLines,
      }, { status: 400 });
    }

    const manager = getCodeBuddyCnAutomationManager();
    const job = await manager.startJob({
      accounts,
      count,
      concurrent: body?.concurrent,
      browser: body?.browser,
      fiveSimApiKey,
      fiveSimCountry: body?.fiveSimCountry,
      fiveSimOperator: body?.fiveSimOperator,
      fiveSimProduct: body?.fiveSimProduct,
      useProxy: body?.useProxy,
      maxRetries: body?.maxRetries,
      smsTimeout: body?.smsTimeout,
      useAllBalance: body?.useAllBalance,
    });

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    return NextResponse.json({
      error: error?.error || error?.message || "Failed to start CodeBuddy CN automation",
      ...(Array.isArray(error?.invalidLines) ? { invalidLines: error.invalidLines } : {}),
    }, { status: error?.status || 500 });
  }
}
