import type { ComponentProps } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlightSegments, type Term } from '../lib/metrics';

/*
 * Rendert KI-Antworten (untrusted) als GFM-Markdown.
 * Sicherheit: kein rehype-raw → rohes HTML wird nie gerendert (zusätzlich skipHtml),
 * URLs laufen durch defaultUrlTransform (blockt javascript:, data: …), Bilder werden nicht geladen.
 */

type HastText = { type: 'text'; value: string };
type HastElement = { type: 'element'; tagName: string; properties: Record<string, unknown>; children: HastNode[] };
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const SKIP = new Set(['code', 'pre']);

/** rehype-Plugin: umschließt Markennennungen in Textknoten mit <mark class="hl-…">. */
function rehypeHighlight(options: { terms: readonly Term[] }) {
  const walk = (node: HastNode) => {
    if (!('children' in node) || !node.children) return;
    const next: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === 'text') {
        for (const s of highlightSegments((child as HastText).value, options.terms)) {
          next.push(s.kind
            ? { type: 'element', tagName: 'mark', properties: { className: [`hl-${s.kind}`] }, children: [{ type: 'text', value: s.text }] }
            : { type: 'text', value: s.text });
        }
      } else {
        if (!(child.type === 'element' && SKIP.has((child as HastElement).tagName))) walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: HastNode) => walk(tree);
}

function textOf(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return (node as HastText).value;
  return 'children' in node && node.children ? node.children.map(textOf).join('') : '';
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function MdLink({ href, children, node }: ComponentProps<'a'> & { node?: unknown }) {
  const url = href ?? '';
  const text = textOf(node as HastNode).trim();
  const external = /^https?:/i.test(url);
  if (!external) {
    // Interne Anker (z. B. GFM-Fußnoten) oder entfernte/unsichere URLs → kein externer Link.
    return url.startsWith('#') ? <a href={url} className="md-link">{children}</a> : <span>{children}</span>;
  }
  const host = hostOf(url);
  const common = { href: url, target: '_blank', rel: 'noopener noreferrer nofollow', title: url } as const;
  const num = text.match(/^\[?(\d{1,3})\]?$/);
  if (num) return <a {...common} className="md-cite">{num[1]}</a>;
  if (host && (/^(https?:\/\/|www\.)/i.test(text) || text.length > 60)) return <a {...common} className="md-link md-domain">{host}</a>;
  return <a {...common} className="md-link">{children}</a>;
}

export function AnswerMarkdown({ text, terms }: { text: string; terms: readonly Term[] }) {
  return (
    <div className="answer-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { terms }]]}
        skipHtml
        urlTransform={defaultUrlTransform}
        components={{
          a: MdLink,
          table: ({ node: _n, ...p }) => <div className="md-table"><table {...p} /></div>,
          img: ({ alt }) => (alt ? <span className="text-muted">[Bild: {alt}]</span> : null),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
