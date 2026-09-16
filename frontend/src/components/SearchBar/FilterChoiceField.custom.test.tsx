import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import FilterChoiceField from './FilterChoiceField';

function Harness() {
  const [value, setValue] = useState('family');
  return <><FilterChoiceField id="topic" label="Topic" placeholder="All" value={value} options={[]} open searchable allowCustom multiple maxSelections={2} onOpenChange={() => {}} onChange={setValue} /><output>{value}</output></>;
}

describe('custom topic choices', () => {
  it('trims a literal category and respects the selection limit', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('searchbox');
    expect(screen.getByRole('button', { name: /Use typed topic/ })).toBeDisabled();
    await user.type(input, ' work% ');
    await user.click(screen.getByRole('button', { name: 'Use typed topic: work%' }));
    expect(screen.getByRole('status')).toHaveTextContent('family,work%');
    await user.type(input, 'third');
    expect(screen.getByRole('button', { name: /Use typed topic/ })).toBeDisabled();
  });

  it('rejects empty, duplicate, comma-separated and oversized custom values', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('searchbox');
    for (const value of [' ', 'FAMILY', 'work,travel', 'x'.repeat(121), 'x'.repeat(115)]) {
      await user.clear(input);
      await user.type(input, value);
      expect(screen.getByRole('button', { name: /Use typed topic/ })).toBeDisabled();
    }
  });
  it('bounds existing multi-select values to the API field limit while allowing removal', () => {
    render(<FilterChoiceField id="tone" label="Tone" value="family" placeholder="All" options={[{ value: 'family', label: 'Family' }, { value: 'work', label: 'Work' }]} open multiple maxValueLength={10} onOpenChange={() => {}} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Work/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Family/ })).not.toBeDisabled();
  });

});
