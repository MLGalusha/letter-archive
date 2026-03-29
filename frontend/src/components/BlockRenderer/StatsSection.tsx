import type { StatsBlock, StatItem } from '../../content/blocks';
import Editable from './Editable';

interface Props {
  block: StatsBlock;
  liveStats?: { letters: number; collections: number } | null;
  editable?: boolean;
  onChange?: (patch: Partial<StatsBlock>) => void;
}

export default function StatsSection({ block, liveStats, editable, onChange }: Props) {
  const updateItem = (index: number, patch: Partial<StatItem>) => {
    const items = block.items.map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    );
    onChange?.({ items });
  };

  return (
    <div className="blk-stats blk-card">
      {block.items.map((item, index) => {
        let displayValue = item.value;
        if (liveStats) {
          if (item.source === 'letters_count') displayValue = liveStats.letters.toLocaleString();
          else if (item.source === 'collections_count') displayValue = String(liveStats.collections);
        }

        const isLive = item.source !== 'static';

        return (
          <div key={index}>
            {index > 0 && <div className="blk-stats-divider" />}
            <div className="blk-stat-item">
              {editable && !isLive ? (
                <Editable
                  value={item.value}
                  editable
                  onChange={(v) => updateItem(index, { value: v })}
                  tag="span"
                  className="blk-stat-value"
                  placeholder="Value"
                />
              ) : (
                <span className="blk-stat-value">{displayValue}</span>
              )}
              <Editable
                value={item.label}
                editable={editable}
                onChange={(v) => updateItem(index, { label: v })}
                tag="span"
                className="blk-stat-label"
                placeholder="Label"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
