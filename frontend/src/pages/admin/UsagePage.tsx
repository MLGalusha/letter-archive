import { useState, useEffect, useCallback } from 'react';
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
import {
  getUsageSummary,
  getUsageCalls,
  getUsageTotals,
  type UsageSummaryPeriod,
  type UsageCall,
  type UsageTotals,
} from '../../api/admin/usage';
import './UsagePage.css';

// ── Chart colors ────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  transcription: '#4a90d9',
  metadata: '#5cb85c',
  entity_extraction: '#f0ad4e',
  entity_resolution: '#9b59b6',
};

const FALLBACK_COLOR = '#999';

function getTypeColor(type: string): string {
  return TYPE_COLORS[type] || FALLBACK_COLOR;
}

// ── Formatting helpers ──────────────────────────────────
function formatCost(value: number): string {
  return `$${(value ?? 0).toFixed(4)}`;
}

function formatCostShort(value: number): string {
  const v = value ?? 0;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function formatNumber(n: number): string {
  return (n ?? 0).toLocaleString();
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTypeName(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Custom tooltip ──────────────────────────────────────
interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="usage-tooltip">
      <div className="usage-tooltip-label">{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} style={{ color: entry.color }}>
          {formatTypeName(entry.name)}: {formatCostShort(entry.value)}
        </div>
      ))}
    </div>
  );
}

// ── Pie label ───────────────────────────────────────────
interface PieLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  name: string;
}

function renderPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: PieLabelProps) {
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 1.4;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="var(--text)"
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={12}
    >
      {formatTypeName(name)} ({(percent * 100).toFixed(0)}%)
    </text>
  );
}

// ── Page calls per request ──────────────────────────────
const CALLS_PER_PAGE = 25;

