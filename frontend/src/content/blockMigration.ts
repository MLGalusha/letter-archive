import type { ContentBlock, BlockPageContent } from './blocks';
import { getDefaultBlocks } from './defaultBlocks';
import {
  createHeroBlock,
  createQuoteBlock,
  createStatsBlock,
  createStepsBlock,
  createTwoColumnBlock,
  createCtaBlock,
  createCardsBlock,
  createContactBlock,
} from './blockFactories';

/**
 * Resolve content JSON from the database into a blocks array.
 *
 * Handles three cases:
 * 1. New format: { blocks: [...] } -> return blocks directly
 * 2. Old flat-field format: { hero_kicker: "...", ... } -> convert to blocks
 * 3. No content / null -> return default blocks
 */
export function resolveBlocks(
  slug: string,
  contentJson: Record<string, unknown> | null | undefined,
): ContentBlock[] {
  if (!contentJson) {
    return getDefaultBlocks(slug);
  }

  // New format: has a blocks array
  if (Array.isArray((contentJson as BlockPageContent).blocks)) {
    return (contentJson as BlockPageContent).blocks;
  }

  // Old flat-field format: convert
  const fields = contentJson as Record<string, string>;
  if (slug === 'about') return convertAboutFields(fields);
  if (slug === 'support') return convertSupportFields(fields);

  return getDefaultBlocks(slug);
}

function f(fields: Record<string, string>, key: string, fallback = ''): string {
  return typeof fields[key] === 'string' ? fields[key] : fallback;
}

function convertAboutFields(fields: Record<string, string>): ContentBlock[] {
  return [
    createHeroBlock({
      kicker: f(fields, 'hero_kicker', 'About the Archive'),
      heading: f(fields, 'hero_heading', 'Every letter is a conversation across time'),
      subtitle: f(fields, 'hero_subtitle'),
    }),
    createStatsBlock({
      items: [
        { value: '', label: f(fields, 'stats_letters_label', 'Letters preserved'), source: 'letters_count' },
        { value: '', label: f(fields, 'stats_collections_label', 'Collections'), source: 'collections_count' },
        { value: f(fields, 'stats_years_value', '100+'), label: f(fields, 'stats_years_label', 'Years of history'), source: 'static' },
      ],
    }),
    createQuoteBlock({
      eyebrow: f(fields, 'why_eyebrow', 'Why letters matter'),
      quoteText: f(fields, 'quote_text'),
      attribution: f(fields, 'quote_attribution'),
      bodyText: f(fields, 'why_matters_text'),
    }),
    createStepsBlock({
      eyebrow: f(fields, 'process_eyebrow', 'How it works'),
      heading: f(fields, 'process_heading', 'From shoebox to searchable archive'),
      steps: [1, 2, 3, 4].map((n) => ({
        title: f(fields, `process_step_${n}_title`),
        text: f(fields, `process_step_${n}_text`),
      })),
    }),
    createTwoColumnBlock({
      panels: [
        {
          eyebrow: f(fields, 'contribute_eyebrow', 'Contribute'),
          heading: f(fields, 'contribute_heading'),
          text: f(fields, 'contribute_text'),
          linkLabel: f(fields, 'contribute_link_label', 'Get in touch'),
          linkUrl: '/support#contact',
        },
        {
          eyebrow: f(fields, 'research_eyebrow', 'Research'),
          heading: f(fields, 'research_heading'),
          text: f(fields, 'research_text'),
          linkLabel: f(fields, 'research_link_label', 'Browse collections'),
          linkUrl: '/collections',
        },
      ],
    }),
    createCtaBlock({
      eyebrow: '',
      text: f(fields, 'cta_text'),
      buttons: [
        { label: f(fields, 'cta_primary_label', 'Browse Collections'), link: '/collections' },
        { label: f(fields, 'cta_secondary_label', 'Read the Journal'), link: '/blog' },
      ],
    }),
  ];
}

function convertSupportFields(fields: Record<string, string>): ContentBlock[] {
  return [
    createHeroBlock({
      kicker: f(fields, 'hero_kicker', 'Support & Contact'),
      heading: f(fields, 'hero_heading'),
      subtitle: f(fields, 'hero_subtitle'),
    }),
    createQuoteBlock({
      eyebrow: f(fields, 'featured_eyebrow', 'Why your support matters'),
      quoteText: f(fields, 'quote_text'),
      attribution: f(fields, 'quote_attribution'),
      bodyText: f(fields, 'impact_intro'),
    }),
    createCardsBlock({
      eyebrow: f(fields, 'impact_eyebrow', 'Where Your Support Goes'),
      heading: f(fields, 'impact_heading'),
      variant: 'icon',
      cards: [1, 2, 3].map((n) => ({
        icon: f(fields, `impact_card_${n}_icon`),
        eyebrow: '',
        title: f(fields, `impact_card_${n}_title`),
        text: f(fields, `impact_card_${n}_text`),
        buttonLabel: '',
        buttonLink: '',
      })),
    }),
    createCardsBlock({
      eyebrow: f(fields, 'give_eyebrow', 'Ways to Give'),
      heading: f(fields, 'donation_heading'),
      variant: 'eyebrow',
      cards: [
        {
          icon: '',
          eyebrow: f(fields, 'option_1_eyebrow', 'One-Time'),
          title: f(fields, 'option_1_title'),
          text: f(fields, 'option_1_text'),
          buttonLabel: f(fields, 'option_1_button_label', 'Donate Once'),
          buttonLink: '$donate_onetime_url',
        },
        {
          icon: '',
          eyebrow: f(fields, 'option_2_eyebrow', 'Monthly'),
          title: f(fields, 'option_2_title'),
          text: f(fields, 'option_2_text'),
          buttonLabel: f(fields, 'option_2_button_label', 'Support Monthly'),
          buttonLink: '$donate_monthly_url',
        },
        {
          icon: '',
          eyebrow: f(fields, 'option_3_eyebrow', 'Non-Monetary'),
          title: f(fields, 'option_3_title'),
          text: f(fields, 'option_3_text'),
          buttonLabel: f(fields, 'option_3_button_label', 'Get in Touch'),
          buttonLink: 'mailto:$contact_volunteer_email',
        },
      ],
    }),
    createContactBlock({
      eyebrow: f(fields, 'contact_eyebrow', 'Get in Touch'),
      heading: f(fields, 'contact_heading'),
      intro: f(fields, 'contact_intro'),
      primaryTitle: f(fields, 'contact_primary_title', 'General Inquiries'),
      primaryText: f(fields, 'contact_primary_text'),
      primaryEmailKey: 'contact_general_email',
      channels: [1, 2, 3].map((n) => ({
        eyebrow: f(fields, `channel_${n}_eyebrow`),
        title: f(fields, `channel_${n}_title`),
        text: f(fields, `channel_${n}_text`),
        emailSettingKey: n === 1 ? 'contact_contribute_email' : n === 2 ? 'contact_research_email' : 'contact_volunteer_email',
      })),
    }),
    createCtaBlock({
      eyebrow: f(fields, 'thankyou_eyebrow', 'Thank You'),
      text: f(fields, 'thankyou_text'),
      buttons: [
        { label: f(fields, 'thankyou_primary_label', 'About the Project'), link: '/about' },
        { label: f(fields, 'thankyou_secondary_label', 'Browse the Archive'), link: '/collections' },
      ],
    }),
  ];
}
