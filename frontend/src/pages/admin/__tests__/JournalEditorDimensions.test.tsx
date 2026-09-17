import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { getPost, savePost, publishPost, toast } = vi.hoisted(() => ({ getPost: vi.fn(), savePost: vi.fn(), publishPost: vi.fn(), toast: vi.fn() }));
vi.mock('../../../components/AdminLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../components/JournalImageDialog', () => ({ default: () => null }));
vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: toast }) }));
vi.mock('../../../api/admin/content', () => ({ adminGetBlogPost: getPost, adminUpdateBlogPost: savePost, adminCreateBlogPost: savePost, adminPublishBlogPost: publishPost, adminUnpublishBlogPost: vi.fn(), adminDeleteBlogPost: vi.fn() }));
vi.mock('@mdxeditor/editor', () => {
  const plugin = () => ({});
  const Empty = () => null;
  return { MDXEditor: ({ markdown, onChange }: { markdown: string; onChange: (value: string) => void }) => <textarea aria-label="Markdown" value={markdown} onChange={e => onChange(e.target.value)} />,
    headingsPlugin: plugin, imagePlugin: plugin, linkPlugin: plugin, linkDialogPlugin: plugin, listsPlugin: plugin, markdownShortcutPlugin: plugin, quotePlugin: plugin, tablePlugin: plugin, thematicBreakPlugin: plugin, toolbarPlugin: plugin, codeBlockPlugin: plugin, diffSourcePlugin: plugin,
    BlockTypeSelect: Empty, BoldItalicUnderlineToggles: Empty, CodeToggle: Empty, CreateLink: Empty, DiffSourceToggleWrapper: Empty, InsertCodeBlock: Empty, InsertTable: Empty, InsertThematicBreak: Empty, ListsToggle: Empty, UndoRedo: Empty };
});
import JournalEditorPage from '../UpdateEditorPage';
const source = '/blog-images/a.jpg';
const dimensions = { [source]: { width: 80, height: 160 } };
const post = { id: 'one', title: 'Article', slug: 'article', bodyMarkdown: `![scan](${source} "float-left")`, status: 'draft', heroImageUrl: source, heroImageAlt: '', imageDimensions: dimensions, updatedAt: '2026-09-17T12:00:00Z', publishedAt: null };
function mount() { return render(<MemoryRouter initialEntries={['/admin/content/blog/one']}><Routes><Route path="/admin/content/blog/:id" element={<JournalEditorPage />} /></Routes></MemoryRouter>); }
beforeEach(() => { vi.clearAllMocks(); getPost.mockResolvedValue(post); savePost.mockImplementation(async (_id, payload) => ({ ...post, ...payload })); publishPost.mockResolvedValue({ ...post, status: 'published' }); });
describe('journal editor dimensions', () => {
  it('preserves dimensions through hydration, autosave, explicit save and reload', async () => {
    const view = mount(); await screen.findByDisplayValue('Article');
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: post.bodyMarkdown + '\n\nMore text.' } });
    await waitFor(() => expect(savePost).toHaveBeenCalled(), { timeout: 2500 });
    expect(savePost.mock.calls[0][1]).toMatchObject({ imageDimensions: dimensions });
    expect(savePost.mock.calls[0][1]).not.toHaveProperty('resolveImageSources');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePost.mock.calls.at(-1)?.[1].resolveImageSources).toEqual([source]));
    getPost.mockResolvedValue({ ...post, ...savePost.mock.calls.at(-1)![1] });
    view.unmount(); mount(); await screen.findByDisplayValue('Article');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePost.mock.calls.at(-1)?.[1].imageDimensions).toEqual(dimensions));
  });
  it('does not carry dimensions to a replacement URL and Publish resolves reference images', async () => {
    mount(); await screen.findByDisplayValue('Article');
    fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: '![scan][ref]\n\n[ref]: /blog-images/replaced.jpg "float-right"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishPost).toHaveBeenCalledWith('one'));
    expect(savePost.mock.calls.at(-1)?.[1]).toMatchObject({ imageDimensions: dimensions, resolveImageSources: [source, '/blog-images/replaced.jpg'] });
    expect(savePost.mock.calls.at(-1)?.[1].imageDimensions).not.toHaveProperty('/blog-images/replaced.jpg');
  });
});

it('keeps newer edits when an earlier save completes and never marks a failed save successful', async () => {
  let resolveSave!: (value: unknown) => void;
  savePost.mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  mount(); await screen.findByDisplayValue('Article');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(savePost).toHaveBeenCalledOnce());
  const latest = '![new](/blog-images/new.jpg)';
  fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: latest } });
  resolveSave({ ...post, imageDimensions: { [source]: { width: 999, height: 999 } } });
  await waitFor(() => expect(screen.getByLabelText('Markdown')).toHaveValue(latest));
  await waitFor(() => expect(savePost).toHaveBeenCalledTimes(2), { timeout: 2500 });
  expect(savePost.mock.calls[1][1].bodyMarkdown).toBe(latest);
  expect(savePost.mock.calls[1][1].imageDimensions).toEqual(dimensions);
  savePost.mockRejectedValueOnce(new Error('Offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(document.querySelector('.journal-save-state')).toHaveClass('state-error'));
  expect(screen.getByLabelText('Markdown')).toHaveValue(latest);
});

it('serializes explicit saves behind autosave so server snapshots cannot arrive out of order', async () => {
  let resolveFirst!: (value: unknown) => void;
  savePost.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  mount(); await screen.findByDisplayValue('Article');
  fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'First edit' } });
  await waitFor(() => expect(savePost).toHaveBeenCalledOnce(), { timeout: 2500 });
  fireEvent.change(screen.getByLabelText('Markdown'), { target: { value: 'Newer edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(savePost).toHaveBeenCalledOnce();
  resolveFirst({ ...post, bodyMarkdown: 'First edit' });
  await waitFor(() => expect(savePost).toHaveBeenCalledTimes(2));
  expect(savePost.mock.calls[1][1].bodyMarkdown).toBe('Newer edit');
  expect(screen.getByLabelText('Markdown')).toHaveValue('Newer edit');
});
