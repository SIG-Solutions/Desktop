/// <reference types="astro/client" />

interface Window {
  dataLayer: unknown[];
  gtag: (...args: unknown[]) => void;
  fbq: (...args: unknown[]) => void;
}

declare function gtag(...args: unknown[]): void;
declare function fbq(...args: unknown[]): void;
