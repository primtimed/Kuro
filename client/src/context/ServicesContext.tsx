import { createContext, useContext, type ReactNode } from "react";

interface ServicesContextValue {
  enabledServiceIds: string[];
  reload: () => void;
  loading: boolean;
}

const ServicesContext = createContext<ServicesContextValue>({
  enabledServiceIds: [],
  reload: () => {},
  loading: false,
});

export function ServicesProvider({ children }: { children: ReactNode }) {
  return (
    <ServicesContext.Provider value={{ enabledServiceIds: [], reload: () => {}, loading: false }}>
      {children}
    </ServicesContext.Provider>
  );
}

export function useServices() {
  return useContext(ServicesContext);
}
