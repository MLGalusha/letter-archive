import { apiGet } from '../client';

export interface UsageSummaryPeriod {
  period: string;
  totalCost: number;
  totalCalls: number;
  inputTokens: number;
  outputTokens: number;
  byType: Record<string, { cost: number; calls: number }>;
}

export interface UsageCall {
  id: string;
  letterId: string | null;
  callType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: string;
  outputCost: string;
  totalCost: string;
  durationMs: number | null;
  createdAt: string;
  collectionCode?: string | null;
  collectionTitle?: string | null;
  dateRaw?: string | null;
  sender?: string | null;
  recipient?: string | null;
}

export interface UsageTotals {
  totalCost: number;
  totalCalls: number;
  totalTokens: number;
  thisMonthCost: number;
  thisMonthCalls: number;
  thisMonthTokens: number;
}

export interface UsageAnalyticsSummary {
  totalCost: number;
  totalCalls: number;
  totalTokens: number;
  totalLetters: number;
  totalCollections: number;
  totalPages: number;
  avgDurationMs: number;
  avgCostPerRequest: number;
  avgCostPerLetter: number;
  avgCostPerPage: number;
  avgTokensPerRequest: number;
  unattributedCost: number;
  unattributedCalls: number;
}

export interface UsageCollectionAnalytics {
  collectionCode: string;
  collectionTitle: string | null;
  totalCost: number;
  totalCalls: number;
  totalTokens: number;
  distinctLetters: number;
  pageCount: number;
  avgCostPerRequest: number;
  avgCostPerLetter: number;
  avgDurationMs: number;
}

export interface UsageTypeAnalytics {
  callType: string;
  totalCost: number;
  totalCalls: number;
  totalTokens: number;
  avgCostPerRequest: number;
  avgTokensPerRequest: number;
  avgDurationMs: number;
  maxCost: number;
}

export interface UsageLetterAnalytics {
  letterId: string;
  collectionCode: string | null;
  dateRaw: string | null;
  sender: string | null;
  recipient: string | null;
  totalCost: number;
  totalCalls: number;
  totalTokens: number;
  pageCount: number;
  avgCostPerRequest: number;
  costPerPage: number | null;
}

export interface UsageRequestAnalytics {
  id: string;
  letterId: string | null;
  collectionCode: string | null;
  collectionTitle: string | null;
  dateRaw: string | null;
  sender: string | null;
  recipient: string | null;
  callType: string;
  model: string;
  totalTokens: number;
  totalCost: number;
  durationMs: number | null;
  createdAt: string;
}

export interface UsageAnalytics {
  summary: UsageAnalyticsSummary;
  byCollection: UsageCollectionAnalytics[];
  byType: UsageTypeAnalytics[];
  topLetters: UsageLetterAnalytics[];
  topRequests: UsageRequestAnalytics[];
}

interface UsageSummaryApiType {
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: string;
}

interface UsageSummaryApiPeriod {
  month: string;
  types: Record<string, UsageSummaryApiType>;
  totalCost: string;
  totalCalls: number;
}

interface UsageCallsApiResponse {
  calls: UsageCall[];
  pagination: {
    total: number;
  };
}

interface UsageTotalsApiResponse {
  allTime: {
    totalCost: string;
    totalCalls: number;
    totalTokens: number;
  };
  thisMonth: {
    totalCost: string;
    totalCalls: number;
    totalTokens: number;
  };
}

interface UsageAnalyticsApiResponse {
  summary: {
    totalCost: string;
    totalCalls: number;
    totalTokens: number;
    totalLetters: number;
    totalCollections: number;
    totalPages: number;
    avgDurationMs: number;
    avgCostPerRequest: string;
    avgCostPerLetter: string;
    avgCostPerPage: string;
    avgTokensPerRequest: number;
    unattributedCost: string;
    unattributedCalls: number;
  };
  byCollection: Array<{
    collectionCode: string;
    collectionTitle: string | null;
    totalCost: string;
    totalCalls: number;
    totalTokens: number;
    distinctLetters: number;
    pageCount: number;
    avgCostPerRequest: string;
    avgCostPerLetter: string;
    avgDurationMs: number;
  }>;
  byType: Array<{
    callType: string;
    totalCost: string;
    totalCalls: number;
    totalTokens: number;
    avgCostPerRequest: string;
    avgTokensPerRequest: number;
    avgDurationMs: number;
    maxCost: string;
  }>;
  topLetters: Array<{
    letterId: string;
    collectionCode: string | null;
    dateRaw: string | null;
    sender: string | null;
    recipient: string | null;
    totalCost: string;
    totalCalls: number;
    totalTokens: number;
    pageCount: number;
    avgCostPerRequest: string;
    costPerPage: string | null;
  }>;
  topRequests: Array<{
    id: string;
    letterId: string | null;
    collectionCode: string | null;
    collectionTitle: string | null;
    dateRaw: string | null;
    sender: string | null;
    recipient: string | null;
    callType: string;
    model: string;
    totalTokens: number;
    totalCost: string;
    durationMs: number | null;
    createdAt: string;
  }>;
}

