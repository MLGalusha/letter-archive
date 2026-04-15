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
  // crypto.randomUUID() requires a secure context — iOS Safari on a
  // plain-http LAN URL (e.g. http://192.168.x.x) does not expose it, so
  // fall back to a manual RFC4122-ish v4 via getRandomValues, and finally
  // to Math.random when even that is unavailable.
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
  // Last-resort: not cryptographically strong, but these ids are just
  // local block keys, never security-sensitive.
  return `uid-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
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
