import type { DesktopApi } from "@supervideo/shared";

declare global {
  interface Window {
    supervideo?: DesktopApi;
  }
}

export {};
