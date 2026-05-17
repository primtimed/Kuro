export interface Account {
  id: string;
  name: string;
  color: string;
  initial: string;
  isGuest?: boolean;
}

export const ACCOUNTS: Account[] = [
  { id: "1", name: "Familie",  color: "#e50914", initial: "Fa" },
  { id: "2", name: "Ronny",    color: "#3b82f6", initial: "Ro" },
  { id: "3", name: "Mellanie", color: "#a855f7", initial: "Me" },
  { id: "4", name: "Brian",    color: "#22c55e", initial: "Br" },
  { id: "5", name: "Romy",     color: "#f59e0b", initial: "Ry" },
];

export const GUEST_ACCOUNT: Account = {
  id: "guest",
  name: "Guest",
  color: "#6b7280",
  initial: "G",
  isGuest: true,
};

export const ACCOUNT_STORAGE_KEY = "kuro_account_id";
