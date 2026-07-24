import { memo, useState, useMemo } from 'react';
import Icon from '../../../components/common/Icon';
import TaggedText from '../../../components/admin/TaggedText';
import './NotesSection.css';

export interface StructuredNote {
  id: string;
  content: string;
  category: 'identity' | 'date' | 'transcription' | 'relationship' | 'context' | 'cross-reference' | 'location' | 'condition';
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'resolved' | 'dismissed';
  resolves_when: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  source: 'ai' | 'admin';
}

interface NotesSectionProps {
  notes: StructuredNote[] | string | null;
  letterId: string;
  disabled?: boolean;
  onNoteStatusChange: (noteId: string, status: 'resolved' | 'dismissed') => void;
  onAddNote: (note: { content: string; category: string; priority: string }) => void;
}

type FilterMode = 'all' | 'open' | 'resolved' | 'dismissed';

const CATEGORY_OPTIONS: StructuredNote['category'][] = [
  'identity', 'date', 'transcription', 'relationship',
  'context', 'cross-reference', 'location', 'condition',
];

const PRIORITY_OPTIONS: StructuredNote['priority'][] = ['high', 'medium', 'low'];

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const STATUS_ORDER: Record<string, number> = { open: 0, resolved: 1, dismissed: 2 };

function formatCategory(cat: string): string {
  return cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const NotesSection = memo(function NotesSection({
  notes,
  disabled = false,
  onNoteStatusChange,
  onAddNote,
}: NotesSectionProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategory, setNewCategory] = useState<string>('context');
  const [newPriority, setNewPriority] = useState<string>('medium');
  const [newContent, setNewContent] = useState('');

  // Legacy string handling
  const isLegacy = typeof notes === 'string';
  const structuredNotes: StructuredNote[] = useMemo(() => {
    if (!notes || typeof notes === 'string') return [];
    return notes;
  }, [notes]);

  // Counts
  const openCount = structuredNotes.filter(n => n.status === 'open').length;
  const resolvedCount = structuredNotes.filter(n => n.status === 'resolved').length;
  const dismissedCount = structuredNotes.filter(n => n.status === 'dismissed').length;

  // Filter + sort
  const filteredNotes = useMemo(() => {
    let filtered = structuredNotes;
    if (filter !== 'all') {
      filtered = filtered.filter(n => n.status === filter);
    }
    return [...filtered].sort((a, b) => {
      // Status: open first
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      // Priority: high first
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    });
  }, [structuredNotes, filter]);

  const handleAddNote = () => {
    if (disabled || !newContent.trim()) return;
    onAddNote({
      content: newContent.trim(),
      category: newCategory,
      priority: newPriority,
    });
    setNewContent('');
    setShowAddForm(false);
  };

  const handleCancel = () => {
    setNewContent('');
    setShowAddForm(false);
  };

  // Legacy text display
  if (isLegacy && notes) {
    return (
      <div className="notes-sec">
        <div className="notes-sec-header">
          <div className="notes-sec-counts">
            <span>AI Notes</span>
          </div>
        </div>
        <div className="notes-sec-legacy">
          <p className="notes-sec-legacy-text">{notes}</p>
          <p className="notes-sec-legacy-hint">
            Legacy format — re-extract metadata to get structured notes
          </p>
        </div>
      </div>
    );
  }

  // No notes at all
  if (!notes && !isLegacy) {
    return (
      <div className="notes-sec">
        <div className="notes-sec-header">
          <div className="notes-sec-counts">
            <span>AI Notes</span>
          </div>
          <div className="notes-sec-actions">
            <button
              className="notes-sec-add-btn"
              onClick={() => setShowAddForm(true)}
              disabled={disabled}
            >
              <Icon name="plus" size={12} /> Add note
            </button>
          </div>
        </div>
        {showAddForm ? (
          <AddNoteForm
            category={newCategory}
            priority={newPriority}
            content={newContent}
            disabled={disabled}
            onCategoryChange={setNewCategory}
            onPriorityChange={setNewPriority}
            onContentChange={setNewContent}
            onSave={handleAddNote}
            onCancel={handleCancel}
          />
        ) : (
          <div className="notes-sec-empty">
            No AI notes yet. Notes will appear after metadata extraction.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="notes-sec">
      {/* Summary bar */}
      <div className="notes-sec-header">
        <div className="notes-sec-counts">
          <span>AI Notes</span>
          <span className="notes-sec-dot">&middot;</span>
          <span>{openCount} open</span>
          {resolvedCount > 0 && (
            <>
              <span className="notes-sec-dot">&middot;</span>
              <span>{resolvedCount} resolved</span>
            </>
          )}
          {dismissedCount > 0 && (
            <>
              <span className="notes-sec-dot">&middot;</span>
              <span>{dismissedCount} dismissed</span>
            </>
          )}
        </div>

        <div className="notes-sec-actions">
          {(['all', 'open', 'resolved', 'dismissed'] as FilterMode[]).map(f => (
            <button
              key={f}
              className={`notes-sec-filter ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button
            className="notes-sec-add-btn"
            onClick={() => setShowAddForm(true)}
            disabled={disabled}
          >
            <Icon name="plus" size={12} /> Add note
          </button>
        </div>
      </div>

      {/* Note cards */}
      {filteredNotes.length === 0 ? (
        <div className="notes-sec-empty">
          No {filter !== 'all' ? filter : ''} notes
        </div>
      ) : (
        <div className="notes-sec-list">
          {filteredNotes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              disabled={disabled}
              onResolve={() => onNoteStatusChange(note.id, 'resolved')}
              onDismiss={() => onNoteStatusChange(note.id, 'dismissed')}
            />
          ))}
        </div>
      )}

      {/* Add note form */}
      {showAddForm && (
        <AddNoteForm
          category={newCategory}
          priority={newPriority}
          content={newContent}
          disabled={disabled}
          onCategoryChange={setNewCategory}
          onPriorityChange={setNewPriority}
          onContentChange={setNewContent}
          onSave={handleAddNote}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
});

NotesSection.displayName = 'NotesSection';

export default NotesSection;

/* ── Note Card Component ──────────────────────────────── */

function NoteCard({
  note,
  disabled,
  onResolve,
  onDismiss,
}: {
  note: StructuredNote;
  disabled: boolean;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`note-card ${note.status}`}>
      <div className="note-card-badges">
        <span className={`note-badge priority-${note.priority}`}>
          {note.priority}
        </span>
        <span className={`note-badge cat-${note.category}`}>
          {formatCategory(note.category)}
        </span>
        <span className="note-badge source">
          {note.source === 'ai' ? 'AI' : 'Admin'}
        </span>
      </div>

      <div className="note-card-body">
        <p className="note-card-content"><TaggedText text={note.content} /></p>

        {note.status === 'open' && note.resolves_when && (
          <p className="note-card-meta">
            Auto-resolves when: {note.resolves_when}
          </p>
        )}

        {note.status === 'resolved' && (
          <div className="note-card-resolved-info">
            <Icon name="check" size={12} />
            <span>Resolved</span>
          </div>
        )}
      </div>

      {note.status === 'open' && (
        <>
          <button
            className="note-card-action resolve"
            onClick={onResolve}
            disabled={disabled}
            title="Mark as resolved"
          >
            <Icon name="check" size={14} />
          </button>
          <button
            className="note-card-action dismiss"
            onClick={onDismiss}
            disabled={disabled}
            title="Dismiss"
          >
            <Icon name="close" size={14} />
          </button>
        </>
      )}
    </div>
  );
}

/* ── Add Note Form Component ──────────────────────────── */

function AddNoteForm({
  category,
  priority,
  content,
  disabled,
  onCategoryChange,
  onPriorityChange,
  onContentChange,
  onSave,
  onCancel,
}: {
  category: string;
  priority: string;
  content: string;
  disabled: boolean;
  onCategoryChange: (v: string) => void;
  onPriorityChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="note-add-form">
      <div className="note-add-row">
        <select
          className="note-add-select"
          value={category}
          disabled={disabled}
          onChange={e => onCategoryChange(e.target.value)}
        >
          {CATEGORY_OPTIONS.map(c => (
            <option key={c} value={c}>{formatCategory(c)}</option>
          ))}
        </select>
        <select
          className="note-add-select"
          value={priority}
          disabled={disabled}
          onChange={e => onPriorityChange(e.target.value)}
        >
          {PRIORITY_OPTIONS.map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
      </div>
      <textarea
        className="note-add-textarea"
        rows={2}
        placeholder="Add a note..."
        value={content}
        disabled={disabled}
        onChange={e => onContentChange(e.target.value)}
        autoFocus
      />
      <div className="note-add-actions">
        <button className="note-add-btn cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="note-add-btn save"
          onClick={onSave}
          disabled={disabled || !content.trim()}
        >
          Save
        </button>
      </div>
    </div>
  );
}
