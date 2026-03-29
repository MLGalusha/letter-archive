import type { ContentBlock } from '../../content/blocks';
import HeroSection from './HeroSection';
import RichtextSection from './RichtextSection';
import QuoteSection from './QuoteSection';
import StatsSection from './StatsSection';
import StepsSection from './StepsSection';
import CardsSection from './CardsSection';
import TwoColumnSection from './TwoColumnSection';
import CtaSection from './CtaSection';
import ContactSection from './ContactSection';
import './BlockRenderer.css';

export interface BlockRendererProps {
  blocks: ContentBlock[];
  liveStats?: { letters: number; collections: number } | null;
  siteSettings?: Record<string, string> | null;
  editable?: boolean;
  onBlockChange?: (blockId: string, patch: Partial<ContentBlock>) => void;
}

export default function BlockRenderer({
  blocks,
  liveStats,
  siteSettings,
  editable,
  onBlockChange,
}: BlockRendererProps) {
  const change = (blockId: string) => (patch: Partial<ContentBlock>) => {
    onBlockChange?.(blockId, patch);
  };

  return (
    <>
      {blocks.map((block) => {
        const c = change(block.id);
        switch (block.type) {
          case 'hero':
            return <HeroSection key={block.id} block={block} editable={editable} onChange={c} />;
          case 'richtext':
            return <RichtextSection key={block.id} block={block} editable={editable} onChange={c} />;
          case 'quote':
            return <QuoteSection key={block.id} block={block} editable={editable} onChange={c} />;
          case 'stats':
            return <StatsSection key={block.id} block={block} liveStats={liveStats} editable={editable} onChange={c} />;
          case 'steps':
            return <StepsSection key={block.id} block={block} editable={editable} onChange={c} />;
          case 'cards':
            return <CardsSection key={block.id} block={block} siteSettings={siteSettings} editable={editable} onChange={c} />;
          case 'two-column':
            return <TwoColumnSection key={block.id} block={block} editable={editable} onChange={c} />;
          case 'cta':
            return <CtaSection key={block.id} block={block} editable={editable} onChange={c} />;
          case 'contact':
            return <ContactSection key={block.id} block={block} siteSettings={siteSettings} editable={editable} onChange={c} />;
          default:
            return null;
        }
      })}
    </>
  );
}
