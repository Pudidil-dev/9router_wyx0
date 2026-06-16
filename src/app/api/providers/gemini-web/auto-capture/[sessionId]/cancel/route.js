import { NextResponse } from "next/server";
import { cancelGeminiWebAutoCapture } from "@/lib/oauth/services/geminiWebAutoCapture";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { sessionId } = await params;
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
  }
  await cancelGeminiWebAutoCapture(sessionId);
  return NextResponse.json({ ok: true });
}
