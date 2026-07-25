import { describe, expect, it } from 'vitest';
import {
  buildMetadataConfirmationGuidanceEnvelope,
  confirmationIntentIdentity,
  isNormalizedConfirmationGuidance,
  metadataInputIdentity,
  normalizeConfirmationGuidance,
  resolveMetadataConfirmationGuidance,
  transcriptDigest,
  type MetadataConfirmationGuidanceSource,
  type MetadataInputIdentitySource,
} from '../letter/metadata-input-identity.js';

const confirmationId = 'e9db47b6-6bd5-47f2-b573-57e57aeb98f6';

const metadataInput: MetadataInputIdentitySource = {
  letterId: 'letter-1',
  transcriptionText: 'Dear Bob,\nHello.',
  collectionCode: '009',
  dateRaw: '19470810',
  letterDate: '1947-08-10',
  extraContentTranscript: 'Envelope addressed to Bob.',
  extraContentStatus: 'AI_DRAFT',
  extraContentJobStatus: 'SUCCESS',
};

function resolutionSource(
  envelope: unknown,
  input: MetadataInputIdentitySource = metadataInput,
): MetadataConfirmationGuidanceSource {
  return {
    envelope,
    confirmationId,
    confirmationSourceRevision: 7,
    confirmationTranscriptDigest: transcriptDigest(
      metadataInput.transcriptionText,
    ),
    primarySourceRevision: 7,
    metadataInput: input,
  };
}

