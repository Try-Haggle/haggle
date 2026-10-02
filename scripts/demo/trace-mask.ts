const REDACTED = "[REDACTED]";

const SECRET_KEYS =
  /^(access_token|refresh_token|id_token|code|code_verifier|client_secret|authorization|token)$/i;
const PII_KEYS =
  /^(email|phone|phone_number|address|street|street1|street2|postal_code|zip|full_name|recipient|recipient_name|ship_to)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\d.])\+?\d[\d\s().-]{8,}\d(?![\d.])/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const URL_SECRET_PARAMS = /([?&](?:code|access_token|refresh_token|code_verifier)=)[^&\s"]+/gi;

export function maskString(value: string, knownSecrets: readonly string[] = []): string {
  let out = value;
  for (const secret of knownSecrets) {
    if (secret.length >= 8) out = out.split(secret).join(REDACTED);
  }
  return out
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(URL_SECRET_PARAMS, `$1${REDACTED}`)
    .replace(EMAIL, "[EMAIL]")
    .replace(PHONE, "[PHONE]");
}

export function maskTrace(value: unknown, knownSecrets: readonly string[] = []): unknown {
  if (typeof value === "string") {
    // MCP tool results are JSON encoded inside content[].text; mask structurally when possible.
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(maskTrace(JSON.parse(trimmed), knownSecrets));
      } catch {
        // fall through to string masking
      }
    }
    return maskString(value, knownSecrets);
  }
  if (Array.isArray(value)) return value.map((item) => maskTrace(item, knownSecrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] =
        SECRET_KEYS.test(key) || PII_KEYS.test(key) ? REDACTED : maskTrace(item, knownSecrets);
    }
    return out;
  }
  return value;
}
