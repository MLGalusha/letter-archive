import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import AdminLayout from '../../components/AdminLayout';
import { Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import { getErrorMessage } from '../../api/client';
import { getAdminCollections, type AdminCollectionInfo } from '../../api/collections';
import {
  getUsageAnalytics,
  getUsageCalls,
  getUsageSummary,
  getUsageTotals,
  type UsageAnalytics,
  type UsageCall,
  type UsageSummaryPeriod,
  type UsageTotals,
} from '../../api/admin/usage';
import './UsagePage.css';

type TypeStyle = {
  label: string;
  chartColor: string;
  badgeBackground: string;
  badgeColor: string;
};

const TYPE_STYLES: Record<string, TypeStyle> = {
  transcription: {
    label: 'Transcription',
    chartColor: '#4a90d9',
    badgeBackground: '#e3f2fd',
    badgeColor: '#1565c0',
  },
  metadata: {
    label: 'Metadata',
    chartColor: '#5cb85c',
    badgeBackground: '#e8f5e9',
    badgeColor: '#2e7d32',
  },
  metadata_v2: {
    label: 'Metadata V2',
    chartColor: '#2f8f83',
    badgeBackground: '#daf3ef',
    badgeColor: '#0d6158',
  },
  metadata_update: {
    label: 'Metadata Update',
    chartColor: '#3b7863',
    badgeBackground: '#d7ece2',
    badgeColor: '#245141',
  },
  entity_extraction: {
    label: 'Entity Extraction',
    chartColor: '#f0ad4e',
    badgeBackground: '#fff3e0',
    badgeColor: '#e65100',
  },
  entity_resolution: {
    label: 'Entity Resolution',
    chartColor: '#9b59b6',
    badgeBackground: '#f3e5f5',
    badgeColor: '#7b1fa2',
  },
  extra_content_check: {
    label: 'Extra Content Check',
    chartColor: '#8a6a55',
    badgeBackground: '#efe4db',
    badgeColor: '#6f4a31',
  },
  extra_content_transcription: {
    label: 'Extra Content Tx',
    chartColor: '#c96c3b',
    badgeBackground: '#fae7dc',
    badgeColor: '#8f4420',
  },
};

const FALLBACK_TYPE_STYLE: TypeStyle = {
  label: 'Other',
  chartColor: '#7d7d7d',
  badgeBackground: '#ececec',
  badgeColor: '#555555',
};

const CALLS_PER_PAGE = 25;

function getTypeMeta(type: string): TypeStyle {
  return TYPE_STYLES[type] || {
    ...FALLBACK_TYPE_STYLE,
    label: type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  };
}

function formatTypeName(type: string): string {
  return getTypeMeta(type).label;
}

function formatCost(value: number): string {
  const amount = value ?? 0;
  if (amount >= 1000) return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (amount >= 1) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}

function formatNumber(value: number): string {
  return (value ?? 0).toLocaleString();
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatIdentity(sender?: string | null, recipient?: string | null): string {
  if (sender && recipient) return `${sender} → ${recipient}`;
  return sender || recipient || 'Participants unavailable';
}

function buildLetterLabel(dateRaw?: string | null, collectionCode?: string | null): string {
  if (dateRaw && collectionCode) return `${collectionCode} · ${dateRaw}`;
  if (dateRaw) return dateRaw;
  if (collectionCode) return collectionCode;
  return 'Unlinked';
}

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="usage-tooltip">
      {label ? <div className="usage-tooltip-label">{label}</div> : null}
      {payload.map((entry) => (
        <div key={entry.name} style={{ color: entry.color }}>
          {formatTypeName(entry.name)}: {formatCost(entry.value)}
        </div>
      ))}
    </div>
  );
}

interface PieLabelProps {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
  name?: string | number;
}

function renderPieLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  name,
}: PieLabelProps) {
  if (
    percent == null ||
    cx == null ||
    cy == null ||
    midAngle == null ||
    innerRadius == null ||
    outerRadius == null ||
    percent < 0.05
  ) {
    return null;
  }

  const radian = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 1.35;
  const x = cx + radius * Math.cos(-midAngle * radian);
  const y = cy + radius * Math.sin(-midAngle * radian);

  return (
    <text
      x={x}
      y={y}
      fill="var(--text)"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={11}
    >
      {formatTypeName(String(name))} ({(percent * 100).toFixed(0)}%)
    </text>
  );
}

function InsightCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="usage-insight-card">
      <div className="usage-insight-value">{value}</div>
      <div className="usage-insight-label">{label}</div>
      {hint ? <div className="usage-insight-hint">{hint}</div> : null}
    </div>
  );
}

function CollectionOptionLabel(collection: AdminCollectionInfo): string {
  return collection.title
    ? `${collection.collectionCode} · ${collection.title}`
    : collection.collectionCode;
}

export default function UsagePage() {
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [summary, setSummary] = useState<UsageSummaryPeriod[]>([]);
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [calls, setCalls] = useState<UsageCall[]>([]);
  const [callsTotal, setCallsTotal] = useState(0);
  const [collections, setCollections] = useState<AdminCollectionInfo[]>([]);

  const [loading, setLoading] = useState(true);
  const [callsLoading, setCallsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [months, setMonths] = useState(6);
  const [collectionCode, setCollectionCode] = useState('');
  const [callTypeFilter, setCallTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const selectedCollection = collections.find((collection) => collection.collectionCode === collectionCode) || null;

  const loadCollections = useCallback(async () => {
    try {
      const data = await getAdminCollections();
      setCollections(
        [...data].sort((a, b) => a.collectionCode.localeCompare(b.collectionCode)),
      );
    } catch {
      // The analytics page remains usable without the collection lookup list.
    }
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [totalsResult, summaryResult, analyticsResult] = await Promise.allSettled([
      getUsageTotals({ collectionCode: collectionCode || undefined }),
      getUsageSummary({ months, collectionCode: collectionCode || undefined }),
      getUsageAnalytics({ months, collectionCode: collectionCode || undefined }),
    ]);

    if (totalsResult.status === 'fulfilled') setTotals(totalsResult.value);
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
    if (analyticsResult.status === 'fulfilled') setAnalytics(analyticsResult.value);

    const firstFailure = [totalsResult, summaryResult, analyticsResult].find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    if (firstFailure) {
      setError(getErrorMessage(firstFailure.reason, 'Failed to load usage data.'));
    }

    setLoading(false);
  }, [months, collectionCode]);

  const loadCalls = useCallback(async (offset: number, append: boolean) => {
    setCallsLoading(true);

    try {
      const data = await getUsageCalls({
        limit: CALLS_PER_PAGE,
        offset,
        callType: callTypeFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        collectionCode: collectionCode || undefined,
      });

      setCalls((previous) => (append ? [...previous, ...data.calls] : data.calls));
      setCallsTotal(data.total);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load call history.'));
    } finally {
      setCallsLoading(false);
    }
  }, [callTypeFilter, dateFrom, dateTo, collectionCode]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadCalls(0, false);
  }, [loadCalls]);

  const allTypes = analytics?.byType.length
    ? analytics.byType.map((row) => row.callType)
    : Array.from(new Set(summary.flatMap((period) => Object.keys(period.byType || {})))).sort();

  const barData = summary.map((period) => {
    const row: Record<string, string | number> = { period: period.period };
    for (const type of allTypes) {
      row[type] = period.byType[type]?.cost ?? 0;
    }
    return row;
  });

  const pieData = (analytics?.byType || [])
    .map((entry) => ({ name: entry.callType, value: entry.totalCost }))
    .filter((entry) => entry.value > 0);

  const collectionSpend = analytics?.byCollection || [];
  const topCollectionCost = collectionSpend[0]?.totalCost || 0;
  const hasPageMetrics = Boolean((analytics?.summary.totalPages || 0) > 0);
  const hasActiveFilters = Boolean(collectionCode || callTypeFilter || dateFrom || dateTo || months !== 6);

  const resetFilters = () => {
    setCollectionCode('');
    setCallTypeFilter('');
    setDateFrom('');
    setDateTo('');
    setMonths(6);
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="usage-loading">Loading usage data...</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="usage-page">
        <div className="usage-header">
          <div className="usage-kicker">Administration</div>
          <h1 className="usage-title">Usage &amp; Analytics</h1>
          <p className="usage-subtitle">
            Track spend, request economics, and collection-level AI activity across the archive.
          </p>
        </div>

        <div className="usage-toolbar">
          <div className="usage-filter-group">
            <label htmlFor="usage-months">Window</label>
            <select
              id="usage-months"
              value={months}
              onChange={(event) => setMonths(Number(event.target.value))}
            >
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
              <option value={24}>Last 24 months</option>
            </select>
          </div>

          <div className="usage-filter-group">
            <label htmlFor="usage-collection">Collection</label>
            <select
              id="usage-collection"
              value={collectionCode}
              onChange={(event) => setCollectionCode(event.target.value)}
            >
              <option value="">All collections</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.collectionCode}>
                  {CollectionOptionLabel(collection)}
                </option>
              ))}
            </select>
          </div>

          <div className="usage-toolbar-meta">
            <div className="usage-toolbar-note">
              {selectedCollection
                ? `Viewing ${CollectionOptionLabel(selectedCollection)}`
                : 'Viewing all attributable collections'}
            </div>
            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Reset Filters
              </Button>
            ) : null}
          </div>
        </div>

        {error ? <div className="usage-error">{error}</div> : null}

        {totals ? (
          <div className="usage-summary-grid">
            <div className="usage-summary-card">
              <div className="usage-summary-value">{formatCost(totals.totalCost)}</div>
              <div className="usage-summary-label">
                {collectionCode ? 'Collection Spend' : 'Total Spend'}
              </div>
            </div>
            <div className="usage-summary-card">
              <div className="usage-summary-value">{formatCost(totals.thisMonthCost)}</div>
              <div className="usage-summary-label">This Month</div>
            </div>
            <div className="usage-summary-card">
              <div className="usage-summary-value">{formatNumber(totals.totalCalls)}</div>
              <div className="usage-summary-label">Total Calls</div>
            </div>
            <div className="usage-summary-card">
              <div className="usage-summary-value">{formatNumber(totals.thisMonthCalls)}</div>
              <div className="usage-summary-label">Calls This Month</div>
            </div>
          </div>
        ) : null}

        {analytics ? (
          <div className="usage-section">
            <div className="usage-section-header">
              <Icon name="chart" size={20} className="usage-section-icon" />
              <h2>Window Intelligence</h2>
              <div className="usage-section-caption">
                {months}-month window{collectionCode ? ' for selected collection' : ''}
              </div>
            </div>

            <div className="usage-insight-grid">
              <InsightCard
                label="Avg / Request"
                value={formatCost(analytics.summary.avgCostPerRequest)}
                hint={`${formatNumber(analytics.summary.totalCalls)} calls in window`}
              />
              <InsightCard
                label="Avg / Letter"
                value={formatCost(analytics.summary.avgCostPerLetter)}
                hint={`${formatNumber(analytics.summary.totalLetters)} letters touched`}
              />
              <InsightCard
                label="Avg / Page"
                value={hasPageMetrics ? formatCost(analytics.summary.avgCostPerPage) : '-'}
                hint={hasPageMetrics ? `${formatNumber(analytics.summary.totalPages)} pages in touched letters` : 'Needs letter-attributed page coverage'}
              />
              <InsightCard
                label="Avg Duration"
                value={formatDuration(analytics.summary.avgDurationMs)}
                hint="Mean latency per request"
              />
              <InsightCard
                label="Tokens / Request"
                value={formatNumber(Math.round(analytics.summary.avgTokensPerRequest))}
                hint={`${formatNumber(analytics.summary.totalTokens)} tokens in window`}
              />
              <InsightCard
                label="Unattributed Spend"
                value={formatCost(analytics.summary.unattributedCost)}
                hint={`${formatNumber(analytics.summary.unattributedCalls)} requests without a linked letter`}
              />
            </div>
          </div>
        ) : null}

        <div className="usage-charts-row">
          <div className="usage-section">
            <div className="usage-section-header">
              <Icon name="chart" size={20} className="usage-section-icon" />
              <h2>Monthly Cost</h2>
              <div className="usage-section-caption">Spend by month and call type</div>
            </div>

            {barData.length > 0 ? (
              <>
                <div className="usage-chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="period" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
                      <YAxis
                        tickFormatter={(value: number) => formatCost(value)}
                        tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      {allTypes.map((type, index) => (
                        <Bar
                          key={type}
                          dataKey={type}
                          stackId="cost"
                          fill={getTypeMeta(type).chartColor}
                          radius={index === allTypes.length - 1 ? [4, 4, 0, 0] : undefined}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="usage-legend">
                  {allTypes.map((type) => (
                    <div key={type} className="usage-legend-item">
                      <span
                        className="usage-legend-swatch"
                        style={{ background: getTypeMeta(type).chartColor }}
                      />
                      {formatTypeName(type)}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="usage-empty">No usage data in this window.</div>
            )}
          </div>

          <div className="usage-section">
            <div className="usage-section-header">
              <Icon name="chart" size={20} className="usage-section-icon" />
              <h2>Cost Breakdown</h2>
              <div className="usage-section-caption">Share of spend by call type</div>
            </div>

            {pieData.length > 0 ? (
              <>
                <div className="usage-pie-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        outerRadius={104}
                        dataKey="value"
                        label={renderPieLabel}
                        labelLine={false}
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={getTypeMeta(entry.name).chartColor} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => formatCost(typeof value === 'number' ? value : Number(value ?? 0))}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="usage-legend">
                  {pieData.map((entry) => (
                    <div key={entry.name} className="usage-legend-item">
                      <span
                        className="usage-legend-swatch"
                        style={{ background: getTypeMeta(entry.name).chartColor }}
                      />
                      {formatTypeName(entry.name)}: {formatCost(entry.value)}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="usage-empty">No usage data to chart.</div>
            )}
          </div>
        </div>

        <div className="usage-detail-grid">
          <div className="usage-section">
            <div className="usage-section-header">
              <Icon name="file" size={20} className="usage-section-icon" />
              <h2>Collection Spend</h2>
              <div className="usage-section-caption">Attributed cost by collection</div>
            </div>

            {collectionSpend.length > 0 ? (
              <div className="usage-rank-list">
                {collectionSpend.slice(0, 8).map((collection) => (
                  <div key={collection.collectionCode} className="usage-rank-row">
                    <div className="usage-rank-header">
                      <div className="usage-rank-title">
                        <span className="usage-rank-code">{collection.collectionCode}</span>
                        <span className="usage-rank-name">
                          {collection.collectionTitle || 'Untitled collection'}
                        </span>
                      </div>
                      <div className="usage-rank-value">{formatCost(collection.totalCost)}</div>
                    </div>
                    <div className="usage-rank-bar">
                      <span
                        style={{
                          width: `${topCollectionCost > 0 ? (collection.totalCost / topCollectionCost) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <div className="usage-rank-meta">
                      <span>{formatNumber(collection.distinctLetters)} letters</span>
                      <span>{formatCost(collection.avgCostPerLetter)} / letter</span>
                      <span>{formatCost(collection.avgCostPerRequest)} / request</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="usage-empty">No collection-attributed usage in this window.</div>
            )}
          </div>

          <div className="usage-section">
            <div className="usage-section-header">
              <Icon name="chart" size={20} className="usage-section-icon" />
              <h2>Request Economics</h2>
              <div className="usage-section-caption">Average price, size, and latency by call type</div>
            </div>

            {analytics?.byType.length ? (
              <div className="usage-table-wrap">
                <table className="usage-table usage-compact-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Calls</th>
                      <th>Spend</th>
                      <th>Avg / Request</th>
                      <th>Tokens / Request</th>
                      <th>Avg Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.byType.map((entry) => (
                      <tr key={entry.callType}>
                        <td>
                          <span
                            className="usage-type-badge"
                            style={{
                              background: getTypeMeta(entry.callType).badgeBackground,
                              color: getTypeMeta(entry.callType).badgeColor,
                            }}
                          >
                            {formatTypeName(entry.callType)}
                          </span>
                        </td>
                        <td className="mono">{formatNumber(entry.totalCalls)}</td>
                        <td className="mono">{formatCost(entry.totalCost)}</td>
                        <td className="mono">{formatCost(entry.avgCostPerRequest)}</td>
                        <td className="mono">{formatNumber(Math.round(entry.avgTokensPerRequest))}</td>
                        <td className="mono">{formatDuration(entry.avgDurationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="usage-empty">No request economics available.</div>
            )}
          </div>
        </div>

        <div className="usage-detail-grid">
          <div className="usage-section">
            <div className="usage-section-header">
              <Icon name="file" size={20} className="usage-section-icon" />
              <h2>Most Expensive Letters</h2>
              <div className="usage-section-caption">Letters with the highest AI spend in this window</div>
            </div>

            {analytics?.topLetters.length ? (
              <div className="usage-table-wrap">
                <table className="usage-table usage-compact-table">
                  <thead>
                    <tr>
                      <th>Letter</th>
                      <th>Participants</th>
                      <th>Spend</th>
                      <th>Calls</th>
                      <th>Pages</th>
                      <th>Cost / Page</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topLetters.map((letter) => (
                      <tr key={letter.letterId}>
                        <td>
                          <Link to={`/admin/letters/${letter.letterId}`} className="usage-letter-link">
                            {buildLetterLabel(letter.dateRaw, letter.collectionCode)}
                          </Link>
                        </td>
                        <td>{formatIdentity(letter.sender, letter.recipient)}</td>
                        <td className="mono">{formatCost(letter.totalCost)}</td>
                        <td className="mono">{formatNumber(letter.totalCalls)}</td>
                        <td className="mono">{formatNumber(letter.pageCount)}</td>
                        <td className="mono">
                          {letter.costPerPage == null ? '-' : formatCost(letter.costPerPage)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="usage-empty">No letter-level usage available yet.</div>
            )}
          </div>

          <div className="usage-section">
            <div className="usage-section-header">
              <Icon name="chart" size={20} className="usage-section-icon" />
              <h2>Most Expensive Requests</h2>
              <div className="usage-section-caption">Individual calls with the highest price tags</div>
            </div>

            {analytics?.topRequests.length ? (
              <div className="usage-table-wrap">
                <table className="usage-table usage-compact-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Model</th>
                      <th>Spend</th>
                      <th>Tokens</th>
                      <th>Duration</th>
                      <th>Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topRequests.map((request) => (
                      <tr key={request.id}>
                        <td>{formatDate(request.createdAt)}</td>
                        <td>
                          <span
                            className="usage-type-badge"
                            style={{
                              background: getTypeMeta(request.callType).badgeBackground,
                              color: getTypeMeta(request.callType).badgeColor,
                            }}
                          >
                            {formatTypeName(request.callType)}
                          </span>
                        </td>
                        <td className="mono">{request.model}</td>
                        <td className="mono">{formatCost(request.totalCost)}</td>
                        <td className="mono">{formatNumber(request.totalTokens)}</td>
                        <td className="mono">{formatDuration(request.durationMs)}</td>
                        <td>
                          {request.letterId ? (
                            <Link to={`/admin/letters/${request.letterId}`} className="usage-letter-link">
                              {buildLetterLabel(request.dateRaw, request.collectionCode)}
                            </Link>
                          ) : request.collectionCode ? (
                            `${request.collectionCode} · Unlinked`
                          ) : (
                            'Unattributed'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="usage-empty">No expensive request data to surface.</div>
            )}
          </div>
        </div>

        <div className="usage-section">
          <div className="usage-section-header">
            <Icon name="file" size={20} className="usage-section-icon" />
            <h2>Call History</h2>
            <div className="usage-section-caption">Detailed request log for the current selection</div>
          </div>

          <div className="usage-filters">
            <div className="usage-filter-group">
              <label htmlFor="filter-type">Type</label>
              <select
                id="filter-type"
                value={callTypeFilter}
                onChange={(event) => setCallTypeFilter(event.target.value)}
              >
                <option value="">All types</option>
                {Object.keys(TYPE_STYLES).map((type) => (
                  <option key={type} value={type}>
                    {formatTypeName(type)}
                  </option>
                ))}
              </select>
            </div>

            <div className="usage-filter-group">
              <label htmlFor="filter-from">From</label>
              <input
                id="filter-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>

            <div className="usage-filter-group">
              <label htmlFor="filter-to">To</label>
              <input
                id="filter-to"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
          </div>

          {calls.length > 0 ? (
            <>
              <div className="usage-table-wrap">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Model</th>
                      <th>Tokens</th>
                      <th>Total Cost</th>
                      <th>Duration</th>
                      <th>Letter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map((call) => (
                      <tr key={call.id}>
                        <td>{formatDate(call.createdAt)}</td>
                        <td>
                          <span
                            className="usage-type-badge"
                            style={{
                              background: getTypeMeta(call.callType).badgeBackground,
                              color: getTypeMeta(call.callType).badgeColor,
                            }}
                          >
                            {formatTypeName(call.callType)}
                          </span>
                        </td>
                        <td className="mono">{call.model}</td>
                        <td className="mono">{formatNumber(call.totalTokens)}</td>
                        <td className="mono">{formatCost(Number(call.totalCost))}</td>
                        <td className="mono">{formatDuration(call.durationMs)}</td>
                        <td>
                          {call.letterId ? (
                            <div className="usage-link-stack">
                              <Link to={`/admin/letters/${call.letterId}`} className="usage-letter-link">
                                {buildLetterLabel(call.dateRaw, call.collectionCode)}
                              </Link>
                              <span className="usage-link-meta">
                                {formatIdentity(call.sender, call.recipient)}
                              </span>
                            </div>
                          ) : call.collectionCode ? (
                            <span className="usage-link-meta">{call.collectionCode} · Unlinked request</span>
                          ) : (
                            <span className="usage-link-meta">Unattributed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {calls.length < callsTotal ? (
                <div className="usage-load-more">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={callsLoading}
                    onClick={() => void loadCalls(calls.length, true)}
                  >
                    Load More ({calls.length} of {callsTotal})
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="usage-empty">
              {callsLoading ? 'Loading calls...' : 'No API calls found for the selected filters.'}
            </div>
          )}
        </div>

        {analytics?.summary.unattributedCost ? (
          <div className="usage-footnote">
            Historical logs without a linked letter remain visible as unattributed spend. Newly patched
            letter-scoped calls will improve collection and per-letter reporting going forward.
          </div>
        ) : null}

        {selectedCollection ? (
          <div className="usage-footnote">
            {CollectionOptionLabel(selectedCollection)} currently shows only requests attributed to letters in that
            collection. Collection-level jobs without a letter link remain outside this filtered view.
          </div>
        ) : null}
      </div>
    </AdminLayout>
  );
}
