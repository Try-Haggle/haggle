"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Link from "next/link";
import "./landing.css";

/* ── Fee Calculator Data ──────────────────── */
const PLATFORMS: readonly { name: string; dot: string; pct: number; flat: number; highlight?: boolean }[] = [
  { name: "Poshmark", dot: "posh", pct: 20, flat: 0 },
  { name: "eBay", dot: "ebay", pct: 15.6, flat: 0 },
  { name: "StockX", dot: "stk", pct: 12, flat: 0 },
  { name: "Mercari", dot: "mer", pct: 10, flat: 0 },
  { name: "Haggle", dot: "hag", pct: 1.5, flat: 0, highlight: true },
];

const CHIP_VALUES = [100, 500, 1000, 2000];

/* ── Scroll Receipt Stages ──────────────────── */
const STAGES = [
  {
    p: 0.0,
    name: "Poshmark Seller Receipt",
    sub: "Order #PM-88217 · payout 3–5 days",
    fees: [{ k: "Commission (20%)", v: 100.0, chit: "Commission" }],
    total: 400.0,
    foot: "Payout in 3–5 business days",
    txt: "Poshmark takes 20% commission. You lose $100.",
  },
  {
    p: 0.18,
    name: "eBay Seller Receipt",
    sub: "Order #14-09221 · electronics category",
    fees: [
      { k: "Final value fee (13.25%)", v: 66.25, chit: "Final value" },
      { k: "Per-order fixed fee", v: 0.4, chit: "Fixed fee" },
      { k: "Payment processing", v: 11.25, chit: "Processing" },
    ],
    total: 422.1,
    foot: "Payout in 2 business days",
    txt: "eBay — 15.55% once processing is added.",
  },
  {
    p: 0.36,
    name: "StockX Seller Receipt",
    sub: "Order #SX-1129 · authenticated sale",
    fees: [
      { k: "Transaction fee (9%)", v: 45.0, chit: "Transaction" },
      { k: "Payment processing (3%)", v: 15.0, chit: "Processing" },
    ],
    total: 440.0,
    foot: "Authentication + payout in 5 days",
    txt: "StockX — 12%. Still $60 gone.",
  },
  {
    p: 0.54,
    name: "Mercari Seller Receipt",
    sub: "Order #ME-40221 · standard sale",
    fees: [{ k: "Selling fee (10%)", v: 50.0, chit: "Selling" }],
    total: 450.0,
    foot: "Payout on buyer confirmation",
    txt: "Mercari — 10%. Every sale, every time.",
  },
  {
    p: 0.72,
    name: "Haggle Settlement Receipt",
    sub: "tx · 0x8f2a…b7c1 · Base L2 · block 18,420,317",
    fees: [
      { k: "Haggle fee (1.5%)", v: 7.5, chit: "" },
      { k: "Gas fee (sponsored)", v: 0.0, chit: "" },
    ],
    total: 492.5,
    foot: "Settled in USDC on Base L2 · Non-custodial ✓",
    txt: "One fee. One block. Non-custodial.",
    good: true,
  },
  {
    p: 1.0,
    name: "Haggle Settlement Receipt",
    sub: "tx · 0x8f2a…b7c1 · Base L2 · block 18,420,317",
    fees: [
      { k: "Haggle fee (1.5%)", v: 7.5, chit: "" },
      { k: "Gas fee (sponsored)", v: 0.0, chit: "" },
    ],
    total: 492.5,
    foot: "Settled in USDC on Base L2 · Non-custodial ✓",
    txt: "+$92.50 in your pocket vs Poshmark. Every sale.",
    good: true,
    final: true,
  },
];

const FLY_TRANSFORMS = [
  "translate(-50%,-50%) translate(-380px,-240px) rotate(-18deg)",
  "translate(-50%,-50%) translate(340px,-200px) rotate(14deg)",
  "translate(-50%,-50%) translate(-320px,240px) rotate(-12deg)",
  "translate(-50%,-50%) translate(360px,260px) rotate(18deg)",
];

/* ── Helpers ──────────────────── */
function fmtDollar(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n: number) {
  return Math.round(n).toLocaleString("en-US");
}
function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/* ══════════════════════════════════════════════
   Main Landing Component
   ══════════════════════════════════════════════ */
