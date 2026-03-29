import type { RichtextBlock } from '../../content/blocks';
import Editable from './Editable';

function renderParagraphs(text: string) {
  return text.split('\n\n').map((paragraph, index) => (
    <span key={index}>
      {index > 0 && <><br /><br /></>}
      {paragraph}
    </span>
  ));
}

interface Props {
  block: RichtextBlock;
  editable?: boolean;
  onChange?: (patch: Partial<RichtextBlock>) => void;
}

export default function RichtextSection({ block, editable, onChange }: Props) {
  return (
    <section className="blk-section blk-card">
      <Editable
        value={block.eyebrow}
        editable={editable}
        onChange={(v) => onChange?.({ eyebrow: v })}
        tag="div"
        className="blk-eyebrow"
        placeholder="Section label"
      />
      <Editable
        value={block.heading}
        editable={editable}
        onChange={(v) => onChange?.({ heading: v })}
        tag="h2"
        className="blk-section-heading"
        placeholder="Section heading"
      />
      {editable ? (
        <Editable
          value={block.body}
          editable
          onChange={(v) => onChange?.({ body: v })}
          tag="p"
          className=""
          multiline
          placeholder="Body text"
        />
      ) : (
        block.body && <p>{renderParagraphs(block.body)}</p>
      )}
    </section>
  );
}
