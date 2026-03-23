import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUsageAnalytics, getUsageCalls, getUsageSummary, getUsageTotals } from '../usage';

const fetchMock = vi.fn();
let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  consoleDebugSpy.mockRestore();
  consoleInfoSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe('admin usage api', () => {
  it('flattens totals into the shape the usage page expects', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      allTime: {
        totalCost: '12.345600',
        totalCalls: 42,
        totalTokens: 123456,
      },
      thisMonth: {
        totalCost: '1.230000',
        totalCalls: 4,
        totalTokens: 4567,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getUsageTotals({ collectionCode: '009' })).resolves.toEqual({
      totalCost: 12.3456,
      totalCalls: 42,
      totalTokens: 123456,
      thisMonthCost: 1.23,
      thisMonthCalls: 4,
      thisMonthTokens: 4567,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/usage/totals?collectionCode=009',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  it('normalizes summary periods and cost breakdowns from the backend contract', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      {
        month: '2026-03',
        totalCost: '2.250000',
        totalCalls: 5,
        types: {
          transcription: {
            callCount: 3,
            totalInputTokens: 1000,
            totalOutputTokens: 500,
            totalTokens: 1500,
            totalCost: '1.500000',
          },
          metadata: {
            callCount: 2,
            totalInputTokens: 400,
            totalOutputTokens: 100,
            totalTokens: 500,
            totalCost: '0.750000',
          },
        },
      },
      {
        month: '2026-02',
        totalCost: '0.500000',
        totalCalls: 1,
        types: {
          entity_extraction: {
            callCount: 1,
            totalInputTokens: 200,
            totalOutputTokens: 50,
            totalTokens: 250,
            totalCost: '0.500000',
          },
        },
      },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getUsageSummary({ months: 6, collectionCode: '009' })).resolves.toEqual([
      {
        period: '2026-02',
        totalCost: 0.5,
        totalCalls: 1,
        inputTokens: 200,
        outputTokens: 50,
        byType: {
          entity_extraction: {
            cost: 0.5,
            calls: 1,
          },
        },
      },
      {
        period: '2026-03',
        totalCost: 2.25,
        totalCalls: 5,
        inputTokens: 1400,
        outputTokens: 600,
        byType: {
          transcription: {
            cost: 1.5,
            calls: 3,
          },
          metadata: {
            cost: 0.75,
            calls: 2,
          },
        },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/usage/summary?months=6&collectionCode=009',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  it('converts offset filters into the backend paging and date query contract', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      calls: [
        {
          id: 'call-1',
          letterId: 'letter-1',
          callType: 'transcription',
          model: 'gpt-5.4',
          inputTokens: 123,
          outputTokens: 45,
          totalTokens: 168,
          inputCost: '0.000308',
          outputCost: '0.000450',
          totalCost: '0.000758',
          durationMs: 900,
          createdAt: '2026-03-20T15:30:00.000Z',
          collectionCode: '009',
          collectionTitle: 'Letters Home',
          dateRaw: '19470810',
          sender: 'Alice',
          recipient: 'Bob',
        },
      ],
      pagination: {
        page: 2,
        limit: 25,
        total: 41,
        totalPages: 2,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getUsageCalls({
      limit: 25,
      offset: 25,
      callType: 'transcription',
      dateFrom: '2026-03-01',
      dateTo: '2026-03-23',
      collectionCode: '009',
    })).resolves.toEqual({
      calls: [
        expect.objectContaining({
          id: 'call-1',
          totalCost: '0.000758',
          collectionCode: '009',
        }),
      ],
      total: 41,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/usage/calls?page=2&limit=25&callType=transcription&collectionCode=009&from=2026-03-01T00%3A00%3A00.000&to=2026-03-23T23%3A59%3A59.999',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });

  it('normalizes analytics aggregates and outlier tables for the usage page', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      summary: {
        totalCost: '4.500000',
        totalCalls: 6,
        totalTokens: 3100,
        totalLetters: 2,
        totalCollections: 1,
        totalPages: 5,
        avgDurationMs: 820.5,
        avgCostPerRequest: '0.750000',
        avgCostPerLetter: '2.250000',
        avgCostPerPage: '0.900000',
        avgTokensPerRequest: 516.7,
        unattributedCost: '0.250000',
        unattributedCalls: 1,
      },
      byCollection: [
        {
          collectionCode: '009',
          collectionTitle: 'Letters Home',
          totalCost: '4.250000',
          totalCalls: 5,
          totalTokens: 2800,
          distinctLetters: 2,
          pageCount: 5,
          avgCostPerRequest: '0.850000',
          avgCostPerLetter: '2.125000',
          avgDurationMs: 780.4,
        },
      ],
      byType: [
        {
          callType: 'transcription',
          totalCost: '3.000000',
          totalCalls: 3,
          totalTokens: 1800,
          avgCostPerRequest: '1.000000',
          avgTokensPerRequest: 600,
          avgDurationMs: 920.2,
          maxCost: '1.500000',
        },
      ],
      topLetters: [
        {
          letterId: 'letter-1',
          collectionCode: '009',
          dateRaw: '19470810',
          sender: 'Alice',
          recipient: 'Bob',
          totalCost: '2.750000',
          totalCalls: 3,
          totalTokens: 1600,
          pageCount: 3,
          avgCostPerRequest: '0.916667',
          costPerPage: '0.916667',
        },
      ],
      topRequests: [
        {
          id: 'call-9',
          letterId: 'letter-1',
          collectionCode: '009',
          collectionTitle: 'Letters Home',
          dateRaw: '19470810',
          sender: 'Alice',
          recipient: 'Bob',
          callType: 'transcription',
          model: 'gpt-5.4',
          totalTokens: 900,
          totalCost: '1.500000',
          durationMs: 1200,
          createdAt: '2026-03-20T15:30:00.000Z',
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(getUsageAnalytics({ months: 12, collectionCode: '009' })).resolves.toEqual({
      summary: {
        totalCost: 4.5,
        totalCalls: 6,
        totalTokens: 3100,
        totalLetters: 2,
        totalCollections: 1,
        totalPages: 5,
        avgDurationMs: 820.5,
        avgCostPerRequest: 0.75,
        avgCostPerLetter: 2.25,
        avgCostPerPage: 0.9,
        avgTokensPerRequest: 516.7,
        unattributedCost: 0.25,
        unattributedCalls: 1,
      },
      byCollection: [
        expect.objectContaining({
          collectionCode: '009',
          totalCost: 4.25,
          avgCostPerLetter: 2.125,
        }),
      ],
      byType: [
        expect.objectContaining({
          callType: 'transcription',
          totalCost: 3,
          maxCost: 1.5,
        }),
      ],
      topLetters: [
        expect.objectContaining({
          letterId: 'letter-1',
          totalCost: 2.75,
          costPerPage: 0.916667,
        }),
      ],
      topRequests: [
        expect.objectContaining({
          id: 'call-9',
          totalCost: 1.5,
          collectionCode: '009',
        }),
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3002/admin/usage/analytics?months=12&collectionCode=009',
      expect.objectContaining({
        credentials: 'include',
      }),
    );
  });
});
