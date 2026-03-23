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
}

export interface UsageTotals {
  totalCost: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  thisMonthCost: number;
  thisMonthCalls: number;
}

export function getUsageSummary(params?: { period?: string; months?: number }): Promise<UsageSummaryPeriod[]> {
  return apiGet<UsageSummaryPeriod[]>('/admin/usage/summary', {
    period: params?.period,
    months: params?.months,
  });
}

export function getUsageCalls(params?: {
  limit?: number;
  offset?: number;
  callType?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ calls: UsageCall[]; total: number }> {
  return apiGet<{ calls: UsageCall[]; total: number }>('/admin/usage/calls', {
    limit: params?.limit,
    offset: params?.offset,
    callType: params?.callType,
    dateFrom: params?.dateFrom,
    dateTo: params?.dateTo,
  });
}

export function getUsageTotals(): Promise<UsageTotals> {
  return apiGet<UsageTotals>('/admin/usage/totals');
}
