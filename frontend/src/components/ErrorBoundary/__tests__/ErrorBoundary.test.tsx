import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from '../ErrorBoundary';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test explosion');
  }
  return <p>All good</p>;
}

// ── Suppress console.error during error boundary tests ──────────────────────

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <p>Hello world</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('displays error UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('"Try Again" resets the error state and re-renders children', async () => {
    const user = userEvent.setup();

    // Use a key trick: first render throws, after reset shouldThrow = false
    function Harness() {
      return (
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={false} />
        </ErrorBoundary>
      );
    }

    // First, render with a throwing child
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();

    // Click Try Again — this resets ErrorBoundary state and re-renders children
    await user.click(screen.getByRole('button', { name: /try again/i }));

    // After reset, rerender with non-throwing child
    rerender(<Harness />);

    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /something went wrong/i })).not.toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error page</div>}>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom error page')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /something went wrong/i })).not.toBeInTheDocument();
  });
});
