import { ReactRenderer } from '@tiptap/react'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import Mention from '@tiptap/extension-mention'
import tippy, { type Instance, type Props } from 'tippy.js'
import { MentionList, type MentionItem } from './MentionList'

// Stored format: [[id|type|label]]
// e.g. [[abc123|contact|John Doe]]
// This survives save/reload: serialize writes it, the markdown-it rule parses it back.

/* Minimal structural types for the third-party surfaces this extension touches.
 * tiptap-markdown's serializer state and markdown-it's inline ruler are not
 * exported as types, and tippy's suggestion props vary by version — so these
 * describe exactly the members used here rather than claiming `any`. */
type MdSerializerState = { write(text: string): void }
type MentionNode = { attrs: { id?: string; type?: string; label?: string } }

type MdInlineToken = { content: string }
type MdInlineState = {
  src: string
  pos: number
  push(type: string, tag: string, nesting: number): MdInlineToken
}
type MarkdownIt = {
  inline: {
    ruler: {
      before(
        before: string,
        name: string,
        rule: (state: MdInlineState, silent: boolean) => boolean,
      ): void
    }
  }
}

type MentionListHandle = { onKeyDown?: (props: SuggestionKeyDownProps) => boolean }

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const MentionExtension = Mention
  .extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        // Explicit data-* parsers so a serialized chip round-trips on reload.
        id: {
          default: null,
          parseHTML: el => el.getAttribute('data-id'),
          renderHTML: attrs => (attrs.id ? { 'data-id': attrs.id } : {}),
        },
        label: {
          default: null,
          parseHTML: el => el.getAttribute('data-label'),
          renderHTML: attrs => (attrs.label ? { 'data-label': attrs.label } : {}),
        },
        type: {
          default: 'unknown',
          parseHTML: el => el.getAttribute('data-type') ?? 'unknown',
          renderHTML: attrs => ({ 'data-type': attrs.type ?? 'unknown' }),
        },
      }
    },

    // CRITICAL: the default mention parseHTML matches span[data-type="mention"],
    // but our chips carry the ENTITY type in data-type (contact/knowledge_item/task)
    // and mark themselves with data-mention. Without this matcher, reloaded content
    // is never recognized as a mention node — the chip degrades to text and the next
    // save drops the id, silently breaking the link. Match on data-mention instead.
    parseHTML() {
      return [{ tag: 'span[data-mention]' }]
    },

    addStorage() {
      return {
        markdown: {
          // Serialize mention node → [[id|type|label]] in stored markdown
          serialize(state: MdSerializerState, node: MentionNode) {
            const id    = node.attrs.id    ?? ''
            const type  = node.attrs.type  ?? 'unknown'
            const label = node.attrs.label ?? node.attrs.id ?? ''
            state.write(`[[${id}|${type}|${label}]]`)
          },

          parse: {
            // Add a markdown-it inline rule that converts [[id|type|label]]
            // back to a <span data-mention …> that tiptap's DOM parser can recognize.
            // html_inline tokens from custom rules always render regardless of html:false.
            setup(markdownit: MarkdownIt) {
              markdownit.inline.ruler.before('escape', 'tars_mention', (state: MdInlineState, silent: boolean) => {
                const src = state.src.slice(state.pos)
                // Match [[id|type|label]] — label may contain anything except ]]
                const match = src.match(/^\[\[([^\]|]+)\|([^\]|]+)\|([^\]]+?)\]\]/)
                if (!match) return false
                if (!silent) {
                  const [, id, type, label] = match
                  const token = state.push('html_inline', '', 0)
                  token.content = `<span data-mention="" data-id="${esc(id)}" data-type="${esc(type)}" data-label="${esc(label)}" class="tars-mention-chip">[[${esc(label)}]]</span>`
                }
                state.pos += match[0].length
                return true
              })
            },
          },
        },
      }
    },
  })
  .configure({
  HTMLAttributes: {
    class: 'tars-mention-chip',
  },

  // renderText is used by tiptap-markdown as a fallback for serialization
  renderText({ node }) {
    const id    = node.attrs.id    ?? ''
    const type  = node.attrs.type  ?? 'unknown'
    const label = node.attrs.label ?? node.attrs.id ?? ''
    return `[[${id}|${type}|${label}]]`
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-mention': '',
        'data-id':    node.attrs.id,
        'data-type':  node.attrs.type ?? 'unknown',
        'data-label': node.attrs.label ?? node.attrs.id,
        class: 'tars-mention-chip',
      },
      `[[${node.attrs.label ?? node.attrs.id}]]`,
    ]
  },

  suggestion: {
    char: '@',

    items: async ({ query }: { query: string }): Promise<MentionItem[]> => {
      // Empty query (just after "@") returns recent items, matching the chat composer.
      try {
        const res = await fetch(`/api/proxy/links/search?q=${encodeURIComponent(query ?? "")}`)
        if (!res.ok) return []
        return await res.json()
      } catch {
        return []
      }
    },

    render: () => {
      /* Tiptap's clientRect may return null between renders; tippy's
       * GetReferenceClientRect may not. Collapsing null to an empty rect keeps
       * the popup positioned at the origin for that frame instead of throwing.
       * The `any` this replaced was hiding the mismatch, not solving it. */
      const rectOf = (fn: SuggestionProps["clientRect"]) => () => fn?.() ?? new DOMRect()

      let component: ReactRenderer | null = null
      let popup: Instance<Props>[] | null = null

      return {
        onStart(props: SuggestionProps) {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          })
          if (!props.clientRect) return
          popup = tippy('body', {
            getReferenceClientRect: rectOf(props.clientRect),
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          })
        },

        onUpdate(props: SuggestionProps) {
          component?.updateProps(props)
          if (!props.clientRect) return
          popup?.[0]?.setProps({ getReferenceClientRect: rectOf(props.clientRect) })
        },

        onKeyDown(props: SuggestionKeyDownProps) {
          if (props.event.key === 'Escape') {
            popup?.[0]?.hide()
            return true
          }
          return (component?.ref as MentionListHandle | undefined)?.onKeyDown?.(props) ?? false
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
