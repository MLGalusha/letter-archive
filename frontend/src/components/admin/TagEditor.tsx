import { useEffect, useRef, useCallback } from 'react';
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import { useEditor, EditorContent, ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import type { ReactNodeViewProps } from '@tiptap/react';
import { parseTaggedText, serializeTaggedText } from '../../utils/tag-serialization';
import './TagEditor.css';

// ─── Node View Components ────────────────────────────────────────────

function SenderTagView({ node }: ReactNodeViewProps) {
  const isEmpty = !node.textContent;
  if (isEmpty) {
    return (
      <NodeViewWrapper as="span" className="tag-empty tag-sender-empty">
        SENDER
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper as="span" className="tag-sender">
      <NodeViewContent as="span" />
    </NodeViewWrapper>
  );
}

function RecipientTagView({ node }: ReactNodeViewProps) {
  const isEmpty = !node.textContent;
  if (isEmpty) {
    return (
      <NodeViewWrapper as="span" className="tag-empty tag-recipient-empty">
        RECIPIENT
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper as="span" className="tag-recipient">
      <NodeViewContent as="span" />
    </NodeViewWrapper>
  );
}

// ─── TipTap Node Extensions ─────────────────────────────────────────

const SenderTag = TiptapNode.create({
  name: 'senderTag',
  group: 'inline',
  content: 'text*',
  inline: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'span[data-tag-type="sender"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-tag-type': 'sender', class: 'tag-sender' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SenderTagView, { contentDOMElementTag: 'span' });
  },

  addKeyboardShortcuts() {
    return {
      Space: ({ editor }) => {
        const { $from } = editor.state.selection;
        // Check if we're inside a senderTag
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'senderTag') {
            // Move cursor to after this node and insert a space
            const endPos = $from.after(d);
            editor.chain().focus().insertContentAt(endPos, ' ').run();
            return true;
          }
        }
        return false;
      },
      Backspace: ({ editor }) => {
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'senderTag') {
            const node = $from.node(d);
            if (node.textContent === '') {
              // Empty tag — delete the node
              const from = $from.before(d);
              const to = $from.after(d);
              editor.chain().focus().deleteRange({ from, to }).run();
              return true;
            }
            break;
          }
        }
        return false;
      },
    };
  },
});

const RecipientTag = TiptapNode.create({
  name: 'recipientTag',
  group: 'inline',
  content: 'text*',
  inline: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'span[data-tag-type="recipient"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-tag-type': 'recipient', class: 'tag-recipient' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RecipientTagView, { contentDOMElementTag: 'span' });
  },

  addKeyboardShortcuts() {
    return {
      Space: ({ editor }) => {
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'recipientTag') {
            const endPos = $from.after(d);
            editor.chain().focus().insertContentAt(endPos, ' ').run();
            return true;
          }
        }
        return false;
      },
      Backspace: ({ editor }) => {
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'recipientTag') {
            const node = $from.node(d);
            if (node.textContent === '') {
              const from = $from.before(d);
              const to = $from.after(d);
              editor.chain().focus().deleteRange({ from, to }).run();
              return true;
            }
            break;
          }
        }
        return false;
      },
    };
  },
});

// ─── Single-line Document (for hook and short fields) ────────────────

const SingleLineDocument = Document.extend({
  content: 'paragraph',
});

// ─── TagEditor Component ─────────────────────────────────────────────

interface TagEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  singleLine?: boolean;
  readOnly?: boolean;
  className?: string;
  maxLength?: number;
}

export default function TagEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  singleLine = false,
  readOnly = false,
  className = '',
  maxLength,
}: TagEditorProps) {
  const isUpdatingRef = useRef(false);
  const lastSerializedRef = useRef(value);

  const editor = useEditor({
    extensions: [
      singleLine ? SingleLineDocument : Document,
      Paragraph,
      Text,
      SenderTag,
      RecipientTag,
    ],
    content: parseTaggedText(value),
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      if (isUpdatingRef.current) return;
      const serialized = serializeTaggedText(ed.getJSON());

      if (maxLength && serialized.length > maxLength) {
        // Undo the last change if it would exceed maxLength
        ed.commands.undo();
        return;
      }

      if (serialized !== lastSerializedRef.current) {
        lastSerializedRef.current = serialized;
        onChange(serialized);
      }
    },
    onBlur: () => {
      onBlur?.();
    },
    editorProps: {
      attributes: {
        class: `tag-editor-content ${singleLine ? 'single-line' : ''}`,
        'data-placeholder': placeholder ?? '',
      },
      handleKeyDown: singleLine
        ? (_view, event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              return true;
            }
            return false;
          }
        : undefined,
    },
  });

  // Sync external value changes into the editor
  const syncContent = useCallback(
    (newValue: string) => {
      if (!editor || editor.isDestroyed) return;
      const currentSerialized = serializeTaggedText(editor.getJSON());
      if (currentSerialized === newValue) return;

      isUpdatingRef.current = true;
      editor.commands.setContent(parseTaggedText(newValue));
      lastSerializedRef.current = newValue;
      isUpdatingRef.current = false;
    },
    [editor],
  );

  useEffect(() => {
    syncContent(value);
  }, [value, syncContent]);

  // Sync readOnly state
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  return (
    <div className={`tag-editor-wrapper ${readOnly ? 'read-only' : ''} ${className}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
