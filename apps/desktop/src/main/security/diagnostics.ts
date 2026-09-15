import type { SecurityLog } from "./ipc";

export function createSecurityLogger(): SecurityLog {
  return (event, details = {}) => {
    console.warn(`[desktop-security] ${JSON.stringify({ event, ...details })}`);
  };
}
