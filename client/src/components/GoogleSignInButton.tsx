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
}

export function GoogleSignInButton({ clientId, onCredential, onLoadError }: GoogleSignInButtonProps) {
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
        google.accounts.id.renderButton(containerRef.current, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "signin_with",
          width: 280,
        });
      })
      .catch((err: Error) => { if (!isCancelled) onLoadError(err.message); });
    return () => { isCancelled = true; };
  }, [clientId, onLoadError]);

  return <div ref={containerRef} style={{ minHeight: 44, display: "flex", justifyContent: "center" }} />;
}
