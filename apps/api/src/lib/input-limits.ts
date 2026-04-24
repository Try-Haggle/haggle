import { z } from "zod";

export const INPUT_LIMITS = {
  jsonBodyBytes: 256 * 1024,
  shortTextChars: 128,
  mediumTextChars: 512,
  longTextChars: 10_000,
  disputeSummaryChars: 2_000,
  advisorMessageChars: 4_000,
  uriChars: 2_048,
  jsonPayloadBytes: 16 * 1024,
  paymentPayloadBytes: 64 * 1024,
} as const;

export function configuredJsonBodyLimit(): number {
  const raw = process.env.HAGGLE_MAX_JSON_BODY_BYTES;
  if (!raw) return INPUT_LIMITS.jsonBodyBytes;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 16 * 1024 || parsed > 1024 * 1024) {
    return INPUT_LIMITS.jsonBodyBytes;
  }
  return parsed;
}

export function boundedJson<T extends z.ZodTypeAny>(
  schema: T,
  maxBytes: number,
  label: string,
): T {
  return schema.superRefine((value, ctx) => {
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} exceeds ${maxBytes} bytes`,
      });
    }
  }) as unknown as T;
}
