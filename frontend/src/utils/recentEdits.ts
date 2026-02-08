/**
 * Utility for tracking recently edited letters in localStorage
 */

export interface RecentEdit {
  id: string;
  sender: string;
  recipient: string;
  collectionCode: string;
  editedAt: number; // timestamp
}

const STORAGE_KEY = 'recentEdits';
const MAX_RECENT_EDITS = 10;

/**
 * Get all recent edits from localStorage
 */
export function getRecentEdits(): RecentEdit[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load recent edits:', e);
  }
  return [];
}

/**
 * Track a letter edit - adds to front of list, removes duplicates
 */
export function trackEdit(letter: {
  id: string;
  metadata: { sender?: string | null; recipient?: string | null };
  collectionCode?: string;
}): void {
  try {
    const recent = getRecentEdits();
    const newEdit: RecentEdit = {
      id: letter.id,
      sender: letter.metadata.sender || 'Unknown',
      recipient: letter.metadata.recipient || 'Unknown',
      collectionCode: letter.collectionCode || '',
      editedAt: Date.now(),
    };

    // Remove duplicate if exists, add to front, keep last MAX_RECENT_EDITS
    const filtered = recent.filter((e) => e.id !== letter.id);
    const updated = [newEdit, ...filtered].slice(0, MAX_RECENT_EDITS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to track edit:', e);
  }
}

/**
 * Clear all recent edits
 */
export function clearRecentEdits(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear recent edits:', e);
  }
}

/**
 * Format a timestamp as relative time (e.g., "2m ago", "1h ago")
 */
export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }

  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}
