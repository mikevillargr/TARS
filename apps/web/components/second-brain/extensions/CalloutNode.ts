import { Node, mergeAttributes } from '@tiptap/core'
import type { RawCommands } from '@tiptap/core'

/* Tiptap's Commands interface is populated by module augmentation, so the
 * command map is not statically known here. This names the one member each
 * command actually calls instead of widening to `any`. */
type TiptapCommandProps = {
  commands: {
    wrapIn(name: string, attrs?: Record<string, unknown>): boolean
    insertContent(value: unknown): boolean
  }
}

const EMOJI: Record<string, string> = {
  note: '💡',
  warning: '⚠️',
  action: '✅',
  insight: '🔑',
}

const BORDER_COLOR: Record<string, string> = {
  note: 'var(--c-moss)',
  warning: 'var(--c-amber)',
  action: 'var(--c-moss)',
  insight: 'var(--c-ink-faint)',
}

export const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      calloutType: { default: 'note' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    const type = HTMLAttributes.calloutType || 'note'
    const emoji = EMOJI[type] || '💡'
    const border = BORDER_COLOR[type] || 'var(--c-moss)'
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-callout': type,
        style: [
          `border-left: 3px solid ${border}`,
          'background: var(--c-surface-2)',
          'border-radius: 0 6px 6px 0',
          'padding: 0.75rem 1rem 0.75rem 1rem',
          'margin: 0.75rem 0',
          'position: relative',
        ].join('; '),
      }),
      ['span', { style: 'position:absolute;left:-0.05rem;top:0.6rem;font-size:0.85rem' }, emoji],
      ['div', { style: 'padding-left: 1.25rem' }, 0],
    ]
  },

  addCommands() {
    return {
      setCallout:
        (calloutType: string = 'note') =>
        ({ commands }: TiptapCommandProps) => {
          return commands.wrapIn(this.name, { calloutType })
        },
    } as Partial<RawCommands>
  },
})
