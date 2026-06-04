import { useEffect, useState } from 'react';
import {
  getEffectiveEditorFontSize,
  subscribeEditorFontSizeChanged,
} from '@/features/editor/lib/editorFontSize';

export function useEditorFontSize(): number {
  const [fontSize, setFontSize] = useState(() => getEffectiveEditorFontSize());

  useEffect(() => subscribeEditorFontSizeChanged(setFontSize), []);

  return fontSize;
}
