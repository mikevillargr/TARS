'use client'

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

export interface MentionItem {
  id: string
  type: 'knowledge_item' | 'contact' | 'task'
  title: string
  subtitle?: string
}

interface Props {
  items: MentionItem[]
  command: (item: { id: string; label: string; type: string }) => void
}

const TYPE_LABEL: Record<string, string> = {
  knowledge_item: 'NOTE',
  contact: 'CONTACT',
  task: 'TASK',
}

const TYPE_ICON: Record<string, string> = {
  knowledge_item: '📄',
  contact: '👤',
  task: '✓',
}

// Avatar bg — 6 deterministic colors from name hash
const AVATAR_COLORS = [
  'var(--c-moss)',
  'var(--c-amber)',
  '#a78bfa',
  '#fb923c',
  '#38bdf8',
  '#f472b6',
]

function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export const MentionList = forwardRef<unknown, Props>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => setSelectedIndex(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }: { event: KeyboardEvent }) {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex)
        return true
      }
      return false
    },
  }))

  function selectItem(index: number) {
    const item = items[index]
    if (item) command({ id: item.id, label: item.title, type: item.type })
  }

  if (!items.length) return null

  // Group by type
  const groups: Record<string, MentionItem[]> = {}
  for (const item of items) {
    if (!groups[item.type]) groups[item.type] = []
    groups[item.type].push(item)
  }

  return (
    <div
      style={{
        width: 240,
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        maxHeight: 240,
        overflowY: 'scroll',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {Object.entries(groups).map(([type, groupItems]) => {
        const flatIndex = items.indexOf(groupItems[0])
        return (
          <div key={type}>
            <div
              style={{
                padding: '6px 10px 3px',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                color: 'var(--c-ink-faint)',
              }}
            >
              {TYPE_LABEL[type] || type}
            </div>
            {groupItems.map((item, i) => {
              const absIndex = flatIndex + i
              const isSelected = absIndex === selectedIndex
              const bg = avatarColor(item.title)
              const initials = item.title.slice(0, 2).toUpperCase()
              return (
                <button
                  key={item.id}
                  onClick={() => selectItem(absIndex)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '5px 10px',
                    background: isSelected ? 'var(--c-surface-2)' : 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: bg,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {type === 'contact' ? initials : TYPE_ICON[type]}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--c-ink)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.title}
                    </span>
                    {item.subtitle && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          color: 'var(--c-ink-muted)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      textTransform: 'uppercase',
                      color: 'var(--c-ink-faint)',
                      flexShrink: 0,
                    }}
                  >
                    {TYPE_LABEL[type]}
                  </span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
})

MentionList.displayName = 'MentionList'
