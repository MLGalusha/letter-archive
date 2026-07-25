import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TranscriptionRegenerationDialog from '../TranscriptionRegenerationDialog';

const buildProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  onLetter: vi.fn(),
  onExtras: vi.fn(),
  onBoth: vi.fn(),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

  it('contains keyboard focus, closes on Escape, and restores its opener', () => {
    const props = buildProps();
    const opener = document.createElement('button');
    opener.textContent = 'Open transcription choices';
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(
      <TranscriptionRegenerationDialog {...props} />,
    );
    const letter = screen.getByRole('button', {
      name: 'Letter Transcript',
    });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const dialog = screen.getByRole('dialog', {
      name: 'Regenerate Transcription',
    });
    expect(dialog).toHaveAccessibleDescription(
      'Choose what to regenerate. This will overwrite the existing content.',
    );
    expect(letter).toHaveFocus();

    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(letter).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    rerender(
      <TranscriptionRegenerationDialog {...props} isOpen={false} />,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('restores focus after a choice finishes and its opener is re-enabled', async () => {
    const operation = deferred<void>();
    const opener = document.createElement('button');
    opener.textContent = 'Open transcription choices';
    document.body.append(opener);
    opener.focus();
    const props = buildProps();
    props.onLetter.mockImplementation(() => {
      opener.disabled = true;
      return operation.promise;
    });

    const { rerender } = render(
      <TranscriptionRegenerationDialog {...props} />,
    );
    fireEvent.click(screen.getByRole('button', {
      name: 'Letter Transcript',
    }));
    rerender(
      <TranscriptionRegenerationDialog {...props} isOpen={false} />,
    );
    expect(opener).not.toHaveFocus();

    await act(async () => {
      opener.disabled = false;
      operation.resolve();
      await operation.promise;
    });
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
    opener.remove();
  });
});
