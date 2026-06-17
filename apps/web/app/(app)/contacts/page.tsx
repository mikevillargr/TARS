"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { Search, Loader2, Users } from "lucide-react"
import { apiGet } from "@/lib/api-client"
import { ContactList } from "@/components/contacts/ContactList"
import { ContactDetailPanel } from "@/components/contacts/ContactDetailPanel"
import type { Contact } from "@tars/types"

function ContactsInner() {
  const searchParams = useSearchParams()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [searchResults, setSearchResults] = useState<Contact[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("id"))

  useEffect(() => {
    apiGet<Contact[]>("/contacts?limit=5000")
      .then(setContacts)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await apiGet<Contact[]>(`/contacts/search?q=${encodeURIComponent(query.trim())}`)
        setSearchResults(data)
      } catch { /* silent */ }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const displayContacts = searchResults ?? contacts

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left panel — list */}
      <div style={{
        width: 320, minWidth: 260, maxWidth: 360,
        borderRight: "1px solid var(--c-border)",
        display: "flex", flexDirection: "column",
        background: "var(--c-surface)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "1rem", borderBottom: "1px solid var(--c-border-faint)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
            <h1 style={{ fontSize: 17, fontWeight: 600, color: "var(--c-ink)" }}>Contacts</h1>
            <span className="tars-label">{contacts.length}</span>
          </div>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--c-ink-faint)" }} />
            {searching && <Loader2 size={12} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "var(--c-ink-faint)", animation: "spin 1s linear infinite" }} />}
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search contacts…"
              style={{
                width: "100%", paddingLeft: 32, paddingRight: 10, paddingTop: 7, paddingBottom: 7,
                borderRadius: 8, border: "1px solid var(--c-border)",
                background: "var(--c-canvas)", color: "var(--c-ink)",
                fontSize: 13, outline: "none",
              }}
            />
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "3rem" }}>
              <Loader2 size={18} style={{ color: "var(--c-ink-faint)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : (
            <ContactList contacts={displayContacts} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
      </div>

      {/* Right panel — detail */}
      <div style={{ flex: 1, overflow: "hidden", background: "var(--c-canvas)" }}>
        {selectedId ? (
          <ContactDetailPanel key={selectedId} contactId={selectedId} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "0.75rem", color: "var(--c-ink-faint)" }}>
            <Users size={32} />
            <p style={{ fontSize: 14 }}>Select a contact</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ContactsPage() {
  return (
    <Suspense>
      <ContactsInner />
    </Suspense>
  )
}
