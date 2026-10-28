/** Source-specific settings; DSE publishes daily history, so polling is deliberately conservative. */
export const config = {
  symbol: 'DWX',
  timeframe: '1D' as const,
  /** Most recent bars shown on initial load (applies after weekly/monthly aggregation). */
  initialBars: 300,
  olderPageBars: 150,
  loadOlderWithinBars: 20,
  /** Re-fetch the daily history conservatively; DSE has no intraday feed wired here. */
  pollIntervalMs: 300_000,
} as const;
