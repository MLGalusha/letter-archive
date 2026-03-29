import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';

type Layout = '' | 'float-left' | 'float-right';

interface Props {
  nodeKey: string;
  title: string;
}

function parseLayout(title: string): Layout {
  if (title === 'float-left' || title === 'float-right') return title;
  return '';
}

const LINE = '#bbb';
const IMG_FILL = '#1f6d7a';
const IMG_FILL_INACTIVE = '#999';

function BlockIcon({ active }: { active: boolean }) {
  const fill = active ? IMG_FILL : IMG_FILL_INACTIVE;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1.5" width="16" height="1.5" rx=".75" fill={LINE} />
      <rect x="3" y="5" width="12" height="8" rx="1.5" fill={fill} />
      <rect x="1" y="15" width="16" height="1.5" rx=".75" fill={LINE} />
    </svg>
  );
}

function FloatLeftIcon({ active }: { active: boolean }) {
  const fill = active ? IMG_FILL : IMG_FILL_INACTIVE;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="2.5" width="7" height="6" rx="1.5" fill={fill} />
      <rect x="10" y="2.5" width="7" height="1.5" rx=".75" fill={LINE} />
      <rect x="10" y="6" width="5" height="1.5" rx=".75" fill={LINE} />
      <rect x="1" y="10.5" width="16" height="1.5" rx=".75" fill={LINE} />
      <rect x="1" y="14" width="12" height="1.5" rx=".75" fill={LINE} />
    </svg>
  );
}

function FloatRightIcon({ active }: { active: boolean }) {
  const fill = active ? IMG_FILL : IMG_FILL_INACTIVE;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="10" y="2.5" width="7" height="6" rx="1.5" fill={fill} />
      <rect x="1" y="2.5" width="7" height="1.5" rx=".75" fill={LINE} />
      <rect x="1" y="6" width="5" height="1.5" rx=".75" fill={LINE} />
      <rect x="1" y="10.5" width="16" height="1.5" rx=".75" fill={LINE} />
      <rect x="1" y="14" width="12" height="1.5" rx=".75" fill={LINE} />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
    </svg>
  );
}

const ACTIVE_BG = 'rgba(31, 109, 122, 0.12)';
const ACTIVE_BORDER = 'rgba(31, 109, 122, 0.4)';

export default function ImageLayoutToolbar({ nodeKey, title }: Props) {
  const [editor] = useLexicalComposerContext();
  const current = parseLayout(title);

  const setLayout = (layout: Layout) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && 'setTitle' in node) {
        (node as any).setTitle(layout);
      }
    });
  };

  const deleteImage = () => {
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove();
    });
  };

  const btn = (layout: Layout, icon: React.ReactNode, tip: string) => {
    const isActive = current === layout;
    return (
      <button
        key={layout || 'block'}
        type="button"
        title={tip}
        style={isActive ? { background: ACTIVE_BG, borderColor: ACTIVE_BORDER } : undefined}
        onClick={(e) => { e.preventDefault(); setLayout(layout); }}
      >
        {icon}
      </button>
    );
  };

  return (
    <div className="img-layout-toolbar">
      {btn('', <BlockIcon active={current === ''} />, 'Block')}
      {btn('float-left', <FloatLeftIcon active={current === 'float-left'} />, 'Wrap left')}
      {btn('float-right', <FloatRightIcon active={current === 'float-right'} />, 'Wrap right')}
      <span className="img-layout-divider" />
      <button
        type="button"
        title="Delete image"
        className="img-layout-delete-btn"
        onClick={(e) => { e.preventDefault(); deleteImage(); }}
      >
        <DeleteIcon />
      </button>
    </div>
  );
}
