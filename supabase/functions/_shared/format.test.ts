import { describe, expect, it } from 'vitest'
import { formatHtml, formatWordPressBlocks, parseText } from './format.ts'

describe('parseText', () => {
  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    expect(parseText('One\nstill one\n\nTwo')).toEqual([
      { type: 'p', lines: ['One', 'still one'] },
      { type: 'p', lines: ['Two'] },
    ])
  })

  it('turns lines starting with "- " or "• " into a bullet list', () => {
    expect(parseText('What to expect:\n- Small groups\n• Tea and coffee')).toEqual([
      { type: 'p', lines: ['What to expect:'] },
      { type: 'ul', items: ['Small groups', 'Tea and coffee'] },
    ])
  })

  it('text after a list starts a new paragraph', () => {
    expect(parseText('- One\n- Two\nAfterwards')).toEqual([
      { type: 'ul', items: ['One', 'Two'] },
      { type: 'p', lines: ['Afterwards'] },
    ])
  })

  it('ignores extra blank lines and trailing spaces', () => {
    expect(parseText('\n\n  One  \n\n\n\nTwo\n')).toEqual([
      { type: 'p', lines: ['One'] },
      { type: 'p', lines: ['Two'] },
    ])
  })
})

describe('formatHtml (Eventbrite)', () => {
  it('writes paragraphs, line breaks and lists', () => {
    expect(formatHtml('Hello\nthere\n\n- A\n- B')).toBe('<p>Hello<br>there</p><ul><li>A</li><li>B</li></ul>')
  })

  it('turns **text** into bold', () => {
    expect(formatHtml('- **Small groups**: up to 10 people')).toBe('<ul><li><strong>Small groups</strong>: up to 10 people</li></ul>')
  })

  it('leaves a lone ** alone', () => {
    expect(formatHtml('Two ** stars')).toBe('<p>Two ** stars</p>')
  })

  it('escapes HTML, including inside bold', () => {
    expect(formatHtml('Tea & <b>cake</b> **a<i>b**')).toBe('<p>Tea &amp; &lt;b&gt;cake&lt;/b&gt; <strong>a&lt;i&gt;b</strong></p>')
  })
})

describe('formatWordPressBlocks (website)', () => {
  it('writes WordPress paragraph and list blocks', () => {
    expect(formatWordPressBlocks('Hi **all**\n\n- A\n- B')).toBe(
      '<!-- wp:paragraph -->\n<p>Hi <strong>all</strong></p>\n<!-- /wp:paragraph -->\n\n' +
      '<!-- wp:list -->\n<ul class="wp-block-list">' +
      '<!-- wp:list-item -->\n<li>A</li>\n<!-- /wp:list-item -->' +
      '<!-- wp:list-item -->\n<li>B</li>\n<!-- /wp:list-item -->' +
      '</ul>\n<!-- /wp:list -->',
    )
  })
})
