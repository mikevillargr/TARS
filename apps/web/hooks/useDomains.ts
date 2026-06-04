"use client"

import { useState, useEffect, useCallback } from "react"
import { apiGet } from "@/lib/api-client"

export interface Domain {
  id: string
  name: string
  color: string
  is_system: boolean
  position: number
  memory_count: number
  knowledge_count: number
}

let _cache: Domain[] | null = null
const _listeners: Set<() => void> = new Set()

function notify() {
  _listeners.forEach(fn => fn())
}

export async function fetchDomains(): Promise<Domain[]> {
  const data = await apiGet<Domain[]>("/domains")
  _cache = data
  notify()
  return data
}

export function useDomains() {
  const [domains, setDomains] = useState<Domain[]>(_cache ?? [])
  const [loading, setLoading] = useState(_cache === null)

  const reload = useCallback(async () => {
    try {
      const data = await fetchDomains()
      setDomains(data)
    } catch (e) {
      console.error("useDomains:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Subscribe to shared cache updates
    const sync = () => { if (_cache) setDomains(_cache) }
    _listeners.add(sync)
    // Fetch on first mount if cache is empty
    if (_cache === null) {
      reload()
    } else {
      setLoading(false)
    }
    return () => { _listeners.delete(sync) }
  }, [reload])

  return { domains, loading, reload }
}

export function invalidateDomains() {
  _cache = null
}
