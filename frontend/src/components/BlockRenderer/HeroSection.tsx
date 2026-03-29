import type { HeroBlock } from '../../content/blocks';
import Editable from './Editable';

interface Props {
  block: HeroBlock;
  editable?: boolean;
  onChange?: (patch: Partial<HeroBlock>) => void;
}

export default function HeroSection({ block, editable, onChange }: Props) {
  return (
    <header className="blk-hero">
      <Editable
        value={block.kicker}
        editable={editable}
        onChange={(v) => onChange?.({ kicker: v })}
        tag="p"
        className="blk-eyebrow"
        placeholder="Kicker text"
      />
      <Editable
        value={block.heading}
        editable={editable}
        onChange={(v) => onChange?.({ heading: v })}
        tag="h1"
        className="blk-hero-heading"
        multiline
        placeholder="Heading"
      />
      <Editable
        value={block.subtitle}
        editable={editable}
        onChange={(v) => onChange?.({ subtitle: v })}
        tag="p"
        className="blk-hero-subtitle"
        multiline
        placeholder="Subtitle paragraph"
      />
    </header>
  );
}
