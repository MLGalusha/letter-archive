import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { getRows } from '../../services/letter-queries.js';

const router = Router();

const baseUsageQuerySchema = z.object({
  collectionCode: z.string().trim().min(1).max(64).optional(),
});

const summaryQuerySchema = baseUsageQuerySchema.extend({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

const callsQuerySchema = baseUsageQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  callType: z.string().trim().min(1).optional(),
  letterId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const analyticsQuerySchema = baseUsageQuerySchema.extend({
  months: z.coerce.number().int().min(1).max(24).default(6),
});

type UsageFilterParams = {
  months?: number;
  collectionCode?: string;
  callType?: string;
  letterId?: string;
  from?: Date;
  to?: Date;
};

function buildUsageSqlFilters(params: UsageFilterParams) {
  return sql`
    ${params.months != null ? sql`AND u.created_at >= now() - make_interval(months => ${params.months})` : sql``}
    ${params.collectionCode ? sql`AND c.collection_code = ${params.collectionCode}` : sql``}
    ${params.callType ? sql`AND u.call_type = ${params.callType}` : sql``}
    ${params.letterId ? sql`AND u.letter_id = ${params.letterId}` : sql``}
    ${params.from ? sql`AND u.created_at >= ${params.from}` : sql``}
    ${params.to ? sql`AND u.created_at <= ${params.to}` : sql``}
  `;
}

function buildAnalyticsCte(params: { months: number; collectionCode?: string }) {
  return sql`
    WITH filtered_usage AS (
      SELECT
        u.id,
        u.letter_id,
        u.call_type,
        u.model,
        u.input_tokens,
        u.output_tokens,
        u.total_tokens,
        u.input_cost,
        u.output_cost,
        u.total_cost,
        u.duration_ms,
        u.created_at,
        l.collection_id,
        l.date_raw,
        l.sender,
        l.recipient,
        c.collection_code,
        c.title AS collection_title
      FROM api_usage_logs u
      LEFT JOIN letters l ON l.id = u.letter_id
      LEFT JOIN collections c ON c.id = l.collection_id
      WHERE TRUE
      ${buildUsageSqlFilters({ months: params.months, collectionCode: params.collectionCode })}
    ),
    page_counts AS (
      SELECT
        lp.letter_id,
        COUNT(*)::int AS page_count
      FROM letter_pages lp
      GROUP BY lp.letter_id
    ),
    letter_page_totals AS (
      SELECT DISTINCT
        fu.letter_id,
        COALESCE(pc.page_count, 0)::int AS page_count
      FROM filtered_usage fu
      LEFT JOIN page_counts pc ON pc.letter_id = fu.letter_id
      WHERE fu.letter_id IS NOT NULL
    )
  `;
}

// ============================================================================
// GET /usage/summary — Monthly aggregates with cost breakdown by call type
// ============================================================================

router.get('/usage/summary', async (req, res) => {
  try {
    const parsed = summaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }

    const { months, collectionCode } = parsed.data;

    const rowsResult = await db.execute(sql`
      SELECT
        to_char(u.created_at, 'YYYY-MM') AS month,
        u.call_type,
        COUNT(*)::int AS call_count,
        COALESCE(SUM(u.input_tokens), 0)::int AS total_input_tokens,
        COALESCE(SUM(u.output_tokens), 0)::int AS total_output_tokens,
        COALESCE(SUM(u.total_tokens), 0)::int AS total_tokens,
        COALESCE(SUM(u.total_cost::numeric), 0)::text AS total_cost
      FROM api_usage_logs u
      LEFT JOIN letters l ON l.id = u.letter_id
      LEFT JOIN collections c ON c.id = l.collection_id
      WHERE TRUE
      ${buildUsageSqlFilters({ months, collectionCode })}
      GROUP BY to_char(u.created_at, 'YYYY-MM'), u.call_type
      ORDER BY to_char(u.created_at, 'YYYY-MM') DESC
    `);

    const rows = getRows<{
      month: string;
      call_type: string;
      call_count: number | string;
      total_input_tokens: number | string;
      total_output_tokens: number | string;
      total_tokens: number | string;
      total_cost: string | null;
    }>(rowsResult);

    const byMonth: Record<
      string,
      {
        month: string;
        types: Record<string, {
          callCount: number;
          totalInputTokens: number;
          totalOutputTokens: number;
          totalTokens: number;
          totalCost: string;
        }>;
        totalCost: string;
        totalCalls: number;
      }
    > = {};

    for (const row of rows) {
      if (!byMonth[row.month]) {
        byMonth[row.month] = {
          month: row.month,
          types: {},
          totalCost: '0',
          totalCalls: 0,
        };
      }

      const entry = byMonth[row.month];
      const rowCost = row.total_cost ?? '0';
      entry.types[row.call_type] = {
        callCount: Number(row.call_count ?? 0),
        totalInputTokens: Number(row.total_input_tokens ?? 0),
        totalOutputTokens: Number(row.total_output_tokens ?? 0),
        totalTokens: Number(row.total_tokens ?? 0),
        totalCost: rowCost,
      };
      entry.totalCalls += Number(row.call_count ?? 0);
      entry.totalCost = (
        Number(entry.totalCost) + Number(rowCost)
      ).toFixed(6);
    }

    res.json(Object.values(byMonth));
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch usage summary');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /usage/calls — Per-call history with pagination and filters
// ============================================================================

router.get('/usage/calls', async (req, res) => {
  try {
    const parsed = callsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }

    const { page, limit, callType, letterId, collectionCode, from, to } = parsed.data;
    const offset = (page - 1) * limit;
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;

    const [rowsResult, totalResult] = await Promise.all([
      db.execute(sql`
        SELECT
          u.id,
          u.letter_id AS "letterId",
          u.call_type AS "callType",
          u.model,
          u.input_tokens AS "inputTokens",
          u.output_tokens AS "outputTokens",
          u.total_tokens AS "totalTokens",
          u.input_cost AS "inputCost",
          u.output_cost AS "outputCost",
          u.total_cost AS "totalCost",
          u.duration_ms AS "durationMs",
          u.created_at AS "createdAt",
          c.collection_code AS "collectionCode",
          c.title AS "collectionTitle",
          l.date_raw AS "dateRaw",
          l.sender,
          l.recipient
        FROM api_usage_logs u
        LEFT JOIN letters l ON l.id = u.letter_id
        LEFT JOIN collections c ON c.id = l.collection_id
        WHERE TRUE
        ${buildUsageSqlFilters({ collectionCode, callType, letterId, from: fromDate, to: toDate })}
        ORDER BY u.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM api_usage_logs u
        LEFT JOIN letters l ON l.id = u.letter_id
        LEFT JOIN collections c ON c.id = l.collection_id
        WHERE TRUE
        ${buildUsageSqlFilters({ collectionCode, callType, letterId, from: fromDate, to: toDate })}
      `),
    ]);

    const rows = getRows(rowsResult);
    const [{ total = 0 } = { total: 0 }] = getRows<{ total: number | string }>(totalResult);
    const numericTotal = Number(total ?? 0);

    res.json({
      calls: rows,
      pagination: {
        page,
        limit,
        total: numericTotal,
        totalPages: Math.ceil(numericTotal / limit),
      },
    });
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch usage calls');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /usage/totals — Total spend + this month's spend
// ============================================================================

router.get('/usage/totals', async (req, res) => {
  try {
    const parsed = baseUsageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }

    const { collectionCode } = parsed.data;

    const [allTimeResult, thisMonthResult] = await Promise.all([
      db.execute(sql`
        SELECT
          COALESCE(SUM(u.total_cost::numeric), 0)::text AS total_cost,
          COUNT(*)::int AS total_calls,
          COALESCE(SUM(u.total_tokens), 0)::int AS total_tokens
        FROM api_usage_logs u
        LEFT JOIN letters l ON l.id = u.letter_id
        LEFT JOIN collections c ON c.id = l.collection_id
        WHERE TRUE
        ${buildUsageSqlFilters({ collectionCode })}
      `),
      db.execute(sql`
        SELECT
          COALESCE(SUM(u.total_cost::numeric), 0)::text AS total_cost,
          COUNT(*)::int AS total_calls,
          COALESCE(SUM(u.total_tokens), 0)::int AS total_tokens
        FROM api_usage_logs u
        LEFT JOIN letters l ON l.id = u.letter_id
        LEFT JOIN collections c ON c.id = l.collection_id
        WHERE TRUE
          AND u.created_at >= date_trunc('month', now())
        ${buildUsageSqlFilters({ collectionCode })}
      `),
    ]);

    const [allTime] = getRows<{
      total_cost: string | null;
      total_calls: number | string;
      total_tokens: number | string;
    }>(allTimeResult);
    const [thisMonth] = getRows<{
      total_cost: string | null;
      total_calls: number | string;
      total_tokens: number | string;
    }>(thisMonthResult);

    res.json({
      allTime: {
        totalCost: allTime?.total_cost ?? '0',
        totalCalls: Number(allTime?.total_calls ?? 0),
        totalTokens: Number(allTime?.total_tokens ?? 0),
      },
      thisMonth: {
        totalCost: thisMonth?.total_cost ?? '0',
        totalCalls: Number(thisMonth?.total_calls ?? 0),
        totalTokens: Number(thisMonth?.total_tokens ?? 0),
      },
    });
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch usage totals');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /usage/analytics — Efficiency, collection spend, and outlier views
// ============================================================================

router.get('/usage/analytics', async (req, res) => {
  try {
    const parsed = analyticsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }

    const { months, collectionCode } = parsed.data;

    const [summaryResult, byCollectionResult, byTypeResult, topLettersResult, topRequestsResult] = await Promise.all([
      db.execute(sql`
        ${buildAnalyticsCte({ months, collectionCode })}
        SELECT
          COALESCE(SUM(fu.total_cost::numeric), 0)::text AS total_cost,
          COUNT(*)::int AS total_calls,
          COALESCE(SUM(fu.total_tokens), 0)::int AS total_tokens,
          COUNT(DISTINCT fu.letter_id)::int AS total_letters,
          COUNT(DISTINCT fu.collection_id)::int AS total_collections,
          COALESCE((SELECT SUM(page_count) FROM letter_page_totals), 0)::int AS total_pages,
          ROUND(COALESCE(AVG(fu.duration_ms), 0)::numeric, 1)::float AS avg_duration_ms,
          COALESCE((SUM(fu.total_cost::numeric) / NULLIF(COUNT(*), 0)), 0)::text AS avg_cost_per_request,
          COALESCE((SUM(fu.total_cost::numeric) / NULLIF(COUNT(DISTINCT fu.letter_id), 0)), 0)::text AS avg_cost_per_letter,
          COALESCE((SUM(fu.total_cost::numeric) / NULLIF((SELECT SUM(page_count) FROM letter_page_totals), 0)), 0)::text AS avg_cost_per_page,
          ROUND(COALESCE(AVG(fu.total_tokens), 0)::numeric, 1)::float AS avg_tokens_per_request,
          COALESCE(SUM(CASE WHEN fu.letter_id IS NULL THEN fu.total_cost::numeric ELSE 0 END), 0)::text AS unattributed_cost,
          COUNT(*) FILTER (WHERE fu.letter_id IS NULL)::int AS unattributed_calls
        FROM filtered_usage fu
      `),
      db.execute(sql`
        ${buildAnalyticsCte({ months, collectionCode })},
        collection_page_totals AS (
          SELECT
            touched.collection_id,
            COALESCE(SUM(lpt.page_count), 0)::int AS page_count
          FROM (
            SELECT DISTINCT
              fu.collection_id,
              fu.letter_id
            FROM filtered_usage fu
            WHERE fu.collection_id IS NOT NULL
              AND fu.letter_id IS NOT NULL
          ) touched
          LEFT JOIN letter_page_totals lpt ON lpt.letter_id = touched.letter_id
          GROUP BY touched.collection_id
        )
        SELECT
          fu.collection_code,
          MAX(fu.collection_title) AS collection_title,
          COALESCE(SUM(fu.total_cost::numeric), 0)::text AS total_cost,
          COUNT(*)::int AS total_calls,
          COALESCE(SUM(fu.total_tokens), 0)::int AS total_tokens,
          COUNT(DISTINCT fu.letter_id)::int AS distinct_letters,
          COALESCE(cpt.page_count, 0)::int AS page_count,
          COALESCE((SUM(fu.total_cost::numeric) / NULLIF(COUNT(*), 0)), 0)::text AS avg_cost_per_request,
          COALESCE((SUM(fu.total_cost::numeric) / NULLIF(COUNT(DISTINCT fu.letter_id), 0)), 0)::text AS avg_cost_per_letter,
          ROUND(COALESCE(AVG(fu.duration_ms), 0)::numeric, 1)::float AS avg_duration_ms
        FROM filtered_usage fu
        LEFT JOIN collection_page_totals cpt ON cpt.collection_id = fu.collection_id
        WHERE fu.collection_code IS NOT NULL
        GROUP BY fu.collection_id, fu.collection_code, cpt.page_count
        ORDER BY SUM(fu.total_cost::numeric) DESC, COUNT(*) DESC
      `),
      db.execute(sql`
        ${buildAnalyticsCte({ months, collectionCode })}
        SELECT
          fu.call_type,
          COALESCE(SUM(fu.total_cost::numeric), 0)::text AS total_cost,
          COUNT(*)::int AS total_calls,
          COALESCE(SUM(fu.total_tokens), 0)::int AS total_tokens,
          COALESCE((SUM(fu.total_cost::numeric) / NULLIF(COUNT(*), 0)), 0)::text AS avg_cost_per_request,
          ROUND(COALESCE(AVG(fu.total_tokens), 0)::numeric, 1)::float AS avg_tokens_per_request,
          ROUND(COALESCE(AVG(fu.duration_ms), 0)::numeric, 1)::float AS avg_duration_ms,
          COALESCE(MAX(fu.total_cost::numeric), 0)::text AS max_cost
        FROM filtered_usage fu
        GROUP BY fu.call_type
        ORDER BY SUM(fu.total_cost::numeric) DESC, COUNT(*) DESC
      `),
      db.execute(sql`
        ${buildAnalyticsCte({ months, collectionCode })}
        SELECT
          fu.letter_id,
          fu.collection_code,
          fu.date_raw,
          fu.sender,
          fu.recipient,
          COALESCE(SUM(fu.total_cost::numeric), 0)::text AS total_cost,
          COUNT(*)::int AS total_calls,
          COALESCE(SUM(fu.total_tokens), 0)::int AS total_tokens,
          COALESCE(pc.page_count, 0)::int AS page_count,
          COALESCE((SUM(fu.total_cost::numeric) / NULLIF(COUNT(*), 0)), 0)::text AS avg_cost_per_request,
          CASE
            WHEN COALESCE(pc.page_count, 0) > 0 THEN (SUM(fu.total_cost::numeric) / pc.page_count)::text
            ELSE NULL
          END AS cost_per_page
        FROM filtered_usage fu
        LEFT JOIN page_counts pc ON pc.letter_id = fu.letter_id
        WHERE fu.letter_id IS NOT NULL
        GROUP BY fu.letter_id, fu.collection_code, fu.date_raw, fu.sender, fu.recipient, pc.page_count
        ORDER BY SUM(fu.total_cost::numeric) DESC, COUNT(*) DESC
        LIMIT 10
      `),
      db.execute(sql`
        ${buildAnalyticsCte({ months, collectionCode })}
        SELECT
          fu.id,
          fu.letter_id,
          fu.collection_code,
          fu.collection_title,
          fu.date_raw,
          fu.sender,
          fu.recipient,
          fu.call_type,
          fu.model,
          fu.total_tokens,
          fu.total_cost,
          fu.duration_ms,
          fu.created_at
        FROM filtered_usage fu
        ORDER BY fu.total_cost::numeric DESC, fu.created_at DESC
        LIMIT 10
      `),
    ]);

    const [summary] = getRows<{
      total_cost: string | null;
      total_calls: number | string;
      total_tokens: number | string;
      total_letters: number | string;
      total_collections: number | string;
      total_pages: number | string;
      avg_duration_ms: number | string;
      avg_cost_per_request: string | null;
      avg_cost_per_letter: string | null;
      avg_cost_per_page: string | null;
      avg_tokens_per_request: number | string;
      unattributed_cost: string | null;
      unattributed_calls: number | string;
    }>(summaryResult);

    const byCollection = getRows<{
      collection_code: string;
      collection_title: string | null;
      total_cost: string | null;
      total_calls: number | string;
      total_tokens: number | string;
      distinct_letters: number | string;
      page_count: number | string;
      avg_cost_per_request: string | null;
      avg_cost_per_letter: string | null;
      avg_duration_ms: number | string;
    }>(byCollectionResult).map((row) => ({
      collectionCode: row.collection_code,
      collectionTitle: row.collection_title,
      totalCost: row.total_cost ?? '0',
      totalCalls: Number(row.total_calls ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      distinctLetters: Number(row.distinct_letters ?? 0),
      pageCount: Number(row.page_count ?? 0),
      avgCostPerRequest: row.avg_cost_per_request ?? '0',
      avgCostPerLetter: row.avg_cost_per_letter ?? '0',
      avgDurationMs: Number(row.avg_duration_ms ?? 0),
    }));

    const byType = getRows<{
      call_type: string;
      total_cost: string | null;
      total_calls: number | string;
      total_tokens: number | string;
      avg_cost_per_request: string | null;
      avg_tokens_per_request: number | string;
      avg_duration_ms: number | string;
      max_cost: string | null;
    }>(byTypeResult).map((row) => ({
      callType: row.call_type,
      totalCost: row.total_cost ?? '0',
      totalCalls: Number(row.total_calls ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      avgCostPerRequest: row.avg_cost_per_request ?? '0',
      avgTokensPerRequest: Number(row.avg_tokens_per_request ?? 0),
      avgDurationMs: Number(row.avg_duration_ms ?? 0),
      maxCost: row.max_cost ?? '0',
    }));

    const topLetters = getRows<{
      letter_id: string;
      collection_code: string | null;
      date_raw: string | null;
      sender: string | null;
      recipient: string | null;
      total_cost: string | null;
      total_calls: number | string;
      total_tokens: number | string;
      page_count: number | string;
      avg_cost_per_request: string | null;
      cost_per_page: string | null;
    }>(topLettersResult).map((row) => ({
      letterId: row.letter_id,
      collectionCode: row.collection_code,
      dateRaw: row.date_raw,
      sender: row.sender,
      recipient: row.recipient,
      totalCost: row.total_cost ?? '0',
      totalCalls: Number(row.total_calls ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      pageCount: Number(row.page_count ?? 0),
      avgCostPerRequest: row.avg_cost_per_request ?? '0',
      costPerPage: row.cost_per_page,
    }));

    const topRequests = getRows<{
      id: string;
      letter_id: string | null;
      collection_code: string | null;
      collection_title: string | null;
      date_raw: string | null;
      sender: string | null;
      recipient: string | null;
      call_type: string;
      model: string;
      total_tokens: number | string;
      total_cost: string;
      duration_ms: number | string | null;
      created_at: Date | string;
    }>(topRequestsResult).map((row) => ({
      id: row.id,
      letterId: row.letter_id,
      collectionCode: row.collection_code,
      collectionTitle: row.collection_title,
      dateRaw: row.date_raw,
      sender: row.sender,
      recipient: row.recipient,
      callType: row.call_type,
      model: row.model,
      totalTokens: Number(row.total_tokens ?? 0),
      totalCost: row.total_cost,
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      createdAt: row.created_at,
    }));

    res.json({
      summary: {
        totalCost: summary?.total_cost ?? '0',
        totalCalls: Number(summary?.total_calls ?? 0),
        totalTokens: Number(summary?.total_tokens ?? 0),
        totalLetters: Number(summary?.total_letters ?? 0),
        totalCollections: Number(summary?.total_collections ?? 0),
        totalPages: Number(summary?.total_pages ?? 0),
        avgDurationMs: Number(summary?.avg_duration_ms ?? 0),
        avgCostPerRequest: summary?.avg_cost_per_request ?? '0',
        avgCostPerLetter: summary?.avg_cost_per_letter ?? '0',
        avgCostPerPage: summary?.avg_cost_per_page ?? '0',
        avgTokensPerRequest: Number(summary?.avg_tokens_per_request ?? 0),
        unattributedCost: summary?.unattributed_cost ?? '0',
        unattributedCalls: Number(summary?.unattributed_calls ?? 0),
      },
      byCollection,
      byType,
      topLetters,
      topRequests,
    });
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch usage analytics');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
