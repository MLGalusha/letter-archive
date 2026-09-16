// Keep a small set of reusable variants within the image API's 1600px limit.
export const SCAN_WIDTHS = [480, 800, 1200, 1600] as const;

export function scanVariantWidth(physicalWidth: number): number {
  return SCAN_WIDTHS.find((width) => width >= physicalWidth) ?? 1600;
}

export function scanNeedsOriginal(physicalWidth: number, scale: number): boolean {
  return scale > 1 && physicalWidth * scale > 1600;
}
