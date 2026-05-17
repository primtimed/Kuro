import { createContext, useContext, useState, type ReactNode } from "react";
import type { Account } from "../lib/accounts";
import { ACCOUNTS, ACCOUNT_STORAGE_KEY, GUEST_ACCOUNT } from "../lib/accounts";

interface AccountContextValue {
  account: Account | null;
  setAccount: (account: Account) => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccountState] = useState<Account | null>(() => {
    const saved = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    return ACCOUNTS.find((a) => a.id === saved) ?? (saved === GUEST_ACCOUNT.id ? GUEST_ACCOUNT : null);
  });

  function setAccount(a: Account) {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, a.id);
    setAccountState(a);
  }

  return (
    <AccountContext.Provider value={{ account, setAccount }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}
