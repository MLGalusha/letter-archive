// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryRouter,
  Link,
  RouterProvider,
  useNavigate,
} from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { useLineReviewNavigationGuard } from '../useLineReviewNavigationGuard';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

interface ReviewRouteProps {
  hasPendingChanges: () => boolean;
  flushPendingChanges: () => Promise<boolean>;
}

function ReviewRoute({
  hasPendingChanges,
  flushPendingChanges,
}: ReviewRouteProps) {
  const navigate = useNavigate();
  const { navigationPending } = useLineReviewNavigationGuard({
    active: true,
    hasPendingChanges,
    flushPendingChanges,
  });

  return (
    <main>
      <h1>Letter review</h1>
      <button
        type="button"
        disabled={navigationPending}
      >
        Edit surface
      </button>
      <Link to="/admin">Sidebar dashboard</Link>
      <button
        type="button"
        onClick={() => navigate('/admin/settings')}
      >
        Programmatic settings
      </button>
    </main>
  );
}

function renderGuardedRouter(
  props: ReviewRouteProps,
  initialEntries = ['/admin/letters/letter-a'],
  initialIndex = 0,
) {
  const router = createMemoryRouter([
    {
      path: '/admin/letters/:letterId',
      element: <ReviewRoute {...props} />,
    },
    {
      path: '/admin',
      element: <h1>Dashboard</h1>,
    },
    {
      path: '/admin/settings',
      element: <h1>Settings</h1>,
    },
  ], {
    initialEntries,
    initialIndex,
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('useLineReviewNavigationGuard', () => {
  it('keeps a sidebar transition mounted until the pending save succeeds', async () => {
    const save = deferred<boolean>();
    const flushPendingChanges = vi.fn(() => save.promise);
    const router = renderGuardedRouter({
      hasPendingChanges: () => true,
      flushPendingChanges,
    });

    fireEvent.click(screen.getByRole('link', {
      name: 'Sidebar dashboard',
    }));

    await waitFor(() => {
      expect(flushPendingChanges).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('heading', {
      name: 'Letter review',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Edit surface',
    })).toBeDisabled();
    expect(router.state.location.pathname)
      .toBe('/admin/letters/letter-a');

    await act(async () => {
      save.resolve(true);
      await save.promise;
    });

    expect(await screen.findByRole('heading', {
      name: 'Dashboard',
    })).toBeInTheDocument();
    expect(flushPendingChanges).toHaveBeenCalledTimes(1);
  });

  it('stays on the current route when a programmatic transition cannot save', async () => {
    const flushPendingChanges = vi.fn(async () => false);
    const router = renderGuardedRouter({
      hasPendingChanges: () => true,
      flushPendingChanges,
    });

    fireEvent.click(screen.getByRole('button', {
      name: 'Programmatic settings',
    }));

    await waitFor(() => {
      expect(flushPendingChanges).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('heading', {
      name: 'Letter review',
    })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: 'Edit surface',
      })).not.toBeDisabled();
    });
    expect(router.state.location.pathname)
      .toBe('/admin/letters/letter-a');
  });

  it('uses one flush and the latest destination when navigation changes mid-save', async () => {
    const save = deferred<boolean>();
    const flushPendingChanges = vi.fn(() => save.promise);
    const router = renderGuardedRouter({
      hasPendingChanges: () => true,
      flushPendingChanges,
    });

    fireEvent.click(screen.getByRole('link', {
      name: 'Sidebar dashboard',
    }));
    await waitFor(() => {
      expect(flushPendingChanges).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', {
      name: 'Programmatic settings',
    }));
    expect(flushPendingChanges).toHaveBeenCalledTimes(1);

    await act(async () => {
      save.resolve(true);
      await save.promise;
    });

    expect(await screen.findByRole('heading', {
      name: 'Settings',
    })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/settings');
    expect(flushPendingChanges).toHaveBeenCalledTimes(1);
  });

  it('does not block or flush when geometry is clean', async () => {
    const flushPendingChanges = vi.fn(async () => true);
    renderGuardedRouter({
      hasPendingChanges: () => false,
      flushPendingChanges,
    });

    fireEvent.click(screen.getByRole('link', {
      name: 'Sidebar dashboard',
    }));

    expect(await screen.findByRole('heading', {
      name: 'Dashboard',
    })).toBeInTheDocument();
    expect(flushPendingChanges).not.toHaveBeenCalled();
  });

  it.each([
    {
      direction: -1,
      destination: 'Dashboard',
      destinationPath: '/admin',
      label: 'back',
    },
    {
      direction: 1,
      destination: 'Settings',
      destinationPath: '/admin/settings',
      label: 'forward',
    },
  ])(
    'holds browser $label navigation until the save succeeds',
    async ({
      direction,
      destination,
      destinationPath,
    }) => {
      const save = deferred<boolean>();
      const flushPendingChanges = vi.fn(() => save.promise);
      const router = renderGuardedRouter(
        {
          hasPendingChanges: () => true,
          flushPendingChanges,
        },
        [
          '/admin',
          '/admin/letters/letter-a',
          '/admin/settings',
        ],
        1,
      );

      act(() => {
        void router.navigate(direction);
      });

      await waitFor(() => {
        expect(flushPendingChanges).toHaveBeenCalledTimes(1);
      });
      expect(router.state.location.pathname)
        .toBe('/admin/letters/letter-a');

      await act(async () => {
        save.resolve(true);
        await save.promise;
      });

      expect(await screen.findByRole('heading', {
        name: destination,
      })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(destinationPath);
      expect(flushPendingChanges).toHaveBeenCalledTimes(1);
    },
  );
});
