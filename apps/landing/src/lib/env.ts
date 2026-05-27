/**
 * Public env vars exposed to the browser.
 * Falls back to localhost for local dev when .env.local is missing.
 */
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
