'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type PageTitleContextType = {
  title: string;
  setTitle: (title: string) => void;
};

const PageTitleContext = createContext<PageTitleContextType>({
  title: '',
  setTitle: () => {},
});

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitleState] = useState('');
  const setTitle = useCallback((t: string) => setTitleState(t), []);
  return (
    <PageTitleContext.Provider value={{ title, setTitle }}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle(newTitle?: string) {
  const ctx = useContext(PageTitleContext);

  useEffect(() => {
    if (newTitle !== undefined) {
      ctx.setTitle(newTitle);
    }
  }, [newTitle, ctx.setTitle]);

  return ctx;
}
