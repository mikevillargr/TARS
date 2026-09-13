import { Node } from '@tiptap/core'
import type { RawCommands } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ToggleNodeView } from './ToggleNodeView'

/* Tiptap's Commands interface is populated by module augmentation, so the
 * command map is not statically known here. This names the one member each
 * command actually calls instead of widening to `any`. */
type TiptapCommandProps = {
  commands: {
    wrapIn(name: string, attrs?: Record<string, unknown>): boolean
    insertContent(value: unknown): boolean
  }
}

export const ToggleNode = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      open: { default: true },
      summary: { default: 'Toggle' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-toggle': '', 'data-open': HTMLAttributes.open, 'data-summary': HTMLAttributes.summary }, 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView)
  },

  addCommands() {
    return {
      insertToggle:
        () =>
        ({ commands }: TiptapCommandProps) => {
          return commands.insertContent({
            type: this.name,
            attrs: { open: true, summary: 'Toggle' },
            content: [{ type: 'paragraph' }],
          })
        },
    } as Partial<RawCommands>
  },
})
