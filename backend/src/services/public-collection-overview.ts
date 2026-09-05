import type { PublicLetter } from './public-read-model.js';

/** Collection browsing needs previews and image identities, not reading payloads. */
export function toPublicCollectionItem(letter: PublicLetter) {
  const { sender, recipient, date, dateRaw, hook, verified } = letter.metadata;
  return {
    id: letter.id,
    images: letter.images,
    metadata: { sender, recipient, date, dateRaw, hook, verified },
    transcriptStatus: letter.transcriptStatus,
    metadataContentStatus: letter.metadataContentStatus,
    photoDescription: letter.photoDescription,
  };
}