describe('metadata input identity', () => {
  it('computes exact SHA-256 digests from UTF-8 transcript bytes', () => {
    expect(transcriptDigest('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(transcriptDigest('é')).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    );
    expect(transcriptDigest('é')).not.toBe(
      transcriptDigest('e\u0301'),
    );
  });

  it('normalizes optional guidance to trimmed NFC values and null blanks', () => {
    const guidance = normalizeConfirmationGuidance({
      confirmedSender: '  Jose\u0301  ',
      confirmedRecipient: '   ',
    });

    expect(guidance).toEqual({
      confirmedSender: 'José',
      confirmedRecipient: null,
    });
    expect(normalizeConfirmationGuidance()).toEqual({
      confirmedSender: null,
      confirmedRecipient: null,
    });
    expect(isNormalizedConfirmationGuidance(guidance)).toBe(true);
  });

  it('rejects controls, overlength names, extra keys, and noncanonical stored values', () => {
    expect(() => normalizeConfirmationGuidance({
      confirmedSender: 'Alice\nBob',
    })).toThrow(/control/i);
    expect(() => normalizeConfirmationGuidance({
      confirmedRecipient: 'x'.repeat(121),
    })).toThrow(/120/);
    expect(() => normalizeConfirmationGuidance({
      confirmedSender: 'Alice',
      unexpected: true,
    })).toThrow();
    expect(isNormalizedConfirmationGuidance({
      confirmedSender: ' Alice ',
      confirmedRecipient: null,
    })).toBe(false);
  });

  it('builds one versioned intent identity from canonical guidance', () => {
    const currentTranscriptDigest = transcriptDigest(
      metadataInput.transcriptionText,
    );
    const first = confirmationIntentIdentity({
      letterId: metadataInput.letterId,
      primarySourceRevision: 7,
      transcriptDigest: currentTranscriptDigest,
      guidance: { confirmedSender: ' Jose\u0301 ' },
    });
    const equivalent = confirmationIntentIdentity({
      letterId: metadataInput.letterId,
      primarySourceRevision: 7,
      transcriptDigest: currentTranscriptDigest,
      guidance: { confirmedSender: 'José', confirmedRecipient: '' },
    });

    expect(first).toMatch(/^v1\.[0-9a-f]{64}$/);
    expect(equivalent).toBe(first);
    expect(confirmationIntentIdentity({
      letterId: metadataInput.letterId,
      primarySourceRevision: 8,
      transcriptDigest: currentTranscriptDigest,
      guidance: { confirmedSender: 'José' },
    })).not.toBe(first);
    expect(confirmationIntentIdentity({
      letterId: metadataInput.letterId,
      primarySourceRevision: 7,
      transcriptDigest: currentTranscriptDigest,
      guidance: { confirmedSender: 'Joseph' },
    })).not.toBe(first);
  });

  it.each([
    ['letterId', 'letter-2'],
    ['transcriptionText', 'Different transcript'],
    ['collectionCode', '010'],
    ['dateRaw', '19470811'],
    ['letterDate', null],
    ['extraContentTranscript', 'Different envelope'],
    ['extraContentStatus', 'VERIFIED'],
    ['extraContentJobStatus', 'FAILED'],
  ] as const)('changes when %s changes', (field, value) => {
    const baseline = metadataInputIdentity(metadataInput);
    const changed = metadataInputIdentity({
      ...metadataInput,
      [field]: value,
    });

    expect(baseline).toMatch(/^v1\.[0-9a-f]{64}$/);
    expect(changed).not.toBe(baseline);
  });
});

describe('durable metadata guidance', () => {
  it('builds a canonical versioned envelope', () => {
    expect(buildMetadataConfirmationGuidanceEnvelope({
      confirmationId,
      metadataInputIdentity: metadataInputIdentity(metadataInput),
      guidance: {
        confirmedSender: ' Alice ',
        confirmedRecipient: 'Bob',
      },
    })).toEqual({
      version: 1,
      confirmationId,
      metadataInputIdentity: metadataInputIdentity(metadataInput),
      confirmedSender: 'Alice',
      confirmedRecipient: 'Bob',
    });
  });

  it('resolves only confirmed fields from a fully current envelope', () => {
    const envelope = buildMetadataConfirmationGuidanceEnvelope({
      confirmationId,
      metadataInputIdentity: metadataInputIdentity(metadataInput),
      guidance: {
        confirmedSender: 'Alice',
        confirmedRecipient: '',
      },
    });

    expect(resolveMetadataConfirmationGuidance(
      resolutionSource(envelope),
    )).toEqual({ confirmedSender: 'Alice' });
  });

  it.each([
    ['invalid persisted value', resolutionSource({ malformed: true })],
    [
      'wrong envelope version',
      resolutionSource({
        ...buildMetadataConfirmationGuidanceEnvelope({
          confirmationId,
          metadataInputIdentity: metadataInputIdentity(metadataInput),
          guidance: { confirmedSender: 'Alice' },
        }),
        version: 2,
      }),
    ],
    [
      'noncanonical persisted name',
      resolutionSource({
        ...buildMetadataConfirmationGuidanceEnvelope({
          confirmationId,
          metadataInputIdentity: metadataInputIdentity(metadataInput),
          guidance: { confirmedSender: 'Alice' },
        }),
        confirmedSender: ' Alice ',
      }),
    ],
    [
      'different confirmation',
      {
        ...resolutionSource(buildMetadataConfirmationGuidanceEnvelope({
          confirmationId,
          metadataInputIdentity: metadataInputIdentity(metadataInput),
          guidance: { confirmedSender: 'Alice' },
        })),
        confirmationId: '932f4197-552a-4ea7-81af-d6fece854cc2',
      },
    ],
    [
      'changed primary source',
      {
        ...resolutionSource(buildMetadataConfirmationGuidanceEnvelope({
          confirmationId,
          metadataInputIdentity: metadataInputIdentity(metadataInput),
          guidance: { confirmedSender: 'Alice' },
        })),
        primarySourceRevision: 8,
      },
    ],
    [
      'changed transcript',
      resolutionSource(
        buildMetadataConfirmationGuidanceEnvelope({
          confirmationId,
          metadataInputIdentity: metadataInputIdentity(metadataInput),
          guidance: { confirmedSender: 'Alice' },
        }),
        {
          ...metadataInput,
          transcriptionText: 'Changed transcript',
        },
      ),
    ],
    [
      'changed metadata context',
      resolutionSource(
        buildMetadataConfirmationGuidanceEnvelope({
          confirmationId,
          metadataInputIdentity: metadataInputIdentity(metadataInput),
          guidance: { confirmedSender: 'Alice' },
        }),
        {
          ...metadataInput,
          extraContentTranscript: 'Changed envelope',
        },
      ),
    ],
  ])('ignores %s', (_label, source) => {
    expect(resolveMetadataConfirmationGuidance(source)).toBeUndefined();
  });

  it('returns undefined when the current envelope carries no guidance', () => {
    const envelope = buildMetadataConfirmationGuidanceEnvelope({
      confirmationId,
      metadataInputIdentity: metadataInputIdentity(metadataInput),
    });

    expect(resolveMetadataConfirmationGuidance(
      resolutionSource(envelope),
    )).toBeUndefined();
  });
});
