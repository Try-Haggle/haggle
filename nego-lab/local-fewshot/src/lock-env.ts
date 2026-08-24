// Capture the shell DATABASE_URL before load-env overlays apps/api/.env.
const locked = process.env.DATABASE_URL;
if (locked) {
  (globalThis as { __fewshotLabDatabaseUrl?: string }).__fewshotLabDatabaseUrl = locked;
}
