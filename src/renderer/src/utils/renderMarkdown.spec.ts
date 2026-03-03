/**
 * Unit tests for renderMarkdown (T678).
 * Validates markdown → sanitized HTML transformation.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { marked } from 'marked'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

// Set up DOMPurify with jsdom (Node environment has no DOM)
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html>')
  // @ts-expect-error — DOMPurify accepts Window-like objects
  DOMPurify.sanitize = (html: string) => {
    const win = dom.window as unknown as Window
    const purify = DOMPurify(win)
    return purify.sanitize(html)
  }
})

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : undefined
      const highlighted = language
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value
      return `<pre class="hljs"><code class="${language ? `language-${language}` : ''}">${highlighted}</code></pre>`
    }
  }
})

function renderMarkdown(text: string): string {
  const raw = marked.parse(text) as string
  return DOMPurify.sanitize(raw)
}

describe('renderMarkdown', () => {
  it('renders bold text', () => {
    const result = renderMarkdown('**hello**')
    expect(result).toContain('<strong>hello</strong>')
  })

  it('renders italic text', () => {
    const result = renderMarkdown('*world*')
    expect(result).toContain('<em>world</em>')
  })

  it('renders heading', () => {
    const result = renderMarkdown('# Title')
    expect(result).toContain('<h1')
    expect(result).toContain('Title')
  })

  it('renders unordered list', () => {
    const result = renderMarkdown('- item one\n- item two')
    expect(result).toContain('<ul>')
    expect(result).toContain('<li>item one</li>')
  })

  it('renders inline code', () => {
    const result = renderMarkdown('Use `foo()` here')
    expect(result).toContain('<code>')
    expect(result).toContain('foo()')
  })

  it('renders fenced code block with syntax highlight', () => {
    const result = renderMarkdown('```js\nconst x = 1\n```')
    expect(result).toContain('<pre class="hljs">')
    expect(result).toContain('language-js')
  })

  it('strips XSS script tags', () => {
    const result = renderMarkdown('<script>alert("xss")</script>')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert(')
  })

  it('strips onerror attributes', () => {
    const result = renderMarkdown('<img src="x" onerror="alert(1)">')
    expect(result).not.toContain('onerror')
  })

  it('returns empty string for empty input', () => {
    const result = renderMarkdown('')
    expect(result.trim()).toBe('')
  })

  it('renders plain text unchanged (wrapped in p)', () => {
    const result = renderMarkdown('hello world')
    expect(result).toContain('hello world')
  })
})
