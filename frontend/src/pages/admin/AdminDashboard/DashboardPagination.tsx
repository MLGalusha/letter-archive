interface PaginationState {
  page: number;
  totalPages: number;
}

interface DashboardPaginationProps {
  pagination: PaginationState;
  loading: boolean;
  onPageChange: (page: number) => void;
  letterCountText?: string;
}

export default function DashboardPagination({
  pagination,
  loading,
  onPageChange,
  letterCountText,
}: DashboardPaginationProps) {
  return (
    <div className="pagination-controls">
      {pagination.totalPages > 1 ? (
        <>
          <button
            type="button"
            className="pagination-btn"
            onClick={() => onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1 || loading}
          >
            ← Previous
          </button>
          <span className="pagination-info">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            className="pagination-btn"
            onClick={() => onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages || loading}
          >
            Next →
          </button>
        </>
      ) : (
        <span className="pagination-info" />
      )}
      {letterCountText && <span className="letter-count">{letterCountText}</span>}
    </div>
  );
}
