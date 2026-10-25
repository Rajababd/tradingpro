/**
 * Single source of truth for colours. `applyThemeToDocument` publishes these as CSS custom
 * properties so the stylesheet and the chart canvas always agree.
 *
 * Up/down use teal and amber instead of green and red so direction stays readable for
 * people with red-green colour-vision deficiency.
 */
export const theme = {
  ink: '#10151c', // page and chart background
  panel: '#171e27', // top bar
  rule: '#2a3441', // borders, grid
  text: '#d7dee8',
  muted: '#8693a4',
  up: '#2ec4a6',
  down: '#e8833a',
  accent: '#7aa7ff',
  warn: '#f2c14e',
  danger: '#ff7b72',
} as const;

export type Theme = typeof theme;

export function applyThemeToDocument(target: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(theme)) {
    target.style.setProperty(`--c-${name}`, value);
  }
}
