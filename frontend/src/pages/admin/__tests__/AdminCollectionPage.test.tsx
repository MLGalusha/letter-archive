import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AdminCollectionWithLetters,
  CollectionProfileCorrespondent,
} from '../../../api/collections';
import type { Letter } from '../../../types/Letter';

const {
  generateCollectionProfileMock,
  getAdminCollectionByCodeMock,
  showToastMock,
  updateCollectionEditorMock,
} = vi.hoisted(() => ({
  generateCollectionProfileMock: vi.fn(),
  getAdminCollectionByCodeMock: vi.fn(),
  showToastMock: vi.fn(),
  updateCollectionEditorMock: vi.fn(),
}));

vi.mock('../../../api/collections', () => ({
  generateCollectionProfile: (...args: unknown[]) => generateCollectionProfileMock(...args),
  getAdminCollectionByCode: (...args: unknown[]) => getAdminCollectionByCodeMock(...args),
  updateCollectionEditor: (...args: unknown[]) => updateCollectionEditorMock(...args),
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock('../../../components/AdminLayout', () => ({
  default: ({
    children,
    headerActions,
  }: {
    children: ReactNode;
    headerActions?: ReactNode;
  }) => (
    <div>
      <div>{headerActions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('../../../components/common', () => ({
  Button: ({
    children,
    size,
    variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: string;
    variant?: string;
  }) => (
    <button type="button" data-size={size} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('../../../components/common/Icon', () => ({
  default: () => <span aria-hidden="true">icon</span>,
}));

vi.mock('../../../components/ShowcaseCard', () => ({
  default: () => <div>Showcase</div>,
}));

vi.mock('../../../components/LetterCard/LetterCard', () => ({
  default: () => <div>Letter card</div>,
}));

import AdminCollectionPage from '../AdminCollectionPage';

const IDENTITY_FINGERPRINT = 'b'.repeat(64);
const PROFILE_CORRESPONDENTS: CollectionProfileCorrespondent[] = [
  {
    name: 'Alice Adams',
    hook: 'Alice old hook',
    biography: 'Alice old biography',
  },
  {
    name: 'Bob Brown',
    hook: 'Bob old hook',
    biography: 'Bob old biography',
  },
];

function makeLetter(): Letter {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Alice to Bob',
    collectionCode: '009',
    primarySourceRevision: 0,
    images: [],
    transcript: {
      pages: [],
      fullText: 'Dear Bob',
      verified: true,
    },
    metadata: {
      sender: 'Alice Adams',
      recipient: 'Bob Brown',
      date: '1947-08-10',
      dateRaw: '19470810',
      verified: true,
    },
    status: 'published',
    workflowState: 'REVIEWED',
    visibility: 'PUBLISHED',
    transcriptPublished: true,
    metadataPublished: true,
    transcriptStatus: 'VERIFIED',
    metadataContentStatus: 'VERIFIED',
    extraContentStatus: 'EMPTY',
    flagged: false,
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}

function makeCollection(
  overrides: Partial<AdminCollectionWithLetters> = {},
): AdminCollectionWithLetters {
  return {
    id: '00000000-0000-4000-8000-000000000009',
    collectionCode: '009',
    title: 'Test Collection',
    description: 'Collection notes',
    createdAt: '2026-07-24T00:00:00.000Z',
    profileRevision: 5,
    identityFingerprint: IDENTITY_FINGERPRINT,
    letterCount: 1,
    hook: 'Collection hook',
    profileNarrative: 'Collection narrative',
    profileStatus: 'EDITED',
    profileStartHereLetterId: null,
    profileCorrespondents: PROFILE_CORRESPONDENTS,
    letters: [makeLetter()],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/collections/009']}>
      <Routes>
        <Route path="/admin/collections/:code" element={<AdminCollectionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitForCollection() {
  await screen.findByRole('heading', { name: 'Test Collection' });
}

function correspondentField(
  id: string,
): HTMLInputElement | HTMLTextAreaElement {
  const field = document.getElementById(id);
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new Error(`Expected correspondent field ${id}`);
  }
  return field;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('AdminCollectionPage profile mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminCollectionByCodeMock.mockResolvedValue(makeCollection());
    updateCollectionEditorMock.mockResolvedValue({
      profileRevision: 6,
      identityFingerprint: IDENTITY_FINGERPRINT,
      updatedLetterCount: 0,
      changed: true,
    });
  });

  it('accumulates profile and correspondent edits into one atomic request', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCollection();

    const aliceHook = correspondentField('correspondent-hook-alice adams');
    const bobBiography = correspondentField('correspondent-bio-bob brown');
    await user.clear(aliceHook);
    await user.type(aliceHook, 'Alice revised hook');
    await user.clear(bobBiography);
    await user.type(bobBiography, 'Bob revised biography');

    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(updateCollectionEditorMock).toHaveBeenCalledOnce();
    });
    expect(updateCollectionEditorMock).toHaveBeenCalledWith('009', {
      profileRevision: 5,
      identityFingerprint: IDENTITY_FINGERPRINT,
      hook: 'Collection hook',
      profileNarrative: 'Collection narrative',
      profileStartHereLetterId: null,
      profileCorrespondents: [
        {
          name: 'Alice Adams',
          hook: 'Alice revised hook',
          biography: 'Alice old biography',
        },
        {
          name: 'Bob Brown',
          hook: 'Bob old hook',
          biography: 'Bob revised biography',
        },
      ],
      correspondentRenames: [],
    });
  });

  it('applies simultaneous profile renames from one original snapshot', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCollection();

    const aliceName = correspondentField('correspondent-alice adams');
    const bobName = correspondentField('correspondent-bob brown');
    await user.clear(aliceName);
    await user.type(aliceName, 'Carol Clark');
    await user.clear(bobName);
    await user.type(bobName, 'David Davis');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(updateCollectionEditorMock).toHaveBeenCalledOnce();
    });
    expect(updateCollectionEditorMock).toHaveBeenCalledWith('009', expect.objectContaining({
      profileCorrespondents: [
        {
          name: 'Carol Clark',
          hook: 'Alice old hook',
          biography: 'Alice old biography',
        },
        {
          name: 'David Davis',
          hook: 'Bob old hook',
          biography: 'Bob old biography',
        },
      ],
      correspondentRenames: [
        {
          oldName: 'Alice Adams',
          newName: 'Carol Clark',
          roles: ['sender'],
        },
        {
          oldName: 'Bob Brown',
          newName: 'David Davis',
          roles: ['recipient'],
        },
      ],
    }));
  });

  it('preserves the complete dirty draft after an atomic save failure', async () => {
    updateCollectionEditorMock
      .mockRejectedValueOnce(new Error('Atomic update failed'))
      .mockResolvedValueOnce({
        profileRevision: 6,
        identityFingerprint: 'c'.repeat(64),
        updatedLetterCount: 1,
        changed: true,
      });

    const user = userEvent.setup();
    renderPage();
    await waitForCollection();

    const aliceName = correspondentField('correspondent-alice adams');
    const collectionHook = screen.getByPlaceholderText(
      'Write or generate a collection hook...',
    );
    const collectionNotes = screen.getByPlaceholderText(
      'Write or add collection notes...',
    );
    await user.clear(aliceName);
    await user.type(aliceName, 'Alicia Adams');
    await user.clear(collectionHook);
    await user.type(collectionHook, 'Unsaved revised hook');
    await user.clear(collectionNotes);
    await user.type(collectionNotes, 'Unsaved revised notes');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(updateCollectionEditorMock).toHaveBeenCalledOnce();
    });
    expect(showToastMock).toHaveBeenCalledWith('Atomic update failed', 'error');
    expect(getAdminCollectionByCodeMock).toHaveBeenCalledOnce();
    expect(aliceName).toHaveValue('Alicia Adams');
    expect(collectionHook).toHaveValue('Unsaved revised hook');
    expect(collectionNotes).toHaveValue('Unsaved revised notes');
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
    expect(updateCollectionEditorMock).toHaveBeenLastCalledWith('009', {
      profileRevision: 5,
      identityFingerprint: IDENTITY_FINGERPRINT,
      hook: 'Unsaved revised hook',
      profileNarrative: 'Collection narrative',
      profileStartHereLetterId: null,
      description: 'Unsaved revised notes',
      correspondentRenames: [{
        oldName: 'Alice Adams',
        newName: 'Alicia Adams',
        roles: ['sender'],
      }],
      profileCorrespondents: [
        {
          name: 'Alicia Adams',
          hook: 'Alice old hook',
          biography: 'Alice old biography',
        },
        PROFILE_CORRESPONDENTS[1],
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => {
      expect(updateCollectionEditorMock).toHaveBeenCalledTimes(2);
      expect(getAdminCollectionByCodeMock).toHaveBeenCalledTimes(2);
    });
    expect(updateCollectionEditorMock.mock.calls[1]?.[1]).toMatchObject({
      profileRevision: 5,
      identityFingerprint: IDENTITY_FINGERPRINT,
      hook: 'Unsaved revised hook',
      description: 'Unsaved revised notes',
      correspondentRenames: [{
        oldName: 'Alice Adams',
        newName: 'Alicia Adams',
        roles: ['sender'],
      }],
    });
  });

  it('uses the committed revision when the authoritative reload must be retried', async () => {
    updateCollectionEditorMock.mockResolvedValue({
      profileRevision: 6,
      identityFingerprint: 'c'.repeat(64),
      updatedLetterCount: 1,
      changed: true,
    });
    getAdminCollectionByCodeMock
      .mockReset()
      .mockResolvedValueOnce(makeCollection())
      .mockRejectedValueOnce(new Error('Reload failed'))
      .mockResolvedValue(makeCollection({
        profileRevision: 6,
        hook: 'Saved hook',
      }));

    const user = userEvent.setup();
    renderPage();
    await waitForCollection();

    const collectionHook = screen.getByPlaceholderText(
      'Write or generate a collection hook...',
    );
    const aliceName = correspondentField('correspondent-alice adams');
    await user.clear(aliceName);
    await user.type(aliceName, 'Alicia Adams');
    await user.clear(collectionHook);
    await user.type(collectionHook, 'Saved hook');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(getAdminCollectionByCodeMock).toHaveBeenCalledTimes(2);
      expect(showToastMock).toHaveBeenCalledWith('Reload failed', 'error');
      expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
    });
    expect(collectionHook).toHaveValue('Saved hook');
    expect(aliceName).toHaveValue('Alicia Adams');

    await user.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => {
      expect(updateCollectionEditorMock).toHaveBeenCalledTimes(2);
    });
    expect(updateCollectionEditorMock.mock.calls[1]?.[1]).toMatchObject({
      profileRevision: 6,
      identityFingerprint: 'c'.repeat(64),
      hook: 'Saved hook',
    });
  });

  it('blocks generation while unsaved profile edits exist', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCollection();

    const collectionHook = screen.getByPlaceholderText(
      'Write or generate a collection hook...',
    );
    await user.type(collectionHook, ' changed');

    expect(screen.getByRole('button', { name: 'Regenerate profile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
  });

  it('uses the committed generation revision when its reload must be retried', async () => {
    getAdminCollectionByCodeMock
      .mockReset()
      .mockResolvedValueOnce(makeCollection())
      .mockRejectedValueOnce(new Error('Reload failed'))
      .mockResolvedValue(makeCollection({ profileRevision: 7 }));
    generateCollectionProfileMock
      .mockResolvedValueOnce({
        hook: 'Generated hook',
        narrative: 'Generated narrative',
        correspondents: PROFILE_CORRESPONDENTS,
        profileStatus: 'AI_DRAFT',
        profileRevision: 6,
        isStub: false,
      })
      .mockResolvedValueOnce({
        hook: 'Regenerated hook',
        narrative: 'Regenerated narrative',
        correspondents: PROFILE_CORRESPONDENTS,
        profileStatus: 'AI_DRAFT',
        profileRevision: 7,
        isStub: false,
      });

    const user = userEvent.setup();
    renderPage();
    await waitForCollection();

    await user.click(screen.getByRole('button', { name: 'Regenerate profile' }));
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(getAdminCollectionByCodeMock).toHaveBeenCalledTimes(2);
      expect(showToastMock).toHaveBeenCalledWith('Reload failed', 'error');
    });

    await user.click(screen.getByRole('button', { name: 'Regenerate profile' }));
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(generateCollectionProfileMock).toHaveBeenCalledTimes(2);
    });
    expect(generateCollectionProfileMock).toHaveBeenNthCalledWith(
      2,
      '009',
      6,
      true,
    );
  });

  it('locks editing and save actions while profile generation is running', async () => {
    const generation = deferred<{
      hook: string;
      narrative: string;
      correspondents: CollectionProfileCorrespondent[];
      profileStatus: 'AI_DRAFT';
      profileRevision: number;
      isStub: boolean;
    }>();
    generateCollectionProfileMock.mockReturnValueOnce(generation.promise);

    const user = userEvent.setup();
    renderPage();
    await waitForCollection();

    await user.click(screen.getByRole('button', { name: 'Regenerate profile' }));
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    const collectionHook = screen.getByPlaceholderText(
      'Write or generate a collection hook...',
    );
    expect(collectionHook).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled();

    await act(async () => {
      generation.resolve({
        hook: 'Generated hook',
        narrative: 'Generated narrative',
        correspondents: PROFILE_CORRESPONDENTS,
        profileStatus: 'AI_DRAFT',
        profileRevision: 6,
        isStub: false,
      });
      await generation.promise;
    });

    await waitFor(() => {
      expect(getAdminCollectionByCodeMock).toHaveBeenCalledTimes(2);
    });
  });
});
