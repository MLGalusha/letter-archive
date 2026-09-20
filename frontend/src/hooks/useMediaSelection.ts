import { useState } from 'react';

/** Track a media identity, so reordering or updating the items cannot select a different scan. */
export default function useMediaSelection(keys: string[]) {
  const [selection, setSelection] = useState({ key: keys[0], index: 0 });
  const found = keys.indexOf(selection.key);
  const index = found >= 0 ? found : Math.max(0, Math.min(selection.index, keys.length - 1));
  const key = keys[index];
  if (selection.key !== key || selection.index !== index) setSelection({ key, index });
  const step = (delta: number) => {
    if (!keys.length) return;
    const next = (index + delta + keys.length) % keys.length;
    setSelection({ key: keys[next], index: next });
  };
  return { index, step };
}
