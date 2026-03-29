// ── Block type system for About & Support page content ──────────────

export type BlockType =
  | 'hero'
  | 'richtext'
  | 'quote'
  | 'stats'
  | 'steps'
  | 'cards'
  | 'two-column'
  | 'cta'
  | 'contact';

interface BlockBase {
  id: string;
  type: BlockType;
}

// ── Hero ────────────────────────────────────────────────────────────

export interface HeroBlock extends BlockBase {
  type: 'hero';
  kicker: string;
  heading: string;
  subtitle: string;
}

// ── Richtext ────────────────────────────────────────────────────────

export interface RichtextBlock extends BlockBase {
  type: 'richtext';
  eyebrow: string;
  heading: string;
  body: string;
}

// ── Quote ───────────────────────────────────────────────────────────

export interface QuoteBlock extends BlockBase {
  type: 'quote';
  eyebrow: string;
  quoteText: string;
  attribution: string;
  bodyText: string;
}

// ── Stats ───────────────────────────────────────────────────────────

export type StatSource = 'static' | 'letters_count' | 'collections_count';

export interface StatItem {
  value: string;
  label: string;
  source: StatSource;
}

export interface StatsBlock extends BlockBase {
  type: 'stats';
  items: StatItem[];
}

// ── Steps ───────────────────────────────────────────────────────────

export interface StepItem {
  title: string;
  text: string;
}

export interface StepsBlock extends BlockBase {
  type: 'steps';
  eyebrow: string;
  heading: string;
  steps: StepItem[];
}

// ── Cards ───────────────────────────────────────────────────────────

export interface CardItem {
  icon: string;
  eyebrow: string;
  title: string;
  text: string;
  buttonLabel: string;
  buttonLink: string;
}

export type CardsVariant = 'icon' | 'eyebrow';

export interface CardsBlock extends BlockBase {
  type: 'cards';
  eyebrow: string;
  heading: string;
  variant: CardsVariant;
  cards: CardItem[];
}

// ── Two-Column ──────────────────────────────────────────────────────

export interface ColumnPanel {
  eyebrow: string;
  heading: string;
  text: string;
  linkLabel: string;
  linkUrl: string;
}

export interface TwoColumnBlock extends BlockBase {
  type: 'two-column';
  panels: [ColumnPanel, ColumnPanel];
}

// ── CTA ─────────────────────────────────────────────────────────────

export interface CtaButton {
  label: string;
  link: string;
}

export interface CtaBlock extends BlockBase {
  type: 'cta';
  eyebrow: string;
  text: string;
  buttons: CtaButton[];
}

// ── Contact ─────────────────────────────────────────────────────────

export interface ContactChannel {
  eyebrow: string;
  title: string;
  text: string;
  emailSettingKey: string;
}

export interface ContactBlock extends BlockBase {
  type: 'contact';
  eyebrow: string;
  heading: string;
  intro: string;
  primaryTitle: string;
  primaryText: string;
  primaryEmailKey: string;
  channels: ContactChannel[];
}

// ── Union ───────────────────────────────────────────────────────────

export type ContentBlock =
  | HeroBlock
  | RichtextBlock
  | QuoteBlock
  | StatsBlock
  | StepsBlock
  | CardsBlock
  | TwoColumnBlock
  | CtaBlock
  | ContactBlock;

// ── Page content shape (stored in content_json) ─────────────────────

export interface BlockPageContent {
  blocks: ContentBlock[];
}

// ── Block metadata (for picker UI, labels, etc.) ────────────────────

import type { IconName } from '../components/common/Icon';

export interface BlockTypeMeta {
  type: BlockType;
  label: string;
  description: string;
  icon: IconName;
  maxPerPage?: number;
}

export const BLOCK_TYPE_META: BlockTypeMeta[] = [
  { type: 'hero', label: 'Hero', description: 'Page hero with kicker, heading, and subtitle', icon: 'flag', maxPerPage: 1 },
  { type: 'richtext', label: 'Text Section', description: 'General text section with heading and body', icon: 'file' },
  { type: 'quote', label: 'Quote', description: 'Featured quote with attribution and body text', icon: 'file' },
  { type: 'stats', label: 'Stats Row', description: 'Row of stat items with values and labels', icon: 'chart', maxPerPage: 1 },
  { type: 'steps', label: 'Steps', description: 'Numbered process steps', icon: 'process' },
  { type: 'cards', label: 'Card Grid', description: 'Grid of cards with title, text, and optional buttons', icon: 'columns' },
  { type: 'two-column', label: 'Two Column', description: 'Side-by-side panels with heading and text', icon: 'arrows-horizontal' },
  { type: 'cta', label: 'Call to Action', description: 'Closing CTA with text and buttons', icon: 'confirm' },
  { type: 'contact', label: 'Contact', description: 'Contact section with email channels', icon: 'person' },
];

export function getBlockMeta(type: BlockType): BlockTypeMeta {
  return BLOCK_TYPE_META.find((m) => m.type === type)!;
}
