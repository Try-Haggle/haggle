import { createClient } from "@supabase/supabase-js";

const BUCKET = "listing-photos";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const MIME_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable",
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface UploadResult {
  publicUrl: string;
}

/**
 * Upload a base64-encoded image to Supabase Storage.
 * Returns the public URL on success.
 */
export async function uploadListingPhoto(
  draftId: string,
  base64Data: string,
  mimeType: string,
): Promise<UploadResult> {
  // Validate MIME type
  const ext = MIME_MAP[mimeType];
  if (!ext) {
    throw new Error(
      `Unsupported image type: ${mimeType}. Allowed: ${Object.keys(MIME_MAP).join(", ")}`,
    );
  }

  // Decode base64
  const buffer = Buffer.from(base64Data, "base64");

  // Validate size
  if (buffer.byteLength > MAX_FILE_SIZE) {
    const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Image too large (${sizeMB} MB). Maximum allowed size is 5 MB.`,
    );
  }

  const supabase = getSupabaseAdmin();
  const filePath = `${draftId}/${Date.now()}${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(filePath);

  return { publicUrl };
}
