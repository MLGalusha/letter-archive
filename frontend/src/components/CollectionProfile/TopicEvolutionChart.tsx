import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface TopicDataPoint {
  date: string;
  topics: string[];
  letterId: string;
}

interface TopicEvolutionChartProps {
  data: TopicDataPoint[];
}

const TOPIC_COLORS = [
  '#1f6d7a',
  '#a67c52',
  '#7a4f1f',
  '#5b8a72',
  '#8b6b5a',
  '#6d7a5b',
];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function TopicEvolutionChart({ data }: TopicEvolutionChartProps) {
  if (data.length < 2) {
    return (
      <div className="cp-chart-card">
        <h3 className="cp-chart-title">Topics Over Time</h3>
        <p className="cp-chart-placeholder">
          Not enough data to show topic evolution
        </p>
      </div>
    );
  }

  // Count topic frequency across all letters
  const topicCounts: Record<string, number> = {};
  for (const d of data) {
    for (const t of d.topics) {
      topicCounts[t] = (topicCounts[t] || 0) + 1;
    }
  }

  // Get top 6 topics
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name]) => name);

  // Build chart data: for each letter date, 1/0 for each top topic
  const chartData = data.map((d) => {
    const row: Record<string, string | number> = {
      date: formatDate(d.date),
    };
    for (const topic of topTopics) {
      row[topic] = d.topics.includes(topic) ? 1 : 0;
    }
    return row;
  });

  return (
    <div className="cp-chart-card">
      <h3 className="cp-chart-title">Topics Over Time</h3>
      <div className="cp-chart-container">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#6d5f51' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(217,207,191,0.6)' }}
            />
            <YAxis hide />
            <Tooltip />
            <Legend
              wrapperStyle={{ fontSize: '0.8rem', color: '#2d241d' }}
            />
            {topTopics.map((topic, i) => (
              <Area
                key={topic}
                type="monotone"
                dataKey={topic}
                stackId="1"
                stroke={TOPIC_COLORS[i]}
                fill={TOPIC_COLORS[i]}
                fillOpacity={0.4}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default TopicEvolutionChart;
