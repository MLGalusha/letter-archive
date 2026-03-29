import type {
  BlockType,
  ContentBlock,
  HeroBlock,
  RichtextBlock,
  QuoteBlock,
  StatsBlock,
  StepsBlock,
  CardsBlock,
  TwoColumnBlock,
  CtaBlock,
  ContactBlock,
} from './blocks';

function uid(): string {
  return crypto.randomUUID();
}

export function createHeroBlock(data?: Partial<Omit<HeroBlock, 'id' | 'type'>>): HeroBlock {
  return { id: uid(), type: 'hero', kicker: '', heading: '', subtitle: '', ...data };
}

export function createRichtextBlock(data?: Partial<Omit<RichtextBlock, 'id' | 'type'>>): RichtextBlock {
  return { id: uid(), type: 'richtext', eyebrow: '', heading: '', body: '', ...data };
}

export function createQuoteBlock(data?: Partial<Omit<QuoteBlock, 'id' | 'type'>>): QuoteBlock {
  return { id: uid(), type: 'quote', eyebrow: '', quoteText: '', attribution: '', bodyText: '', ...data };
}

export function createStatsBlock(data?: Partial<Omit<StatsBlock, 'id' | 'type'>>): StatsBlock {
  return {
    id: uid(),
    type: 'stats',
    items: [{ value: '', label: '', source: 'static' }],
    ...data,
  };
}

export function createStepsBlock(data?: Partial<Omit<StepsBlock, 'id' | 'type'>>): StepsBlock {
  return {
    id: uid(),
    type: 'steps',
    eyebrow: '',
    heading: '',
    steps: [{ title: '', text: '' }],
    ...data,
  };
}

export function createCardsBlock(data?: Partial<Omit<CardsBlock, 'id' | 'type'>>): CardsBlock {
  return {
    id: uid(),
    type: 'cards',
    eyebrow: '',
    heading: '',
    variant: 'icon',
    cards: [{ icon: '', eyebrow: '', title: '', text: '', buttonLabel: '', buttonLink: '' }],
    ...data,
  };
}

export function createTwoColumnBlock(data?: Partial<Omit<TwoColumnBlock, 'id' | 'type'>>): TwoColumnBlock {
  return {
    id: uid(),
    type: 'two-column',
    panels: [
      { eyebrow: '', heading: '', text: '', linkLabel: '', linkUrl: '' },
      { eyebrow: '', heading: '', text: '', linkLabel: '', linkUrl: '' },
    ],
    ...data,
  };
}

export function createCtaBlock(data?: Partial<Omit<CtaBlock, 'id' | 'type'>>): CtaBlock {
  return {
    id: uid(),
    type: 'cta',
    eyebrow: '',
    text: '',
    buttons: [{ label: '', link: '' }],
    ...data,
  };
}

export function createContactBlock(data?: Partial<Omit<ContactBlock, 'id' | 'type'>>): ContactBlock {
  return {
    id: uid(),
    type: 'contact',
    eyebrow: '',
    heading: '',
    intro: '',
    primaryTitle: '',
    primaryText: '',
    primaryEmailKey: 'contact_general_email',
    channels: [{ eyebrow: '', title: '', text: '', emailSettingKey: 'contact_general_email' }],
    ...data,
  };
}

const FACTORIES: Record<BlockType, (data?: any) => ContentBlock> = {
  hero: createHeroBlock,
  richtext: createRichtextBlock,
  quote: createQuoteBlock,
  stats: createStatsBlock,
  steps: createStepsBlock,
  cards: createCardsBlock,
  'two-column': createTwoColumnBlock,
  cta: createCtaBlock,
  contact: createContactBlock,
};

export function createBlock(type: BlockType): ContentBlock {
  return FACTORIES[type]();
}
