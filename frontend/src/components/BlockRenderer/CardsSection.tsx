import type { CardsBlock, CardItem } from '../../content/blocks';
import Editable from './Editable';

function resolveLink(link: string, siteSettings?: Record<string, string | undefined> | null): string {
  if (!link) return '#';
  if (link.startsWith('mailto:$')) {
    const key = link.slice(8);
    const email = siteSettings?.[key] || `${key.replace(/_/g, '@')}`;
    return `mailto:${email}`;
  }
  if (link.startsWith('$')) {
    const key = link.slice(1);
    return siteSettings?.[key] || '#';
  }
  return link;
}

interface Props {
  block: CardsBlock;
  siteSettings?: Record<string, string | undefined> | null;
  editable?: boolean;
  onChange?: (patch: Partial<CardsBlock>) => void;
}

export default function CardsSection({ block, siteSettings, editable, onChange }: Props) {
  const isIcon = block.variant === 'icon';

  const updateCard = (index: number, patch: Partial<CardItem>) => {
    const cards = block.cards.map((card, i) =>
      i === index ? { ...card, ...patch } : card,
    );
    onChange?.({ cards });
  };

  return (
    <section className="blk-cards-section">
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
      <div className="blk-cards-grid">
        {block.cards.map((card, index) => (
          <div key={index} className="blk-card-item blk-card">
            {isIcon && card.icon && (
              <div className="blk-card-icon">{card.icon}</div>
            )}
            {!isIcon && card.eyebrow && (
              <div className="blk-eyebrow">{card.eyebrow}</div>
            )}
            <Editable
              value={card.title}
              editable={editable}
              onChange={(v) => updateCard(index, { title: v })}
              tag="h3"
              className=""
              placeholder="Card title"
            />
            <Editable
              value={card.text}
              editable={editable}
              onChange={(v) => updateCard(index, { text: v })}
              tag="p"
              className=""
              multiline
              placeholder="Card description"
            />
            {card.buttonLabel && !editable && (
              <a
                href={resolveLink(card.buttonLink, siteSettings)}
                className="blk-card-btn btn-card"
                target={card.buttonLink.startsWith('$') || card.buttonLink.startsWith('http') ? '_blank' : undefined}
                rel={card.buttonLink.startsWith('$') || card.buttonLink.startsWith('http') ? 'noopener noreferrer' : undefined}
              >
                {card.buttonLabel}
              </a>
            )}
            {card.buttonLabel && editable && (
              <span className="blk-card-btn btn-card blk-non-editable">{card.buttonLabel}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
