import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';
import { Modal } from '../Modal';

describe('accessible modal boundary', () => {
  it('labels, contains, closes, and restores focus for shared modals', () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Open details';
    document.body.append(opener);
    opener.focus();

    const { rerender } = render(
      <Modal
        isOpen
        onClose={onClose}
        title="Archive details"
        subtitle="Review this record"
        actions={<button type="button">Save</button>}
      >
        <button type="button">Edit</button>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Archive details',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Review this record');
    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(close).toHaveFocus();

    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <Modal
        isOpen={false}
        onClose={onClose}
        title="Archive details"
      >
        Hidden
      </Modal>,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('gives confirmation dialogs the same keyboard and naming contract', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        isOpen
        title="Delete letter"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Delete letter' });
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss a confirmation while its operation is running', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        isOpen
        loading
        title="Delete letter"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    rerender(
      <ConfirmDialog
        isOpen
        title="Delete letter"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
