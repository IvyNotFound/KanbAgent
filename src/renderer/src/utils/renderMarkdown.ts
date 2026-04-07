/**
 * Markdown renderer with syntax highlighting and XSS sanitization (T678).
 * Shared by StreamView and its sub-components.
 */
import { marked } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'

/** Escapes HTML special chars for safe plaintext display (T841). */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Guard — prevents marked.use() from stacking renderers on hot-reload / multiple imports (T845). */
let _markedConfigured = false

function ensureMarkedConfigured(): void {
  if (_markedConfigured) return
  _markedConfigured = true
  marked.use({
    renderer: {
      code({ text, lang }: { text: string; lang?: string }) {
        const language = lang && hljs.getLanguage(lang) ? lang : undefined
        // Plaintext fallback when no language is specified — avoids O(200 langs) hljs.highlightAuto() (T841)
        const highlighted = language
          ? hljs.highlight(text, { language }).value
          : escapeHtml(text)
        return `<div class="code-block-wrapper"><button class="copy-code-btn" type="button" aria-label="Copy code">Copy</button><pre class="hljs"><code class="${language ? `language-${language}` : ''}">${highlighted}</code></pre></div>`
      }
    }
  })
}

/** Renders Markdown to sanitized HTML. DOMPurify prevents XSS from network content. */
export function renderMarkdown(text: string): string {
  ensureMarkedConfigured()
  const raw = marked.parse(text) as string
  return DOMPurify.sanitize(raw, { ADD_TAGS: ['button'] })
}
