import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EditableSegment } from '../../../hooks/useSegmentEditor';
import SegmentEditorOverlay from '../SegmentEditorOverlay';

function segment(id: string, bbox: [number, number, number, number]): EditableSegment {
  return {
    id,
    _id: id,
    line: 1,
    bbox,
    boundary: [
      { x: bbox[0], y: bbox[1] },
      { x: bbox[2], y: bbox[1] },
      { x: bbox[2], y: bbox[3] },
      { x: bbox[0], y: bbox[3] },
    ],
    ocrText: '',
  };
}

describe('SegmentEditorOverlay', () => {
  it('renders selected-line controls above every segment polygon', () => {
    const { container } = render(
      <SegmentEditorOverlay
        segments={[
          segment('selected', [10, 10, 100, 50]),
          segment('overlap', [20, 20, 110, 60]),
        ]}
        selectedSegmentId="selected"
        scaleFactor={1}
        imageWidth={200}
        imageHeight={200}
        onSelect={vi.fn()}
        onResize={vi.fn()}
        onDelete={vi.fn()}
        onToggleExcluded={vi.fn()}
        onAddSegment={vi.fn()}
        movable
      />,
    );

    const svg = container.querySelector('.segment-editor-svg');
    const controls = container.querySelector('.segment-editor-controls');
    const segments = Array.from(container.querySelectorAll('.segment-editor-seg'));

    expect(svg).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(container.querySelectorAll('.segment-handles rect')).toHaveLength(2);
    expect(Array.from(svg!.children).indexOf(controls!)).toBeGreaterThan(
      Array.from(svg!.children).indexOf(segments.at(-1)!),
    );
  });

  it('removes the same window blur listener when the overlay unmounts', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <SegmentEditorOverlay
        segments={[]}
        selectedSegmentId={null}
        scaleFactor={1}
        imageWidth={200}
        imageHeight={200}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onToggleExcluded={vi.fn()}
        onAddSegment={vi.fn()}
      />,
    );
    const blurRegistration = addListener.mock.calls.find(
      ([eventName]) => eventName === 'blur',
    );
    expect(blurRegistration).toBeDefined();

    unmount();

    expect(removeListener).toHaveBeenCalledWith(
      'blur',
      blurRegistration?.[1],
    );
    addListener.mockRestore();
    removeListener.mockRestore();
  });

  it('blocks direct pointer, keyboard, drawing, transform, and context actions when read-only', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const onToggleExcluded = vi.fn();
    const onAddSegment = vi.fn();
    const onResize = vi.fn();
    const onMoveSegment = vi.fn();
    const onSegmentContextMenu = vi.fn();
    const { container } = render(
      <SegmentEditorOverlay
        segments={[segment('selected', [10, 10, 100, 50])]}
        selectedSegmentId="selected"
        scaleFactor={1}
        imageWidth={200}
        imageHeight={200}
        onSelect={onSelect}
        onResize={onResize}
        onDelete={onDelete}
        onToggleExcluded={onToggleExcluded}
        onAddSegment={onAddSegment}
        onMoveSegment={onMoveSegment}
        onSegmentContextMenu={onSegmentContextMenu}
        drawTool="box"
        movable
        readOnly
      />,
    );

    const svg = container.querySelector<SVGSVGElement>('.segment-editor-svg');
    const renderedSegment = container.querySelector(
      '.segment-editor-rect, .segment-editor-poly',
    );
    expect(svg?.style.pointerEvents).toBe('none');
    expect(container.querySelector('.segment-editor-controls')).toBeNull();

    if (svg) {
      fireEvent.pointerDown(svg, {
        pointerId: 1,
        clientX: 20,
        clientY: 20,
      });
      fireEvent.pointerMove(svg, {
        pointerId: 1,
        clientX: 80,
        clientY: 60,
      });
      fireEvent.pointerUp(svg, {
        pointerId: 1,
        clientX: 80,
        clientY: 60,
      });
    }
    if (renderedSegment) {
      fireEvent.pointerDown(renderedSegment, { pointerId: 2 });
      fireEvent.doubleClick(renderedSegment);
      fireEvent.contextMenu(renderedSegment);
    }
    const deleteNotDispatched = fireEvent.keyDown(window, { key: 'Delete' });
    const backspaceNotDispatched = fireEvent.keyDown(window, { key: 'Backspace' });

    expect(deleteNotDispatched).toBe(false);
    expect(backspaceNotDispatched).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(onToggleExcluded).not.toHaveBeenCalled();
    expect(onAddSegment).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
    expect(onMoveSegment).not.toHaveBeenCalled();
    expect(onSegmentContextMenu).not.toHaveBeenCalled();
  });
});
