import { useEffect, useRef } from "react";

// Google Identity Services renders its own button and hands back an ID token ("credential"),
// which the server verifies. Loaded on demand so signed-in visits never fetch it.
const GIS_SRC = "https://accounts.google.com/gsi/client";

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (response: { credential: string }) => void; ux_mode?: "popup" }) => void;
      renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let scriptLoader: Promise<GoogleIdentity> | null = null;

function loadGoogleIdentity(): Promise<GoogleIdentity> {
  scriptLoader ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error("Google sign-in failed to load")));
    script.onerror = () => {
      scriptLoader = null;
      reject(new Error("Google sign-in failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptLoader;
}

interface GoogleSignInButtonProps {
  clientId: string;
  onCredential: (credential: string) => void;
  onLoadError: (message: string) => void;
  /** White button as wide as its container (Google allows 200–400px) instead of the compact black one. */
  isWide?: boolean;
}

const GOOGLE_MIN_WIDTH = 200;
const GOOGLE_MAX_WIDTH = 400;

export function GoogleSignInButton({ clientId, onCredential, onLoadError, isWide }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Google keeps the first callback it is given; route it through a ref so it always calls the latest one.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  useEffect(() => {
    let isCancelled = false;
    loadGoogleIdentity()
      .then((google) => {
        if (isCancelled || !containerRef.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: "popup",
          callback: (response) => onCredentialRef.current(response.credential),
        });
        const wideWidth = Math.round(Math.min(GOOGLE_MAX_WIDTH, Math.max(GOOGLE_MIN_WIDTH, containerRef.current.offsetWidth)));
        google.accounts.id.renderButton(containerRef.current, {
          theme: isWide ? "outline" : "filled_black",
          size: "large",
          shape: "pill",
          text: "signin_with",
          width: isWide ? wideWidth : 280,
        });
      })
      .catch((err: Error) => { if (!isCancelled) onLoadError(err.message); });
    return () => { isCancelled = true; };
  }, [clientId, onLoadError, isWide]);

  return <div ref={containerRef} style={{ minHeight: 44, display: "flex", justifyContent: "center" }} />;
}
