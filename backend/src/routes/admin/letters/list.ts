import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, collections, letters } from '../../../db/index.js';
import {
  adminLettersQuerySchema,
  fetchLetterWithRelatedAndTransform,
  queryAdminLetters,
} from '../../../services/letter-queries.js';
import { notesQuerySchema } from './shared.js';

const router = Router();

router.get('/letters', async (req, res, next) => {
  try {
    const query = adminLettersQuerySchema.parse(req.query);
    req.log.debug(
      { collection: query.collection, visibility: query.visibility, workflow: query.workflow, search: query.search, page: query.page },
      'Admin letters list query',
    );

    const result = await queryAdminLetters(query);

    req.log.info(
      { resultCount: result.letters.length, total: result.pagination.total, page: query.page },
      'Admin letters list completed',
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/letters/:letterId', async (req, res, next) => {
  try {
    const letterDTO = await fetchLetterWithRelatedAndTransform(req.params.letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    db.execute(sql`
      INSERT INTO letter_views (letter_id, last_opened_at) VALUES (${req.params.letterId}, now())
      ON CONFLICT (letter_id) DO UPDATE SET last_opened_at = now()
    `).catch(err => req.log.warn({ letterId: req.params.letterId, err }, 'Failed to update lastOpenedAt'));

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.get('/notes', async (req, res, next) => {
  try {
    const query = notesQuerySchema.parse(req.query);
    req.log.debug({ ...query }, 'Aggregate notes query');

    const rows = await db
      .select({
        id: letters.id,
        letterDate: letters.letterDate,
        sender: letters.sender,
        recipient: letters.recipient,
        aiNotes: letters.aiNotes,
        notes: letters.notes,
        updatedAt: letters.updatedAt,
        collectionCode: collections.collectionCode,
      })
      .from(letters)
      .innerJoin(collections, eq(letters.collectionId, collections.id))
      .where(sql`${letters.aiNotes} IS NOT NULL OR ${letters.notes} IS NOT NULL`);

    interface AggregatedNote {
      id: string;
      type: 'ai' | 'personal';
      content: string;
      category: string | null;
      priority: string | null;
      status: string | null;
      resolves_when: string | null;
      resolved_at: string | null;
      resolved_by: string | null;
      source: string;
      letterId: string;
      letterDate: string | null;
      collectionCode: string;
      sender: string | null;
      recipient: string | null;
      updatedAt: string | null;
    }

    const allNotes: AggregatedNote[] = [];

    for (const row of rows) {
      const personalNote = typeof row.notes === 'string' ? row.notes.trim() : '';
      if (personalNote) {
        allNotes.push({
          id: `personal-${row.id}`,
          type: 'personal',
          content: personalNote,
          category: null,
          priority: null,
          status: null,
          resolves_when: null,
          resolved_at: null,
          resolved_by: null,
          source: 'personal',
          letterId: row.id,
          letterDate: row.letterDate,
          collectionCode: row.collectionCode,
          sender: row.sender,
          recipient: row.recipient,
          updatedAt: row.updatedAt?.toISOString() ?? null,
        });
      }

      const rawNotes = row.aiNotes;
      if (!Array.isArray(rawNotes)) continue;

      for (const note of rawNotes) {
        if (!note || typeof note !== 'object' || !('id' in note) || !('content' in note)) continue;

        const n = note as Record<string, unknown>;
        allNotes.push({
          id: String(n.id ?? ''),
          type: 'ai',
          content: String(n.content ?? ''),
          category: String(n.category ?? 'context'),
          priority: String(n.priority ?? 'medium'),
          status: String(n.status ?? 'open'),
          resolves_when: n.resolves_when != null ? String(n.resolves_when) : null,
          resolved_at: n.resolved_at != null ? String(n.resolved_at) : null,
          resolved_by: n.resolved_by != null ? String(n.resolved_by) : null,
          source: String(n.source ?? 'ai'),
          letterId: row.id,
          letterDate: row.letterDate,
          collectionCode: row.collectionCode,
          sender: row.sender,
          recipient: row.recipient,
          updatedAt: row.updatedAt?.toISOString() ?? null,
        });
      }
    }

    const counts = {
      open: allNotes.filter(n => n.type === 'ai' && n.status === 'open').length,
      resolved: allNotes.filter(n => n.type === 'ai' && n.status === 'resolved').length,
      dismissed: allNotes.filter(n => n.type === 'ai' && n.status === 'dismissed').length,
      ai: allNotes.filter(n => n.type === 'ai').length,
      personal: allNotes.filter(n => n.type === 'personal').length,
    };

    let filtered = allNotes;

    if (query.type) {
      filtered = filtered.filter(n => n.type === query.type);
    }
    if (query.status) {
      filtered = filtered.filter(n => n.type === 'ai' && n.status === query.status);
    }
    if (query.priority) {
      filtered = filtered.filter(n => n.type === 'ai' && n.priority === query.priority);
    }
    if (query.category) {
      filtered = filtered.filter(n => n.type === 'ai' && n.category === query.category);
    }
    if (query.search) {
      const lower = query.search.toLowerCase();
      filtered = filtered.filter((n) => {
        const haystack = [
          n.content,
          n.category,
          n.collectionCode,
          n.sender,
          n.recipient,
          n.letterDate,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(lower);
      });
    }

    const STATUS_ORDER: Record<string, number> = { open: 0, personal: 1, resolved: 2, dismissed: 3 };
    const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

    filtered.sort((a, b) => {
      const aBucket = STATUS_ORDER[a.type === 'personal' ? 'personal' : (a.status ?? 'dismissed')] ?? 4;
      const bBucket = STATUS_ORDER[b.type === 'personal' ? 'personal' : (b.status ?? 'dismissed')] ?? 4;
      if (aBucket !== bBucket) return aBucket - bBucket;

      if (a.type === 'ai' && b.type === 'ai') {
        const priorityDiff = (PRIORITY_ORDER[a.priority ?? 'low'] ?? 3) - (PRIORITY_ORDER[b.priority ?? 'low'] ?? 3);
        if (priorityDiff !== 0) return priorityDiff;
      }

      if (a.updatedAt && b.updatedAt) {
        const updatedAtDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        if (!Number.isNaN(updatedAtDiff) && updatedAtDiff !== 0) return updatedAtDiff;
      }

      if (a.letterDate && b.letterDate) {
        const letterDateDiff = String(b.letterDate).localeCompare(String(a.letterDate));
        if (letterDateDiff !== 0) return letterDateDiff;
      }

      return a.letterId.localeCompare(b.letterId);
    });

    const total = filtered.length;
    const paginated = filtered
      .slice(query.offset, query.offset + query.limit)
      .map(({ updatedAt: _updatedAt, ...note }) => note);

    req.log.info({ total, returned: paginated.length }, 'Aggregate notes query completed');

    res.json({ notes: paginated, total, counts });
  } catch (error) {
    next(error);
  }
});

export default router;
