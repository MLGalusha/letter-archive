import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, Image, ImageReference, Definition } from 'mdast';

/** Parse image nodes, not Markdown strings: reference definitions and wrap titles survive. */
export function journalImageSourcesInPost(markdown: string, hero: string): string[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const definitions = new Map<string, string>();
  const images: (Image | ImageReference)[] = [];
  function walk(node: Root | Root['children'][number]) {
    if (node.type === 'definition') {
      const key = (node as Definition).identifier.toUpperCase();
      if (!definitions.has(key)) definitions.set(key, (node as Definition).url);
    }
    if (node.type === 'image' || node.type === 'imageReference') images.push(node);
    if ('children' in node) node.children.forEach(child => walk(child as Root['children'][number]));
  }
  walk(tree);
  return [...new Set([hero.trim(), ...images.map(node => node.type === 'image' ? node.url : definitions.get(node.identifier.toUpperCase()) ?? '')])].filter(source => source.length > 0 && source.length <= 2048).slice(0, 64);
}
