/**
 * Unit tests for renderMarkdown (T678, T1106).
 * Tests import from the actual module to cover mutation testing.
 */
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './renderMarkdown'

describe('renderMarkdown', () => {
  it('renders bold text', () => {
    const result = renderMarkdown('**hello**')
    expect(result).toContain('<strong>hello</strong>')
  })

  it('renders italic text', () => {
    const result = renderMarkdown('*world*')
    expect(result).toContain('<em>world</em>')
  })

  it('renders h1 heading', () => {
    const result = renderMarkdown('# Title')
    expect(result).toContain('<h1')
    expect(result).toContain('Title')
  })

  it('renders h2 heading', () => {
    const result = renderMarkdown('## Subtitle')
    expect(result).toContain('<h2')
    expect(result).toContain('Subtitle')
  })

  it('renders unordered list', () => {
    const result = renderMarkdown('- item one\n- item two')
    expect(result).toContain('<ul>')
    expect(result).toContain('<li>item one</li>')
    expect(result).toContain('<li>item two</li>')
  })

  it('renders inline code', () => {
    const result = renderMarkdown('Use `foo()` here')
    expect(result).toContain('<code>')
    expect(result).toContain('foo()')
  })

  it('renders fenced code block with language — class language-js applied', () => {
    const result = renderMarkdown('```js\nconst x = 1\n```')
    expect(result).toContain('<pre class="hljs">')
    expect(result).toContain('language-js')
    expect(result).toContain('<code class="language-js">')
  })

  it('renders fenced code block with unknown language — no class applied (fallback plaintext)', () => {
    const result = renderMarkdown('```unknownlang999\nsome text\n```')
    expect(result).toContain('<pre class="hljs">')
    expect(result).toContain('<code class="">')
    expect(result).toContain('some text')
  })

  it('renders code block without language — class is empty string (T841)', () => {
    const result = renderMarkdown('```\nconst x = 1\n```')
    expect(result).toContain('<pre class="hljs">')
    expect(result).toContain('<code class="">')
    expect(result).toContain('const x = 1')
  })

  it('escapes HTML tags in unlabeled code blocks — no raw tags (T841)', () => {
    const result = renderMarkdown('```\n<b>bold</b>\n```')
    expect(result).not.toContain('<b>')
    expect(result).toContain('&lt;b&gt;')
  })

  it('escapes & in unlabeled code blocks', () => {
    const result = renderMarkdown('```\na & b\n```')
    expect(result).toContain('&amp;')
  })

  it('renders " safely in unlabeled code blocks (no raw script injection)', () => {
    const result = renderMarkdown('```\nsay "hello"\n```')
    // DOMPurify may decode &quot; back to " inside text nodes — both are safe
    expect(result).toMatch(/say (&quot;|")hello(&quot;|")/)
  })

  it("renders ' safely in unlabeled code blocks (no raw script injection)", () => {
    const result = renderMarkdown("```\nit's fine\n```")
    // DOMPurify may decode &#39; back to ' inside text nodes — both are safe
    expect(result).toMatch(/it(&#39;|')s fine/)
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

  // XSS regression tests — GHSA-v8jm-5vwx-cfxm (T848)
  it('strips javascript: href payload', () => {
    const result = renderMarkdown('[click me](javascript:alert(1))')
    expect(result).not.toContain('javascript:')
  })

  it('strips SVG onload payload', () => {
    const result = renderMarkdown('<svg onload="alert(1)"><rect/></svg>')
    expect(result).not.toContain('onload')
    expect(result).not.toContain('alert')
  })

  it('strips iframe injection', () => {
    const result = renderMarkdown('<iframe src="https://evil.example.com"></iframe>')
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('evil.example.com')
  })

  it('returns empty string for empty input', () => {
    const result = renderMarkdown('')
    expect(result.trim()).toBe('')
  })

  it('renders plain text unchanged (wrapped in p)', () => {
    const result = renderMarkdown('hello world')
    expect(result).toContain('hello world')
  })

  it('renders link with href', () => {
    const result = renderMarkdown('[visit](https://example.com)')
    expect(result).toContain('<a')
    expect(result).toContain('href="https://example.com"')
    expect(result).toContain('visit')
  })

  it('renders ordered list', () => {
    const result = renderMarkdown('1. first\n2. second')
    expect(result).toContain('<ol>')
    expect(result).toContain('<li>first</li>')
    expect(result).toContain('<li>second</li>')
  })

  it('renders horizontal rule', () => {
    const result = renderMarkdown('---')
    expect(result).toContain('<hr')
  })

  it('renders blockquote', () => {
    const result = renderMarkdown('> quote text')
    expect(result).toContain('<blockquote>')
    expect(result).toContain('quote text')
  })

  it('idempotent — calling twice returns same result', () => {
    const a = renderMarkdown('**test**')
    const b = renderMarkdown('**test**')
    expect(a).toBe(b)
  })
})
