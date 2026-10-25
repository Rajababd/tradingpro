import type { MarketDataService } from '../data/MarketDataService';
import type { Unsubscribe } from '../utils/eventChannel';
import { IndicatorSyncError, type IndicatorEngine } from './IndicatorEngine';

/**
 * Feeds market-data events into the indicator engine, incrementally.
 *
 * If the engine ever disagrees with the data (a bar it did not expect), it does not stay wrong:
 * it logs and recomputes everything from the service's current candles.
 */
export function bindIndicatorsToService(
  engine: IndicatorEngine,
  service: Pick<MarketDataService, 'subscribe' | 'candles'>,
): Unsubscribe {
  if (service.candles.length > 0) engine.reset(service.candles);

  return service.subscribe((event) => {
    try {
      switch (event.type) {
        case 'reset':
          engine.reset(event.candles);
          break;
        case 'prepend':
          engine.prepend(event.candles);
          break;
        case 'append':
          if (event.index !== engine.length) throw new IndicatorSyncError(`Append at index ${event.index}, engine has ${engine.length} bars.`);
          engine.append(event.candle);
          break;
        case 'update':
          if (event.index !== engine.length - 1) throw new IndicatorSyncError(`Update at index ${event.index}, engine has ${engine.length} bars.`);
          engine.update(event.candle);
          break;
      }
    } catch (error) {
      if (!(error instanceof IndicatorSyncError)) throw error;
      console.error('Indicators were out of sync with the market data; recomputing from the current candles.', error);
      engine.reset(service.candles);
    }
  });
}
