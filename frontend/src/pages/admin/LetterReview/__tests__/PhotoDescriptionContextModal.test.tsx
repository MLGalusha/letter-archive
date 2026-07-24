import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhotoDescriptionContextModal } from '../PhotoDescriptionContextModal';

describe('PhotoDescriptionContextModal', () => {
  it('preserves the existing context form and delegates its actions', async () => {
    const user = userEvent.setup();
    const onContextChange = vi.fn();
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(
      <PhotoDescriptionContextModal
        view={{
          isOpen: true,
          hasDescription: true,
          hasSavedContext: true,
          draftContext: 'Porch snapshot',
          generating: false,
        }}
        onContextChange={onContextChange}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Regenerate Photo Description' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Current saved context/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('AI Context'), '!');
    await user.click(screen.getByRole('button', { name: 'Regenerate Description' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onContextChange).toHaveBeenLastCalledWith('Porch snapshot!');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables every dialog control while generation is running', () => {
    render(
      <PhotoDescriptionContextModal
        view={{
          isOpen: true,
          hasDescription: false,
          hasSavedContext: false,
          draftContext: '',
          generating: true,
        }}
        onContextChange={vi.fn()}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('AI Context')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Describing...' })).toBeDisabled();
  });
});
