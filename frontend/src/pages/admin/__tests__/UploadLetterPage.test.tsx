import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';

const {
  navigateMock,
  showToastMock,
  uploadFilesMock,
  checkDuplicatesMock,
  createObjectURLMock,
  revokeObjectURLMock,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  showToastMock: vi.fn(),
  uploadFilesMock: vi.fn(),
  checkDuplicatesMock: vi.fn(),
  createObjectURLMock: vi.fn(() => 'blob:preview'),
  revokeObjectURLMock: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('../../../api/admin', () => ({
  uploadFiles: uploadFilesMock,
  checkDuplicates: checkDuplicatesMock,
}));

vi.mock('../../../api/auth', () => ({
  isAuthenticated: () => true,
}));

vi.mock('../../../components/common', () => ({
  Button: ({
    children,
    icon,
    active,
    variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: string;
    active?: boolean;
    variant?: string;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  ConfirmDialog: ({
    isOpen,
    title,
    message,
    confirmText,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    title?: string;
    message?: ReactNode;
    confirmText?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div>
        <h2>{title}</h2>
        <div>{message}</div>
        <button type="button" onClick={onConfirm}>
          {confirmText ?? 'Confirm'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
  Icon: () => <span aria-hidden="true">icon</span>,
}));

vi.mock('../../../components/AdminLayout/AdminLayout', () => ({
  default: ({
    headerActions,
    children,
  }: {
    headerActions?: ReactNode;
    children?: ReactNode;
  }) => (
    <div>
      <div>{headerActions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('../UploadLetter/CollectionCard', () => ({
  default: ({
    collection,
    onClick,
  }: {
    collection: { collectionCode: string };
    onClick: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      Collection {collection.collectionCode}
    </button>
  ),
}));

vi.mock('../UploadLetter/CollectionModal', () => ({
  default: () => <div>Collection Modal</div>,
}));

vi.mock('../UploadLetter/Lightbox', () => ({
  default: () => <div>Lightbox</div>,
}));

vi.mock('../UploadLetter/UncategorizedCarousel', () => ({
  default: ({
    images,
  }: {
    images: Array<{ originalFilename: string }>;
  }) => <div>Uncategorized {images.length}</div>,
}));

import UploadLetterPage from '../UploadLetterPage';

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function makeUploadResult(filename: string) {
  return {
    filename,
    letterId: 'letter-1',
    pageId: `page-${filename}`,
    collectionCode: filename.slice(0, 3),
    storagePath: `/uploads/${filename}`,
    alreadyExists: false,
  };
}

function makeImageFile(name: string): File {
  return new File(['image-bytes'], name, { type: 'image/jpeg' });
}

function getFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]:not([webkitdirectory])');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Expected file input');
  }
  return input;
}

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURLMock,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURLMock,
  });
});

afterAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: originalRevokeObjectURL,
  });
});

describe('UploadLetterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('adminAuth', 'true');

    checkDuplicatesMock.mockResolvedValue({ duplicates: {} });
    uploadFilesMock.mockResolvedValue({
      success: 1,
      failed: 0,
      results: [makeUploadResult('001-18860314-L01-01.jpg')],
      errors: [],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('imports categorized files and updates collection stats', async () => {
    const user = userEvent.setup();
    const { container } = render(<UploadLetterPage />);

    await user.upload(
      getFileInput(container),
      makeImageFile('001-18860314-L01-01.jpg'),
    );

    await waitFor(() => {
      expect(checkDuplicatesMock).toHaveBeenCalledWith(['001-18860314-L01-01.jpg']);
    });

    expect(showToastMock).toHaveBeenCalledWith('1 file imported');
    expect(await screen.findByText('Collection 001')).toBeInTheDocument();
    expect(screen.getByText(/1 imported/)).toBeInTheDocument();
    expect(screen.getByText(/1 original/)).toBeInTheDocument();
  });

  it('blocks upload when nothing has been categorized yet', async () => {
    const user = userEvent.setup();
    const { container } = render(<UploadLetterPage />);

    await user.upload(getFileInput(container), makeImageFile('notes.jpg'));

    expect(await screen.findByText('Uncategorized 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(
      screen.getByText('No categorized images to upload. Use Edit mode to organize images first.'),
    ).toBeInTheDocument();
    expect(uploadFilesMock).not.toHaveBeenCalled();
  });

  it('shows request ids in failed upload results', async () => {
    const user = userEvent.setup();
    uploadFilesMock.mockRejectedValueOnce(
      new ApiError(500, 'Archive unavailable', undefined, 'req-upload-123'),
    );

    const { container } = render(<UploadLetterPage />);
    await user.upload(
      getFileInput(container),
      makeImageFile('001-18860314-L01-01.jpg'),
    );

    await screen.findByText('Collection 001');
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => {
      expect(uploadFilesMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText('Failed (1)')).toBeInTheDocument();
    expect(
      screen.getByText('Archive unavailable (Request ID: req-upload-123)'),
    ).toBeInTheDocument();
  });

  it('surfaces duplicate check failures while still importing files', async () => {
    const user = userEvent.setup();
    checkDuplicatesMock.mockRejectedValueOnce(
      new ApiError(503, 'Duplicate service unavailable', undefined, 'req-dupes-503'),
    );

    const { container } = render(<UploadLetterPage />);

    await user.upload(
      getFileInput(container),
      makeImageFile('001-18860314-L01-01.jpg'),
    );

    await waitFor(() => {
      expect(checkDuplicatesMock).toHaveBeenCalledWith(['001-18860314-L01-01.jpg']);
    });

    expect(showToastMock).toHaveBeenCalledWith('1 file imported');
    expect(showToastMock).toHaveBeenCalledWith(
      'Duplicate service unavailable (Request ID: req-dupes-503)',
      'error',
    );
    expect(await screen.findByText('Collection 001')).toBeInTheDocument();
  });

  it('asks how to handle duplicates and can skip them during upload', async () => {
    const user = userEvent.setup();
    checkDuplicatesMock.mockResolvedValueOnce({
      duplicates: {
        '001-18860314-L01-01.jpg': true,
        '001-18860314-L01-02.jpg': false,
      },
    });
    uploadFilesMock.mockResolvedValueOnce({
      success: 1,
      failed: 0,
      results: [makeUploadResult('001-18860314-L01-02.jpg')],
      errors: [],
    });

    const { container } = render(<UploadLetterPage />);
    await user.upload(getFileInput(container), [
      makeImageFile('001-18860314-L01-01.jpg'),
      makeImageFile('001-18860314-L01-02.jpg'),
    ]);

    expect(await screen.findByText(/1 duplicate/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText('Duplicates Found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Skip Duplicates/i }));

    await waitFor(() => {
      expect(uploadFilesMock).toHaveBeenCalledTimes(1);
    });

    const [files, force] = uploadFilesMock.mock.calls[0] as [File[], boolean];
    expect(files.map((file) => file.name)).toEqual(['001-18860314-L01-02.jpg']);
    expect(force).toBe(false);
    await waitFor(() => {
      expect(document.querySelector('.upload-banner')).toHaveTextContent('1 skipped');
    });
    expect(screen.queryByText('Collection 001')).not.toBeInTheDocument();
  });
});
