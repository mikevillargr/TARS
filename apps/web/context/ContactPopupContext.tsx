"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { ContactPopup } from "@/components/contacts/ContactPopup"

interface ContactPopupContextValue {
  openContact: (contactId: string, anchorElOrRect: HTMLElement | DOMRect) => void
  closeContact: () => void
}

const ContactPopupContext = createContext<ContactPopupContextValue>({
  openContact: () => {},
  closeContact: () => {},
})

export function useContactPopup() {
  return useContext(ContactPopupContext)
}

export function ContactPopupProvider({ children }: { children: React.ReactNode }) {
  const [contactId, setContactId] = useState<string | null>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  const openContact = useCallback((id: string, elOrRect: HTMLElement | DOMRect) => {
    setContactId(id)
    setAnchorRect(elOrRect instanceof DOMRect ? elOrRect : elOrRect.getBoundingClientRect())
  }, [])

  const closeContact = useCallback(() => {
    setContactId(null)
    setAnchorRect(null)
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!contactId) return
    function handle(e: MouseEvent) {
      const popup = document.getElementById("contact-popup-root")
      if (popup && !popup.contains(e.target as Node)) closeContact()
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [contactId, closeContact])

  // Close on Escape
  useEffect(() => {
    if (!contactId) return
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") closeContact()
    }
    document.addEventListener("keydown", handle)
    return () => document.removeEventListener("keydown", handle)
  }, [contactId, closeContact])

  return (
    <ContactPopupContext.Provider value={{ openContact, closeContact }}>
      {children}
      {contactId && anchorRect && (
        <ContactPopup
          contactId={contactId}
          anchorRect={anchorRect}
          onClose={closeContact}
        />
      )}
    </ContactPopupContext.Provider>
  )
}
