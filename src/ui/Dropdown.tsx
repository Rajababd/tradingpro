import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { placePanel, type PanelPlacement } from './placement';

interface DropdownProps {
  /** Unique id; links the trigger to its panel for assistive technology. */
  id: string;
  label: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Preferred panel width in px; it shrinks on narrow screens. */
  width?: number;
  children: ReactNode;
}

const viewportSize = () => ({
  width: window.visualViewport?.width ?? window.innerWidth,
  height: window.visualViewport?.height ?? window.innerHeight,
});

/**
 * A button that opens a floating panel.
 *  - Opening or closing changes nothing else: it is only a view.
 *  - The panel is positioned in viewport coordinates and re-placed on resize/rotation, so it is never clipped,
 *    and long content scrolls inside it.
 *  - It closes on Escape (focus returns to the button), on its Close button (the way out on a phone, where the panel can
 *    cover the whole chart), and on any press outside it, including a press on the chart, so it never sits in the way of
 *    chart gestures. It does NOT close when something inside is used.
 */
export function Dropdown({ id, label, open, onOpenChange, width = 320, children }: DropdownProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger === null) return;
    setPlacement(placePanel(trigger.getBoundingClientRect(), width, viewportSize()));
  }, [width]);

  // Place before paint so the panel never flashes in the wrong spot.
  useLayoutEffect(() => {
    if (open) place();
    else setPlacement(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', place);
    window.addEventListener('orientationchange', place);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('orientationchange', place);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open, onOpenChange, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="menu-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => onOpenChange(!open)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          className="menu-panel"
          style={placement === null ? { visibility: 'hidden' } : { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight }}
        >
          <div className="menu-head">
            <span>{label}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={`Close ${label} menu`}
              onClick={() => {
                onOpenChange(false);
                triggerRef.current?.focus();
              }}
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      )}
    </>
  );
}
