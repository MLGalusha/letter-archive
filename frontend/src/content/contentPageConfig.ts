export type ContentPageSlug = 'about' | 'support';

export interface ContentPageFieldDefinition {
  key: string;
  label: string;
  kind?: 'text' | 'textarea';
  hint?: string;
}

export interface ContentPageSectionDefinition {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  fields: ContentPageFieldDefinition[];
}

export interface ContentPageEditorDefinition {
  slug: ContentPageSlug;
  title: string;
  kicker: string;
  description: string;
  publicPath: string;
  sections: ContentPageSectionDefinition[];
}

export const CONTENT_PAGE_ORDER: ContentPageSlug[] = ['about', 'support'];

const ABOUT_DEFAULTS = {
  hero_kicker: 'About the Archive',
  hero_heading: 'Every letter is a conversation across time',
  hero_subtitle:
    'We preserve personal letters - the kind written at kitchen tables, in hospital wards, on trains between cities - so the voices inside them are never lost.',
  stats_letters_label: 'Letters preserved',
  stats_collections_label: 'Collections',
  stats_years_value: '100+',
  stats_years_label: 'Years of history',
  why_eyebrow: 'Why letters matter',
  quote_text:
    'History books record the decisions of generals and presidents. Personal letters record everything else - the price of bread, the ache of distance, the small joys that never made the newspapers.',
  quote_attribution: '',
  why_matters_text:
    'These documents are fragile. Paper yellows, ink fades, and families move on. Every year, irreplaceable correspondence is lost to attics, floods, and estate sales. Letter Archive exists to intervene - to digitize, transcribe, and share these fragments before they disappear.',
  process_eyebrow: 'How it works',
  process_heading: 'From shoebox to searchable archive',
  process_step_1_title: 'Digitize',
  process_step_1_text:
    'Letters are carefully photographed at high resolution, preserving every crease, stain, and margin note.',
  process_step_2_title: 'Transcribe',
  process_step_2_text:
    'AI-assisted transcription converts handwriting to searchable text, then human reviewers verify accuracy.',
  process_step_3_title: 'Contextualize',
  process_step_3_text:
    'Each letter is annotated with dates, locations, people, and topics - connecting it to the broader historical record.',
  process_step_4_title: 'Publish',
  process_step_4_text:
    'Verified letters are published to the open archive where anyone can read, search, and explore the connections between them.',
  contribute_eyebrow: 'Contribute',
  contribute_heading: 'Your letters have a story',
  contribute_text:
    'Old family correspondence gathering dust in a drawer? A bundle of postcards from a relative you never met? We can help preserve them - digitized, transcribed, and made available to future generations.\n\nEvery contribution enriches the archive and helps paint a fuller picture of everyday life across generations.',
  contribute_link_label: 'Get in touch',
  research_eyebrow: 'Research',
  research_heading: 'A primary source collection',
  research_text:
    'Historians, genealogists, and students will find rich material here - patterns in migration, economic hardship, family dynamics, and cultural change, told through the words of the people who lived it.\n\nThe archive is fully searchable by date, location, person, topic, and full-text content. We welcome academic inquiries and collaborations.',
  research_link_label: 'Browse collections',
  cta_text:
    'Start exploring - read the letters, follow the people, trace the places.',
  cta_primary_label: 'Browse Collections',
  cta_secondary_label: 'Read the Journal',
} satisfies Record<string, string>;

