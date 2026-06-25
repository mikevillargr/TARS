import { NextResponse } from "next/server"
import { cookies } from "next/headers"

// Force IPv4 — Node 18+ resolves "localhost" to both ::1 and 127.0.0.1, but the
// harness only listens on 0.0.0.0:8000 (IPv4), so the IPv6 attempt is refused and
// undici surfaces it as an AggregateError/ECONNREFUSED ("This page couldn't load").
const HARNESS_URL = (process.env.HARNESS_URL ?? "http://127.0.0.1:8000").replace("//localhost", "//127.0.0.1")

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const cookieStore = await cookies()
  const token = cookieStore.get("tars_token")?.value

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const targetUrl = `${HARNESS_URL}/api/${path.join("/")}${url.search}`

  const headers = new Headers(request.headers)
  headers.set("Authorization", `Bearer ${token}`)
  headers.delete("host")

  const res = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    // @ts-expect-error duplex required for streaming
    duplex: "half",
  })

  return new NextResponse(res.body, {
    status: res.status,
    headers: res.headers,
  })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