export function Landing() {
  const [price, setPrice] = useState(500);
  const [activeChip, setActiveChip] = useState(500);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* ── Override body dark theme ── */
  useEffect(() => {
    const prev = document.body.style.cssText;
    document.body.style.background = "#f6f4ee";
    document.body.style.color = "#14141a";
    return () => {
      document.body.style.cssText = prev;
    };
  }, []);

  /* ── Nav scroll tint ── */
  useEffect(() => {
    const nav = document.getElementById("hg-navWrap");
    if (!nav) return;
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* ── Scroll-driven receipt hero ── */
  useEffect(() => {
    const track = document.getElementById("hg-shTrack") as HTMLElement | null;
    if (!track) return;

    const receipt = document.getElementById("hg-receipt");
    const platName = document.getElementById("hg-platName");
    const platSub = document.getElementById("hg-platSub");
    const totalVal = document.getElementById("hg-totalVal");
    const receiptFoot = document.getElementById("hg-receiptFoot");
    const diffCap = document.getElementById("hg-diffCap");
    const negCard = document.getElementById("hg-negCard");
    const shIdx = document.getElementById("hg-shIdx");
    const shTxt = document.getElementById("hg-shTxt");
    const progDots = document.querySelectorAll("#hg-shProgress .sh-dot");
    const feeRowsEl = document.getElementById("hg-feeRows");
    const torns = [0, 1, 2, 3].map((i) => document.getElementById(`hg-torn${i}`));

    let currentStage = -1;
    let currentFeeEls: HTMLElement[] = [];

    function renderReceiptFees(
      st: (typeof STAGES)[number],
      animateIn: boolean,
    ) {
      if (!feeRowsEl) return;
      feeRowsEl.innerHTML = "";
      currentFeeEls = st.fees.map((f, i) => {
        const row = document.createElement("div");
        row.className = "row neg peel";
        row.innerHTML = `<span class="k">${f.k}</span><span class="v">−$${f.v.toFixed(2)}</span>`;
        if (animateIn) {
          row.style.opacity = "0";
          row.style.transform = "translateY(-6px)";
          requestAnimationFrame(() => {
            row.style.transition = `opacity .5s ease ${i * 60}ms, transform .5s ease ${i * 60}ms`;
            row.style.opacity = "";
            row.style.transform = "";
          });
        }
        feeRowsEl.appendChild(row);
        return row;
      });
    }

    function flyAwayCurrentFees(st: (typeof STAGES)[number]) {
      currentFeeEls.forEach((row, i) => {
        const dir = i % 2 ? 1 : -1;
        row.style.transition = `transform .42s cubic-bezier(.2,.7,.2,1), opacity .3s ease, max-height .32s ease ${i * 25}ms, padding .32s ease ${i * 25}ms`;
        row.style.transform = `translateX(${dir * 120}%) rotate(${dir * 10}deg)`;
        row.style.opacity = "0";
        row.style.maxHeight = "0";
        row.style.padding = "0";
        row.style.overflow = "hidden";
      });
      (st?.fees || []).slice(0, 4).forEach((f, i) => {
        const t = torns[i];
        if (!t || !f.chit) return;
        t.querySelector(".d")!.textContent = f.chit;
        t.querySelector(".x")!.textContent = "−$" + f.v.toFixed(2);
        t.classList.remove("fly");
        t.style.transition = "opacity .2s ease, transform .55s cubic-bezier(.2,.7,.2,1)";
        t.style.opacity = "1";
        t.style.transform = `translate(-50%,-50%) translate(${(i - 1) * 30}px, ${-8 + i * 8}px) rotate(${i % 2 ? 4 : -4}deg)`;
        const tm = setTimeout(() => {
          t.style.opacity = "0";
          t.style.transform = FLY_TRANSFORMS[i];
        }, 140 + i * 50);
        (t as any)._tm = tm;
      });
    }

    function hideAllTorns() {
      torns.forEach((t) => {
        if (t) {
          t.style.opacity = "0";
          t.style.transform = "";
        }
      });
    }

    function update() {
      const rect = track!.getBoundingClientRect();
      const vh = window.innerHeight;
      const scrollable = rect.height - vh;
      const passed = -rect.top;
      let p = scrollable > 0 ? passed / scrollable : 0;
      p = Math.max(0, Math.min(1, p));

      let idx = 0;
      for (let i = 0; i < STAGES.length; i++) {
        if (p >= STAGES[i].p) idx = i;
      }
      const st = STAGES[idx];
      const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
      const span = Math.max(0.0001, next.p - st.p);
      const localT = easeInOut(Math.min(1, (p - st.p) / span));
      const interpTotal = lerp(st.total, next.total, localT);
      if (totalVal) totalVal.textContent = fmtDollar(interpTotal);

      if (idx !== currentStage) {
        const prevIdx = currentStage;
        currentStage = idx;

        if (prevIdx >= 0 && prevIdx < idx) {
          flyAwayCurrentFees(STAGES[prevIdx]);
        } else {
          hideAllTorns();
        }

        if (platName) platName.textContent = st.name;
        if (platSub) platSub.textContent = st.sub;
        if (receiptFoot) receiptFoot.textContent = st.foot;
        if (shIdx) shIdx.textContent = String(idx + 1).padStart(2, "0");
        if (shTxt) shTxt.textContent = st.txt;

        receipt?.classList.toggle("is-bad", !st.good);
        receipt?.classList.toggle("is-good", !!st.good);
        const orbitEl = document.querySelector(".orbit");
        if (orbitEl) orbitEl.classList.toggle("in", !!st.good);

        const delay = prevIdx >= 0 && prevIdx < idx ? 300 : 0;
        setTimeout(() => renderReceiptFees(st, true), delay);

        negCard?.classList.toggle("in", idx >= STAGES.length - 2);
        diffCap?.classList.toggle("in", idx >= STAGES.length - 1);

        progDots.forEach((d, i) => {
          d.classList.toggle("on", i === Math.min(idx, progDots.length - 1));
          d.classList.toggle("done", i < Math.min(idx, progDots.length - 1));
        });
      }

      if (st.good && idx === STAGES.length - 1 && totalVal) {
        totalVal.style.transform = `scale(${1 + 0.04 * Math.sin(localT * Math.PI)})`;
      } else if (totalVal) {
        totalVal.style.transform = "";
      }
    }

    renderReceiptFees(STAGES[0], false);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  /* ── Reveal on scroll ── */
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    document.querySelectorAll(".haggle-landing .reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  /* ── Protection timeline ── */
  useEffect(() => {
    const tRail = document.getElementById("hg-tRail");
    const tFill = document.getElementById("hg-tFill");
    const tSteps = document.querySelectorAll(".haggle-landing .t-step");
    if (!tRail || !tFill) return;

    function updateTimeline() {
      const r = tRail!.getBoundingClientRect();
      const vh = window.innerHeight;
      const start = vh * 0.75;
      const end = vh * 0.25;
      const p = Math.max(0, Math.min(1, (start - r.top) / (start - end)));
      tFill!.style.width = p * 100 + "%";
      tSteps.forEach((s, i) => {
        const pos = i / (tSteps.length - 1);
        s.classList.toggle("on", p >= pos - 0.02);
      });
    }
    window.addEventListener("scroll", updateTimeline, { passive: true });
    window.addEventListener("resize", updateTimeline);
    updateTimeline();
    return () => {
      window.removeEventListener("scroll", updateTimeline);
      window.removeEventListener("resize", updateTimeline);
    };
  }, []);

  /* ── Trust bar marquee ── */
  useEffect(() => {
    const row = document.querySelector(".haggle-landing .trust-row");
    if (!row) return;
    const items = [...row.children];
    const track = document.createElement("div");
    track.className = "trust-marquee";
    items.forEach((el) => track.appendChild(el));
    const clone = track.cloneNode(true) as HTMLElement;
    clone.setAttribute("aria-hidden", "true");
    row.appendChild(track);
    row.appendChild(clone);
  }, []);

  /* ── Orbital chips + live ticker ── */
  useEffect(() => {
    const wrap = document.querySelector(".haggle-landing .sh-receipt-wrap");
    if (!wrap) return;
    const orbit = document.createElement("div");
    orbit.className = "orbit";
    orbit.innerHTML = `
      <span class="chip c1"><span class="d"></span>Base L2 · ChainID 8453</span>
      <span class="chip c2"><span class="d"></span>EIP-712 · verified</span>
      <span class="chip c3"><span class="d"></span>USDC · non-custodial</span>
      <span class="chip c4"><span class="d"></span>x402 · Linux Foundation</span>
    `;
    wrap.appendChild(orbit);

    const tick = document.createElement("div");
    tick.className = "hero-tick";
    tick.innerHTML = '<span class="lp"></span>block <span id="hg-blkN">18,420,317</span> · 2.01s';
    wrap.appendChild(tick);
    let n = 18420317;
    const interval = setInterval(() => {
      n += 1;
      const el = document.getElementById("hg-blkN");
      if (el) el.textContent = n.toLocaleString();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  /* ── Step 01: cycle suggested price ── */
  useEffect(() => {
    const ph = document.querySelector(".haggle-landing .phone-price");
    if (!ph) return;
    const val = ph.querySelector(".v");
    const ticks = document.createElement("div");
    ticks.className = "market-ticks";
    ticks.innerHTML = "<span></span>".repeat(8);
    ph.parentElement?.appendChild(ticks);
    const prices = [520, 515, 524, 519, 528, 522];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % prices.length;
      if (val) val.textContent = "$" + prices[i];
      ph.classList.remove("upd");
      void (ph as HTMLElement).offsetWidth;
      ph.classList.add("upd");
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  /* ── Step 02: auto-play chat bubbles ── */
  useEffect(() => {
    const chat = document.querySelector(".haggle-landing .step:nth-child(2) .chat");
    if (!chat) return;
    const bubbles = [...chat.children] as HTMLElement[];
    let intervalId: ReturnType<typeof setInterval>;
    function run() {
      bubbles.forEach((b) => b.classList.remove("in"));
      bubbles.forEach((b, i) => setTimeout(() => b.classList.add("in"), 300 + i * 650));
    }
    const io = new IntersectionObserver(
      (ents) => {
        ents.forEach((e) => {
          if (e.isIntersecting) {
            run();
            intervalId = setInterval(run, 4000);
            io.disconnect();
          }
        });
      },
      { threshold: 0.3 },
    );
    io.observe(chat);
    return () => {
      io.disconnect();
      clearInterval(intervalId);
    };
  }, []);

  /* ── Step 03: USDC coin ── */
  useEffect(() => {
    const s = document.querySelector(".haggle-landing .settle");
    if (!s) return;
    const coin = document.createElement("div");
    coin.className = "coin";
    s.appendChild(coin);
  }, []);

  /* ── On-chain pulse ── */
  useEffect(() => {
    const diag = document.querySelector(".haggle-landing .chain-diagram");
    if (!diag) return;
    const pulse = document.createElement("div");
    pulse.className = "chain-pulse";
    diag.appendChild(pulse);
    const io = new IntersectionObserver(
      (ents) => {
        ents.forEach((e) => pulse.classList.toggle("on", e.isIntersecting));
      },
      { threshold: 0.2 },
    );
    io.observe(diag);
    return () => io.disconnect();
  }, []);

  /* ── Code block caret ── */
  useEffect(() => {
    const pre = document.querySelector(".haggle-landing .dev .code pre");
    if (!pre) return;
    const caret = document.createElement("span");
    caret.className = "caret";
    pre.appendChild(caret);
  }, []);

  /* ── Final CTA sparkles ── */
  useEffect(() => {
    const final = document.querySelector(".haggle-landing .final");
    if (!final) return;
    const sp = document.createElement("div");
    sp.className = "sparkles";
    let html = "";
    for (let i = 0; i < 22; i++) {
      const left = Math.random() * 100;
      const delay = (Math.random() * 4).toFixed(2);
      const dur = (3 + Math.random() * 3).toFixed(2);
      const size = (2 + Math.random() * 3).toFixed(1);
      html += `<i style="left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s;width:${size}px;height:${size}px"></i>`;
    }
    sp.innerHTML = html;
    final.appendChild(sp);
  }, []);

  /* ── Fee table bar animation ── */
  useEffect(() => {
    const feeBody = document.getElementById("hg-feeBody");
    if (!feeBody) return;
    const obs = new MutationObserver(() => {
      const rows = [...feeBody.querySelectorAll("tr")];
      let max = 0;
      rows.forEach((r) => {
        const cells = r.querySelectorAll(".num");
        if (cells.length >= 3) {
          const lost = (cells[2] as HTMLElement).textContent?.replace(/[^\d.]/g, "") || "0";
          max = Math.max(max, parseFloat(lost) || 0);
        }
      });
      rows.forEach((r) => {
        const cells = r.querySelectorAll(".num");
        if (cells.length >= 3) {
          const lost = parseFloat((cells[2] as HTMLElement).textContent?.replace(/[^\d.]/g, "") || "0") || 0;
          const frac = max > 0 ? lost / max : 0;
          (r as HTMLElement).style.setProperty("--bar", frac.toFixed(3));
        }
      });
    });
    obs.observe(feeBody, { childList: true, subtree: false });
    return () => obs.disconnect();
  }, []);

  /* ── Fee calculator render ── */
  const renderFeeTable = useCallback((p: number) => {
    const feeBody = document.getElementById("hg-feeBody");
    const priceValEl = document.getElementById("hg-priceVal");
    const avgLossEl = document.getElementById("hg-avgLoss");
    const avgSaveEl = document.getElementById("hg-avgSave");
    if (!feeBody) return;

    if (priceValEl) priceValEl.textContent = fmtInt(p);
    feeBody.innerHTML = PLATFORMS.map((pl) => {
      const fee = p * (pl.pct / 100) + pl.flat;
      const rcv = p - fee;
      const cls = pl.highlight ? ' class="row-hg"' : "";
      return `<tr${cls}>
        <td><div class="plat-cell"><span class="plat-dot ${pl.dot}"></span>${pl.highlight ? "<strong>" + pl.name + "</strong>" : pl.name}</div></td>
        <td class="num">${pl.pct}%</td>
        <td class="num ${pl.highlight ? "saved" : ""}">\$${fmtDollar(rcv).slice(1)}</td>
        <td class="num ${pl.highlight ? "" : "lost"}">${pl.highlight ? "$" + fmtDollar(fee).slice(1) : "−$" + fmtDollar(fee).slice(1)}</td>
      </tr>`;
    }).join("");

    const ebayFee = p * 0.156;
    const hgFee = p * 0.015;
    if (avgLossEl) avgLossEl.textContent = "$" + fmtInt(ebayFee * 12);
    if (avgSaveEl) avgSaveEl.textContent = "$" + fmtInt((ebayFee - hgFee) * 12);

    // Trigger bar animation via mutation observer
    const trigger = document.createElement("div");
    feeBody.appendChild(trigger);
    feeBody.removeChild(trigger);
  }, []);

  useEffect(() => {
    renderFeeTable(price);
  }, [price, renderFeeTable]);

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = +e.target.value;
    setPrice(v);
    setActiveChip(CHIP_VALUES.includes(v) ? v : -1);
  };

  const handleChip = (v: number) => {
    setPrice(v);
    setActiveChip(v);
  };

  /* ══════════════════════════════════════════════
     JSX
     ══════════════════════════════════════════════ */
  return (
    <div className="haggle-landing" ref={wrapRef}>

      {/* ── NAV ── */}
      <div className="nav-wrap" id="hg-navWrap">
        <nav className="nav">
          <div className="brand">
            <span className="brand-mark">H</span>
            <span>Haggle</span>
          </div>
          <div className="nav-links">
            <a href="#how">How it Works</a>
            <a href="#pricing">Pricing</a>
            <a href="#demo">Demo</a>
            <a href="#docs">Docs</a>
          </div>
          <div className="nav-spacer" />
          <Link href="/demo" className="btn btn-primary btn-sm">
            Try Demo →
          </Link>
        </nav>
      </div>

      <main>
        {/* ── HERO (scroll-driven) ── */}
        <section className="scroll-hero">
          <div className="sh-track" id="hg-shTrack">
            <div className="sh-stage">

              <div className="sh-copy">
                <span className="eyebrow"><span className="dot" /> AI Negotiation · USDC on Base L2</span>
                <h1 style={{ marginTop: 16 }}>
                  <span className="stack">AI negotiates.</span>
                  <span className="stack accent">You keep more.</span>
                </h1>
                <p className="sh-sub">
                  Haggle is the standard for AI-powered negotiation. Your agent bargains, the smart contract settles — <strong>1.5% total fee</strong>, non-custodial, final in seconds.
                </p>
                <div className="sh-ctas">
                  <Link href="/demo" className="btn btn-primary">Try AI Negotiation →</Link>
                  <Link href="/demo/developer" className="btn btn-ghost">Try Trade Tutorial</Link>
                </div>
                <div className="sh-caption">
                  <span className="idx" id="hg-shIdx">01</span>
                  <span className="txt" id="hg-shTxt">Scroll to watch platform fees peel off →</span>
                </div>
{/* sh-meta removed per design feedback */}
              </div>

              <div className="sh-receipt-wrap">
                <div className="receipt is-bad" id="hg-receipt">
                  <div className="head">
                    <span className="plat-pill" id="hg-platPill"><span className="pd" /><span id="hg-platName">Poshmark Seller Receipt</span></span>
                    <div className="sub-r" id="hg-platSub">Order #PM-88217 · payout 3–5 days</div>
                  </div>
                  <div className="row"><span className="k">Item</span><span className="v">iPhone 14 Pro 128GB</span></div>
                  <div className="row"><span className="k">Sale price</span><span className="v">$500.00</span></div>
                  <div className="sep" />
                  <div id="hg-feeRows" />
                  <div className="sep" />
                  <div className="total"><span>YOU RECEIVE</span><span className="val" id="hg-totalVal">$400.00</span></div>
                  <div className="foot" id="hg-receiptFoot">Payout in 3–5 business days</div>
                </div>

                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="torn" id={`hg-torn${i}`}><span className="d" /><span className="x" /></div>
                ))}

                <div className="neg-card" id="hg-negCard" aria-hidden="true">
                  <div className="neg-head">
                    <div className="neg-title">Live negotiation</div>
                    <div className="live"><span className="lp" /> in progress</div>
                  </div>
                  <div className="bubble b"><div className="who">Buyer AI</div>I&apos;ll offer $430 — battery at 89%.</div>
                  <div className="bubble s"><div className="who">Seller AI</div>Counter at $465. Screen is mint.</div>
                  <div className="bubble b"><div className="who">Buyer AI</div>Meet at $450?</div>
                  <div className="deal-row"><span className="mono">Settled @ $450</span><span className="ok">✓ Both sides agreed</span></div>
                </div>

                <div className="diff-cap" id="hg-diffCap">
                  <span className="a">Poshmark · $400.00</span>
                  <span className="arrow">→</span>
                  <span className="b">Haggle · $492.50</span>
                  <span className="plus">+$92.50</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── TRUST ── */}
        <section className="trust" style={{ paddingTop: 0 }}>
          <div className="trust-row reveal">
            <div className="trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" /></svg>
              Powered by x402 Protocol
            </div>
            <div className="trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
              Payments on Base L2
            </div>
            <div className="trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 6v12M9 9h5a2 2 0 010 4H9a2 2 0 000 4h6" /></svg>
              USDC Settlement
            </div>
            <div className="trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              Non-custodial
            </div>
            <div className="trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 21V8l8-5 8 5v13" /><path d="M9 21V12h6v9" /></svg>
              Delaware LLC
            </div>
            <div className="trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7L9 18l-5-5" /></svg>
              Linux Foundation
            </div>
          </div>
        </section>

        {/* ── FEE PROBLEM ── */}
        <section id="pricing">
          <div className="sec-head reveal">
            <span className="eyebrow"><span className="dot" style={{ background: "var(--red)" }} /> The fee problem</span>
            <h2 className="slash-head">
              <span className="sh-w">Platform fees</span>
              <span className="sh-w sh-accent">are eating</span>
              <span className="sh-w">your profits<span className="sh-end">.</span></span>
            </h2>
            <p>Drag the slider — watch every platform bite you. Except one.</p>
          </div>

          <div className="fee-wrap reveal delay-1">
            <div className="price-controls">
              <span className="price-label">Sale price</span>
              <div className="chips">
                {CHIP_VALUES.map((v) => (
                  <button
                    key={v}
                    className={`chip ${activeChip === v ? "active" : ""}`}
                    onClick={() => handleChip(v)}
                  >
                    ${v >= 1000 ? v.toLocaleString() : v}
                  </button>
                ))}
              </div>
              <input
                className="slider"
                type="range"
                min="50"
                max="5000"
                step="10"
                value={price}
                onChange={handleSlider}
              />
              <div className="price-display">
                <span className="cur">$</span>
                <span id="hg-priceVal">{fmtInt(price)}</span>
              </div>
            </div>

            <table className="fees">
              <colgroup>
                <col className="c-plat" />
                <col className="c-pct" />
                <col className="c-rcv" />
                <col className="c-lost" />
              </colgroup>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th className="num">Fee %</th>
                  <th className="num">You receive</th>
                  <th className="num">Lost to fees</th>
                </tr>
              </thead>
              <tbody id="hg-feeBody" />
            </table>

            <div className="stat-line">
              <div className="big">
                The average seller loses <span className="num" id="hg-avgLoss">$847</span> per year to platform fees.
              </div>
              <div className="sub">
                Based on 12 sales/year at $500 avg price · Haggle saves you{" "}
                <span className="mono" id="hg-avgSave" style={{ color: "#86efac", fontWeight: 700 }}>$759</span>.
              </div>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how">
          <div className="sec-head reveal">
            <span className="eyebrow"><span className="dot" /> How it works</span>
            <h2 className="triptych" aria-label="Three steps. One fair price. Instant settlement.">
              <span className="tp-col"><span className="tp-count">3</span><span className="tp-lbl">steps</span></span>
              <span className="tp-div" />
              <span className="tp-col"><span className="tp-count">1</span><span className="tp-lbl">fair price</span></span>
              <span className="tp-div" />
              <span className="tp-col"><span className="tp-count">∞</span><span className="tp-lbl">instant settlement</span></span>
            </h2>
          </div>

          <div className="steps">
            <div className="step reveal delay-1">
              <div className="num">STEP 01</div>
              <h3>List in 30 seconds</h3>
              <p>Take a photo. Set your price. Our AI suggests optimal pricing from live market data — so you don&apos;t undersell.</p>
              <div className="step-visual">
                <div className="phone-shot">
                  <div className="phone-img">[ product shot ]</div>
                  <div className="phone-form">
                    <div className="phone-line w70" />
                    <div className="phone-line w40" />
                    <div className="phone-price"><span>Suggested</span><span className="v">$520</span></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="step reveal delay-2">
              <div className="num">STEP 02</div>
              <h3>AI negotiates — fairly</h3>
              <p>Both buyer and seller get their own agent with equal data. No one-sided advantage. Deals land in seconds.</p>
              <div className="step-visual">
                <div className="chat">
                  <div className="mini b">Offer $430 — battery 89%</div>
                  <div className="mini s">Counter at $465 — screen mint</div>
                  <div className="mini b">Meet at $450?</div>
                  <div className="mini ok">✓ Deal @ $450</div>
                </div>
              </div>
            </div>

            <div className="step reveal delay-3">
              <div className="num">STEP 03</div>
              <h3>Instant, non-custodial</h3>
              <p>USDC routes directly from buyer to seller via smart contract. Haggle literally cannot hold your money.</p>
              <div className="step-visual">
                <div className="settle">
                  <div className="wallet"><span className="lab">Buyer</span><span className="am">$450</span></div>
                  <div className="arrow-r" />
                  <div className="router">Settlement<br />Router</div>
                  <div className="arrow-r" />
                  <div className="wallet"><span className="lab">Seller</span><span className="am">$443.25</span></div>
                </div>
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--line)", display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "var(--mute)" }}>
                  <span>1 block · 2s</span><span>tx 0x8f2a…b7c1</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── ON-CHAIN ── */}
        <section>
          <div className="sec-head reveal" style={{ marginBottom: 28 }}>
            <span className="eyebrow"><span className="dot" style={{ background: "var(--violet)" }} /> On-chain settlement</span>
            <h2 className="mega-stack" aria-label="Non-custodial. Transparent. Atomic.">
              <span className="ms-row ms-1"><span className="ms-word">Non-custodial.</span></span>
              <span className="ms-row ms-2"><span className="ms-word">Transparent.</span></span>
              <span className="ms-row ms-3"><span className="ms-word">Atomic.</span></span>
            </h2>
            <p>One signed transaction. One block. Funds split at the contract level — Haggle never touches the principal.</p>
          </div>
          <div className="chain reveal">
            <div className="chain-diagram">
              <div className="flow">
                <div className="node">
                  <div className="lab">Buyer wallet</div>
                  <div className="addr">0x9A1…fE4B</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--cyan-600)", marginTop: 4 }}>−$450.00</div>
                </div>
                <div className="node router">
                  <div className="lab">Settlement Router</div>
                  <div className="addr">HaggleRouter.sol</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--mute)", marginTop: 4 }}>EIP-712 · verified</div>
                </div>
                <div className="branch">
                  <div className="node split">
                    <div className="lab">Seller wallet · 98.5%</div>
                    <div className="addr">0x2C8…A091</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--emerald)", marginTop: 4 }}>+$443.25</div>
                  </div>
                  <div className="node split">
                    <div className="lab">Haggle fee · 1.5%</div>
                    <div className="addr">0xFee…Haggle</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--violet)", marginTop: 4 }}>+$6.75</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="chain-cards">
              <div className="chain-card"><span className="tag">SIGNATURE</span><h4>EIP-712 typed</h4><p>Human-readable structured signatures, not blind blobs.</p></div>
              <div className="chain-card"><span className="tag">ATOMIC</span><h4>One tx, one block</h4><p>Either everyone gets paid, or nothing moves.</p></div>
              <div className="chain-card"><span className="tag">GAS</span><h4>Sponsored by Haggle</h4><p>Sellers never touch gas. $0.00 on every receipt.</p></div>
              <div className="chain-card"><span className="tag">OPEN</span><h4>Open-source contracts</h4><p>Audited, verified, reproducible from source.</p></div>
            </div>
          </div>
        </section>

        {/* ── PAYMENT RAILS ── */}
        <section>
          <div className="sec-head reveal">
            <span className="eyebrow"><span className="dot" style={{ background: "var(--emerald)" }} /> Two ways to pay</span>
            <h2 style={{ marginTop: 12 }}>Crypto-native speed. Card-friendly access.</h2>
          </div>
          <div className="rails">
            <div className="rail rec reveal delay-1">
              <span className="badge">Recommended</span>
              <div className="rail-head">
                <div className="rail-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 6v12M9 9h5a2 2 0 010 4H9a2 2 0 000 4h6" /></svg>
                </div>
                <h3>USDC Direct</h3>
              </div>
              <p className="what">Already have crypto in your wallet? Pay with one signature. No middleman, no reroute.</p>
              <div className="rail-stats">
                <div className="s"><div className="k">Total fee</div><div className="v g">1.5%</div></div>
                <div className="s"><div className="k">Speed</div><div className="v">~2s</div></div>
                <div className="s"><div className="k">Custody</div><div className="v">None</div></div>
              </div>
            </div>
            <div className="rail card reveal delay-2">
              <div className="rail-head">
                <div className="rail-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></svg>
                </div>
                <h3>Card Payment</h3>
              </div>
              <p className="what">No wallet? No problem. Pay with any card — we convert to USDC under the hood via Stripe Crypto Onramp.</p>
              <div className="rail-stats">
                <div className="s"><div className="k">Total fee</div><div className="v">3.0%</div></div>
                <div className="s"><div className="k">Speed</div><div className="v">~30s</div></div>
                <div className="s"><div className="k">Powered by</div><div className="v">Stripe</div></div>
              </div>
            </div>
          </div>
        </section>

        {/* ── PROTECTION ── */}
        <section>
          <div className="sec-head reveal">
            <span className="eyebrow"><span className="dot" style={{ background: "var(--emerald)" }} /> Buyer protection</span>
            <h2 style={{ marginTop: 12 }}>Your money is protected at every step.</h2>
            <p>Funds are held by the smart contract — not Haggle. Released to the seller only after you confirm delivery.</p>
          </div>
          <div className="timeline reveal delay-1">
            <div className="t-rail" id="hg-tRail">
              <div className="t-fill" id="hg-tFill" />
              <div className="t-step" style={{ left: "0%" }}>
                <div className="t-node"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg></div>
                <div className="t-lab">Payment</div><div className="t-sub">t=0s</div>
              </div>
              <div className="t-step" style={{ left: "25%" }}>
                <div className="t-node"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg></div>
                <div className="t-lab">Escrow locked</div><div className="t-sub">smart contract</div>
              </div>
              <div className="t-step" style={{ left: "50%" }}>
                <div className="t-node"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 17l9 4 9-4M3 12l9 4 9-4" /></svg></div>
                <div className="t-lab">Delivery</div><div className="t-sub">APV verified</div>
              </div>
              <div className="t-step" style={{ left: "75%" }}>
                <div className="t-node"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg></div>
                <div className="t-lab">24h Review</div><div className="t-sub">buyer window</div>
              </div>
              <div className="t-step" style={{ left: "100%" }}>
                <div className="t-node"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 7L9 18l-5-5" /></svg></div>
                <div className="t-lab">Release</div><div className="t-sub">or dispute</div>
              </div>
            </div>
            <div className="protect-cards">
              <div className="p-card"><div className="t">01 · Escrow</div><div className="d">Funds locked in the Settlement Router contract — not in Haggle&apos;s bank account.</div></div>
              <div className="p-card"><div className="t">02 · APV</div><div className="d">Weight-buffer verification confirms the package sent matches what was sold.</div></div>
              <div className="p-card"><div className="t">03 · Review</div><div className="d">Buyer has 24h to approve. Silence is consent — funds release automatically.</div></div>
              <div className="p-card"><div className="t">04 · Dispute</div><div className="d">3-tier resolution: auto-arbiter → review panel → binding arbitration, with on-chain evidence.</div></div>
            </div>
          </div>
        </section>

        {/* ── DEV ── */}
        <section id="docs">
          <div className="dev reveal">
            <div>
              <span className="eyebrow"><span className="dot" style={{ background: "var(--violet)" }} /> For developers</span>
              <h2 style={{ marginTop: 12 }}>Built on open protocols.</h2>
              <ul>
                <li><span className="bul">✓</span> <strong style={{ color: "var(--ink)" }}>x402&nbsp;</strong>&nbsp;— payment protocol (Linux Foundation)</li>
                <li><span className="bul">✓</span> <strong style={{ color: "var(--ink)" }}>MCP&nbsp;</strong>&nbsp;— ChatGPT &amp; Claude can list items directly</li>
                <li><span className="bul">✓</span> <strong style={{ color: "var(--ink)" }}>REST API&nbsp;</strong>&nbsp;— drop-in negotiation for any marketplace</li>
                <li><span className="bul">✓</span> <strong style={{ color: "var(--ink)" }}>HNP&nbsp;</strong>&nbsp;— open Haggle Negotiation Protocol spec</li>
              </ul>
              <button className="btn btn-ghost">View API Docs →</button>
            </div>
            <div className="code">
              <div className="bar"><i /><i /><i /></div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                <span className="cm"># Start an AI-negotiated session in one call</span>{"\n"}
                <span className="kw">POST</span> <span className="st">/v1/negotiations/sessions</span>{"\n"}
                {"{"}{"\n"}
                {"  "}<span className="fn">&quot;listing_id&quot;</span>: <span className="st">&quot;lst_iPhone14Pro_8fa2&quot;</span>,{"\n"}
                {"  "}<span className="fn">&quot;buyer_strategy&quot;</span>: <span className="st">&quot;balanced&quot;</span>,{"\n"}
                {"  "}<span className="fn">&quot;max_price&quot;</span>: <span className="ev">475</span>,{"\n"}
                {"  "}<span className="fn">&quot;rail&quot;</span>: <span className="st">&quot;usdc&quot;</span>{"\n"}
                {"}"}{"\n\n"}
                <span className="cm">→ AI negotiates. Smart contract settles.</span>{"\n"}
                <span className="cm">→ Webhook fires when deal is done.</span>{"\n\n"}
                <span className="kw">event</span> <span className="ev">settlement.completed</span> {"{"}{"\n"}
                {"  "}final_price: <span className="ev">450.00</span>,{"\n"}
                {"  "}seller_received: <span className="ev">443.25</span>,{"\n"}
                {"  "}tx: <span className="st">&quot;0x8f2a…b7c1&quot;</span>{"\n"}
                {"}"}
              </pre>
            </div>
          </div>
        </section>

        {/* ── COMPANY ── */}
        <section>
          <div className="sec-head reveal">
            <span className="eyebrow"><span className="dot" /> Company</span>
            <h2 style={{ marginTop: 12 }}>Built in Delaware. Backed by protocol.</h2>
          </div>
          <div className="company">
            <div className="co-meta reveal delay-1">
              <div className="row"><span className="k">Legal entity</span><span className="v">Haggle LLC</span></div>
              <div className="row"><span className="k">Jurisdiction</span><span className="v">Delaware, USA</span></div>
              <div className="row"><span className="k">Domain</span><span className="v">tryhaggle.ai</span></div>
              <div className="row"><span className="k">Contact</span><span className="v">hello@tryhaggle.ai</span></div>
              <div className="row"><span className="k">Settlement chain</span><span className="v">Base L2 · ChainID 8453</span></div>
              <div className="row"><span className="k">Protocol</span><span className="v">x402 · HNP v0.3</span></div>
            </div>
            <div className="mission reveal delay-2">
              <div className="q">&ldquo;Everyone deserves to negotiate fairly — not just the rich, the aggressive, or the experienced.&rdquo;</div>
              <div className="by">Haggle mission · democratizing negotiation</div>
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section id="demo">
          <div className="final reveal">
            <h2>Stop losing money to platform fees.</h2>
            <div className="compare">
              <span className="c1">eBay · you get $410.15</span>
              <span className="arw">→</span>
              <span className="c2">Haggle · you get $492.50</span>
              <span className="plus">+$82.35</span>
            </div>
            <div className="ctas">
              <Link href="/demo" className="btn btn-primary">Try AI Negotiation — Free Demo</Link>
              <Link href="/demo/developer" className="btn btn-ghost">Try Trade Tutorial</Link>
              <button className="btn btn-ghost">Join Waitlist</button>
            </div>
            <div style={{ marginTop: 18, fontSize: 13, color: "rgba(255,255,255,.7)", position: "relative" }}>
              Early members get fee-free trades for life.
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ── */}
      <footer>
        <div style={{ padding: "0 28px", maxWidth: 1200, margin: "0 auto" }}>
          <div className="foot">
            <div>
              <div className="brand" style={{ marginBottom: 14 }}><span className="brand-mark">H</span><span>Haggle</span></div>
              <p style={{ color: "var(--mute)", maxWidth: 320, lineHeight: 1.55 }}>
                The protocol where AI negotiates so humans don&apos;t have to. A fair deal in seconds — on-chain, non-custodial, transparent.
              </p>
            </div>
            <div>
              <h5>Product</h5>
              <a href="#how">How it works</a>
              <a href="#pricing">Pricing</a>
              <Link href="/demo">Demo</Link>
              <a href="#docs">API Docs</a>
            </div>
            <div>
              <h5>Company</h5>
              <a href="#">About</a>
              <a href="#">Blog</a>
              <a href="mailto:hello@tryhaggle.ai">Contact</a>
              <a href="#">Press</a>
            </div>
            <div>
              <h5>Legal</h5>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <a href="#">Smart contracts</a>
              <a href="#">Security</a>
            </div>
          </div>
          <div className="foot-bot">
            <div>© 2026 Haggle LLC · Delaware · <span className="mono">hello@tryhaggle.ai</span></div>
            <div className="pill-row">
              <span className="pill">Non-custodial</span>
              <span className="pill">Transparent</span>
              <span className="pill">Buyer-protected</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
