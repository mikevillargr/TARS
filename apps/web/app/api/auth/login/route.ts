import { NextResponse } from "next/server"

// Force IPv4 — see api/proxy/[...path]/route.ts for the localhost dual-stack rationale.
const HARNESS_URL = (process.env.HARNESS_URL ?? "http://127.0.0.1:8000").replace("//localhost", "//127.0.0.1")

export async function POST(request: Request) {
  const body = await request.json()

  const res = await fetch(`${HARNESS_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }

  const { token } = await res.json()

  const response = NextResponse.json({ ok: true })
  response.cookies.set("tars_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  })

  return response
}
