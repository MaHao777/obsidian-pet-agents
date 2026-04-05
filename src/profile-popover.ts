export interface ProfilePopoverPositionOptions {
  anchorX: number;
  anchorY: number;
  popoverWidth: number;
  popoverHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  offset?: number;
  margin?: number;
}

export interface RectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PointerPosition {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rectContainsPoint(point: PointerPosition, rect: RectBounds | null): boolean {
  if (!rect) {
    return false;
  }

  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function computeProfilePopoverPosition(options: ProfilePopoverPositionOptions): { left: number; top: number } {
  const offset = options.offset ?? 12;
  const margin = options.margin ?? 8;

  const preferredLeft = options.anchorX + offset;
  const preferredTop = options.anchorY + offset;
  const fallbackLeft = options.anchorX - options.popoverWidth - offset;
  const fallbackTop = options.anchorY - options.popoverHeight + offset;

  const maxLeft = Math.max(margin, options.viewportWidth - options.popoverWidth - margin);
  const maxTop = Math.max(margin, options.viewportHeight - options.popoverHeight - margin);

  const left =
    preferredLeft + options.popoverWidth + margin <= options.viewportWidth
      ? preferredLeft
      : clamp(fallbackLeft, margin, maxLeft);
  const top =
    preferredTop + options.popoverHeight + margin <= options.viewportHeight
      ? preferredTop
      : clamp(fallbackTop, margin, maxTop);

  return {
    left,
    top,
  };
}

export function shouldHideProfilePopover(
  point: PointerPosition,
  triggerRect: RectBounds | null,
  popoverRect: RectBounds | null,
): boolean {
  return !rectContainsPoint(point, triggerRect) && !rectContainsPoint(point, popoverRect);
}
