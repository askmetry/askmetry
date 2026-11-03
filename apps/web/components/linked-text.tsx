import { linkify, type LinkTargets } from '@/lib/linkify';

/** Text mit klickbaren Links zu Seiten aus den Belegen (neuer Tab). */
export function LinkedText({ text, targets }: { text: string; targets: LinkTargets }) {
  return (
    <>
      {linkify(text, targets).map((p, i) => (typeof p === 'string' ? p : (
        <a key={i} href={p.href} target="_blank" rel="noreferrer noopener nofollow" className="text-accent hover:underline [overflow-wrap:anywhere]">{p.label}</a>
      )))}
    </>
  );
}
