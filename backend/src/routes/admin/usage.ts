import { Router } from 'express';
import { z } from 'zod';
import { sql, eq, and, gte, lte, desc, count, sum } from 'drizzle-orm';
import { db, apiUsageLogs } from '../../db/index.js';

const router = Router();

// ============================================================================
// GET /usage/summary — Monthly aggregates with cost breakdown by call type
// ============================================================================

router.get('/usage/summary', async (req, res) => {
  try {
    const months = Math.min(Number(req.query.months) || 6, 24);

    const rows = await db
      .select({
        month: sql<string>`to_char(${apiUsageLogs.createdAt}, 'YYYY-MM')`.as('month'),
        callType: apiUsageLogs.callType,
        callCount: count().as('call_count'),
        totalInputTokens: sum(apiUsageLogs.inputTokens).as('total_input_tokens'),
        totalOutputTokens: sum(apiUsageLogs.outputTokens).as('total_output_tokens'),
        totalTokens: sum(apiUsageLogs.totalTokens).as('total_tokens'),
        totalCost: sql<string>`SUM(${apiUsageLogs.totalCost}::numeric)::text`.as('total_cost'),
      })
      .from(apiUsageLogs)
      .where(
        gte(
          apiUsageLogs.createdAt,
          sql`now() - make_interval(months => ${months})`,
        ),
      )
      .groupBy(
        sql`to_char(${apiUsageLogs.createdAt}, 'YYYY-MM')`,
        apiUsageLogs.callType,
      )
      .orderBy(
        sql`to_char(${apiUsageLogs.createdAt}, 'YYYY-MM') DESC`,
      );

    // Group by month for easier frontend consumption
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
      entry.types[row.callType] = {
        callCount: Number(row.callCount),
        totalInputTokens: Number(row.totalInputTokens ?? 0),
        totalOutputTokens: Number(row.totalOutputTokens ?? 0),
        totalTokens: Number(row.totalTokens ?? 0),
        totalCost: row.totalCost ?? '0',
      };
      entry.totalCalls += Number(row.callCount);
      entry.totalCost = (
        parseFloat(entry.totalCost) + parseFloat(row.totalCost ?? '0')
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

const callsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  callType: z.string().optional(),
  letterId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

router.get('/usage/calls', async (req, res) => {
  try {
    const parsed = callsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }

    const { page, limit, callType, letterId, from, to } = parsed.data;
    const offset = (page - 1) * limit;

    // Build conditions
    const conditions = [];
    if (callType) {
      conditions.push(eq(apiUsageLogs.callType, callType));
    }
    if (letterId) {
      conditions.push(eq(apiUsageLogs.letterId, letterId));
    }
    if (from) {
      conditions.push(gte(apiUsageLogs.createdAt, new Date(from)));
    }
    if (to) {
      conditions.push(lte(apiUsageLogs.createdAt, new Date(to)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ value: total }]] = await Promise.all([
      db
        .select()
        .from(apiUsageLogs)
        .where(where)
        .orderBy(desc(apiUsageLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ value: count() }).from(apiUsageLogs).where(where),
    ]);

    res.json({
      calls: rows,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / limit),
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
    const [allTimeRows, thisMonthRows] = await Promise.all([
      db
        .select({
          totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.totalCost}::numeric), 0)::text`.as('total_cost'),
          totalCalls: count().as('total_calls'),
          totalTokens: sql<string>`COALESCE(SUM(${apiUsageLogs.totalTokens}), 0)::text`.as('total_tokens'),
        })
        .from(apiUsageLogs),
      db
        .select({
          totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.totalCost}::numeric), 0)::text`.as('total_cost'),
          totalCalls: count().as('total_calls'),
          totalTokens: sql<string>`COALESCE(SUM(${apiUsageLogs.totalTokens}), 0)::text`.as('total_tokens'),
        })
        .from(apiUsageLogs)
        .where(
          gte(
            apiUsageLogs.createdAt,
            sql`date_trunc('month', now())`,
          ),
        ),
    ]);

    const allTime = allTimeRows[0];
    const thisMonth = thisMonthRows[0];

    res.json({
      allTime: {
        totalCost: allTime?.totalCost ?? '0',
        totalCalls: Number(allTime?.totalCalls ?? 0),
        totalTokens: Number(allTime?.totalTokens ?? 0),
      },
      thisMonth: {
        totalCost: thisMonth?.totalCost ?? '0',
        totalCalls: Number(thisMonth?.totalCalls ?? 0),
        totalTokens: Number(thisMonth?.totalTokens ?? 0),
      },
    });
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch usage totals');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
