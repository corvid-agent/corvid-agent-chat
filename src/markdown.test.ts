import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown.ts';

describe('renderMarkdown', () => {
  it('escapes HTML entities', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('renders bold text', () => {
    const result = renderMarkdown('**bold text**');
    expect(result).toContain('<strong>bold text</strong>');
  });

  it('renders italic text', () => {
    const result = renderMarkdown('*italic text*');
    expect(result).toContain('<em>italic text</em>');
  });

  it('renders bold-italic text', () => {
    const result = renderMarkdown('***bold italic***');
    expect(result).toContain('<strong><em>bold italic</em></strong>');
  });

  it('renders inline code', () => {
    const result = renderMarkdown('Use `console.log()` here');
    expect(result).toContain('<code>console.log()</code>');
  });

  it('renders code blocks', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result).toContain('<pre><code>');
    expect(result).toContain('const x = 1;');
  });

  it('renders links with target="_blank"', () => {
    const result = renderMarkdown('[click me](https://example.com)');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener"');
    expect(result).toContain('>click me</a>');
  });

  it('renders headers', () => {
    expect(renderMarkdown('# Title')).toContain('font-size:1.1em');
    expect(renderMarkdown('## Subtitle')).toContain('font-size:1em');
    expect(renderMarkdown('### Small')).toContain('font-size:0.95em');
    expect(renderMarkdown('#### Tiny')).toContain('font-size:0.9em');
  });

  it('renders blockquotes', () => {
    const result = renderMarkdown('> quoted text');
    expect(result).toContain('<blockquote>quoted text</blockquote>');
  });

  it('renders horizontal rules', () => {
    expect(renderMarkdown('---')).toContain('<hr>');
    expect(renderMarkdown('-----')).toContain('<hr>');
  });

  it('renders unordered lists', () => {
    const result = renderMarkdown('- item one\n- item two');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>item one</li>');
    expect(result).toContain('<li>item two</li>');
  });

  it('renders ordered lists', () => {
    const result = renderMarkdown('1. first\n2. second');
    expect(result).toContain('<li>first</li>');
    expect(result).toContain('<li>second</li>');
  });

  it('preserves line breaks', () => {
    const result = renderMarkdown('line one\nline two');
    expect(result).toContain('<br>');
  });

  it('handles plain text without modification (except line breaks)', () => {
    const result = renderMarkdown('Hello World');
    expect(result).toBe('Hello World');
  });
});
