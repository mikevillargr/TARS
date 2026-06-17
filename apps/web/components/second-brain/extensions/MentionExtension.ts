import { ReactRenderer } from '@tiptap/react'
import Mention from '@tiptap/extension-mention'
import tippy, { type Instance, type Props } from 'tippy.js'
import { MentionList, type MentionItem } from './MentionList'

export const MentionExtension = Mention.configure({
  HTMLAttributes: {
    class: 'tars-mention-chip',
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-mention': '',
        'data-id': node.attrs.id,
        'data-type': node.attrs.type ?? 'unknown',
        class: 'tars-mention-chip',
      },
      `[[${node.attrs.label ?? node.attrs.id}]]`,
    ]
  },

  suggestion: {
    char: '[[',

    items: async ({ query }: { query: string }): Promise<MentionItem[]> => {
      if (!query || query.length < 1) return []
      try {
        const res = await fetch(`/api/proxy/links/search?q=${encodeURIComponent(query)}`)
        if (!res.ok) return []
        return await res.json()
      } catch {
        return []
      }
    },

    render: () => {
      let component: ReactRenderer | null = null
      let popup: Instance<Props>[] | null = null

      return {
        onStart(props: any) {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          })
          if (!props.clientRect) return
          popup = tippy('body', {
            getReferenceClientRect: props.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          })
        },

        onUpdate(props: any) {
          component?.updateProps(props)
          if (!props.clientRect) return
          popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect })
        },

        onKeyDown(props: any) {
          if (props.event.key === 'Escape') {
            popup?.[0]?.hide()
            return true
          }
          return (component?.ref as any)?.onKeyDown(props)
        },

        onExit() {
          popup?.[0]?.destroy()
          component?.destroy()
          popup = null
          component = null
        },
      }
    },
  },
})
