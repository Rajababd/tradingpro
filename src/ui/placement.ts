export interface Box {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

export interface PanelPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  /** Tallest the panel may be; taller content scrolls inside it. */
  readonly maxHeight: number;
}

export interface PlacementOptions {
  /** Space kept free at the viewport edges. */
  margin?: number;
  /** Space between trigger and panel. */
  gap?: number;
  /** Below this much room the panel is moved up rather than squeezed. */
  minHeight?: number;
}

/**
 * Where to put a dropdown panel so it can never be clipped: below its trigger, aligned to the trigger's left
 * edge but pulled back inside the viewport, no wider than the viewport, and no taller than the room that is
 * left (content scrolls inside). On a very short viewport (phone in landscape) it is moved up instead.
 */
export function placePanel(
  trigger: Box,
  desiredWidth: number,
  viewport: { readonly width: number; readonly height: number },
  { margin = 8, gap = 4, minHeight = 160 }: PlacementOptions = {},
): PanelPlacement {
  const width = Math.max(0, Math.min(desiredWidth, viewport.width - 2 * margin));
  const left = Math.max(margin, Math.min(trigger.left, viewport.width - margin - width));

  let top = trigger.bottom + gap;
  if (viewport.height - margin - top < minHeight) top = Math.max(margin, viewport.height - margin - minHeight);
  return { left, top, width, maxHeight: Math.max(0, viewport.height - margin - top) };
}
