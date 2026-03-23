import {
  useCallback,
  useEffect,
  useState,
  type RefObject,
} from 'react';

const BASE_FONT_SIZE_REM = 1.1;
const MIN_SCALE = 0.4;

export function useTranscriptFontSize(
  editorRef: RefObject<HTMLDivElement | null>,
  transcript: string,
  reviewMode: boolean,
): string {
  const [transcriptFontSize, setTranscriptFontSize] = useState(
    `${BASE_FONT_SIZE_REM}rem`,
  );

  const calculateFontSize = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !transcript) {
      setTranscriptFontSize(`${BASE_FONT_SIZE_REM}rem`);
      return;
    }

    const computedStyle = window.getComputedStyle(editor);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
    const containerWidth = editor.clientWidth - paddingLeft - paddingRight;
    const lines = transcript.split('\n');

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const fontFamily = computedStyle.fontFamily || 'inherit';
    ctx.font = `${BASE_FONT_SIZE_REM * 16}px ${fontFamily}`;

    let maxWidth = 0;
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const width = ctx.measureText(line).width;
      if (width > maxWidth) {
        maxWidth = width;
      }
    }

    if (maxWidth > containerWidth) {
      const scale = Math.max(MIN_SCALE, containerWidth / maxWidth);
      setTranscriptFontSize(`${BASE_FONT_SIZE_REM * scale}rem`);
      return;
    }

    setTranscriptFontSize(`${BASE_FONT_SIZE_REM}rem`);
  }, [editorRef, transcript]);

  useEffect(() => {
    calculateFontSize();

    const editor = editorRef.current;
    const editorContainer = editor?.parentElement;

    if (editor || editorContainer) {
      const resizeObserver = new ResizeObserver(() => {
        calculateFontSize();
      });

      if (editor) {
        resizeObserver.observe(editor);
      }

      if (editorContainer) {
        resizeObserver.observe(editorContainer);
      }

      return () => resizeObserver.disconnect();
    }

    window.addEventListener('resize', calculateFontSize);
    return () => window.removeEventListener('resize', calculateFontSize);
  }, [calculateFontSize, editorRef, reviewMode]);

  return transcriptFontSize;
}