export default function UsagePage() {
  // ── Data ────────────────────────────────────────────
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [summary, setSummary] = useState<UsageSummaryPeriod[]>([]);
  const [calls, setCalls] = useState<UsageCall[]>([]);
  const [callsTotal, setCallsTotal] = useState(0);

  // ── UI state ────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(6);
  const [callTypeFilter, setCallTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [callsLoading, setCallsLoading] = useState(false);

  // ── Load totals + summary ─────────────────────────
  const loadOverview = useCallback(async () => {
    try {
      const [totalsData, summaryData] = await Promise.allSettled([
        getUsageTotals(),
        getUsageSummary({ period: 'month', months }),
      ]);

      if (totalsData.status === 'fulfilled') setTotals(totalsData.value);
      if (summaryData.status === 'fulfilled') setSummary(summaryData.value);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load usage data.'));
    } finally {
      setLoading(false);
    }
  }, [months]);

  // ── Load calls ────────────────────────────────────
  const loadCalls = useCallback(async (offset: number, append: boolean) => {
    setCallsLoading(true);
    try {
      const data = await getUsageCalls({
        limit: CALLS_PER_PAGE,
        offset,
        callType: callTypeFilter || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setCalls(prev => append ? [...prev, ...data.calls] : data.calls);
      setCallsTotal(data.total);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load call history.'));
    } finally {
      setCallsLoading(false);
    }
  }, [callTypeFilter, dateFrom, dateTo]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadCalls(0, false); }, [loadCalls]);

  // ── Derived chart data ────────────────────────────
  const allTypes = Array.from(
    new Set(summary.flatMap(s => Object.keys(s.byType || {})))
  ).sort();

  const barData = summary.map(s => {
    const row: Record<string, string | number> = { period: s.period };
    for (const type of allTypes) {
      row[type] = (s.byType || {})[type]?.cost ?? 0;
    }
    return row;
  });

  const pieData = (() => {
    const totals: Record<string, number> = {};
    for (const s of summary) {
      for (const [type, data] of Object.entries(s.byType || {})) {
        totals[type] = (totals[type] || 0) + data.cost;
      }
    }
    return Object.entries(totals)
      .map(([name, value]) => ({ name, value }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);
  })();

  // ── Render ────────────────────────────────────────
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
        {/* Header */}
        <div className="usage-header">
          <div className="usage-kicker">Administration</div>
          <h1 className="usage-title">Usage &amp; Analytics</h1>
          <p className="usage-subtitle">
            Track OpenAI API costs, token usage, and processing activity.
          </p>
        </div>

        {error && <div className="usage-error">{error}</div>}

        {/* Summary Cards */}
        {totals && (
          <div className="usage-summary-grid">
            <div className="usage-summary-card">
              <div className="usage-summary-value">{formatCostShort(totals.totalCost)}</div>
              <div className="usage-summary-label">Total Spend</div>
            </div>
            <div className="usage-summary-card">
              <div className="usage-summary-value">{formatCostShort(totals.thisMonthCost)}</div>
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
        )}

        {/* Charts Row */}
        <div className="usage-charts-row">
          {/* Bar Chart: Monthly Cost */}
          <div className="usage-section">
            <div className="usage-section-header">
              <Icon name="chart" size={20} className="usage-section-icon" />
              <h2>Monthly Cost</h2>
              <select
                className="usage-period-select"
                value={months}
                onChange={e => setMonths(Number(e.target.value))}
              >
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
              </select>
            </div>

            {barData.length > 0 ? (
              <div className="usage-chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="period"
                      tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    />
                    <YAxis
                      tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                      tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    {allTypes.map(type => (
                      <Bar
                        key={type}
                        dataKey={type}
                        stackId="cost"
                        fill={getTypeColor(type)}
                        radius={allTypes.indexOf(type) === allTypes.length - 1 ? [3, 3, 0, 0] : undefined}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="usage-empty">No data for this period.</div>
            )}

            {/* Legend */}
            <div className="usage-legend">
              {allTypes.map(type => (
                <div key={type} className="usage-legend-item">
                  <span className="usage-legend-swatch" style={{ background: getTypeColor(type) }} />
                  {formatTypeName(type)}
                </div>
              ))}
            </div>
          </div>

          {/* Pie Chart: Cost Breakdown */}
          <div className="usage-section">
            <div className="usage-section-header">
              <Icon name="chart" size={20} className="usage-section-icon" />
              <h2>Cost Breakdown</h2>
            </div>

            {pieData.length > 0 ? (
              <div className="usage-pie-container">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      dataKey="value"
                      label={renderPieLabel}
                      labelLine={false}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={getTypeColor(entry.name)} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => formatCostShort(value)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="usage-empty">No usage data to chart.</div>
            )}

            {/* Legend with totals */}
            <div className="usage-legend">
              {pieData.map(entry => (
                <div key={entry.name} className="usage-legend-item">
                  <span className="usage-legend-swatch" style={{ background: getTypeColor(entry.name) }} />
                  {formatTypeName(entry.name)}: {formatCostShort(entry.value)}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Call History Table */}
        <div className="usage-section">
          <div className="usage-section-header">
            <Icon name="file" size={20} className="usage-section-icon" />
            <h2>Call History</h2>
          </div>

          {/* Filters */}
          <div className="usage-filters">
            <div className="usage-filter-group">
              <label htmlFor="filter-type">Type</label>
              <select
                id="filter-type"
                value={callTypeFilter}
                onChange={e => setCallTypeFilter(e.target.value)}
              >
                <option value="">All types</option>
                <option value="transcription">Transcription</option>
                <option value="metadata">Metadata</option>
                <option value="entity_extraction">Entity Extraction</option>
                <option value="entity_resolution">Entity Resolution</option>
              </select>
            </div>
            <div className="usage-filter-group">
              <label htmlFor="filter-from">From</label>
              <input
                id="filter-from"
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
              />
            </div>
            <div className="usage-filter-group">
              <label htmlFor="filter-to">To</label>
              <input
                id="filter-to"
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
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
                      <th>Input Tokens</th>
                      <th>Output Tokens</th>
                      <th>Input Cost</th>
                      <th>Output Cost</th>
                      <th>Total Cost</th>
                      <th>Duration</th>
                      <th>Letter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map(call => (
                      <tr key={call.id}>
                        <td>{formatDate(call.createdAt)}</td>
                        <td>
                          <span className={`usage-type-badge ${call.callType}`}>
                            {call.callType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="mono">{call.model}</td>
                        <td className="mono">{formatNumber(call.inputTokens)}</td>
                        <td className="mono">{formatNumber(call.outputTokens)}</td>
                        <td className="mono">{formatCost(Number(call.inputCost))}</td>
                        <td className="mono">{formatCost(Number(call.outputCost))}</td>
                        <td className="mono">{formatCost(Number(call.totalCost))}</td>
                        <td className="mono">{formatDuration(call.durationMs)}</td>
                        <td>
                          {call.letterId ? (
                            <Link
                              to={`/admin/letters/${call.letterId}`}
                              className="usage-letter-link"
                            >
                              {call.letterId.slice(0, 8)}...
                            </Link>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {calls.length < callsTotal && (
                <div className="usage-load-more">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={callsLoading}
                    onClick={() => loadCalls(calls.length, true)}
                  >
                    Load More ({calls.length} of {callsTotal})
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="usage-empty">
              {callsLoading ? 'Loading calls...' : 'No API calls found for the selected filters.'}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
