/**
 * Application configuration. Values that depend on the data source live here, not in the
 * data layer: there is deliberately no global "right" polling interval.
 */
export const config = {
  symbol: 'SIM',
  timeframe: '1D' as const,
  /** Candles fetched on first load. Kept below the fixture's total so paging back has something to find. */
  initialBars: 300,
  /** Candles per older page. */
  olderPageBars: 150,
  /** Request older history when fewer than this many candles are hidden to the left of the viewport. */
  loadOlderWithinBars: 20,
  /** Poll interval for the SIMULATED fixture feed. A real provider must set its own, within its rate limits. */
  pollIntervalMs: 2000,
} as const;
