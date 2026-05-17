import { createContext, useContext, useState } from "react";

type MediaMode = "anime" | "tv";

const STORAGE_KEY = "kuro-media-mode";

const MediaModeContext = createContext<{
  mode: MediaMode;
  setMode: (m: MediaMode) => void;
}>({ mode: "anime", setMode: () => {} });

export function MediaModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<MediaMode>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "tv" ? "tv" : "anime";
    } catch {
      return "anime";
    }
  });

  function setMode(m: MediaMode) {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* storage unavailable */ }
  }

  return (
    <MediaModeContext.Provider value={{ mode, setMode }}>
      {children}
    </MediaModeContext.Provider>
  );
}

export function useMediaMode() {
  return useContext(MediaModeContext);
}
