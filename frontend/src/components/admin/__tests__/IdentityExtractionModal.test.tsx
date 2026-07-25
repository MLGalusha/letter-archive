import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IdentityExtractionModal from '../IdentityExtractionModal';

const buildProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  sender: 'Visible Sender',
  recipient: 'Visible Recipient',
  onSenderChange: vi.fn(),
  onRecipientChange: vi.fn(),
  letterTitle: 'Letter One',
});

describe('IdentityExtractionModal', () => {
  it('keeps presentation controlled and routes actions to one owner', () => {
    const props = buildProps();
    const { container, rerender } = render(
      <IdentityExtractionModal {...props} isOpen={false} />,
    );
    expect(container.querySelector('.modal-content')).not.toBeInTheDocument();

    rerender(<IdentityExtractionModal {...props} />);
    expect(screen.getByRole('heading', {
      name: 'Generate Metadata',
    })).toBeInTheDocument();
    expect(screen.getByText(
      '"Letter One" will treat these names as trusted guidance.',
    )).toBeInTheDocument();
    expect(screen.getByLabelText('Sender')).toHaveValue('Visible Sender');
    expect(screen.getByLabelText('Recipient')).toHaveValue(
      'Visible Recipient',
    );

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

    fireEvent.click(screen.getByRole('button', {
      name: 'Generate Metadata',
    }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);

    const content = container.querySelector('.modal-content')!;
    fireEvent.click(content);
    expect(props.onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(props.onClose).toHaveBeenCalledTimes(3);
  });

  it('preserves the existing regenerate and submitting contract', () => {
    const props = buildProps();
    const { container } = render(
      <IdentityExtractionModal
        {...props}
        mode="regenerate"
        submitting
      />,
    );

    expect(screen.getByRole('heading', {
      name: 'Refresh Metadata',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', {
      name: 'Refreshing...',
    })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
