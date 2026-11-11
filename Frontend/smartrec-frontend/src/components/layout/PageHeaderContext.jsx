import { createContext, useCallback, useContext, useMemo, useState } from "react";

const PageHeaderContext = createContext(null);

export function PageHeaderProvider({ pathname, children }) {
  const [override, setOverride] = useState(null);
  const setPageHeader = useCallback(
    (header) => setOverride(header ? { ...header, pathname } : null),
    [pathname],
  );
  const pageHeader = override?.pathname === pathname ? override : null;
  const value = useMemo(
    () => ({ pageHeader, setPageHeader }),
    [pageHeader, setPageHeader],
  );

  return (
    <PageHeaderContext.Provider value={value}>
      {children}
    </PageHeaderContext.Provider>
  );
}

export function usePageHeader() {
  const context = useContext(PageHeaderContext);
  if (!context) {
    throw new Error("usePageHeader must be used inside PageHeaderProvider.");
  }
  return context;
}
