import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useNavigate } from 'react-router-dom';

interface SentimentDataPoint {
  date: string;
  tone: string;
  letterId: string;
}

interface SentimentArcChartProps {
  data: SentimentDataPoint[];
}

const TONE_VALUES: Record<string, number> = {
  desperate: -3,
  angry: -2,
  sad: -1.5,
  anxious: -1,
  neutral: 0,
  hopeful: 1.5,
  joyful: 3,
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

interface ChartPoint {
  date: string;
  dateLabel: string;
  score: number;
  tone: string;
  letterId: string;
}

interface TooltipPayloadEntry {
  payload: ChartPoint;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="cp-sentiment-tooltip">
      <p className="cp-sentiment-tooltip-tone">{p.tone}</p>
      <p className="cp-sentiment-tooltip-date">{p.dateLabel}</p>
    </div>
  );
}

function SentimentArcChart({ data }: SentimentArcChartProps) {
  const navigate = useNavigate();

  if (data.length < 2) {
    return (
      <div className="cp-chart-card">
        <h3 className="cp-chart-title">Emotional Arc</h3>
        <p className="cp-chart-placeholder">
          Not enough data for sentiment analysis
        </p>
      </div>
    );
  }

  const chartData: ChartPoint[] = data.map((d) => ({
    date: d.date,
    dateLabel: formatDate(d.date),
    score: TONE_VALUES[d.tone] ?? 0,
    tone: d.tone,
    letterId: d.letterId,
  }));

  const handleClick = (point: ChartPoint) => {
    if (point?.letterId) {
      navigate(`/letter/${point.letterId}`);
    }
  };

  return (
    <div className="cp-chart-card">
      <h3 className="cp-chart-title">Emotional Arc</h3>
      <div className="cp-chart-container">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart
            data={chartData}
            onClick={(e: Record<string, unknown>) => {
              const payload = (e?.activePayload as Array<{ payload: ChartPoint }> | undefined)?.[0]?.payload;
              if (payload) {
                handleClick(payload);
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <defs>
              <linearGradient id="sentimentGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1f6d7a" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#1f6d7a" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="dateLabel"
              tick={{ fontSize: 11, fill: '#6d5f51' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(217,207,191,0.6)' }}
            />
            <YAxis
              domain={[-3.5, 3.5]}
              tick={{ fontSize: 11, fill: '#6d5f51' }}
              tickLine={false}
              axisLine={false}
              width={30}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="score"
              stroke="#1f6d7a"
              strokeWidth={2}
              fill="url(#sentimentGradient)"
              dot={{ r: 4, fill: '#1f6d7a', stroke: '#fff', strokeWidth: 2 }}
              activeDot={{ r: 6, fill: '#1f6d7a', stroke: '#fff', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default SentimentArcChart;
