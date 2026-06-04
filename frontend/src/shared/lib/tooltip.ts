/** Matches Monaco hover delay. */
export const TOOLTIP_SHOW_DELAY_MS = 300;

export function tooltipProps(text: string | undefined | null): { 'data-tooltip'?: string } {
  if (text == null || text === '') return {};
  return { 'data-tooltip': text };
}
