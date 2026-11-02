import type { IChartApi } from 'lightweight-charts';

type ChartCrosshairOptions = Pick<IChartApi, 'applyOptions' | 'options'>;

/** Touch-only crosshair overlay that follows the actual finger coordinates, not candle snap points. */
export class TouchCrosshairOverlay {
  readonly #layer: HTMLDivElement;
  readonly #vertical: HTMLDivElement;
  readonly #horizontal: HTMLDivElement;
  readonly #nativeVisible: { vertical: boolean; horizontal: boolean };
  readonly #touchPointers = new Set<number>();
  #activePointer: number | null = null;
  #multiTouch = false;
  #disposed = false;

  constructor(private readonly chart: ChartCrosshairOptions, private readonly container: HTMLElement) {
    const options = chart.options().crosshair;
    this.#nativeVisible = { vertical: options.vertLine.visible, horizontal: options.horzLine.visible };
    this.#layer = document.createElement('div');
    this.#layer.className = 'touch-crosshair';
    this.#layer.dataset.visible = 'false';
    this.#layer.setAttribute('aria-hidden', 'true');
    this.#vertical = document.createElement('div');
    this.#vertical.className = 'touch-crosshair__vertical';
    this.#horizontal = document.createElement('div');
    this.#horizontal.className = 'touch-crosshair__horizontal';
    this.#layer.append(this.#vertical, this.#horizontal);
    container.append(this.#layer);
    container.addEventListener('pointerdown', this.#onPointerDown, { passive: true });
    container.addEventListener('pointermove', this.#onPointerMove, { passive: true });
    container.addEventListener('pointerup', this.#onPointerUp, { passive: true });
    container.addEventListener('pointercancel', this.#onPointerCancel, { passive: true });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.container.removeEventListener('pointerdown', this.#onPointerDown);
    this.container.removeEventListener('pointermove', this.#onPointerMove);
    this.container.removeEventListener('pointerup', this.#onPointerUp);
    this.container.removeEventListener('pointercancel', this.#onPointerCancel);
    this.#touchPointers.clear();
    this.#restoreNative();
    this.#layer.remove();
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.#touchPointers.add(event.pointerId);
    if (this.#touchPointers.size > 1) {
      this.#multiTouch = true;
      this.#activePointer = null;
      this.#hide();
      this.#restoreNative();
      return;
    }
    this.#activePointer = event.pointerId;
    this.#hideNative();
    this.#update(event);
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') {
      if (this.#layer.dataset.visible === 'true') {
        this.#hide();
        this.#restoreNative();
      }
      return;
    }
    if (this.#activePointer === event.pointerId) this.#update(event);
  };

  #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    if (this.#activePointer === event.pointerId) {
      this.#update(event);
      this.#activePointer = null;
    }
    this.#touchPointers.delete(event.pointerId);
    if (this.#touchPointers.size === 0 && this.#multiTouch) {
      this.#multiTouch = false;
      this.#hide();
      this.#restoreNative();
    }
  };

  #onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.#touchPointers.delete(event.pointerId);
    this.#activePointer = null;
    this.#multiTouch = false;
    this.#hide();
    this.#restoreNative();
  };

  #update(event: PointerEvent): void {
    const rect = this.container.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    this.#vertical.style.left = `${x}px`;
    this.#horizontal.style.top = `${y}px`;
    this.#layer.dataset.visible = 'true';
  }

  #hide(): void { this.#layer.dataset.visible = 'false'; }
  #hideNative(): void {
    this.chart.applyOptions({ crosshair: { vertLine: { visible: false }, horzLine: { visible: false } } });
  }
  #restoreNative(): void {
    this.chart.applyOptions({ crosshair: {
      vertLine: { visible: this.#nativeVisible.vertical },
      horzLine: { visible: this.#nativeVisible.horizontal },
    } });
  }
}
