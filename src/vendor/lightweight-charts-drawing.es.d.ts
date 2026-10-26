import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';

export interface DrawingJSON {
  id: string;
  type: string;
  seriesId?: string;
  paneIndex: number;
  anchors: Array<{ time: number | string; logical?: number; price: number }>;
  style?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface DrawingInstance {
  id: string;
  type: string;
  seriesId: string | null;
  paneIndex: number;
  anchors: Array<{ time: number | string; logical?: number; price: number }>;
  options: { visible: boolean; locked: boolean; [key: string]: unknown };
  getSeries(): ISeriesApi<SeriesType> | null;
  isAttached(): boolean;
  attach(series: ISeriesApi<SeriesType>, chart: IChartApi, container?: HTMLElement): void;
  detach(): void;
  toJSON(): DrawingJSON;
  fromJSON(item: DrawingJSON): void;
}

export class DrawingManager {
  attach(
    chart: IChartApi,
    series: ISeriesApi<SeriesType> | null,
    container: HTMLElement,
    seriesIdResolver?: (series: ISeriesApi<SeriesType>) => string | undefined,
    seriesResolverById?: (seriesId: string) => ISeriesApi<SeriesType> | undefined,
  ): void;
  detach(): void;
  isAttached(): boolean;
  addDrawing(drawing: DrawingInstance, series?: ISeriesApi<SeriesType>): void;
  removeDrawing(id: string): void;
  getDrawing(id: string): DrawingInstance | undefined;
  getAllDrawings(): DrawingInstance[];
  clearAll(): void;
  shiftLogicalAnchors(added: number): void;
  exportDrawings(): DrawingJSON[];
  importDrawings(
    items: DrawingJSON[],
    factory: (type: string, item: DrawingJSON) => DrawingInstance | null,
    paneResolver: (paneIndex: number) => ISeriesApi<SeriesType> | undefined,
    seriesResolver: (seriesId: string) => ISeriesApi<SeriesType> | undefined,
  ): void;
  setActiveTool(type: string | null): void;
  getActiveTool(): string | null;
  on(event: string, listener: (event: unknown) => void): () => void;
}

export interface DrawingToolRegistry {
  getAll(): Array<{ type: string; name: string; category: string; requiredAnchors: number }>;
  get(type: string): { type: string; name: string; category: string; requiredAnchors: number } | undefined;
  has(type: string): boolean;
  createDrawing(
    type: string,
    id: string,
    anchors?: Array<{ time: number | string; logical?: number; price: number }>,
    style?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): DrawingInstance | null;
}

export function getToolRegistry(): DrawingToolRegistry;
export const VERSION: string;
