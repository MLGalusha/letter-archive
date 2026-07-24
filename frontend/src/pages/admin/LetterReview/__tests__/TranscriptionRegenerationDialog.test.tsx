import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TranscriptionRegenerationDialog from '../TranscriptionRegenerationDialog';

const buildProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  onLetter: vi.fn(),
  onExtras: vi.fn(),
  onBoth: vi.fn(),
});

describe('TranscriptionRegenerationDialog', () => {
  it('renders only the choices supplied by its composition owner', () => {
    const props = buildProps();
    const { rerender } = render(
      <TranscriptionRegenerationDialog
        {...props}
        isOpen={false}
      />,
    );
    expect(
      screen.queryByRole('dialog', { name: 'Regenerate Transcription' }),
    ).not.toBeInTheDocument();

    rerender(
      <TranscriptionRegenerationDialog
        isOpen
        onClose={props.onClose}
        onLetter={props.onLetter}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Letter Transcript' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Extra Content' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Both' }),
    ).not.toBeInTheDocument();

    rerender(<TranscriptionRegenerationDialog {...props} />);
    expect(
      screen.getByRole('button', { name: 'Extra Content' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Both' })).toBeInTheDocument();
  });

  it('routes each choice and backdrop interaction to exactly one owner', () => {
    const props = buildProps();
    render(<TranscriptionRegenerationDialog {...props} />);

    fireEvent.click(screen.getByRole('button', {
      name: 'Letter Transcript',
    }));
    expect(props.onLetter).toHaveBeenCalledTimes(1);
    expect(props.onExtras).not.toHaveBeenCalled();
    expect(props.onBoth).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Extra Content' }));
    expect(props.onExtras).toHaveBeenCalledTimes(1);
    expect(props.onBoth).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Both' }));
    expect(props.onBoth).toHaveBeenCalledTimes(1);
    expect(props.onLetter).toHaveBeenCalledTimes(1);
    expect(props.onExtras).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog', {
      name: 'Regenerate Transcription',
    }));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(document.querySelector('.confirm-dialog-overlay')!);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
