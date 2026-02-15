import { Router } from 'express';
import {
  extractPlaceThemesFromNotes,
  getCanonicalPlaceById,
  getLettersForPlaceEnriched,
  stripPlaceThemesFromNotes,
} from '../services/entities.js';
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
    const letters = allLetters.filter(l => l.visibility === 'PUBLISHED');

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
        aliases: place.aliases || [],
        placeType: place.placeType,
        notes: stripPlaceThemesFromNotes(place.notes),
        themes: extractPlaceThemesFromNotes(place.notes),
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
