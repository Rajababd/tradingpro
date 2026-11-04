/** Chart defaults for the manual DSE historical-data workflow. */
export const config = {
  symbol: 'DWX',
  timeframe: '1D' as const,
  /** Most recent bars shown on initial load (applies after weekly/monthly aggregation). */
  initialBars: 300,
  olderPageBars: 150,
  loadOlderWithinBars: 20,
} as const;
