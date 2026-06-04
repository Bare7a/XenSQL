import { useEffect } from 'react';
import type { EditorTab } from '@/types';

// Scrolls the active tab into view on change - needed after Ctrl+Tab cycling and sidebar tab opens.
export function useScrollActiveTabIntoView(
  tabStripRef: React.RefObject<HTMLElement | null>,
  tabs: EditorTab[],
  activeTabId: string | null
): void {
  useEffect(() => {
    if (!activeTabId || !tabStripRef.current) return;
    const idx = tabs.findIndex((tab) => tab.id === activeTabId);
    if (idx < 0) return;
    const el = tabStripRef.current.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [tabStripRef, activeTabId, tabs]);
}
