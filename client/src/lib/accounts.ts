export interface Account {
  id: string;
  name: string;
  color: string;
  initial: string;
  isGuest?: boolean;
  isShared?: boolean;
  isOwner?: boolean;
  needsPin?: boolean;
}

// Guest is a built-in profile any signed-in device can use; nothing it does is saved.
export const GUEST_ACCOUNT: Account = {
  id: "guest",
  name: "Guest",
  color: "#6b7280",
  initial: "G",
  isGuest: true,
};

// Mirrors the server-side active profile so API helpers and local caches can read it synchronously.
export const ACCOUNT_STORAGE_KEY = "kuro_account_id";
