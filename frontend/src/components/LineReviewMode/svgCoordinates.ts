export interface SvgPoint {
  x: number;
  y: number;
}

/** Convert viewport coordinates into the SVG's own displayed coordinate space. */
export function clientPointToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): SvgPoint {
  const rect = svg.getBoundingClientRect();
  const width = svg.width.baseVal.value || rect.width || 1;
  const height = svg.height.baseVal.value || rect.height || 1;
  return {
    x: ((clientX - rect.left) * width) / Math.max(rect.width, 1),
    y: ((clientY - rect.top) * height) / Math.max(rect.height, 1),
  };
}

/**
 * Convert viewport coordinates into source-image pixels.
 *
 * Using the live client rect accounts for both the image's base fit scale and
 * any parent CSS zoom. Every editor gesture must use this transform rather
 * than dividing raw client movement by the base scale alone.
 */
export function clientPointToSource(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  sourceToSvgScale: number,
): SvgPoint {
  const point = clientPointToSvg(svg, clientX, clientY);
  return {
    x: point.x / sourceToSvgScale,
    y: point.y / sourceToSvgScale,
  };
}
