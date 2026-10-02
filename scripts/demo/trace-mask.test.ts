import assert from "node:assert/strict";
import { test } from "node:test";
import { maskTrace } from "./trace-mask.ts";

test("masks tokens, nested JSON text, emails and phones", () => {
  const token = "hgl_abcdef1234567890SECRET";
  const masked = JSON.stringify(
    maskTrace(
      {
        headers: { authorization: `Bearer ${token}` },
        content: [
          {
            type: "text",
            text: JSON.stringify({
              access_token: token,
              note: `mail me at buyer@example.com or +1 (415) 555-0123, ref ${token}`,
              shipping: { address: "1 Main St", city: "SF" },
              price_minor: 42000,
            }),
          },
        ],
        url: "http://x/cb?code=abc123&state=s",
      },
      [token],
    ),
  );
  assert.ok(!masked.includes(token));
  assert.ok(!masked.includes("buyer@example.com"));
  assert.ok(!masked.includes("555-0123"));
  assert.ok(!masked.includes("1 Main St"));
  assert.ok(!masked.includes("abc123"));
  assert.ok(masked.includes("42000"));
});
