import { apiGet } from '../client';

export interface AggregatedNote {
  id: string;
  content: string;
  type: 'ai' | 'personal';
  category: string | null;
  priority: 'high' | 'medium' | 'low' | null;
  status: 'open' | 'resolved' | 'dismissed' | null;
  resolves_when: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  source: 'ai' | 'admin' | 'personal';
  letterId: string;
  letterDate: string | null;
  collectionCode: string;
  sender: string | null;
  recipient: string | null;
}

export interface NotesListResponse {
  notes: AggregatedNote[];
  total: number;
  counts: {
    open: number;
    resolved: number;
    dismissed: number;
    ai: number;
    personal: number;
  };
}

export function getNotes(params?: {
  type?: 'ai' | 'personal';
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
