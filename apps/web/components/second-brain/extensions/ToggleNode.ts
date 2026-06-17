import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { ToggleNodeView } from './ToggleNodeView'

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
        ({ commands }: { commands: any }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { open: true, summary: 'Toggle' },
            content: [{ type: 'paragraph' }],
          })
        },
    } as any
  },
})
