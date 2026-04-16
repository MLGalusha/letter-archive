/**
 * ReaderBlockRenderer — renders derived ReaderBlock[] for the public reader view.
 *
 * Each block gets a semantic CSS class based on its type. Body paragraphs
 * render as <p>, structural elements (date, salutation, etc.) as styled <div>.
 */

import type { ReaderBlock } from '../types/ReaderView';
import './ReaderBlockRenderer.css';

interface ReaderBlockRendererProps {
  blocks: ReaderBlock[];
  className?: string;
}

export default function ReaderBlockRenderer({ blocks, className }: ReaderBlockRendererProps) {
  return (
    <div className={`reader-blocks${className ? ` ${className}` : ''}`}>
      {blocks.map((block) => {
        const alignClass = block.alignment && block.alignment !== 'left'
          ? ` reader-align-${block.alignment}`
          : '';

        switch (block.type) {
          case 'paragraph':
            return (
              <p key={block.id} className={`reader-block reader-block-paragraph${alignClass}`}>
                {block.text}
              </p>
            );

          case 'date':
            return (
              <div key={block.id} className={`reader-block reader-block-date${alignClass}`}>
                {block.text}
              </div>
            );

          case 'salutation':
            return (
              <div key={block.id} className={`reader-block reader-block-salutation${alignClass}`}>
                {block.text}
              </div>
            );

          case 'closing':
            return (
              <div key={block.id} className={`reader-block reader-block-closing${alignClass}`}>
                {block.text}
              </div>
            );

          case 'signature':
            return (
              <div key={block.id} className={`reader-block reader-block-signature${alignClass}`}>
                {block.text}
              </div>
            );

          case 'postscript':
            return (
              <div key={block.id} className={`reader-block reader-block-postscript${alignClass}`}>
                {block.text}
              </div>
            );

          case 'continuation':
            return (
              <div key={block.id} className={`reader-block reader-block-continuation${alignClass}`}>
                {block.text}
              </div>
            );

          case 'addition':
            return (
              <aside key={block.id} className={`reader-block reader-block-addition${alignClass}`}>
                {block.text}
              </aside>
            );

          case 'address':
            return (
              <div key={block.id} className={`reader-block reader-block-address${alignClass}`}>
                {block.text}
              </div>
            );

          default:
            return (
              <p key={block.id} className={`reader-block${alignClass}`}>
                {block.text}
              </p>
            );
        }
      })}
    </div>
  );
}
