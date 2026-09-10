import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyLogin, createSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/clientIp";
import { env } from "@/lib/env";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers, env.trustProxy);
  const rate = checkRateLimit({ bucket: `login:${ip}`, limit: 8, windowMs: 5 * 60 * 1000 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again in a few minutes." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email or password format." }, { status: 400 });
  }

  const user = await verifyLogin(parsed.data.email, parsed.data.password);
  if (!user) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  await createSession(user.id, req.headers.get("user-agent"));

  return NextResponse.json({ ok: true });
}
