"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  buildDemoCheckoutPayload,
  DEFAULT_DEMO_CHECKOUT,
  DEMO_CHECKOUT_STORAGE_KEY,
  type DemoCheckoutPayload,
  parseDemoCheckoutPayload,
} from "@/lib/demo-checkout";
import CheckoutFlow from "../../(marketing)/demo/developer/_components/checkout-flow";

function SetupForm({ onStart }: { onStart: (p: DemoCheckoutPayload) => void }) {
  const [item, setItem] = useState<string>(DEFAULT_DEMO_CHECKOUT.item);
  const [agreed, setAgreed] = useState(String(DEFAULT_DEMO_CHECKOUT.price / 100));
  const [market, setMarket] = useState(String(DEFAULT_DEMO_CHECKOUT.market / 100));
  const [rounds, setRounds] = useState(String(DEFAULT_DEMO_CHECKOUT.rounds));
  const field = { padding: "8px 10px", border: "1px solid #d9d6cc", borderRadius: 8, fontSize: 14 };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onStart(
          buildDemoCheckoutPayload({
            agreedPriceUsd: Number(agreed),
            listingPriceUsd: Number(market),
            item,
            rounds: Number(rounds),
          }),
        );
      }}
      style={{ maxWidth: 420, margin: "12vh auto", display: "grid", gap: 12 }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Start checkout</h1>
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        Item
        <input style={field} value={item} onChange={(e) => setItem(e.target.value)} />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        Agreed price (USD)
        <input
          style={field}
          inputMode="decimal"
          value={agreed}
          onChange={(e) => setAgreed(e.target.value)}
        />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        Market price (USD)
        <input
          style={field}
          inputMode="decimal"
          value={market}
          onChange={(e) => setMarket(e.target.value)}
        />
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        Negotiation rounds
        <input
          style={field}
          inputMode="numeric"
          value={rounds}
          onChange={(e) => setRounds(e.target.value)}
        />
      </label>
      <button
        type="submit"
        style={{ ...field, background: "#14141a", color: "#fff", cursor: "pointer" }}
      >
        Continue to checkout
      </button>
    </form>
  );
}

function CheckoutInner() {
  const presenter = useSearchParams().get("presenter") === "1";
  // undefined = still reading storage, null = show setup form
  const [data, setData] = useState<DemoCheckoutPayload | null | undefined>(undefined);

  useEffect(() => {
    // Read from sessionStorage (not URL) for security
    const raw = sessionStorage.getItem(DEMO_CHECKOUT_STORAGE_KEY);
    setData(raw ? parseDemoCheckoutPayload(raw) : null);
  }, []);

  if (data === undefined) return null;
  if (data === null) {
    return (
      <SetupForm
        onStart={(p) => {
          sessionStorage.setItem(DEMO_CHECKOUT_STORAGE_KEY, JSON.stringify(p));
          setData(p);
        }}
      />
    );
  }

  return (
    <CheckoutFlow
      agreedPrice={data.price / 100}
      marketPrice={data.market / 100}
      itemTitle={data.item}
      itemImageUrl={data.imageUrl}
      rounds={data.rounds}
      presenter={presenter}
      onComplete={() => {
        sessionStorage.removeItem(DEMO_CHECKOUT_STORAGE_KEY);
        setData(null);
      }}
    />
  );
}

export function DemoCheckoutClient() {
  return (
    <>
      <style jsx global>{`
        html, body {
          background: #f6f4ee !important;
          color: #14141a !important;
        }
        body {
          background:
            radial-gradient(1100px 500px at 85% -10%, rgba(8,145,178,0.05), transparent 60%),
            radial-gradient(800px 400px at -5% 110%, rgba(124,58,237,0.04), transparent 60%),
            #f6f4ee !important;
        }
      `}</style>
      <Suspense
        fallback={
          <div
            style={{
              minHeight: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#f6f4ee",
              color: "#6b6b75",
              fontSize: 14,
            }}
          >
            Loading checkout...
          </div>
        }
      >
        <CheckoutInner />
      </Suspense>
    </>
  );
}
