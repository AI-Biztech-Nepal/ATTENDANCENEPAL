'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type PageTitleContextType = {
  title: string;
  /** Optional small uppercase label shown above the title (e.g. "Dashboard"). */
  eyebrow: string;
  setTitle: (title: string, eyebrow?: string) => void;
};

const PageTitleContext = createContext<PageTitleContextType>({
  title: '',
  eyebrow: '',
  setTitle: () => {},
});

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ title: '', eyebrow: '' });
  const setTitle = useCallback((title: string, eyebrow = '') => setState({ title, eyebrow }), []);
  return (
    <PageTitleContext.Provider value={{ ...state, setTitle }}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle(newTitle?: string, eyebrow?: string) {
  const ctx = useContext(PageTitleContext);

  useEffect(() => {
    if (newTitle !== undefined) {
      ctx.setTitle(newTitle, eyebrow);
    }
  }, [newTitle, eyebrow, ctx.setTitle]);

  return ctx;
}
