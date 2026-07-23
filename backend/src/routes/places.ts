import { Router } from 'express';
import { getCanonicalPlaceById, getLettersForPlaceEnriched } from '../services/entities.js';
import {
  isPublicCatalogueLetterType,
  retainPublicCatalogueRepresentatives,
} from '../services/public-catalogue-unit.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'public-places' });
const router = Router();

/**
 * GET /places/:id - Get public place detail
 *
 * Returns place info with notes and letter list.
 * Only returns published letters.
 */
router.get('/places/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    log.debug({ placeId: id }, 'Fetching public place detail');

    const place = await getCanonicalPlaceById(id);
    if (!place) {
      res.status(404).json({ error: 'Place not found' });
      return;
    }

    // Get letters (only published ones for public view)
    const allLetters = await getLettersForPlaceEnriched(id);
    const letters = retainPublicCatalogueRepresentatives(
      allLetters
        .filter(
          (letter) => letter.visibility === 'PUBLISHED'
            && letter.metadataPublished
            && letter.entityProjectionTrusted === true
            && isPublicCatalogueLetterType(letter.type),
        )
        .map((letter) => ({ ...letter, id: letter.letterId })),
    );

    // Canonical places have no independent publication flag. A place only
    // becomes public through at least one metadata-published letter.
    if (letters.length === 0) {
      res.status(404).json({ error: 'Place not found' });
      return;
    }

    // Calculate stats by role
    const stats = {
      writtenFrom: letters.filter(l => l.role === 'written_from').length,
      mentioned: letters.filter(l => l.role === 'mentioned').length,
      destination: letters.filter(l => l.role === 'destination').length,
      total: letters.length,
    };

    // Sort letters chronologically
    const sortedLetters = [...letters].sort((a, b) => {
      const dateA = a.letterDate || a.dateRaw;
      const dateB = b.letterDate || b.dateRaw;
      return String(dateA).localeCompare(String(dateB));
    });

    res.json({
      place: {
        id: place.id,
        canonicalName: place.canonicalName,
        aliases: [],
        notes: null,
        themes: [],
      },
      stats,
      letters: sortedLetters.map(l => ({
        id: l.letterId,
        dateRaw: l.dateRaw,
        letterDate: l.letterDate,
        role: l.role,
        sender: l.sender,
        recipient: l.recipient,
        hook: l.hook,
        summary: l.summary,
      })),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
