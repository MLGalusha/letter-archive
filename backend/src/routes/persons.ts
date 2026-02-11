import { Router } from 'express';
import {
  getCanonicalPersonById,
  getLettersForPersonEnriched,
  getRelationshipsForPerson,
} from '../services/entities.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'public-persons' });
const router = Router();

/**
 * GET /persons/:id - Get public person detail
 *
 * Returns person info with biography, relationships, and letter list.
 * Only returns published letters.
 */
router.get('/persons/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    log.debug({ personId: id }, 'Fetching public person detail');

    const person = await getCanonicalPersonById(id);
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    // Get relationships
    const relationships = await getRelationshipsForPerson(id);

    // Get letters (only published ones for public view)
    const allLetters = await getLettersForPersonEnriched(id);
    const letters = allLetters.filter(l => l.visibility === 'PUBLISHED');

    // Calculate stats
    const stats = {
      asSender: letters.filter(l => l.role === 'sender').length,
      asRecipient: letters.filter(l => l.role === 'recipient').length,
      asMentioned: letters.filter(l => l.role === 'mentioned').length,
      total: letters.length,
    };

    // Sort letters chronologically
    const sortedLetters = [...letters].sort((a, b) => {
      const dateA = a.letterDate || a.dateRaw;
      const dateB = b.letterDate || b.dateRaw;
      return String(dateA).localeCompare(String(dateB));
    });

    res.json({
      person: {
        id: person.id,
        canonicalName: person.canonicalName,
        aliases: person.aliases || [],
        biography: person.biography,
        biographyStatus: person.biographyStatus,
      },
      relationships: relationships.map(r => ({
        id: r.id,
        relatedPersonId: r.personAId === id ? r.personBId : r.personAId,
        relatedPersonName: r.personAId === id ? r.personBName : r.personAName,
        relationshipType: r.relationshipType,
      })),
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
