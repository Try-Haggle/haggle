"use client";

import { Suspense, useState, useEffect } from "react";
import CheckoutFlow from "../../(marketing)/demo/developer/_components/checkout-flow";

function CheckoutInner() {
  const [data, setData] = useState<{ price: number; item: string; rounds: number } | null>(null);

  useEffect(() => {
    // Read from sessionStorage (not URL) for security
    const raw = sessionStorage.getItem("haggle_checkout");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setData({
          price: (parsed.price ?? 45000) / 100, // minor → dollars
          item: parsed.item ?? "iPhone 14 Pro 128GB · Space Black",
          rounds: parsed.rounds ?? 3,
        });
      } catch {
        setData({ price: 450, item: "iPhone 14 Pro 128GB · Space Black", rounds: 3 });
      }
    } else {
      // Fallback for direct access
      setData({ price: 450, item: "iPhone 14 Pro 128GB · Space Black", rounds: 3 });
    }
  }, []);

  if (!data) return null;

  return (
    <CheckoutFlow
      agreedPrice={data.price}
      itemTitle={data.item}
      rounds={data.rounds}
      onComplete={() => {
        sessionStorage.removeItem("haggle_checkout");
        window.location.href = "/demo/developer";
      }}
    />
  );
}

export default function CheckoutPage() {
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
          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f6f4ee", color: "#6b6b75", fontSize: 14 }}>
            Loading checkout...
          </div>
        }
      >
        <CheckoutInner />
      </Suspense>
    </>
  );
}
