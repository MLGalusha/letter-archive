import type { ContentBlock } from './blocks';
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

// ── About page defaults ─────────────────────────────────────────────

function aboutBlocks(): ContentBlock[] {
  return [
    createHeroBlock({
      kicker: 'About the Archive',
      heading: 'Every letter is a conversation across time',
      subtitle:
        'Letter Archive preserves personal correspondence \u2014 the handwritten notes passed between lovers, the telegrams sent home from war, the postcards scribbled on train platforms. We digitize, transcribe, and publish these documents so the voices inside them outlast the paper they were written on.',
    }),
    createStatsBlock({
      items: [
        { value: '', label: 'Letters preserved', source: 'letters_count' },
        { value: '', label: 'Collections', source: 'collections_count' },
        { value: '100+', label: 'Years of history', source: 'static' },
      ],
    }),
    createQuoteBlock({
      eyebrow: 'Why letters matter',
      quoteText:
        'History remembers the speeches, the treaties, the declarations. But it forgets the letters \u2014 the ones that say the milk is too expensive, or that the baby learned to walk, or please come home soon. Those are the ones that tell you what it was really like.',
      attribution: '',
      bodyText:
        'Personal letters are among the most honest documents we have. They were never written for posterity \u2014 they were written for one person, in one moment, with no expectation that anyone else would ever read them. That honesty is what makes them irreplaceable. But paper is fragile. Every year, floods, fires, estate sales, and simple neglect destroy correspondence that can never be recovered. Letter Archive exists to intervene before it\u2019s too late.',
    }),
    createStepsBlock({
      eyebrow: 'How it works',
      heading: 'From shoebox to searchable archive',
      steps: [
        {
          title: 'Digitize',
          text: 'Each letter is photographed to capture the handwriting, margin notes, and physical details as faithfully as possible.',
        },
        {
          title: 'Transcribe',
          text: 'AI-assisted transcription converts decades of handwriting into searchable text. Human reviewers then verify every line to ensure nothing is lost in translation.',
        },
        {
          title: 'Contextualize',
          text: 'Dates, locations, people, and historical context are layered onto each letter \u2014 connecting individual documents to the larger web of lives they belong to.',
        },
        {
          title: 'Publish',
          text: 'Verified letters go live in the open archive, where anyone can read, search, and follow the threads that connect one life to another.',
        },
      ],
    }),
    createTwoColumnBlock({
      panels: [
        {
          eyebrow: 'Contribute',
          heading: 'Your letters belong here',
          text: 'Somewhere in a closet or a desk drawer, there is a bundle of letters that no one has read in years. They might be your grandparents\u2019 love letters, your uncle\u2019s postcards from overseas, a stack of correspondence from someone you never met. We can preserve them \u2014 digitized, transcribed, and made accessible \u2014 while you keep every original.\n\nEvery letter that enters the archive adds another voice to the record. The more voices, the fuller the picture of what life actually looked like.',
          linkLabel: 'Get in touch',
          linkUrl: '/support#contact',
        },
        {
          eyebrow: 'Research',
          heading: 'A living primary source',
          text: 'Historians, genealogists, journalists, and students will find material here that exists nowhere else \u2014 firsthand accounts of migration, war, love, economic hardship, and the ordinary texture of daily life across generations.\n\nThe entire archive is searchable by name, date, location, and full text. We welcome academic inquiries and are happy to help researchers locate material relevant to their work.',
          linkLabel: 'Browse collections',
          linkUrl: '/collections',
        },
      ],
    }),
  ];
}

// ── Support page defaults ───────────────────────────────────────────

