/**
 * Lightweight markdown renderer
 * Converts markdown to HTML for message display
 */
import { escapeHtml } from './utils.ts';

export function renderMarkdown(text: string): string {
  // Escape HTML first
  let html = escapeHtml(text);

  // Code blocks (```...```)
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, _lang, code) => `<pre><code>${code.trim()}</code></pre>`
  );

  // Inline code (`...`)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<strong style="font-size:0.9em">$1</strong>');
  html = html.replace(/^### (.+)$/gm, '<strong style="font-size:0.95em">$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong style="font-size:1em">$1</strong>');
  html = html.replace(/^# (.+)$/gm, '<strong style="font-size:1.1em">$1</strong>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  // Blockquotes
  html = html.replace(
    /^&gt; (.+)$/gm,
    '<blockquote>$1</blockquote>'
  );

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Unordered lists
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists — use a marker to avoid <ul> wrapping consuming these <li>s
  html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (match) => {
    const items = match.replace(/<\/?oli>/g, (tag: string) =>
      tag === '<oli>' ? '<li>' : '</li>'
    );
    return `<ol>${items}</ol>`;
  });

  // Line breaks (preserve newlines)
  html = html.replace(/\n/g, '<br>');

  // Clean up double <br> from block elements
  html = html.replace(/<br><br>/g, '<br>');
  html = html.replace(/<\/pre><br>/g, '</pre>');
  html = html.replace(/<br><pre>/g, '<pre>');
  html = html.replace(/<\/ul><br>/g, '</ul>');
  html = html.replace(/<br><ul>/g, '<ul>');
  html = html.replace(/<\/ol><br>/g, '</ol>');
  html = html.replace(/<br><ol>/g, '<ol>');
  html = html.replace(/<\/blockquote><br>/g, '</blockquote>');

  return html;
}