const SUPPORT_DEFAULTS = {
  hero_kicker: 'Support & Contact',
  hero_heading: 'Help us keep these voices alive',
  hero_subtitle:
    'Preserving handwritten letters takes real resources - scanning equipment, archival storage, hosting, and countless hours of careful work. Your generosity makes it possible to keep this history accessible to everyone.',
  featured_eyebrow: 'Why your support matters',
  quote_text:
    'Every letter in this archive was written by someone who trusted that their words would reach the people they loved. Keeping these letters alive is a way of honoring that trust - across decades, across generations.',
  quote_attribution: '',
  impact_intro:
    "Letter Archive is a passion project born from one family's collection and grown into something bigger. There are no corporate sponsors, no institutional grants - just people who believe these voices deserve to be heard. Your support, in any form, keeps the lights on and the scanners running.",
  impact_eyebrow: 'Where Your Support Goes',
  impact_heading: 'Every contribution makes a difference',
  impact_card_1_icon: '\u{1F4F7}',
  impact_card_1_title: 'Digitization',
  impact_card_1_text:
    'High-resolution scanning equipment and supplies to carefully capture every crease, margin note, and faded line of ink before time takes its toll.',
  impact_card_2_icon: '\u{1F5C3}',
  impact_card_2_title: 'Preservation & Storage',
  impact_card_2_text:
    'Archival-quality materials for physical storage, plus secure cloud infrastructure to safeguard digital copies for decades to come.',
  impact_card_3_icon: '\u{1F310}',
  impact_card_3_title: 'Public Access',
  impact_card_3_text:
    'Server hosting, bandwidth, and ongoing development to keep the archive free and searchable for researchers, families, and the curious alike.',
  give_eyebrow: 'Ways to Give',
  donation_heading: "Choose how you'd like to help",
  option_1_eyebrow: 'One-Time',
  option_1_title: 'Make a donation',
  option_1_text:
    'A single contribution of any amount goes directly toward preserving and sharing these letters. No amount is too small - every dollar helps digitize another page of history.',
  option_1_button_label: 'Donate Once',
  option_2_eyebrow: 'Monthly',
  option_2_title: 'Become a sustainer',
  option_2_text:
    'Ongoing support provides the steady foundation this project needs. Monthly sustainers help us plan ahead, invest in better equipment, and expand the collection with confidence.',
  option_2_button_label: 'Support Monthly',
  option_3_eyebrow: 'Non-Monetary',
  option_3_title: 'Other ways to help',
  option_3_text:
    "Not everyone can give financially, and that's perfectly okay. You can volunteer your time, contribute letters from your own family, or simply share the archive with someone who'd appreciate it.",
  option_3_button_label: 'Get in Touch',
  contact_eyebrow: 'Get in Touch',
  contact_heading: "We'd love to hear from you",
  contact_intro:
    'Whether you have letters to contribute, a research question, or just want to know more - every message matters to us.',
  contact_primary_title: 'General Inquiries',
  contact_primary_text:
    'Questions about the archive, how it works, or how to get involved? This is the best place to start.',
  channel_1_eyebrow: 'Contribute',
  channel_1_title: 'Share your letters',
  channel_1_text:
    "Old family correspondence, postcards, telegrams - we'll digitize and preserve them for future generations. You keep the originals.",
  channel_2_eyebrow: 'Research',
  channel_2_title: 'Academic access',
  channel_2_text:
    'Historians, genealogists, and students are welcome. We can help locate letters relevant to your area of study.',
  channel_3_eyebrow: 'Volunteer',
  channel_3_title: 'Join the effort',
  channel_3_text:
    'Help with transcription verification, metadata review, or digitization. No experience needed - just curiosity and care.',
  thankyou_eyebrow: 'Thank You',
  thankyou_text:
    'Whether you give a dollar, an hour, or a letter - you become part of the story. This archive exists because of people who care about preserving the quiet, honest words of everyday life. From our family to yours, thank you.',
  thankyou_primary_label: 'About the Project',
  thankyou_secondary_label: 'Browse the Archive',
} satisfies Record<string, string>;

export const CONTENT_PAGE_DEFAULTS: Record<ContentPageSlug, Record<string, string>> = {
  about: ABOUT_DEFAULTS,
  support: SUPPORT_DEFAULTS,
};

