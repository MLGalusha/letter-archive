import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../../../components/common/ConfirmDialog';
import { Dropdown } from '../../../../components/common/Dropdown';
import TranscriptionRegenerationDialog from '../TranscriptionRegenerationDialog';
import modalCss from '../../../../components/common/Modal.css?inline';
import dropdownCss from '../../../../components/common/Dropdown.css?inline';
import formCss from '../../../../components/common/Form.css?inline';
import searchCss from '../../../../components/SearchBar/SearchBar.css?inline';
import collectionsCss from '../../../CollectionsPage.css?inline';
import reviewCss from '../../LetterReviewPage.css?inline';
import dashboardCss from '../../AdminDashboard.css?inline';

const styles: HTMLStyleElement[] = [];
function loadCss(css: string) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  styles.push(style);
}
afterEach(() => styles.splice(0).forEach(style => style.remove()));

// Lazy routes leave their styles loaded after navigation. Exercise both orders
// against shared components and public filter/sort DOM contracts.
describe.each(['admin-first', 'admin-last'])('CSS ownership: %s', order => {
  function loadStyles() {
    const shared = [modalCss, dropdownCss, formCss, searchCss, collectionsCss].join('\n');
    const admin = [reviewCss, dashboardCss].join('\n');
    for (const css of order === 'admin-first' ? [admin, shared] : [shared, admin]) loadCss(css);
  }

  it('keeps shared and review confirmation actions independently aligned', () => {
    loadStyles();
    const { container } = render(<>
      <ConfirmDialog isOpen title="Shared confirmation" message="Keep shared sizing" onConfirm={vi.fn()} onCancel={vi.fn()} />
      <TranscriptionRegenerationDialog isOpen onClose={vi.fn()} onLetter={vi.fn()} />
    </>);
    expect(getComputedStyle(screen.getByRole('dialog', { name: 'Shared confirmation' })).width).toBe('100%');
    expect(getComputedStyle(container.querySelector('.confirm-dialog-actions')!).justifyContent).toBe('center');
    expect(getComputedStyle(container.querySelector('.review-confirm-dialog-actions')!).justifyContent).toBe('flex-end');
    expect(getComputedStyle(container.querySelector('.review-confirm-dialog')!).textAlign).toBe('center');
  });

  it('preserves shared form/dropdown and public filter/sort layouts', () => {
    loadStyles();
    const { container } = render(<>
      <div className="form-row"><div className="form-group">Shared form</div></div>
      <div className="review-form-row"><div className="review-form-group">Review form</div></div>
      <Dropdown trigger={<button>Open</button>} isOpen={false} onClose={vi.fn()}>Choices</Dropdown>
      <div className="filter-section"><div className="filter-group">Public search</div></div>
      <button className="sort-option">Public sort</button>
    </>);
    const style = (selector: string) => getComputedStyle(container.querySelector(selector)!);
    expect(style('.form-row').display).toBe('grid');
    expect(style('.review-form-row').display).toBe('flex');
    expect(style('.form-group').gap).toBe('0.375rem');
    expect(style('.dropdown-container').display).toBe('inline-block');
    expect(style('.filter-section').gap).toBe('0.3rem');
    expect(style('.filter-group').gap).toBe('0.2rem');
    expect(style('.sort-option').display).toBe('flex');
  });

});
