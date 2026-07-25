import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AnalysisRegenerationDialog from '../AnalysisRegenerationDialog';

const buildProps = () => ({
  isOpen: true,
  sender: 'Visible Sender',
  recipient: 'Visible Recipient',
  onSenderChange: vi.fn(),
  onRecipientChange: vi.fn(),
  onChoose: vi.fn(async () => ({
    accepted: true,
    shouldRestoreFocus: true,
  })),
  onClose: vi.fn(),
});

describe('AnalysisRegenerationDialog', () => {
  it('exposes one controlled, labelled modal dialog only while open', () => {
    const props = buildProps();
    const { rerender } = render(
      <AnalysisRegenerationDialog {...props} isOpen={false} />,
    );
    expect(
      screen.queryByRole('dialog', { name: 'Regenerate Analysis' }),
    ).not.toBeInTheDocument();

    rerender(<AnalysisRegenerationDialog {...props} />);
    const dialog = screen.getByRole('dialog', {
      name: 'Regenerate Analysis',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(
      'Choose what to regenerate. This will overwrite the existing data.',
    );
    expect(screen.getByLabelText('Sender')).toHaveValue('Visible Sender');
    expect(screen.getByLabelText('Recipient')).toHaveValue(
      'Visible Recipient',
    );
    expect(screen.getByRole('button', {
      name: 'Metadata Only',
    })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', {
      name: 'Entities Only',
    })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', {
      name: 'Both',
    })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', {
      name: 'Cancel',
    })).toHaveAttribute('type', 'button');

    fireEvent.change(screen.getByLabelText('Sender'), {
      target: { value: 'Changed Sender' },
    });
    fireEvent.change(screen.getByLabelText('Recipient'), {
      target: { value: 'Changed Recipient' },
    });
    expect(props.onSenderChange).toHaveBeenCalledWith('Changed Sender');
    expect(props.onRecipientChange).toHaveBeenCalledWith(
      'Changed Recipient',
    );
  });

  it('routes choices, Cancel, and backdrop clicks to exactly one owner', () => {
    const props = buildProps();
    render(<AnalysisRegenerationDialog {...props} />);

    fireEvent.click(screen.getByRole('button', {
      name: 'Metadata Only',
    }));
    fireEvent.click(screen.getByRole('button', {
      name: 'Entities Only',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Both' }));
    expect(props.onChoose.mock.calls).toEqual([
      ['metadata'],
      ['entities'],
      ['both'],
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog', {
      name: 'Regenerate Analysis',
    }));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(document.querySelector(
      '.analysis-regeneration-overlay',
    )!);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('contains keyboard focus, closes on Escape, and restores its opener', () => {
    const props = buildProps();
    const opener = document.createElement('button');
    opener.textContent = 'Open analysis';
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(
      <AnalysisRegenerationDialog {...props} />,
    );
    const sender = screen.getByLabelText('Sender');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(sender).toHaveFocus();

    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(sender).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    rerender(
      <AnalysisRegenerationDialog {...props} isOpen={false} />,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
