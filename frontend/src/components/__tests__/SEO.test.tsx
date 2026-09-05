import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SEO from '../SEO';

vi.mock('../../hooks/useSiteSettings', () => ({ useSiteSettings: () => ({
  site_title: 'Family Archive', site_description: 'Letters preserved by our family.',
}) }));

it('uses site settings for default metadata and preserves page overrides', () => {
  const { rerender } = render(<SEO />);
  expect(document.title).toBe('Family Archive');
  expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Letters preserved by our family.');
  rerender(<SEO title="Collection Nine" description="Letters from 1947." />);
  expect(document.title).toBe('Collection Nine | Family Archive');
  expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Letters from 1947.');
  expect(document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')).toBe('Family Archive');
});

it('uses the configured name in nested site-owned structured metadata', () => {
  render(<SEO jsonLd={{ '@type': 'BlogPosting', publisher: { '@type': 'Organization', name: 'Voices That Remain' }, author: { '@type': 'Person', name: 'Historical Author' } }} />);
  const data = JSON.parse(document.querySelector('script[data-seo-jsonld]')!.textContent!);
  expect(data.publisher.name).toBe('Family Archive');
  expect(data.author.name).toBe('Historical Author');
});
