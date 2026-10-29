import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadLang, saveLang, setCurrentLang, type Lang } from './i18n';

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; ready: boolean }
const Ctx = createContext<LangCtx>({ lang: 'en', setLang: () => undefined, ready: true });

/**
 * Holds the chosen language (remembered on the phone). The screens below are re-created when it changes, so every piece of
 * text, date and master-data name is drawn again in the new language.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadLang().then((l) => { setCurrentLang(l); setLangState(l); setReady(true); });
  }, []);

  const setLang = useCallback((l: Lang) => {
    setCurrentLang(l);
    setLangState(l);
    void saveLang(l);
  }, []);

  const value = useMemo(() => ({ lang, setLang, ready }), [lang, setLang, ready]);
  return <Ctx.Provider value={value}><Fragment key={lang}>{ready ? children : null}</Fragment></Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);
