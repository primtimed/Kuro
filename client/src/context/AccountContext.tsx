import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { PinDialog } from "../components/PinDialog";
import { api, UNAUTHORIZED_EVENT } from "../lib/api";
import { ACCOUNT_STORAGE_KEY, GUEST_ACCOUNT, type Account } from "../lib/accounts";

import type { Me } from "../lib/types";

type AuthStatus = "loading" | "signedIn" | "signedOut" | "offline";

interface AccountContextValue {
  status: AuthStatus;
  account: Account | null;
  profiles: Account[];
  me: Me | null;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  requestProfile: (profile: Account) => void;
  signOut: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [pinTarget, setPinTarget] = useState<Account | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.auth.me();
      setMe(next);
      setStatus("signedIn");
    } catch (err) {
      setMe(null);
      setStatus((err as { status?: number }).status === 401 ? "signedOut" : "offline");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleUnauthorized = () => { setMe(null); setStatus("signedOut"); };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [refresh]);

  useEffect(() => {
    try {
      if (me) localStorage.setItem(ACCOUNT_STORAGE_KEY, me.activeProfileId);
      else localStorage.removeItem(ACCOUNT_STORAGE_KEY);
    } catch { /* storage unavailable — guest detection falls back to the server */ }
  }, [me]);

  const profiles = useMemo<Account[]>(
    () => [...(me?.profiles ?? []), GUEST_ACCOUNT],
    [me]
  );
  const account = profiles.find((p) => p.id === me?.activeProfileId) ?? null;

  // A full reload clears every page's state that belonged to the previous profile.
  const openProfile = useCallback(() => { window.location.href = "/"; }, []);

  const requestProfile = useCallback((profile: Account) => {
    if (profile.id === me?.activeProfileId) {
      openProfile();
      return;
    }
    if (profile.needsPin) {
      setPinTarget(profile);
      return;
    }
    api.auth.switchProfile(profile.id)
      .then(openProfile)
      .catch((err: unknown) => console.error("[account] switching profile failed:", err));
  }, [me, openProfile]);

  const signOut = useCallback(async () => {
    await api.auth.signOut().catch((err: unknown) => console.error("[account] sign-out failed:", err));
    window.location.href = "/";
  }, []);

  const value: AccountContextValue = {
    status,
    account,
    profiles,
    me,
    isAdmin: !!me?.owner.isAdmin,
    refresh,
    requestProfile,
    signOut,
  };

  return (
    <AccountContext.Provider value={value}>
      {children}
      {pinTarget && (
        <PinDialog
          profile={pinTarget}
          onUnlocked={openProfile}
          onCancel={() => setPinTarget(null)}
        />
      )}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
