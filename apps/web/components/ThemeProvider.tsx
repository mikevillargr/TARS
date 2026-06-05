"use client"

import { createContext, useContext, useEffect, useState } from "react"

export type ThemeMode = "light" | "dark" | "system"
export type Theme = "light" | "dark"

function resolveTheme(mode: ThemeMode): Theme {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  }
  return mode
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

const ThemeContext = createContext<{
  theme: Theme
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  /** @deprecated use setMode */
  toggle: () => void
}>({ theme: "light", mode: "system", setMode: () => {}, toggle: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system")
  const [theme, setTheme] = useState<Theme>("light")

  useEffect(() => {
    const saved = (localStorage.getItem("tars-theme") as ThemeMode | null) ?? "system"
    const resolved = resolveTheme(saved)
    setModeState(saved)
    setTheme(resolved)
    applyTheme(resolved)

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    function onSystemChange() {
      setModeState(current => {
        if (current !== "system") return current
        const next = mq.matches ? "dark" : "light"
        setTheme(next)
        applyTheme(next)
        return current
      })
    }
    mq.addEventListener("change", onSystemChange)
    return () => mq.removeEventListener("change", onSystemChange)
  }, [])

  function setMode(next: ThemeMode) {
    if (next === "system") {
      localStorage.removeItem("tars-theme")
    } else {
      localStorage.setItem("tars-theme", next)
    }
    const resolved = resolveTheme(next)
    setModeState(next)
    setTheme(resolved)
    applyTheme(resolved)
  }

  function toggle() {
    setMode(mode === "light" ? "dark" : mode === "dark" ? "system" : "light")
  }

  return (
    <ThemeContext.Provider value={{ theme, mode, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
