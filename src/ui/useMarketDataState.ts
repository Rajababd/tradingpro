import { useSyncExternalStore } from 'react';
import type { MarketDataService, MarketDataState } from '../data/MarketDataService';

const NO_SUBSCRIPTION = () => () => {};

/**
 * Subscribes React to the service's state snapshots. Only status changes re-render (not
 * pointer moves or chart updates, which go through the event channel straight to the chart).
 */
export function useMarketDataState(service: MarketDataService | null, fallback: MarketDataState): MarketDataState {
  return useSyncExternalStore(
    service ? service.subscribeState : NO_SUBSCRIPTION,
    service ? service.getState : () => fallback,
  );
}
