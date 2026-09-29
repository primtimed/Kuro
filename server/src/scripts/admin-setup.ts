// Recovery when the admin is locked out (e.g. lost Google account):
//   docker compose exec server node dist/scripts/admin-setup.js
// Prints a fresh one-time setup link; signing in with it re-links the admin profile.

import { printAdminSetupLink } from "../lib/invites.js";

printAdminSetupLink();
