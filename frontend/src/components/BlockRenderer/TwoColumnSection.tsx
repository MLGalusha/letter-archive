import { Link } from 'react-router-dom';
import type { TwoColumnBlock, ColumnPanel } from '../../content/blocks';
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
  block: TwoColumnBlock;
  editable?: boolean;
  onChange?: (patch: Partial<TwoColumnBlock>) => void;
}

export default function TwoColumnSection({ block, editable, onChange }: Props) {
  const updatePanel = (index: 0 | 1, patch: Partial<ColumnPanel>) => {
    const panels = [...block.panels] as [ColumnPanel, ColumnPanel];
    panels[index] = { ...panels[index], ...patch };
    onChange?.({ panels });
  };

  return (
    <div className="blk-two-col">
      {block.panels.map((panel, index) => (
        <section key={index} className="blk-section blk-card">
          <Editable
            value={panel.eyebrow}
            editable={editable}
            onChange={(v) => updatePanel(index as 0 | 1, { eyebrow: v })}
            tag="div"
            className="blk-eyebrow"
            placeholder="Section label"
          />
          <Editable
            value={panel.heading}
            editable={editable}
            onChange={(v) => updatePanel(index as 0 | 1, { heading: v })}
            tag="h2"
            className="blk-section-heading"
            placeholder="Heading"
          />
          {editable ? (
            <Editable
              value={panel.text}
              editable
              onChange={(v) => updatePanel(index as 0 | 1, { text: v })}
              tag="p"
              className=""
              multiline
              placeholder="Body text"
            />
          ) : (
            panel.text && <p>{renderParagraphs(panel.text)}</p>
          )}
          {panel.linkLabel && panel.linkUrl && !editable && (
            <Link to={panel.linkUrl} className="blk-section-link">
              {panel.linkLabel} &rarr;
            </Link>
          )}
          {panel.linkLabel && editable && (
            <span className="blk-section-link blk-non-editable">{panel.linkLabel} &rarr;</span>
          )}
        </section>
      ))}
    </div>
  );
}