export const CONTENT_PAGE_EDITOR_CONFIG: Record<ContentPageSlug, ContentPageEditorDefinition> = {
  about: {
    slug: 'about',
    title: 'About',
    kicker: 'Static Page Composer',
    description:
      'Shape the archive story, explain the preservation process, and tune the pathways into collections and support.',
    publicPath: '/about',
    sections: [
      {
        id: 'hero',
        eyebrow: 'Opening',
        title: 'Hero',
        description: 'Set the first impression and the framing line visitors meet at the top of the page.',
        fields: [
          { key: 'hero_kicker', label: 'Hero kicker' },
          { key: 'hero_heading', label: 'Hero heading' },
          {
            key: 'hero_subtitle',
            label: 'Hero subtitle',
            kind: 'textarea',
            hint: 'Use 2-4 sentences that explain the archive in plain language.',
          },
        ],
      },
      {
        id: 'stats',
        eyebrow: 'At A Glance',
        title: 'Stats row',
        description: 'These labels sit beside the live collection counts on the public page.',
        fields: [
          { key: 'stats_letters_label', label: 'Letters stat label' },
          { key: 'stats_collections_label', label: 'Collections stat label' },
          { key: 'stats_years_value', label: 'Years stat value' },
          { key: 'stats_years_label', label: 'Years stat label' },
        ],
      },
      {
        id: 'story',
        eyebrow: 'Core Story',
        title: 'Why letters matter',
        description: 'This is the emotional center of the page: quote, context, and the case for preservation.',
        fields: [
          { key: 'why_eyebrow', label: 'Section eyebrow' },
          { key: 'quote_text', label: 'Quote text', kind: 'textarea' },
          { key: 'quote_attribution', label: 'Quote attribution' },
          {
            key: 'why_matters_text',
            label: 'Why it matters body',
            kind: 'textarea',
          },
        ],
      },
      {
        id: 'process',
        eyebrow: 'Workflow',
        title: 'How it works',
        description: 'Guide readers from physical letters to searchable public records.',
        fields: [
          { key: 'process_eyebrow', label: 'Section eyebrow' },
          { key: 'process_heading', label: 'Section heading' },
          { key: 'process_step_1_title', label: 'Step 1 title' },
          { key: 'process_step_1_text', label: 'Step 1 text', kind: 'textarea' },
          { key: 'process_step_2_title', label: 'Step 2 title' },
          { key: 'process_step_2_text', label: 'Step 2 text', kind: 'textarea' },
          { key: 'process_step_3_title', label: 'Step 3 title' },
          { key: 'process_step_3_text', label: 'Step 3 text', kind: 'textarea' },
          { key: 'process_step_4_title', label: 'Step 4 title' },
          { key: 'process_step_4_text', label: 'Step 4 text', kind: 'textarea' },
        ],
      },
      {
        id: 'paths',
        eyebrow: 'Next Steps',
        title: 'Contribution and research lanes',
        description: 'Tune the two side-by-side invitations that send readers deeper into the project.',
        fields: [
          { key: 'contribute_eyebrow', label: 'Contribute eyebrow' },
          { key: 'contribute_heading', label: 'Contribute heading' },
          { key: 'contribute_text', label: 'Contribute body', kind: 'textarea' },
          { key: 'contribute_link_label', label: 'Contribute link label' },
          { key: 'research_eyebrow', label: 'Research eyebrow' },
          { key: 'research_heading', label: 'Research heading' },
          { key: 'research_text', label: 'Research body', kind: 'textarea' },
          { key: 'research_link_label', label: 'Research link label' },
        ],
      },
      {
        id: 'cta',
        eyebrow: 'Closing',
        title: 'Footer call to action',
        description: 'Finish the page with a concise invitation to explore the archive.',
        fields: [
          { key: 'cta_text', label: 'CTA text', kind: 'textarea' },
          { key: 'cta_primary_label', label: 'Primary button label' },
          { key: 'cta_secondary_label', label: 'Secondary button label' },
        ],
      },
    ],
  },
  support: {
    slug: 'support',
    title: 'Support',
    kicker: 'Static Page Composer',
    description:
      'Tune the fundraising story, clarify contribution paths, and make every contact route feel intentional.',
    publicPath: '/support',
    sections: [
      {
        id: 'hero',
        eyebrow: 'Opening',
        title: 'Hero',
        description: 'Lead with a concise case for support and set the emotional tone for the page.',
        fields: [
          { key: 'hero_kicker', label: 'Hero kicker' },
          { key: 'hero_heading', label: 'Hero heading' },
          { key: 'hero_subtitle', label: 'Hero subtitle', kind: 'textarea' },
        ],
      },
      {
        id: 'story',
        eyebrow: 'Context',
        title: 'Why support matters',
        description: 'Explain the stakes before asking people to donate, contribute, or reach out.',
        fields: [
          { key: 'featured_eyebrow', label: 'Section eyebrow' },
          { key: 'quote_text', label: 'Quote text', kind: 'textarea' },
          { key: 'quote_attribution', label: 'Quote attribution' },
          { key: 'impact_intro', label: 'Intro body', kind: 'textarea' },
        ],
      },
      {
        id: 'impact',
        eyebrow: 'Funding Story',
        title: 'Where support goes',
        description: 'These three cards explain what donations actually pay for.',
        fields: [
          { key: 'impact_eyebrow', label: 'Section eyebrow' },
          { key: 'impact_heading', label: 'Section heading' },
          { key: 'impact_card_1_icon', label: 'Impact card 1 icon' },
          { key: 'impact_card_1_title', label: 'Impact card 1 title' },
          { key: 'impact_card_1_text', label: 'Impact card 1 text', kind: 'textarea' },
          { key: 'impact_card_2_icon', label: 'Impact card 2 icon' },
          { key: 'impact_card_2_title', label: 'Impact card 2 title' },
          { key: 'impact_card_2_text', label: 'Impact card 2 text', kind: 'textarea' },
          { key: 'impact_card_3_icon', label: 'Impact card 3 icon' },
          { key: 'impact_card_3_title', label: 'Impact card 3 title' },
          { key: 'impact_card_3_text', label: 'Impact card 3 text', kind: 'textarea' },
        ],
      },
      {
        id: 'give',
        eyebrow: 'Giving Paths',
        title: 'Ways to give',
        description: 'Control the three donation and outreach cards without changing site settings or payment links.',
        fields: [
          { key: 'give_eyebrow', label: 'Section eyebrow' },
          { key: 'donation_heading', label: 'Section heading' },
          { key: 'option_1_eyebrow', label: 'Option 1 eyebrow' },
          { key: 'option_1_title', label: 'Option 1 title' },
          { key: 'option_1_text', label: 'Option 1 text', kind: 'textarea' },
          { key: 'option_1_button_label', label: 'Option 1 button label' },
          { key: 'option_2_eyebrow', label: 'Option 2 eyebrow' },
          { key: 'option_2_title', label: 'Option 2 title' },
          { key: 'option_2_text', label: 'Option 2 text', kind: 'textarea' },
          { key: 'option_2_button_label', label: 'Option 2 button label' },
          { key: 'option_3_eyebrow', label: 'Option 3 eyebrow' },
          { key: 'option_3_title', label: 'Option 3 title' },
          { key: 'option_3_text', label: 'Option 3 text', kind: 'textarea' },
          { key: 'option_3_button_label', label: 'Option 3 button label' },
        ],
      },
      {
        id: 'contact',
        eyebrow: 'Contact',
        title: 'Contact section',
        description: 'Shape the outreach copy for the main inbox and the three specialized channels.',
        fields: [
          { key: 'contact_eyebrow', label: 'Section eyebrow' },
          { key: 'contact_heading', label: 'Section heading' },
          { key: 'contact_intro', label: 'Intro text', kind: 'textarea' },
          { key: 'contact_primary_title', label: 'Primary contact title' },
          { key: 'contact_primary_text', label: 'Primary contact text', kind: 'textarea' },
          { key: 'channel_1_eyebrow', label: 'Channel 1 eyebrow' },
          { key: 'channel_1_title', label: 'Channel 1 title' },
          { key: 'channel_1_text', label: 'Channel 1 text', kind: 'textarea' },
          { key: 'channel_2_eyebrow', label: 'Channel 2 eyebrow' },
          { key: 'channel_2_title', label: 'Channel 2 title' },
          { key: 'channel_2_text', label: 'Channel 2 text', kind: 'textarea' },
          { key: 'channel_3_eyebrow', label: 'Channel 3 eyebrow' },
          { key: 'channel_3_title', label: 'Channel 3 title' },
          { key: 'channel_3_text', label: 'Channel 3 text', kind: 'textarea' },
        ],
      },
      {
        id: 'thanks',
        eyebrow: 'Closing',
        title: 'Thank-you block',
        description: 'Close the page with gratitude and the two follow-on links back into the archive.',
        fields: [
          { key: 'thankyou_eyebrow', label: 'Section eyebrow' },
          { key: 'thankyou_text', label: 'Thank-you text', kind: 'textarea' },
          { key: 'thankyou_primary_label', label: 'Primary button label' },
          { key: 'thankyou_secondary_label', label: 'Secondary button label' },
        ],
      },
    ],
  },
};

