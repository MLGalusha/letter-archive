import type { JSONContent } from '@tiptap/react';

const TAG_REGEX = /«(SENDER|RECIPIENT):([^»]*)»/g;

/**
 * Parse a string with «SENDER:text»/«RECIPIENT:text» tags into TipTap JSONContent.
 * Plain text becomes text nodes; tags become senderTag/recipientTag nodes.
 */
export function parseTaggedText(raw: string): JSONContent {
  const lines = raw.split('\n');
  const content: JSONContent[] = lines.map((line) => {
    const inlineContent: JSONContent[] = [];
    let lastIndex = 0;
    TAG_REGEX.lastIndex = 0;
    let match;

    while ((match = TAG_REGEX.exec(line)) !== null) {
      // Text before this tag
      if (match.index > lastIndex) {
        inlineContent.push({
          type: 'text',
          text: line.slice(lastIndex, match.index),
        });
      }

      const tagType = match[1]; // SENDER or RECIPIENT
      const tagText = match[2]; // content inside the tag
      const nodeType = tagType === 'SENDER' ? 'senderTag' : 'recipientTag';

      if (tagText.length > 0) {
        inlineContent.push({
          type: nodeType,
          content: [{ type: 'text', text: tagText }],
        });
      } else {
        // Empty tag — represent as node with no content
        inlineContent.push({
          type: nodeType,
        });
      }

      lastIndex = match.index + match[0].length;
    }

    // Remaining text after last tag
    if (lastIndex < line.length) {
      inlineContent.push({
        type: 'text',
        text: line.slice(lastIndex),
      });
    }

    // Empty paragraph if line was empty
    if (inlineContent.length === 0) {
      return { type: 'paragraph' };
    }

    return { type: 'paragraph', content: inlineContent };
  });

  return { type: 'doc', content };
}

/**
 * Serialize a TipTap JSONContent document back to the «SENDER:text»/«RECIPIENT:text» format.
 */
export function serializeTaggedText(doc: JSONContent): string {
  if (!doc.content) return '';

  return doc.content
    .map((paragraph) => {
      if (!paragraph.content) return '';
      return paragraph.content
        .map((node) => {
          if (node.type === 'senderTag') {
            const text = extractText(node);
            return `«SENDER:${text}»`;
          }
          if (node.type === 'recipientTag') {
            const text = extractText(node);
            return `«RECIPIENT:${text}»`;
          }
          return node.text ?? '';
        })
        .join('');
    })
    .join('\n');
}

function extractText(node: JSONContent): string {
  if (!node.content) return '';
  return node.content.map((child) => child.text ?? '').join('');
}
