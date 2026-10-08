import { describe, expect, it } from 'vitest'
import { markdownPathFor, negotiate, prefersMarkdown } from '../scripts/site/accept.ts'

describe('Accept negotiation', () => {
  it('prefers Markdown when it is the best supported type', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true)
    expect(prefersMarkdown('text/markdown, text/html;q=0.8')).toBe(true)
    expect(prefersMarkdown('text/html;q=0.1, text/markdown')).toBe(true)
  })

  it('keeps HTML for browsers and vague clients', () => {
    expect(negotiate(null)).toBe('html')
    expect(negotiate('')).toBe('html')
    expect(negotiate('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe('html')
    expect(negotiate('text/plain, */*;q=0.1')).toBe('html')
    expect(prefersMarkdown('text/html, text/markdown;q=0')).toBe(false)
  })

  it('maps canonical paths to Markdown twins', () => {
    expect(markdownPathFor('/')).toBe('/index.md')
    expect(markdownPathFor('/holdem')).toBe('/holdem.md')
    expect(markdownPathFor('/about/')).toBe('/about.md')
    expect(markdownPathFor('/assets/index.js')).toBeUndefined()
    expect(markdownPathFor('/../secret')).toBeUndefined()
  })
})
