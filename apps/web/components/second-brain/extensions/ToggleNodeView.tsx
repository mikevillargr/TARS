'use client'

import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { ChevronRight } from 'lucide-react'

interface Props {
  node: any
  updateAttributes: (attrs: Record<string, unknown>) => void
  selected: boolean
}

export function ToggleNodeView({ node, updateAttributes }: Props) {
  const open: boolean = node.attrs.open ?? true
  const summary: string = node.attrs.summary || 'Toggle'

  return (
    <NodeViewWrapper>
      <div style={{ margin: '0.5rem 0' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
        >
          <button
            contentEditable={false}
            onClick={() => updateAttributes({ open: !open })}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              color: 'var(--c-ink-faint)',
              flexShrink: 0,
            }}
          >
            <ChevronRight
              size={14}
              style={{
                transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 150ms ease',
              }}
            />
          </button>
          <input
            contentEditable={false}
            value={summary}
            onChange={(e) => updateAttributes({ summary: e.target.value })}
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              fontWeight: 500,
              fontSize: '0.875rem',
              color: 'var(--c-ink)',
              flex: 1,
              cursor: 'text',
            }}
            placeholder="Toggle title…"
          />
        </div>
        <div
          style={{
            paddingLeft: '1.25rem',
            display: open ? 'block' : 'none',
            marginTop: '0.25rem',
          }}
        >
          <NodeViewContent />
        </div>
      </div>
    </NodeViewWrapper>
  )
}
