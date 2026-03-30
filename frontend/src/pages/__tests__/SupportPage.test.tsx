import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import SupportPage from '../SupportPage';

const getContentPageMock = vi.fn();
const useSiteSettingsMock = vi.fn();

vi.mock('../../api/client', () => ({
  getContentPage: (...args: unknown[]) => getContentPageMock(...args),
}));

vi.mock('../../hooks/useSiteSettings', () => ({
  useSiteSettings: () => useSiteSettingsMock(),
}));

vi.mock('../../components/SEO', () => ({
  default: () => null,
}));

vi.mock('../../components/Footer/Footer', () => ({
  default: () => <footer>Footer</footer>,
}));

describe('SupportPage', () => {
  beforeEach(() => {
    getContentPageMock.mockReset();
    useSiteSettingsMock.mockReset();

    getContentPageMock.mockResolvedValue(null);
    useSiteSettingsMock.mockReturnValue({
      donate_onetime_url: 'https://donate.example.com/once',
      donate_monthly_url: 'https://donate.example.com/monthly',
      contact_general_email: 'info@letterarchive.org',
      contact_contribute_email: 'contribute@letterarchive.org',
      contact_volunteer_email: 'volunteer@letterarchive.org',
    });
  });

  it('shows a setup modal instead of following support actions', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SupportPage />
      </MemoryRouter>,
    );

    const donateLink = screen.getByRole('link', { name: 'Donate Once' });
    const donateClick = createEvent.click(donateLink);
    fireEvent(donateLink, donateClick);

    expect(donateClick.defaultPrevented).toBe(true);
    expect(screen.getByRole('heading', { name: 'Still being set up' })).toBeInTheDocument();
    expect(
      screen.getByText("Donation and email links on this page are not live yet. They're still being set up."),
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Close' })[1]);
    expect(screen.queryByRole('heading', { name: 'Still being set up' })).not.toBeInTheDocument();

    const emailLink = screen.getByRole('link', { name: 'info@letterarchive.org' });
    const emailClick = createEvent.click(emailLink);
    fireEvent(emailLink, emailClick);

    expect(emailClick.defaultPrevented).toBe(true);
    expect(screen.getByRole('heading', { name: 'Still being set up' })).toBeInTheDocument();
  });
});