function toNumber(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

export function getUsageSummary(params?: {
  period?: string;
  months?: number;
  collectionCode?: string;
}): Promise<UsageSummaryPeriod[]> {
  return apiGet<UsageSummaryApiPeriod[]>('/admin/usage/summary', {
    months: params?.months,
    collectionCode: params?.collectionCode,
  }).then((rows) =>
    rows
      .map((row) => {
        let inputTokens = 0;
        let outputTokens = 0;
        const byType: UsageSummaryPeriod['byType'] = {};

        for (const [type, data] of Object.entries(row.types || {})) {
          inputTokens += toNumber(data.totalInputTokens);
          outputTokens += toNumber(data.totalOutputTokens);
          byType[type] = {
            cost: toNumber(data.totalCost),
            calls: toNumber(data.callCount),
          };
        }

        return {
          period: row.month,
          totalCost: toNumber(row.totalCost),
          totalCalls: toNumber(row.totalCalls),
          inputTokens,
          outputTokens,
          byType,
        };
      })
      .sort((a, b) => a.period.localeCompare(b.period)),
  );
}

export function getUsageCalls(params?: {
  limit?: number;
  offset?: number;
  callType?: string;
  dateFrom?: string;
  dateTo?: string;
  collectionCode?: string;
}): Promise<{ calls: UsageCall[]; total: number }> {
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;
  const page = Math.floor(offset / limit) + 1;

  return apiGet<UsageCallsApiResponse>('/admin/usage/calls', {
    page,
    limit,
    callType: params?.callType,
    collectionCode: params?.collectionCode,
    from: params?.dateFrom ? `${params.dateFrom}T00:00:00.000` : undefined,
    to: params?.dateTo ? `${params.dateTo}T23:59:59.999` : undefined,
  }).then((response) => ({
    calls: response.calls,
    total: toNumber(response.pagination?.total),
  }));
}

export function getUsageTotals(params?: { collectionCode?: string }): Promise<UsageTotals> {
  return apiGet<UsageTotalsApiResponse>('/admin/usage/totals', {
    collectionCode: params?.collectionCode,
  }).then((response) => ({
    totalCost: toNumber(response.allTime?.totalCost),
    totalCalls: toNumber(response.allTime?.totalCalls),
    totalTokens: toNumber(response.allTime?.totalTokens),
    thisMonthCost: toNumber(response.thisMonth?.totalCost),
    thisMonthCalls: toNumber(response.thisMonth?.totalCalls),
    thisMonthTokens: toNumber(response.thisMonth?.totalTokens),
  }));
}

export function getUsageAnalytics(params?: {
  months?: number;
  collectionCode?: string;
}): Promise<UsageAnalytics> {
  return apiGet<UsageAnalyticsApiResponse>('/admin/usage/analytics', {
    months: params?.months,
    collectionCode: params?.collectionCode,
  }).then((response) => ({
    summary: {
      totalCost: toNumber(response.summary?.totalCost),
      totalCalls: toNumber(response.summary?.totalCalls),
      totalTokens: toNumber(response.summary?.totalTokens),
      totalLetters: toNumber(response.summary?.totalLetters),
      totalCollections: toNumber(response.summary?.totalCollections),
      totalPages: toNumber(response.summary?.totalPages),
      avgDurationMs: toNumber(response.summary?.avgDurationMs),
      avgCostPerRequest: toNumber(response.summary?.avgCostPerRequest),
      avgCostPerLetter: toNumber(response.summary?.avgCostPerLetter),
      avgCostPerPage: toNumber(response.summary?.avgCostPerPage),
      avgTokensPerRequest: toNumber(response.summary?.avgTokensPerRequest),
      unattributedCost: toNumber(response.summary?.unattributedCost),
      unattributedCalls: toNumber(response.summary?.unattributedCalls),
    },
    byCollection: (response.byCollection || []).map((row) => ({
      collectionCode: row.collectionCode,
      collectionTitle: row.collectionTitle,
      totalCost: toNumber(row.totalCost),
      totalCalls: toNumber(row.totalCalls),
      totalTokens: toNumber(row.totalTokens),
      distinctLetters: toNumber(row.distinctLetters),
      pageCount: toNumber(row.pageCount),
      avgCostPerRequest: toNumber(row.avgCostPerRequest),
      avgCostPerLetter: toNumber(row.avgCostPerLetter),
      avgDurationMs: toNumber(row.avgDurationMs),
    })),
    byType: (response.byType || []).map((row) => ({
      callType: row.callType,
      totalCost: toNumber(row.totalCost),
      totalCalls: toNumber(row.totalCalls),
      totalTokens: toNumber(row.totalTokens),
      avgCostPerRequest: toNumber(row.avgCostPerRequest),
      avgTokensPerRequest: toNumber(row.avgTokensPerRequest),
      avgDurationMs: toNumber(row.avgDurationMs),
      maxCost: toNumber(row.maxCost),
    })),
    topLetters: (response.topLetters || []).map((row) => ({
      letterId: row.letterId,
      collectionCode: row.collectionCode,
      dateRaw: row.dateRaw,
      sender: row.sender,
      recipient: row.recipient,
      totalCost: toNumber(row.totalCost),
      totalCalls: toNumber(row.totalCalls),
      totalTokens: toNumber(row.totalTokens),
      pageCount: toNumber(row.pageCount),
      avgCostPerRequest: toNumber(row.avgCostPerRequest),
      costPerPage: toNullableNumber(row.costPerPage),
    })),
    topRequests: (response.topRequests || []).map((row) => ({
      id: row.id,
      letterId: row.letterId,
      collectionCode: row.collectionCode,
      collectionTitle: row.collectionTitle,
      dateRaw: row.dateRaw,
      sender: row.sender,
      recipient: row.recipient,
      callType: row.callType,
      model: row.model,
      totalTokens: toNumber(row.totalTokens),
      totalCost: toNumber(row.totalCost),
      durationMs: toNullableNumber(row.durationMs),
      createdAt: row.createdAt,
    })),
  }));
}