export function isContentPageSlug(value: string | undefined): value is ContentPageSlug {
  return value === 'about' || value === 'support';
}

export function getContentPageFieldKeys(slug: ContentPageSlug): string[] {
  return Object.keys(CONTENT_PAGE_DEFAULTS[slug]);
}

export function resolveContentPageContent(
  slug: ContentPageSlug,
  content: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const defaults = CONTENT_PAGE_DEFAULTS[slug];
  const resolved = { ...defaults };

  if (!content) {
    return resolved;
  }

  for (const key of Object.keys(defaults)) {
    if (Object.prototype.hasOwnProperty.call(content, key) && typeof content[key] === 'string') {
      resolved[key] = String(content[key]).replace(/\r\n/g, '\n');
    }
  }

  return resolved;
}

export function serializeContentPageDraft(
  slug: ContentPageSlug,
  content: Record<string, unknown>,
): Record<string, string> {
  const defaults = CONTENT_PAGE_DEFAULTS[slug];
  const serialized: Record<string, string> = {};

  for (const key of Object.keys(defaults)) {
    const rawValue = typeof content[key] === 'string' ? String(content[key]) : defaults[key];
    const value = rawValue.replace(/\r\n/g, '\n');
    if (value !== defaults[key]) {
      serialized[key] = value;
    }
  }

  return serialized;
}
