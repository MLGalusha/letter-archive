import { Link } from 'react-router-dom';
import type { CtaBlock } from '../../content/blocks';
import Editable from './Editable';

interface Props {
  block: CtaBlock;
  editable?: boolean;
  onChange?: (patch: Partial<CtaBlock>) => void;
}

export default function CtaSection({ block, editable, onChange }: Props) {
  return (
    <div className="blk-cta">
      <Editable
        value={block.eyebrow}
        editable={editable}
        onChange={(v) => onChange?.({ eyebrow: v })}
        tag="div"
        className="blk-eyebrow"
        placeholder="Section label (optional)"
      />
      <Editable
        value={block.text}
        editable={editable}
        onChange={(v) => onChange?.({ text: v })}
        tag="p"
        className="blk-cta-text"
        multiline
        placeholder="Call to action text"
      />
      {block.buttons.length > 0 && (
        <div className="blk-cta-buttons">
          {block.buttons.map((btn, index) =>
            editable ? (
              <span key={index} className="btn-card blk-cta-btn blk-non-editable">{btn.label}</span>
            ) : btn.link.startsWith('http') ? (
              <a key={index} href={btn.link} className="btn-card blk-cta-btn" target="_blank" rel="noopener noreferrer">
                {btn.label}
              </a>
            ) : (
              <Link key={index} to={btn.link} className="btn-card blk-cta-btn">
                {btn.label}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}
