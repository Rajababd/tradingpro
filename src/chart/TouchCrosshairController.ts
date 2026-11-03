import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';

/**
 * Bridges touch coordinates to Lightweight Charts' own crosshair API.
 * The library remains responsible for rendering, styling and hiding the crosshair;
 * this controller only supplies the current touch position and clears it on release.
 */
export class TouchCrosshairController {
  readonly #activePointers = new Set<number>();
  #activePointer: number | null = null;
  #pinching = false;
  #disposed = false;

  constructor(
    private readonly chart: Pick<IChartApi, 'setCrosshairPosition' | 'clearCrosshairPosition' | 'timeScale'>,
    private readonly series: ISeriesApi<'Candlestick'>,
    private readonly container: HTMLElement,
  ) {
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
    this.#activePointers.clear();
    this.#activePointer = null;
    this.chart.clearCrosshairPosition();
  }

  #onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.#activePointers.add(event.pointerId);
    if (this.#activePointers.size > 1) {
      this.#pinching = true;
      this.#activePointer = null;
      this.chart.clearCrosshairPosition();
      return;
    }
    if (this.#pinching) return;
    this.#activePointer = event.pointerId;
    this.#update(event);
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || this.#pinching) return;
    if (this.#activePointer === event.pointerId) this.#update(event);
  };

  #onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.#activePointers.delete(event.pointerId);
    this.#activePointer = null;
    this.chart.clearCrosshairPosition();
    if (this.#activePointers.size === 0) this.#pinching = false;
  };

  #onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.#activePointers.delete(event.pointerId);
    this.#activePointer = null;
    this.#pinching = false;
    this.chart.clearCrosshairPosition();
  };

  #update(event: PointerEvent): void {
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
      this.chart.clearCrosshairPosition();
      return;
    }

    const price = this.series.coordinateToPrice(y);
    const time = this.chart.timeScale().coordinateToTime(x) as Time | null;
    if (price === null || time === null || !Number.isFinite(price)) {
      this.chart.clearCrosshairPosition();
      return;
    }

    this.chart.setCrosshairPosition(price, time, this.series);
  }
}
