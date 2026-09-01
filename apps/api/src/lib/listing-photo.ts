import { uploadListingPhoto } from "./supabase-storage.js";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
]);

const MIME_FROM_MAGIC: Array<{
  mime: "image/jpeg" | "image/png" | "image/webp";
  test: (buf: Buffer) => boolean;
}> = [
  {
    mime: "image/jpeg",
    test: (buf) => buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mime: "image/png",
    test: (buf) =>
      buf.length > 7 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47,
  },
  {
    mime: "image/webp",
    test: (buf) =>
      buf.length > 11 &&
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export function isSafeListingPhotoUrl(raw: string): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (!host || host.includes("*") || BLOCKED_HOSTS.has(host)) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (isPrivateHostname(host)) return false;
  return true;
}

function isPrivateHostname(host: string): boolean {
  if (host === "127.0.0.1" || host === "::1") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function stripDataUri(raw: string): { data: string; mime?: string } {
  const match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
  if (match) return { mime: match[1].toLowerCase(), data: match[2] };
  return { data: raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw };
}

function detectMime(
  buffer: Buffer,
  hinted?: string,
): "image/jpeg" | "image/png" | "image/webp" | null {
  const fromMagic = MIME_FROM_MAGIC.find((entry) => entry.test(buffer));
  if (fromMagic) return fromMagic.mime;
  if (hinted === "image/jpeg" || hinted === "image/png" || hinted === "image/webp") return hinted;
  return null;
}

export async function storeListingPhoto(input: {
  storageKey: string;
  imageBase64?: string;
  mimeType?: string;
  photoUrl?: string;
}): Promise<{ ok: true; publicUrl: string } | { ok: false; error: string }> {
  if (input.imageBase64?.trim()) {
    const stripped = stripDataUri(input.imageBase64.trim());
    const buffer = Buffer.from(stripped.data, "base64");
    if (buffer.byteLength === 0) return { ok: false, error: "INVALID_PHOTO" };
    const mime = detectMime(buffer, stripped.mime ?? input.mimeType);
    if (!mime) return { ok: false, error: "UNSUPPORTED_PHOTO_TYPE" };
    try {
      const uploaded = await uploadListingPhoto(input.storageKey, buffer.toString("base64"), mime);
      return { ok: true, publicUrl: uploaded.publicUrl };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "PHOTO_UPLOAD_FAILED",
      };
    }
  }

  const remote = input.photoUrl?.trim();
  if (!remote) return { ok: false, error: "PHOTO_REQUIRED" };
  if (!isSafeListingPhotoUrl(remote)) return { ok: false, error: "UNSAFE_PHOTO_URL" };

  try {
    const fetched = await fetchRemoteListingPhoto(remote);
    if (!fetched.ok) return fetched;
    const uploaded = await uploadListingPhoto(
      input.storageKey,
      fetched.buffer.toString("base64"),
      fetched.mime,
    );
    return { ok: true, publicUrl: uploaded.publicUrl };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "PHOTO_FETCH_FAILED",
    };
  }
}

async function fetchRemoteListingPhoto(
  url: string,
): Promise<
  | { ok: true; buffer: Buffer; mime: "image/jpeg" | "image/png" | "image/webp" }
  | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "image/jpeg,image/png,image/webp,image/*" },
    });
    if (!response.ok) return { ok: false, error: "PHOTO_FETCH_FAILED" };
    const hinted = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) {
      return { ok: false, error: "PHOTO_TOO_LARGE" };
    }
    const mime = detectMime(bytes, hinted);
    if (!mime) return { ok: false, error: "UNSUPPORTED_PHOTO_TYPE" };
    return { ok: true, buffer: bytes, mime };
  } finally {
    clearTimeout(timer);
  }
}
