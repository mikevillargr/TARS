const BASE = "/api/proxy"

/**
 * Retry a fetch-based thunk on network errors (TypeError: Failed to fetch).
 * This handles mobile PWA foreground-resume: iOS/Android suspends the network
 * stack while backgrounded, so the first fetch after switching back fails
 * instantly. We retry up to 3 times with short exponential backoff.
 * HTTP errors (4xx/5xx) are NOT retried — those are real errors.
 */
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 400): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      // Only retry on network-level failures (TypeError), not HTTP errors
      if (err instanceof TypeError && attempt < retries - 1) {
        lastErr = err
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

export async function apiGet<T>(path: string): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(`${BASE}${path}`)
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
    return res.json()
  })
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      let detail = ""
      try { detail = (await res.json()).detail ?? "" } catch { /* ignore */ }
      throw new Error(detail || `POST ${path} failed: ${res.status}`)
    }
    return res.json()
  })
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`)
    return res.json()
  })
}

export async function apiDelete(path: string): Promise<void> {
  return withRetry(async () => {
    const res = await fetch(`${BASE}${path}`, { method: "DELETE" })
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`)
  })
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    body: formData,
    // No Content-Type header — browser sets it with boundary automatically
  })
  if (!res.ok) {
    let detail = ""
    try { detail = (await res.json()).detail ?? "" } catch { /* ignore */ }
    throw new Error(detail || `UPLOAD ${path} failed: ${res.status}`)
  }
  return res.json()
}

export async function apiStream(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok || !res.body) throw new Error(`Stream ${path} failed: ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onChunk(decoder.decode(value, { stream: true }))
  }
}
