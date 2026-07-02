import { useSyncExternalStore } from 'react';
import { getEffectiveEditorFontSize, subscribeEditorFontSizeChanged } from '@/features/editor/lib/editorFontSize';

export function useEditorFontSize(): number {
  return useSyncExternalStore(subscribeEditorFontSizeChanged, getEffectiveEditorFontSize);
}
