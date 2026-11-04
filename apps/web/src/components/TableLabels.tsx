'use client';

import { useEffect } from 'react';

/**
 * On a phone every table turns into a stack of cards (see globals.css), where each value needs its column name next to it.
 * This copies each header's text onto the cells below it as `data-label`, for every table on every page, now and whenever
 * a table is drawn or redrawn - so no page has to be changed.
 */
export function TableLabels() {
  useEffect(() => {
    const label = (table: HTMLTableElement) => {
      const heads = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead tr:last-child > th'));
      if (!heads.length) return;
      const names = heads.map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim());
      table.querySelectorAll<HTMLTableRowElement>('tbody > tr, tfoot > tr').forEach((tr) => {
        let col = 0;
        Array.from(tr.children).forEach((cell) => {
          const c = cell as HTMLTableCellElement;
          const name = c.colSpan > 1 ? '' : names[col] ?? '';
          if (c.getAttribute('data-label') !== name) c.setAttribute('data-label', name);
          col += c.colSpan || 1;
        });
      });
    };
    const all = () => document.querySelectorAll<HTMLTableElement>('table').forEach(label);
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(all); };
    all();
    const mo = new MutationObserver(schedule); // childList only: setting an attribute does not retrigger it
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return null;
}
