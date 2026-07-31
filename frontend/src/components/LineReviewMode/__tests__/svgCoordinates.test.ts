import { describe, expect, it } from 'vitest';
import { clientPointToSource, clientPointToSvg } from '../svgCoordinates';

function fakeSvg(): SVGSVGElement {
  return {
    width: { baseVal: { value: 600 } },
    height: { baseVal: { value: 800 } },
    getBoundingClientRect: () => ({
      left: 100,
      top: 50,
      width: 1200,
      height: 1600,
    }),
  } as unknown as SVGSVGElement;
}

describe('SVG editor coordinate conversion', () => {
  it('accounts for a parent CSS zoom when converting client coordinates', () => {
    const svg = fakeSvg();

    expect(clientPointToSvg(svg, 700, 850)).toEqual({ x: 300, y: 400 });
    expect(clientPointToSource(svg, 700, 850, 0.5)).toEqual({
      x: 600,
      y: 800,
    });
  });
});
