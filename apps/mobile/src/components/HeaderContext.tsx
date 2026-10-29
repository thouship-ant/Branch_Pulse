import { createContext, useContext, type ReactNode } from 'react';

/** What the curved header shows: the user's name, the company (and branch) under it, and an optional action on the right. */
export interface HeaderInfo { title: string; subtitle?: string; right?: ReactNode }

const Ctx = createContext<HeaderInfo | null>(null);
export const HeaderProvider = Ctx.Provider;
export const useHeader = () => useContext(Ctx);