function supportBlocks(): ContentBlock[] {
  return [
    createHeroBlock({
      kicker: 'Support & Contact',
      heading: 'Help us keep these voices alive',
      subtitle:
        'Letter Archive runs on real resources \u2014 equipment, storage, hosting, and a lot of careful human work. There are no corporate sponsors or institutional grants behind this project. It exists because people like you believe these voices deserve to be heard.',
    }),
    createQuoteBlock({
      eyebrow: 'Why your support matters',
      quoteText:
        'Every letter in this archive was written by someone who trusted that their words would reach the person they loved. Preserving that trust \u2014 across decades, across generations \u2014 is the least we can do.',
      attribution: '',
      bodyText:
        'This project started with one family\u2019s letters and grew into something much larger. There is no grant committee or endowment keeping the lights on. What keeps this archive running is the generosity of people who understand that ordinary voices matter \u2014 that a letter written from a kitchen table is as important to history as any general\u2019s memoir.',
    }),
    createCardsBlock({
      eyebrow: 'Where Your Support Goes',
      heading: 'Every contribution makes a difference',
      variant: 'icon',
      cards: [
        {
          icon: '\u{1F4F7}',
          eyebrow: '',
          title: 'Digitization',
          text: 'Scanning equipment and supplies to capture the details of each letter \u2014 the handwriting, the margin notes, the faded ink \u2014 before time takes them.',
          buttonLabel: '',
          buttonLink: '',
        },
        {
          icon: '\u{1F5C3}',
          eyebrow: '',
          title: 'Preservation & Storage',
          text: 'Safe, dry storage for physical letters and reliable cloud backups for digital copies \u2014 so nothing is lost once it enters the archive.',
          buttonLabel: '',
          buttonLink: '',
        },
        {
          icon: '\u{1F310}',
          eyebrow: '',
          title: 'Public Access',
          text: 'Server hosting, bandwidth, and ongoing development to keep the archive free, fast, and searchable for researchers, families, and the curious.',
          buttonLabel: '',
          buttonLink: '',
        },
      ],
    }),
    createCardsBlock({
      eyebrow: 'Ways to Give',
      heading: "Choose how you'd like to help",
      variant: 'eyebrow',
      cards: [
        {
          icon: '',
          eyebrow: 'One-Time',
          title: 'Make a donation',
          text: 'A single contribution of any size goes directly toward preserving and publishing letters. No amount is too small \u2014 every bit helps keep the archive running and growing.',
          buttonLabel: 'Donate Once',
          buttonLink: '$donate_onetime_url',
        },
        {
          icon: '',
          eyebrow: 'Monthly',
          title: 'Become a sustainer',
          text: 'Ongoing support gives this project a steady foundation. Monthly sustainers help us plan ahead, invest in better equipment, and grow the collection with confidence.',
          buttonLabel: 'Support Monthly',
          buttonLink: '$donate_monthly_url',
        },
        {
          icon: '',
          eyebrow: 'Non-Monetary',
          title: 'Other ways to help',
          text: 'Not everyone can give financially, and that\u2019s completely fine. You can contribute letters from your own family, volunteer your time for transcription review, or simply share the archive with someone who would appreciate it.',
          buttonLabel: 'Get in Touch',
          buttonLink: 'mailto:$contact_volunteer_email',
        },
      ],
    }),
    createContactBlock({
      eyebrow: 'Get in Touch',
      heading: "We'd love to hear from you",
      intro: 'Whether you have letters to contribute, a research question, or just want to learn more \u2014 we read every message and respond to each one personally.',
      primaryTitle: '',
      primaryText: '',
      primaryEmailKey: 'contact_general_email',
      channels: [
        {
          eyebrow: 'General',
          title: 'General Inquiries',
          text: 'Questions about the archive, the project, or how to get involved? Start here.',
          emailSettingKey: 'contact_general_email',
        },
        {
          eyebrow: 'Contribute',
          title: 'Share your letters',
          text: 'Old family correspondence, postcards, telegrams \u2014 we\u2019ll digitize and preserve them for future generations. You keep every original.',
          emailSettingKey: 'contact_contribute_email',
        },
        {
          eyebrow: 'Volunteer',
          title: 'Join the effort',
          text: 'Help with transcription verification, metadata review, or digitization. No experience necessary \u2014 just care and curiosity.',
          emailSettingKey: 'contact_volunteer_email',
        },
      ],
    }),
  ];
}

// ── Public API ──────────────────────────────────────────────────────

const DEFAULT_BLOCKS: Record<string, () => ContentBlock[]> = {
  about: aboutBlocks,
  support: supportBlocks,
};

export function getDefaultBlocks(slug: string): ContentBlock[] {
  const factory = DEFAULT_BLOCKS[slug];
  return factory ? factory() : [];
}
