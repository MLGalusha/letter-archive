import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

const {
  getUsageTotalsMock,
  getUsageSummaryMock,
  getUsageAnalyticsMock,
  getUsageCallsMock,
  getAdminCollectionsMock,
} = vi.hoisted(() => ({
  getUsageTotalsMock: vi.fn(),
  getUsageSummaryMock: vi.fn(),
  getUsageAnalyticsMock: vi.fn(),
  getUsageCallsMock: vi.fn(),
  getAdminCollectionsMock: vi.fn(),
}));

vi.mock('../../../api/admin/usage', () => ({
  getUsageTotals: (...args: unknown[]) => getUsageTotalsMock(...args),
  getUsageSummary: (...args: unknown[]) => getUsageSummaryMock(...args),
  getUsageAnalytics: (...args: unknown[]) => getUsageAnalyticsMock(...args),
  getUsageCalls: (...args: unknown[]) => getUsageCallsMock(...args),
}));

vi.mock('../../../api/collections', () => ({
  getAdminCollections: (...args: unknown[]) => getAdminCollectionsMock(...args),
}));

vi.mock('../../../components/AdminLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../components/common', () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('../../../components/common/Icon', () => ({
  default: () => <span>icon</span>,
}));

vi.mock('recharts', () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Wrapper,
    BarChart: Wrapper,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    PieChart: Wrapper,
    Pie: Wrapper,
    Cell: () => null,
  };
});

import UsagePage from '../UsagePage';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function createCollections() {
  return [
    {
      id: 'collection-1',
      collectionCode: '009',
      title: 'Letters Home',
      description: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      publishedCount: 0,
      hiddenCount: 12,
      uploadedCount: 0,
      transcribedCount: 10,
      metadataReadyCount: 9,
      reviewedCount: 7,
      verifiedCount: 6,
      minDate: '19470810',
      maxDate: '19470820',
      letterCount: 12,
      letterPageCount: 24,
      extraContentCount: 4,
    },
  ];
}

function createAnalytics() {
  return {
    summary: {
      totalCost: 4.5,
      totalCalls: 6,
      totalTokens: 3100,
      totalLetters: 2,
      totalCollections: 1,
      totalPages: 5,
      avgDurationMs: 820,
      avgCostPerRequest: 0.75,
      avgCostPerLetter: 2.25,
      avgCostPerPage: 0.9,
      avgTokensPerRequest: 516.7,
      unattributedCost: 0.25,
      unattributedCalls: 1,
    },
    byCollection: [
      {
        collectionCode: '009',
        collectionTitle: 'Letters Home',
        totalCost: 4.25,
        totalCalls: 5,
        totalTokens: 2800,
        distinctLetters: 2,
        pageCount: 5,
        avgCostPerRequest: 0.85,
        avgCostPerLetter: 2.125,
        avgDurationMs: 780,
      },
    ],
    byType: [
      {
        callType: 'transcription',
        totalCost: 3,
        totalCalls: 3,
        totalTokens: 1800,
        avgCostPerRequest: 1,
        avgTokensPerRequest: 600,
        avgDurationMs: 920,
        maxCost: 1.5,
      },
      {
        callType: 'metadata_v2',
        totalCost: 1.25,
        totalCalls: 2,
        totalTokens: 800,
        avgCostPerRequest: 0.625,
        avgTokensPerRequest: 400,
        avgDurationMs: 700,
        maxCost: 0.8,
      },
    ],
    topLetters: [
      {
        letterId: 'letter-1',
        collectionCode: '009',
        dateRaw: '19470810',
        sender: 'Alice',
        recipient: 'Bob',
        totalCost: 2.75,
        totalCalls: 3,
        totalTokens: 1600,
        pageCount: 3,
        avgCostPerRequest: 0.916667,
        costPerPage: 0.916667,
      },
    ],
    topRequests: [
      {
        id: 'call-1',
        letterId: 'letter-1',
        collectionCode: '009',
        collectionTitle: 'Letters Home',
        dateRaw: '19470810',
        sender: 'Alice',
        recipient: 'Bob',
        callType: 'transcription',
        model: 'gpt-5.4',
        totalTokens: 900,
        totalCost: 1.5,
        durationMs: 1200,
        createdAt: '2026-03-20T15:30:00.000Z',
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  getAdminCollectionsMock.mockResolvedValue(createCollections());
  getUsageTotalsMock.mockResolvedValue({
    totalCost: 12.34,
    totalCalls: 42,
    totalTokens: 123456,
    thisMonthCost: 1.23,
    thisMonthCalls: 4,
    thisMonthTokens: 4567,
  });
  getUsageSummaryMock.mockResolvedValue([
    {
      period: '2026-02',
      totalCost: 0.5,
      totalCalls: 1,
      inputTokens: 200,
      outputTokens: 50,
      byType: {
        metadata_v2: { cost: 0.5, calls: 1 },
      },
    },
    {
      period: '2026-03',
      totalCost: 3.25,
      totalCalls: 5,
      inputTokens: 1500,
      outputTokens: 500,
      byType: {
        transcription: { cost: 3, calls: 3 },
        metadata_v2: { cost: 0.25, calls: 2 },
      },
    },
  ]);
  getUsageAnalyticsMock.mockResolvedValue(createAnalytics());
  getUsageCallsMock.mockResolvedValue({
    total: 1,
    calls: [
      {
        id: 'call-1',
        letterId: 'letter-1',
        callType: 'transcription',
        model: 'gpt-5.4',
        inputTokens: 600,
        outputTokens: 300,
        totalTokens: 900,
        inputCost: '0.001000',
        outputCost: '0.000500',
        totalCost: '0.001500',
        durationMs: 1200,
        createdAt: '2026-03-20T15:30:00.000Z',
        collectionCode: '009',
        collectionTitle: 'Letters Home',
        dateRaw: '19470810',
        sender: 'Alice',
        recipient: 'Bob',
      },
    ],
  });
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('UsagePage', () => {
  it('renders the richer analytics sections and applies collection filters to reloads', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <UsagePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Window Intelligence')).toBeInTheDocument();
    expect(screen.getByText('Collection Spend')).toBeInTheDocument();
    expect(screen.getByText('Request Economics')).toBeInTheDocument();
    expect(screen.getByText('Most Expensive Letters')).toBeInTheDocument();
    expect(screen.getByText('Most Expensive Requests')).toBeInTheDocument();
    expect(screen.getByText('$0.7500')).toBeInTheDocument();
    expect(screen.getAllByText('009 · 19470810')[0]).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Collection'), '009');

    await waitFor(() => {
      expect(getUsageTotalsMock).toHaveBeenLastCalledWith({ collectionCode: '009' });
      expect(getUsageSummaryMock).toHaveBeenLastCalledWith({ months: 6, collectionCode: '009' });
      expect(getUsageAnalyticsMock).toHaveBeenLastCalledWith({ months: 6, collectionCode: '009' });
      expect(getUsageCallsMock).toHaveBeenLastCalledWith({
        limit: 25,
        offset: 0,
        callType: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        collectionCode: '009',
      });
    });
  });
});
