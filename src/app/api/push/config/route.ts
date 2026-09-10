import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  return NextResponse.json({
    configured: env.pushConfigured,
    publicKey: env.pushConfigured ? env.vapidPublicKey : null,
  });
}
