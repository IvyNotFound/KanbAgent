/**
 * Markdown renderer with syntax highlighting and XSS sanitization (T678).
 * Shared by StreamView and its sub-components.
 */
import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import diff from 'highlight.js/lib/languages/diff'
import markdown from 'highlight.js/lib/languages/markdown'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('json', json)
hljs.registerLanguage('python', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('markdown', markdown)
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
      },
      // Escape raw HTML (block & inline) so it displays as literal text instead of being rendered (T1841)
      html({ text }: { text: string }) {
        return escapeHtml(text)
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
