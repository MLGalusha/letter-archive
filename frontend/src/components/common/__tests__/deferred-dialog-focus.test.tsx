import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAccessibleDialog } from '../useAccessibleDialog';

let actions: Pick<ReturnType<typeof useAccessibleDialog>, 'deferFocusRestore' | 'restoreFocusAfterUpdate'>;
function Harness({ open, busy, otherModal = false }: { open: boolean; busy: boolean; otherModal?: boolean }) {
  const { dialogRef, deferFocusRestore, restoreFocusAfterUpdate } = useAccessibleDialog({ isOpen: open, onClose: () => {} });
  useEffect(() => { actions = { deferFocusRestore, restoreFocusAfterUpdate }; });
  return <>
    <button disabled={busy}>Open</button>
    <input aria-label="Other work" />
    {otherModal && <div role="dialog" aria-modal="true">Another dialog</div>}
    {open && <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
      <button>Confirm</button>
    </div>}
  </>;
}

afterEach(() => vi.unstubAllGlobals());

describe('focus restoration after async dialog work', () => {
  it('waits for the React commit that re-enables the opener instead of one animation frame', async () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
    const view = render(<Harness open={false} busy={false} />);
    screen.getByText('Open').focus();
    view.rerender(<Harness open busy={false} />);
    actions.deferFocusRestore();
    view.rerender(<Harness open={false} busy />);
    await act(async () => { actions.restoreFocusAfterUpdate(); });
    act(() => frame?.(0));
    expect(screen.getByText('Open')).not.toHaveFocus();
    view.rerender(<Harness open={false} busy={false} />);
    expect(screen.getByText('Open')).toHaveFocus();
  });

  it('does not steal focus if the user moves to another control during completion', async () => {
    const view = render(<Harness open={false} busy={false} />);
    screen.getByText('Open').focus();
    view.rerender(<Harness open busy={false} />);
    actions.deferFocusRestore();
    view.rerender(<Harness open={false} busy />);
    screen.getByLabelText('Other work').focus();
    await act(async () => { actions.restoreFocusAfterUpdate(); });
    view.rerender(<Harness open={false} busy={false} />);
    expect(screen.getByLabelText('Other work')).toHaveFocus();
  });

  it('cancels a pending return when another modal opens', async () => {
    const view = render(<Harness open={false} busy={false} />);
    screen.getByText('Open').focus();
    view.rerender(<Harness open busy={false} />);
    actions.deferFocusRestore();
    view.rerender(<Harness open={false} busy />);
    await act(async () => { actions.restoreFocusAfterUpdate(); });
    view.rerender(<Harness open={false} busy otherModal />);
    view.rerender(<Harness open={false} busy={false} />);
    expect(screen.getByText('Open')).not.toHaveFocus();
  });

  it('does not retain scheduled work after the owner unmounts', async () => {
    const view = render(<Harness open={false} busy={false} />);
    const opener = screen.getByText('Open');
    opener.focus();
    view.rerender(<Harness open busy={false} />);
    actions.deferFocusRestore();
    view.rerender(<Harness open={false} busy />);
    await act(async () => { actions.restoreFocusAfterUpdate(); });
    const focus = vi.spyOn(opener, 'focus');
    view.unmount();
    await act(async () => {});
    expect(focus).not.toHaveBeenCalled();
  });
});
