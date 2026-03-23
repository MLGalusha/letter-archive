import { apiGet } from '../client';

export interface AggregatedNote {
  id: string;
  content: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'resolved' | 'dismissed';
  resolves_when: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  source: 'ai' | 'admin';
  letterId: string;
  letterDate: string | null;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
}

export interface NotesListResponse {
  notes: AggregatedNote[];
  total: number;
  counts: { open: number; resolved: number; dismissed: number };
}

export function getNotes(params?: {
  status?: string;
  priority?: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<NotesListResponse> {
  return apiGet<NotesListResponse>(
    '/admin/notes',
    params as Record<string, string | number | undefined>,
  );
}
