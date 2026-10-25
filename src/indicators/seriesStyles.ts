import { HistogramSeries, LineSeries, type SeriesDefinition } from 'lightweight-charts';
import type { Theme } from '../app/theme';
import type { Candle } from '../types/marketData';
import type { OutputDef } from './types';

export interface OutputSeriesStyle {
  readonly definition: SeriesDefinition<'Line'> | SeriesDefinition<'Histogram'>;
  readonly options: Readonly<Record<string, unknown>>;
  /** Histograms only: the colour of one bar, from its value and its candle. `undefined` keeps the series colour. */
  readonly pointColor?: (value: number, candle: Candle | undefined) => string | undefined;
}

/** How indicator outputs and SMAs look. Injectable so the coordination layer needs no chart library to be tested. */
export interface SeriesStyleProvider {
  forOutput(definitionId: string, output: OutputDef): OutputSeriesStyle;
  /** `ordinal` is the source's stable position in the SMA source list, so a source always gets the same colour. */
  forSma(sourceKey: string, ordinal: number): OutputSeriesStyle;
}

const SMA_COLORS = ['#f2c14e', '#c792ea', '#5ad1f0', '#ff9ecb', '#9be37a'] as const;
const AD_COLOR = '#c792ea';

/** Appends a hex alpha ("99" = 60%) to a #rrggbb colour. */
const withAlpha = (hex: string, alpha: string): string => `${hex}${alpha}`;

export function createSeriesStyles(theme: Pick<Theme, 'accent' | 'warn' | 'up' | 'down'>): SeriesStyleProvider {
  const line = (color: string, extra: Record<string, unknown> = {}): OutputSeriesStyle => ({
    definition: LineSeries,
    options: { color, lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false, ...extra },
  });

  return {
    forOutput(definitionId, output) {
      switch (`${definitionId}:${output.key}`) {
        case 'rsi:rsi':
          // Always show the whole 0-100 scale, not just the range the data happens to cover.
          return line(theme.accent, { autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
        case 'volume:volume':
          return {
            definition: HistogramSeries,
            options: { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
            pointColor: (_value, candle) => withAlpha(candle !== undefined && candle.close < candle.open ? theme.down : theme.up, '99'),
          };
        case 'obv:obv':
          return line(theme.accent);
        case 'ad:ad':
          return line(AD_COLOR);
        case 'macd:macd':
          return line(theme.accent);
        case 'macd:signal':
          return line(theme.warn);
        case 'macd:histogram':
          return {
            definition: HistogramSeries,
            options: { priceLineVisible: false, lastValueVisible: false },
            pointColor: (value) => withAlpha(value >= 0 ? theme.up : theme.down, 'cc'),
          };
      }
      // An indicator added later still gets a sensible default until it has its own style.
      return output.kind === 'histogram'
        ? { definition: HistogramSeries, options: { color: theme.accent, priceLineVisible: false, lastValueVisible: false } }
        : line(theme.accent);
    },

    forSma(_sourceKey, ordinal) {
      return line(SMA_COLORS[ordinal % SMA_COLORS.length]!, { lastValueVisible: false });
    },
  };
}
