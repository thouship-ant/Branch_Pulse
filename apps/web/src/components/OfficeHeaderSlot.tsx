'use client';

import { createContext, isValidElement, useContext, useEffect, useRef, type ReactNode } from 'react';

export interface OfficeHeaderContent { subtitle?: string; right?: ReactNode }

export const OfficeHeaderContext = createContext<(content: OfficeHeaderContent | null) => void>(() => undefined);

export function OfficeHeaderSlot({ subtitle, right }: OfficeHeaderContent) {
  const setContent = useContext(OfficeHeaderContext);
  const current = useRef<OfficeHeaderContent | null>(null);
  useEffect(() => {
    return () => { current.current = null; setContent(null); };
  }, [setContent]);
  useEffect(() => {
    const previous = current.current;
    const previousRight = previous?.right;
    const previousElement = isValidElement<Record<string, unknown>>(previousRight) ? previousRight : null;
    const nextElement = isValidElement<Record<string, unknown>>(right) ? right : null;
    const sameRight = previousRight === right || (
      previousElement !== null && nextElement !== null &&
      previousElement.type === nextElement.type &&
      Object.keys(nextElement.props).length === Object.keys(previousElement.props).length &&
      Object.keys(nextElement.props).every((key) => Object.is(nextElement.props[key], previousElement.props[key]))
    );
    if (previous?.subtitle !== subtitle || !sameRight) {
      const next = { subtitle, right };
      current.current = next;
      setContent(next);
    }
  }, [setContent, subtitle, right]);
  return null;
}
