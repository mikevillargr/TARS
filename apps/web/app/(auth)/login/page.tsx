"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })

      if (res.ok) {
        router.push("/chat")
      } else {
        setError("Invalid credentials")
      }
    } catch {
      setError("Connection failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-8 px-6">
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <svg width="22" height="40" viewBox="0 0 22 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="20" height="8.5" rx="1" fill="#1a1714" stroke="#3a342d" strokeWidth="0.5" />
              <rect x="3" y="3" width="2" height="1" fill="#6b6357" opacity="0.6" />
              <rect x="3" y="5.5" width="3" height="0.5" fill="#6b6357" opacity="0.4" />
              <rect x="0" y="9.5" width="22" height="1" fill="#f6f3ec" />
              <rect x="1" y="10.5" width="20" height="8.5" rx="1" fill="#1a1714" stroke="#3a342d" strokeWidth="0.5" />
              <rect x="3" y="12.5" width="6" height="1" fill="#6b6357" opacity="0.4" />
              <circle cx="17" cy="13" r="0.6" fill="#b8651a" opacity="0.8" />
              <rect x="0" y="19" width="22" height="1" fill="#f6f3ec" />
              <rect x="1" y="20" width="20" height="8.5" rx="1" fill="#1a1714" stroke="#3a342d" strokeWidth="0.5" />
              <rect x="3" y="22" width="3" height="0.5" fill="#6b6357" opacity="0.4" />
              <rect x="3" y="24" width="5" height="0.5" fill="#6b6357" opacity="0.4" />
              <rect x="0" y="28.5" width="22" height="1" fill="#f6f3ec" />
              <rect x="1" y="29.5" width="20" height="8.5" rx="1" fill="#1a1714" stroke="#3a342d" strokeWidth="0.5" />
              <rect x="3" y="31.5" width="2" height="1" fill="#6b6357" opacity="0.5" />
              <rect x="3" y="34" width="4" height="0.5" fill="#6b6357" opacity="0.4" />
            </svg>
          </div>
          <h1
            className="text-4xl font-semibold tracking-[0.25em] text-foreground pl-[0.25em]"
            style={{ fontFamily: "var(--font-mono), monospace" }}
          >
            TARS
          </h1>
          <p className="tars-label tars-label--muted">Life OS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            placeholder="Email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="email"
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Authenticating..." : "Login"}
          </Button>
          <p className="tars-label tars-label--muted text-center pt-2">Access restricted — single operator</p>
        </form>
      </div>
    </div>
  )
}
