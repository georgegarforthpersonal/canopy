import { useState, useRef, useCallback } from 'react';

const HIGHLIGHT_BG = 'rgba(219, 237, 219, 0.7)';

/**
 * Briefly highlight a freshly created/updated row and scroll it into view.
 *
 * The toast is the reliable confirmation; this is a progressive enhancement that
 * only fires when the affected row is on the current page (always true for
 * unpaginated lists). Call `highlight(id)` after the list has reloaded, spread
 * `rowRef(id)` onto the row, and merge `rowSx(id)` into its `sx`.
 */
export function useRowHighlight<T extends HTMLElement = HTMLTableRowElement>() {
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const ref = useRef<T | null>(null);

  const highlight = useCallback((id: number) => {
    setHighlightId(id);
    window.setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    window.setTimeout(() => {
      setHighlightId((current) => (current === id ? null : current));
    }, 3000);
  }, []);

  const rowRef = useCallback(
    (id: number) => (id === highlightId ? ref : undefined),
    [highlightId],
  );

  // Returns a plain style object (not SxProps) so it composes inside an `sx` array.
  const rowSx = useCallback(
    (id: number) => ({
      transition: 'background-color 0.6s ease-out',
      bgcolor: id === highlightId ? HIGHLIGHT_BG : 'transparent',
    }),
    [highlightId],
  );

  return { highlightId, highlight, rowRef, rowSx };
}
