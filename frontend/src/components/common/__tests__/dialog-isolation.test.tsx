import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useAccessibleDialog } from '../useAccessibleDialog';

function Dialog({ name, children, onClose }: { name: string; children?: React.ReactNode; onClose: () => void }) {
  const { dialogRef } = useAccessibleDialog({ isOpen: true, onClose, isolateBackground: true });
  return createPortal(<div ref={dialogRef} role="dialog" aria-modal="true" aria-label={name} tabIndex={-1}>
    <button onClick={onClose}>Close {name}</button>{children}
  </div>, document.body);
}
function Fixture() {
  const [parent, setParent] = useState(false);
  const [child, setChild] = useState(false);
  return <><button onClick={() => setParent(true)}>Open viewer</button>
    {parent && <Dialog name="viewer" onClose={() => setParent(false)}>
      <div style={{ display: 'none' }}><button>Hidden control</button></div>
      <button tabIndex={-1}>Programmatic only</button>
      <button disabled>Disabled control</button>
      <button onClick={() => setChild(true)}>Open details</button>
    </Dialog>}
    {child && <Dialog name="details" onClose={() => setChild(false)} />}
  </>;
}

describe('opt-in modal background isolation', () => {
  it('unwinds nested portals in order and preserves prior inert state', () => {
    const prior = document.createElement('aside');
    prior.setAttribute('inert', ''); document.body.append(prior);
    const view = render(<Fixture />);
    const opener = screen.getByText('Open viewer'); opener.focus(); fireEvent.click(opener);
    expect(view.container).toHaveAttribute('inert');
    const nestedOpener = screen.getByText('Open details');
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(nestedOpener).toHaveFocus();
    fireEvent.click(nestedOpener);
    expect(screen.getByRole('dialog', { name: 'viewer', hidden: true })).toHaveAttribute('inert');
    expect(screen.getByText('Close details')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Close details')).not.toBeInTheDocument();
    expect(nestedOpener).toHaveFocus();
    expect(view.container).toHaveAttribute('inert');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(opener).toHaveFocus(); expect(view.container).not.toHaveAttribute('inert');
    expect(prior).toHaveAttribute('inert'); prior.remove();
  });
  it('cleans isolation on unmount without restoring a disconnected opener', () => {
    const view = render(<Fixture />);
    const opener = screen.getByText('Open viewer'); opener.focus(); fireEvent.click(opener);
    view.unmount();
    expect(view.container).not.toHaveAttribute('inert');
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });
});
