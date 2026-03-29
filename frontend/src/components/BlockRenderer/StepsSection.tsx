import type { StepsBlock, StepItem } from '../../content/blocks';
import Editable from './Editable';

interface Props {
  block: StepsBlock;
  editable?: boolean;
  onChange?: (patch: Partial<StepsBlock>) => void;
}

export default function StepsSection({ block, editable, onChange }: Props) {
  const updateStep = (index: number, patch: Partial<StepItem>) => {
    const steps = block.steps.map((step, i) =>
      i === index ? { ...step, ...patch } : step,
    );
    onChange?.({ steps });
  };

  return (
    <section className="blk-steps">
      <Editable
        value={block.eyebrow}
        editable={editable}
        onChange={(v) => onChange?.({ eyebrow: v })}
        tag="div"
        className="blk-eyebrow"
        placeholder="Section label"
      />
      <Editable
        value={block.heading}
        editable={editable}
        onChange={(v) => onChange?.({ heading: v })}
        tag="h2"
        className="blk-steps-heading"
        multiline
        placeholder="Section heading"
      />
      <div className="blk-steps-grid">
        {block.steps.map((step, index) => (
          <div key={index} className="blk-step blk-card">
            <div className="blk-step-number">{String(index + 1).padStart(2, '0')}</div>
            <Editable
              value={step.title}
              editable={editable}
              onChange={(v) => updateStep(index, { title: v })}
              tag="h3"
              className=""
              placeholder="Step title"
            />
            <Editable
              value={step.text}
              editable={editable}
              onChange={(v) => updateStep(index, { text: v })}
              tag="p"
              className=""
              multiline
              placeholder="Step description"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
