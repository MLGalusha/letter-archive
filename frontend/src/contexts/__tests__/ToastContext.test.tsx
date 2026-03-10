// @vitest-environment jsdom

import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from '../ToastContext';

function Trigger() {
  const { showToast } = useToast();

  return (
    <button
      type="button"
      onClick={() => showToast('Line detector offline (Request ID: req-123)', 'error')}
    >
      Trigger
    </button>
  );
}

describe('ToastProvider', () => {
  it('deduplicates identical toasts while one is already visible', async () => {
    const user = userEvent.setup();

    render(
      <StrictMode>
        <ToastProvider>
          <Trigger />
        </ToastProvider>
      </StrictMode>,
    );

    await user.click(screen.getByRole('button', { name: 'Trigger' }));
    await user.click(screen.getByRole('button', { name: 'Trigger' }));

    expect(
      screen.getAllByText('Line detector offline (Request ID: req-123)'),
    ).toHaveLength(1);
  });
});
