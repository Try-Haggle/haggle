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

test("preserves UUIDs and wallet addresses", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const wallet = "0x1234567890123456789012345678901234567890";
  const masked = JSON.stringify(
    maskTrace({ session_id: uuid, wallet_address: wallet, note: `session ${uuid} wallet ${wallet}` }),
  );
  assert.ok(masked.includes(uuid));
  assert.ok(masked.includes(wallet));
  assert.ok(!masked.includes("[PHONE]"));
});

test("masks nested address name fields and shipping_address", () => {
  const masked = JSON.stringify(
    maskTrace({
      order: {
        shipping_address: { name: "Jane Roe", line: "9 Elm" },
        ship: { address: { first_name: "Jane", last_name: "Roe", city: "SF" } },
        recipient: { name: "John Doe" },
      },
      listing: { name: "Phone X" },
    }),
  );
  for (const v of ["Jane", "Roe", "9 Elm", "John Doe"]) assert.ok(!masked.includes(v), v);
  assert.ok(masked.includes("Phone X"));
});
