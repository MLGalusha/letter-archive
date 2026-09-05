import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useReviewNavigationGuard } from '../useReviewNavigationGuard';

function Review({ pending, flush }: { pending: boolean; flush: () => Promise<boolean> }) {
  useReviewNavigationGuard(pending, flush);
  return <Link to="/next">Leave review</Link>;
}

describe('review navigation protection', () => {
  it('waits for a successful flush before unmounting the editor', async () => {
    let finish!: (saved: boolean) => void;
    const flush = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const router = createMemoryRouter([
      { path: '/', element: <Review pending flush={flush} /> },
      { path: '/next', element: <p>Next page</p> },
    ]);
    render(<RouterProvider router={router} />);
    act(() => { screen.getByText('Leave review').click(); });
    await waitFor(() => expect(flush).toHaveBeenCalledOnce());
    expect(screen.queryByText('Next page')).toBeNull();
    await act(async () => { finish(true); });
    expect(await screen.findByText('Next page')).toBeVisible();
  });

  it('warns on document exit only while there are unsaved edits', () => {
    const flush = vi.fn(async () => true);
    const router = createMemoryRouter([{ path: '/', element: <Review pending flush={flush} /> }]);
    const view = render(<RouterProvider router={router} />);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(flush).not.toHaveBeenCalled();
    view.unmount();
    const cleanRouter = createMemoryRouter([{ path: '/', element: <Review pending={false} flush={flush} /> }]);
    render(<RouterProvider router={cleanRouter} />);
    const cleanExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanExit);
    expect(cleanExit.defaultPrevented).toBe(false);
  });
});
