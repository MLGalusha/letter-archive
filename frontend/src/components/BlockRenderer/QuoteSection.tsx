import type { QuoteBlock } from '../../content/blocks';
import Editable from './Editable';

interface Props {
  block: QuoteBlock;
  editable?: boolean;
  onChange?: (patch: Partial<QuoteBlock>) => void;
}

export default function QuoteSection({ block, editable, onChange }: Props) {
  return (
    <section className="blk-section blk-card blk-section--featured">
      <Editable
        value={block.eyebrow}
        editable={editable}
        onChange={(v) => onChange?.({ eyebrow: v })}
        tag="div"
        className="blk-eyebrow"
        placeholder="Section label"
      />
      <Editable
        value={block.quoteText}
        editable={editable}
        onChange={(v) => onChange?.({ quoteText: v })}
        tag="blockquote"
        className="blk-quote"
        multiline
        placeholder="Quote text"
      />
      <Editable
        value={block.attribution}
        editable={editable}
        onChange={(v) => onChange?.({ attribution: v })}
        tag="p"
        className="blk-quote-attribution"
        placeholder="Attribution (optional)"
      >
        {!editable && block.attribution ? `\u2014 ${block.attribution}` : undefined}
      </Editable>
      <Editable
        value={block.bodyText}
        editable={editable}
        onChange={(v) => onChange?.({ bodyText: v })}
        tag="p"
        className=""
        multiline
        placeholder="Body text"
      />
    </section>
  );
}
