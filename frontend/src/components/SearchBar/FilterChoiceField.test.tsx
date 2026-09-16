import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import FilterChoiceField from './FilterChoiceField';

function Harness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  return <FilterChoiceField id="tone" label="Tone" value={value} placeholder="All" options={[
    { value: 'hopeful', label: 'Hopeful' }, { value: 'sad', label: 'Sad' },
  ]} open={open} multiple allowClear onChange={setValue} onOpenChange={setOpen} />;
}

describe('filter choice keyboard controls', () => {
  it('announces selections, stays open while choosing, and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Tone' });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    const group = screen.getByRole('group', { name: 'Tone' });
    const hopeful = within(group).getByRole('button', { name: 'Hopeful' });
    hopeful.focus();
    await user.keyboard(' ');
    expect(hopeful).toHaveAttribute('aria-pressed', 'true');
    await user.tab();
    await user.keyboard(' ');
    expect(within(group).getByRole('button', { name: 'Sad' })).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
