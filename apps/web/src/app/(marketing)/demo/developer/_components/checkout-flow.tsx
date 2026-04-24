"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";

/* ===== props ===== */
interface CheckoutFlowProps {
  agreedPrice: number;
  itemTitle: string;
  rounds: number;
  onComplete: () => void;
}

/* ===== color tokens (light theme) ===== */
const C = {
  ink: "#14141a",
  dim: "#3d3d45",
  mute: "#6b6b75",
  faint: "#a29b8d",
  bg: "#f6f4ee",
  card: "#ffffff",
  card2: "#f7f4eb",
  line: "#e3ddcf",
  line2: "#cdc6b5",
  cyan: "#0891b2",
  cyanFg: "#0e7490",
  cyanBg: "rgba(8,145,178,0.08)",
  cyanBd: "rgba(8,145,178,0.25)",
  violet: "#7c3aed",
  violetFg: "#6d28d9",
  violetBg: "rgba(124,58,237,0.07)",
  violetBd: "rgba(124,58,237,0.25)",
  em: "#059669",
  emFg: "#047857",
  emBg: "rgba(5,150,105,0.08)",
  emBd: "rgba(5,150,105,0.25)",
  redFg: "#b91c1c",
  redBg: "rgba(220,38,38,0.07)",
  redBd: "rgba(220,38,38,0.25)",
  amberFg: "#b45309",
  amberBg: "rgba(217,119,6,0.08)",
  amberBd: "rgba(217,119,6,0.25)",
};

/* ===== keyframe styles (injected once) ===== */
const KEYFRAMES = `
@keyframes haggle-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(8,145,178,0.4); }
  70%  { box-shadow: 0 0 0 10px rgba(8,145,178,0); }
  100% { box-shadow: 0 0 0 0 rgba(8,145,178,0); }
}
@keyframes haggle-spin-slow { to { transform: rotate(360deg); } }
@keyframes haggle-spin-rev  { to { transform: rotate(-360deg); } }
@keyframes haggle-flow {
  0%   { transform: translateX(-10%); opacity: 0; }
  15%  { opacity: 1; }
  85%  { opacity: 1; }
  100% { transform: translateX(110%); opacity: 0; }
}
@keyframes haggle-fadeup {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes haggle-dash { to { stroke-dashoffset: -40; } }
@keyframes haggle-shake {
  0%, 100% { transform: rotate(0deg) scale(1.1); }
  25% { transform: rotate(-12deg) scale(1.15); }
  50% { transform: rotate(8deg) scale(1.1); }
  75% { transform: rotate(-6deg) scale(1.12); }
}
`;

/* ===== icons ===== */
type IconProps = {
  size?: number;
  color?: string;
  sw?: number;
  style?: React.CSSProperties;
};
const I =
  (d: React.ReactNode) =>
  ({ size = 16, color = "currentColor", sw = 1.5, style }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {d}
    </svg>
  );

const Ic = {
  check: I(<path d="M4 12l5 5L20 6" />),
  arrow: I(<path d="M5 12h14M13 6l6 6-6 6" />),
  chev: I(<path d="M6 9l6 6 6-6" />),
  wallet: I(
    <g>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 13h3" />
      <path d="M3 9h18" />
    </g>
  ),
  card: I(
    <g>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h3" />
    </g>
  ),
  shield: I(
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
  ),
  lock: I(
    <g>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 118 0v3" />
    </g>
  ),
  flame: I(
    <path d="M12 3s5 4 5 9a5 5 0 01-10 0c0-2 1-3 2-4-.5 2 .5 3 1.5 3 0-3 1.5-5 1.5-8z" />
  ),
  pkg: I(
    <g>
      <path d="M21 16V8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3.3 7L12 12l8.7-5" />
      <path d="M12 22V12" />
    </g>
  ),
  truck: I(
    <g>
      <path d="M3 7h11v10H3z" />
      <path d="M14 10h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </g>
  ),
  file: I(
    <g>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
    </g>
  ),
  sig: I(
    <g>
      <path d="M3 17s3-2 6-2 4 2 7 2 5-2 5-2" />
      <path d="M7 13c3-6 6-6 9 0" />
    </g>
  ),
  alert: I(
    <g>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v4M12 17v.01" />
    </g>
  ),
  play: I(<path d="M6 4l14 8-14 8V4z" />),
  pause: I(
    <g>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </g>
  ),
  restart: I(
    <g>
      <path d="M3 12a9 9 0 1015-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </g>
  ),
  info: I(
    <g>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </g>
  ),
  ext: I(
    <g>
      <path d="M14 4h6v6" />
      <path d="M20 4L10 14" />
      <path d="M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5" />
    </g>
  ),
  coin: I(
    <g>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10c0-1 1-2 3-2s3 1 3 2c0 2-6 2-6 4 0 1 1 2 3 2s3-1 3-2" />
      <path d="M12 6v2M12 16v2" />
    </g>
  ),
};

/* ===== primitives ===== */
const Card = ({
  children,
  accent,
  style,
  onClick,
}: {
  children?: React.ReactNode;
  accent?: "cyan" | "violet" | "em" | "red" | "amber";
  style?: React.CSSProperties;
  onClick?: () => void;
}) => {
  const bd =
    accent === "cyan"
      ? C.cyanBd
      : accent === "violet"
        ? C.violetBd
        : accent === "em"
          ? C.emBd
          : accent === "red"
            ? C.redBd
            : accent === "amber"
              ? C.amberBd
              : C.line;
  const bg =
    accent === "cyan"
      ? `linear-gradient(180deg, ${C.cyanBg}, #fff)`
      : accent === "violet"
        ? `linear-gradient(180deg, ${C.violetBg}, #fff)`
        : accent === "em"
          ? `linear-gradient(180deg, ${C.emBg}, #fff)`
          : C.card;
  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 16,
        border: `1px solid ${bd}`,
        background: bg,
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const Btn = ({
  children,
  onClick,
  v = "primary",
  size = "md",
  disabled,
  icon,
  iconRight,
  style,
  full,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  v?: "primary" | "secondary" | "ghost" | "danger" | "violet";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  style?: React.CSSProperties;
  full?: boolean;
}) => {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 600,
    letterSpacing: "-0.005em",
    border: "1px solid transparent",
    transition: "all 0.18s",
    opacity: disabled ? 0.45 : 1,
    width: full ? "100%" : "auto",
    padding:
      size === "sm"
        ? "8px 14px"
        : size === "lg"
          ? "14px 22px"
          : "11px 18px",
    fontSize: size === "sm" ? 12.5 : size === "lg" ? 15 : 13.5,
  };
  const vs: Record<string, React.CSSProperties> = {
    primary: {
      background: C.cyan,
      color: "#fff",
      boxShadow: "0 4px 14px -6px rgba(8,145,178,0.4)",
    },
    secondary: {
      background: "#fff",
      color: C.dim,
      borderColor: C.line2,
    },
    ghost: { background: "transparent", color: C.dim },
    danger: {
      background: C.redBg,
      color: C.redFg,
      borderColor: C.redBd,
    },
    violet: {
      background: C.violet,
      color: "#fff",
      boxShadow: "0 4px 14px -6px rgba(124,58,237,0.4)",
    },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{ ...base, ...vs[v], ...style }}
    >
      {icon}
      <span>{children}</span>
      {iconRight}
    </button>
  );
};

const Badge = ({
  children,
  tone = "cyan",
  subtle,
  icon,
}: {
  children: React.ReactNode;
  tone?: "cyan" | "violet" | "em" | "slate" | "amber" | "red";
  subtle?: boolean;
  icon?: React.ReactNode;
}) => {
  const t = {
    cyan: { f: C.cyanFg, b: C.cyanBg, d: C.cyanBd },
    violet: { f: C.violetFg, b: C.violetBg, d: C.violetBd },
    em: { f: C.emFg, b: C.emBg, d: C.emBd },
    slate: {
      f: C.dim,
      b: "rgba(20,20,26,0.04)",
      d: "rgba(20,20,26,0.12)",
    },
    amber: { f: C.amberFg, b: C.amberBg, d: C.amberBd },
    red: { f: C.redFg, b: C.redBg, d: C.redBd },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: subtle ? "2px 8px" : "3px 10px",
        borderRadius: 999,
        background: t.b,
        color: t.f,
        border: `1px solid ${t.d}`,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
      }}
    >
      {icon}
      {children}
    </span>
  );
};

const Money = ({
  value,
  size = 16,
  tone,
  bold,
  style,
}: {
  value: number | string;
  size?: number;
  tone?: "cyan" | "violet" | "em" | "dim";
  bold?: boolean;
  style?: React.CSSProperties;
}) => {
  const f =
    typeof value === "number"
      ? value.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : value;
  const col =
    tone === "cyan"
      ? C.cyanFg
      : tone === "violet"
        ? C.violetFg
        : tone === "em"
          ? C.emFg
          : tone === "dim"
            ? C.mute
            : C.ink;
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: bold ? 600 : 500,
        color: col,
        letterSpacing: "-0.01em",
        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      <span style={{ opacity: 0.55, marginRight: 3, fontWeight: 500 }}>$</span>
      {f}
    </span>
  );
};

const Row = ({
  children,
  style,
  justify = "flex-start",
  align = "center",
  gap = 8,
  wrap,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  justify?: string;
  align?: string;
  gap?: number;
  wrap?: boolean;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: align,
      justifyContent: justify,
      gap,
      flexWrap: wrap ? "wrap" : "nowrap",
      ...style,
    }}
  >
    {children}
  </div>
);

const KV = ({
  k,
  v,
  mono,
  dim,
}: {
  k: string;
  v: string;
  mono?: boolean;
  dim?: boolean;
}) => (
  <Row
    justify="space-between"
    style={{ padding: "6px 0", borderBottom: `1px dashed ${C.line}` }}
  >
    <span style={{ color: C.mute, fontSize: 12 }}>{k}</span>
    <span
      style={{
        color: dim ? C.dim : C.ink,
        fontSize: 13,
        fontFamily: mono
          ? "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)"
          : "inherit",
      }}
    >
      {v}
    </span>
  </Row>
);

const SL = ({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) => (
  <Row justify="space-between" style={{ marginBottom: 12 }}>
    <span
      style={{
        fontSize: 10,
        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
        color: C.mute,
        textTransform: "uppercase",
        letterSpacing: "0.14em",
      }}
    >
      {children}
    </span>
    {right}
  </Row>
);

const Api = ({ method = "POST", ep }: { method?: string; ep: string }) => (
  <div
    style={{
      textAlign: "center",
      fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
      fontSize: 10.5,
      color: C.faint,
      marginTop: 16,
      paddingTop: 14,
      borderTop: `1px dashed ${C.line}`,
      letterSpacing: "0.02em",
    }}
  >
    <span style={{ color: C.mute, fontWeight: 600 }}>{method}</span> {ep}
  </div>
);

const PS = ({
  label = "PRODUCT SHOT",
  size = 64,
}: {
  label?: string;
  size?: number;
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 12,
      background:
        "repeating-linear-gradient(135deg, rgba(20,20,26,0.05) 0 6px, rgba(20,20,26,0.02) 6px 12px)",
      border: `1px solid ${C.line}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
      fontSize: 8,
      color: C.faint,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      textAlign: "center",
      padding: 6,
    }}
  >
    {label}
  </div>
);

/* ===== timeline ===== */
const Timeline = ({
  steps,
  cur,
  done,
  onJump,
}: {
  steps: { k: string; lbl: string }[];
  cur: number;
  done: number[];
  onJump?: (i: number) => void;
}) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(${steps.length}, 1fr)`,
      position: "relative",
      padding: "12px 4px 4px",
    }}
  >
    {steps.map((s, i) => {
      const dn = done.includes(i);
      const on = i === cur;
      return (
        <div
          key={s.k}
          onClick={() => (dn || on) && onJump && onJump(i)}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            cursor: dn || on ? "pointer" : "default",
          }}
        >
          {i < steps.length - 1 && (
            <div
              style={{
                position: "absolute",
                top: 14,
                left: "50%",
                right: "-50%",
                height: 2,
                background: dn ? "rgba(5,150,105,0.4)" : C.line,
                zIndex: 0,
              }}
            />
          )}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: dn ? C.em : on ? C.cyan : C.card,
              border: `2px solid ${dn ? C.em : on ? C.cyan : C.line2}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: dn || on ? "#fff" : C.faint,
              zIndex: 1,
              position: "relative",
              ...(on
                ? {
                    animation:
                      "haggle-pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
                  }
                : {}),
            }}
          >
            {dn ? (
              <Ic.check size={14} sw={3} />
            ) : (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                {i + 1}
              </span>
            )}
          </div>
          <div style={{ marginTop: 10, textAlign: "center" }}>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: on ? C.ink : dn ? C.dim : C.mute,
              }}
            >
              {s.lbl}
            </div>
            <div
              style={{
                fontSize: 9.5,
                color: C.faint,
                marginTop: 2,
                letterSpacing: "0.04em",
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              STEP {String(i + 1).padStart(2, "0")}
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

/* ===== step header ===== */
const SH = ({
  eb,
  title,
  sub,
}: {
  eb: string;
  title: string;
  sub?: string;
}) => (
  <div style={{ marginBottom: 22 }}>
    <div
      style={{
        fontSize: 10.5,
        color: C.cyanFg,
        letterSpacing: "0.16em",
        marginBottom: 8,
        fontFamily:
          "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
      }}
    >
      {eb}
    </div>
    <div
      style={{
        fontSize: 26,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        marginBottom: 6,
        color: C.ink,
      }}
    >
      {title}
    </div>
    {sub && (
      <div
        style={{
          fontSize: 13.5,
          color: C.mute,
          lineHeight: 1.55,
          maxWidth: 640,
        }}
      >
        {sub}
      </div>
    )}
  </div>
);

/* ===== step 1: rail ===== */
const RailOption = ({
  selected,
  recommended,
  onClick,
  title,
  sub,
  fee,
  feeDetail,
  icon,
  tone,
}: {
  selected: boolean;
  recommended?: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  fee: string;
  feeDetail: string;
  icon: React.ReactNode;
  tone: "cyan" | "violet";
}) => {
  const [h, setH] = useState(false);
  const col =
    tone === "cyan"
      ? {
          fg: C.cyanFg,
          bd: C.cyanBd,
          accentBd: "rgba(8,145,178,0.55)",
          bg: `linear-gradient(180deg, ${C.cyanBg}, #fff)`,
        }
      : {
          fg: C.violetFg,
          bd: C.violetBd,
          accentBd: "rgba(124,58,237,0.55)",
          bg: `linear-gradient(180deg, ${C.violetBg}, #fff)`,
        };
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        position: "relative",
        cursor: "pointer",
        borderRadius: 16,
        padding: 22,
        border: `1px solid ${selected ? col.accentBd : h ? C.line2 : C.line}`,
        background: selected ? col.bg : C.card,
        transition: "all 0.2s",
        boxShadow: selected
          ? `0 6px 24px -10px ${tone === "cyan" ? "rgba(8,145,178,0.3)" : "rgba(124,58,237,0.3)"}`
          : "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 18,
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: `2px solid ${selected ? col.fg : C.line2}`,
          background: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected && (
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: col.fg,
            }}
          />
        )}
      </div>
      <Row gap={12} style={{ marginBottom: 14 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: tone === "cyan" ? C.cyanBg : C.violetBg,
            border: `1px solid ${col.bd}`,
            color: col.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </div>
        {recommended && <Badge tone="cyan">Recommended</Badge>}
      </Row>
      <div
        style={{
          fontSize: 17,
          fontWeight: 600,
          letterSpacing: "-0.015em",
          marginBottom: 4,
          color: C.ink,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: C.mute,
          lineHeight: 1.55,
          marginBottom: 16,
        }}
      >
        {sub}
      </div>
      <div
        style={{
          padding: "12px 14px",
          borderRadius: 10,
          background: C.card2,
          border: `1px solid ${C.line}`,
        }}
      >
        <Row justify="space-between">
          <span
            style={{
              fontSize: 11,
              color: C.mute,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Total fee
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: col.fg,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fee}
          </span>
        </Row>
        <div
          style={{
            fontSize: 11,
            color: C.faint,
            marginTop: 4,
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          {feeDetail}
        </div>
      </div>
    </div>
  );
};

const FeeTable = ({ amt, rail }: { amt: number; rail: string }) => {
  const hf = amt * 0.015;
  const sf = amt * 0.015;
  const sel = amt - hf;
  const cardT = amt + sf;
  const rows = [
    ["Buyer pays", `$${amt.toFixed(2)}`, `$${cardT.toFixed(2)}`],
    ["Haggle fee (1.5%)", `$${hf.toFixed(2)}`, `$${hf.toFixed(2)}`],
    ["Stripe fee (1.5%)", "—", `$${sf.toFixed(2)}`],
    ["Seller receives", `$${sel.toFixed(2)}`, `$${sel.toFixed(2)}`],
  ];
  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${C.line}`,
        overflow: "hidden",
        background: C.card2,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr",
          padding: "10px 16px",
          background: "rgba(20,20,26,0.02)",
          borderBottom: `1px solid ${C.line}`,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: C.mute,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          Breakdown
        </span>
        <span
          style={{
            fontSize: 10,
            color: rail === "x402" ? C.cyanFg : C.mute,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textAlign: "right",
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          USDC Direct
        </span>
        <span
          style={{
            fontSize: 10,
            color: rail === "stripe" ? C.violetFg : C.mute,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            textAlign: "right",
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          Card
        </span>
      </div>
      {rows.map(([k, v1, v2], i) => (
        <div
          key={k}
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr",
            padding: "10px 16px",
            borderTop: i === 0 ? "none" : `1px solid ${C.line}`,
            background: i === rows.length - 1 ? C.emBg : "transparent",
          }}
        >
          <span
            style={{
              fontSize: 12.5,
              color: i === rows.length - 1 ? C.ink : C.dim,
              fontWeight: i === rows.length - 1 ? 600 : 400,
            }}
          >
            {k}
          </span>
          <span
            style={{
              fontSize: 12.5,
              textAlign: "right",
              color: rail === "x402" ? C.ink : C.mute,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {v1}
          </span>
          <span
            style={{
              fontSize: 12.5,
              textAlign: "right",
              color: rail === "stripe" ? C.ink : C.mute,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {v2}
          </span>
        </div>
      ))}
    </div>
  );
};

const Step1 = ({
  s,
  setRail,
  next,
}: {
  s: SessionState;
  setRail: (r: string) => void;
  next: () => void;
}) => (
  <div style={{ animation: "haggle-fadeup 0.35s ease both" }}>
    <SH
      eb="STEP 01"
      title="Choose payment rail"
      sub="Both rails settle in USDC on Base L2 — the difference is who pays the Stripe fee."
    />
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
        marginBottom: 20,
      }}
    >
      <RailOption
        selected={s.rail === "x402"}
        recommended
        onClick={() => setRail("x402")}
        tone="cyan"
        icon={<Ic.coin size={22} />}
        title="USDC Direct · x402"
        sub="Buyer pays directly from wallet. Gas sponsored by Haggle relayer. Settles atomically on-chain."
        fee="1.5%"
        feeDetail="Haggle 1.5% · gas $0"
      />
      <RailOption
        selected={s.rail === "stripe"}
        onClick={() => setRail("stripe")}
        tone="violet"
        icon={<Ic.card size={22} />}
        title="Card · Stripe Onramp"
        sub="Pay with credit/debit card. Stripe handles KYC and converts USD → USDC → Base L2."
        fee="3.0%"
        feeDetail="Haggle 1.5% + Stripe 1.5%"
      />
    </div>
    <FeeTable amt={s.amount} rail={s.rail} />
    <Row justify="flex-end" style={{ marginTop: 22 }}>
      <Btn onClick={next} iconRight={<Ic.arrow size={16} />}>
        Continue with {s.rail === "x402" ? "USDC Direct" : "Card"}
      </Btn>
    </Row>
  </div>
);

/* ===== step 2: prepare ===== */
const Step2 = ({ s, next }: { s: SessionState; next: () => void }) => (
  <div style={{ animation: "haggle-fadeup 0.35s ease both" }}>
    <SH
      eb="STEP 02"
      title="Prepare payment intent"
      sub="Creating a PaymentIntent from the accepted negotiation. The intent locks in the order, amount, and rail — nothing moves yet."
    />
    <Card style={{ marginBottom: 16 }}>
      <SL>Intent draft</SL>
      <KV k="Order ID" v="ord_8f2ab7c1e4" mono />
      <KV k="Item" v={s.item} />
      <KV k="Negotiated price" v={`$${s.amount.toFixed(2)} USD`} mono />
      <KV
        k="Payment rail"
        v={
          s.rail === "x402"
            ? "x402 · USDC Direct"
            : "stripe · Card Onramp"
        }
        mono
      />
      <KV k="Settlement asset" v="USDC on Base L2" mono />
      <KV k="Status" v="(none) → CREATED" mono dim />
    </Card>
    {s.rail === "stripe" && (
      <Card accent="violet" style={{ marginBottom: 16 }}>
        <Row gap={10} align="flex-start">
          <Ic.info
            size={16}
            color={C.violetFg}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Stripe Onramp session will be provisioned
            </div>
            <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.55 }}>
              Haggle will create a hosted Stripe Crypto Onramp session at the
              authorize step. Stripe handles KYC, card authorization, and
              converts fiat into USDC delivered to Base L2.
            </div>
          </div>
        </Row>
      </Card>
    )}
    <Row justify="flex-end">
      <Btn onClick={next} iconRight={<Ic.arrow size={16} />}>
        Prepare intent
      </Btn>
    </Row>
    <Api ep="/payments/prepare" />
  </div>
);

/* ===== step 3: quote ===== */
const QC = ({
  lbl,
  amt,
  addr,
  addrLbl,
  tone,
  icon,
}: {
  lbl: string;
  amt: number;
  addr: string;
  addrLbl: string;
  tone?: "cyan" | "violet";
  icon: React.ReactNode;
}) => (
  <Card accent={tone} style={{ padding: 16 }}>
    <Row justify="space-between" style={{ marginBottom: 10 }}>
      <span
        style={{
          fontSize: 10,
          color: C.mute,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontFamily:
            "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
        }}
      >
        {lbl}
      </span>
      <div
        style={{
          color:
            tone === "cyan"
              ? C.cyanFg
              : tone === "violet"
                ? C.violetFg
                : C.mute,
        }}
      >
        {icon}
      </div>
    </Row>
    <Money value={amt} size={22} tone={tone} bold />
    <Row gap={6} style={{ marginTop: 10, fontSize: 11 }}>
      <span
        style={{
          color: C.mute,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontSize: 9.5,
          fontFamily:
            "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
        }}
      >
        {addrLbl}
      </span>
      <span
        style={{
          color: C.dim,
          fontFamily:
            "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
        }}
      >
        {addr}
      </span>
    </Row>
  </Card>
);

const Step3 = ({ s, next }: { s: SessionState; next: () => void }) => {
  const hf = s.amount * 0.015;
  const sf = s.rail === "stripe" ? s.amount * 0.015 : 0;
  const sel = s.amount - hf;
  const tot = s.rail === "stripe" ? s.amount + sf : s.amount;
  const sp = (sel / tot) * 100;
  const hp = (hf / tot) * 100;
  const stp = (sf / tot) * 100;
  return (
    <div style={{ animation: "haggle-fadeup 0.35s ease both" }}>
      <SH
        eb="STEP 03"
        title="Quote & fee split"
        sub="Resolving destination wallets and computing the on-chain split. The seller always receives the same amount regardless of rail."
      />
      <Card style={{ marginBottom: 16 }}>
        <SL
          right={
            <span
              style={{
                fontSize: 10,
                color: C.faint,
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              share of buyer payment
            </span>
          }
        >
          Settlement split
        </SL>
        <div
          style={{
            display: "flex",
            height: 44,
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid ${C.line}`,
          }}
        >
          <div
            style={{
              width: `${sp}%`,
              background: `linear-gradient(180deg, ${C.ink}, ${C.dim})`,
              display: "flex",
              alignItems: "center",
              paddingLeft: 12,
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {sp.toFixed(1)}%
            </span>
          </div>
          <div
            style={{
              width: `${hp}%`,
              background: `linear-gradient(180deg, ${C.cyan}, rgba(8,145,178,0.75))`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              minWidth: 50,
            }}
          >
            <span
              style={{
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {hp.toFixed(1)}%
            </span>
          </div>
          {stp > 0 && (
            <div
              style={{
                width: `${stp}%`,
                background: `linear-gradient(180deg, ${C.violet}, rgba(124,58,237,0.75))`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
                minWidth: 50,
              }}
            >
              <span
                style={{
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {stp.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
        <Row gap={16} style={{ marginTop: 12 }} wrap>
          <Row gap={6}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: C.ink,
              }}
            />
            <span style={{ fontSize: 12, color: C.dim }}>Seller</span>
          </Row>
          <Row gap={6}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: C.cyan,
              }}
            />
            <span style={{ fontSize: 12, color: C.dim }}>Haggle fee</span>
          </Row>
          {stp > 0 && (
            <Row gap={6}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: C.violet,
                }}
              />
              <span style={{ fontSize: 12, color: C.dim }}>Stripe fee</span>
            </Row>
          )}
        </Row>
      </Card>
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            s.rail === "stripe" ? "1fr 1fr 1fr" : "1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <QC
          lbl="Seller receives"
          amt={sel}
          addr="0x7a3F…e9C2"
          addrLbl="seller wallet"
          icon={<Ic.wallet size={14} />}
        />
        <QC
          lbl="Haggle fee"
          amt={hf}
          tone="cyan"
          addr="0xHagg…F33E"
          addrLbl="fee wallet"
          icon={<Ic.flame size={14} />}
        />
        {s.rail === "stripe" && (
          <QC
            lbl="Stripe fee"
            amt={sf}
            tone="violet"
            addr="stripe.com"
            addrLbl="retained"
            icon={<Ic.card size={14} />}
          />
        )}
      </div>
      <Row justify="flex-end">
        <Btn onClick={next} iconRight={<Ic.arrow size={16} />}>
          Authorize payment
        </Btn>
      </Row>
      <Api ep="/payments/pi_8f2ab7c1/quote" />
    </div>
  );
};

/* ===== step 4: authorize (x402) ===== */
const Step4x = ({ s, next }: { s: SessionState; next: () => void }) => {
  const [open, setOpen] = useState(false);
  const hf = s.amount * 0.015;
  const sel = s.amount - hf;
  return (
    <div style={{ animation: "haggle-fadeup 0.35s ease both" }}>
      <SH
        eb="STEP 04"
        title="Authorize · EIP-712 signature"
        sub="Backend signs settlement params via EIP-712. Buyer calls HaggleSettlementRouter on Base L2 — the contract atomically splits USDC."
      />
      <Card accent="violet" style={{ marginBottom: 14 }}>
        <Row
          justify="space-between"
          style={{ marginBottom: 14 }}
          wrap
          gap={8}
        >
          <Row gap={10}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: C.violetBg,
                border: `1px solid ${C.violetBd}`,
                color: C.violetFg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ic.shield size={18} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                HaggleSettlementRouter
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: C.mute,
                  marginTop: 2,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                0x4E3A…B7c1 · Base L2
              </div>
            </div>
          </Row>
          <Badge tone="violet" icon={<Ic.lock size={10} />}>
            Non-custodial
          </Badge>
        </Row>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
          }}
        >
          {(
            [
              ["Protocol", "EIP-712"],
              ["Caller", "buyer (msg.sender)"],
              ["Asset", "USDC"],
              ["Gas sponsor", "Haggle relayer"],
            ] as const
          ).map(([k, v]) => (
            <div
              key={k}
              style={{
                padding: 10,
                borderRadius: 8,
                background: "rgba(124,58,237,0.03)",
                border: `1px solid ${C.violetBd}`,
              }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  color: C.mute,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                {k}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: C.violetFg,
                  marginTop: 4,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setOpen(!open)}
          style={{
            marginTop: 14,
            background: C.card2,
            border: `1px solid ${C.line}`,
            borderRadius: 8,
            width: "100%",
            padding: "10px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            cursor: "pointer",
            color: C.dim,
            fontFamily: "inherit",
          }}
        >
          <Row gap={10}>
            <Ic.file size={14} color={C.mute} />
            <span
              style={{
                fontSize: 12,
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              Settlement(...)
            </span>
          </Row>
          <Ic.chev
            size={14}
            style={{
              transform: open ? "rotate(180deg)" : "none",
              transition: "0.2s",
            }}
          />
        </button>
        {open && (
          <pre
            style={{
              margin: "8px 0 0",
              padding: 16,
              background: C.card2,
              border: `1px solid ${C.line}`,
              borderRadius: 8,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              fontSize: 12,
              color: C.dim,
              lineHeight: 1.7,
              overflowX: "auto",
            }}
          >{`Settlement(
  orderId:      "ord_8f2ab7c1e4",
  buyer:        0xBu7e…a12C,
  seller:       0x7a3F…e9C2,
  feeWallet:    0xHagg…F33E,
  asset:        USDC,
  grossAmount:  ${(s.amount * 1e6).toFixed(0)}  // $${s.amount.toFixed(2)}
  sellerAmount: ${(sel * 1e6).toFixed(0)}  // $${sel.toFixed(2)}
  feeAmount:    ${(hf * 1e6).toFixed(0)}    // $${hf.toFixed(2)}
  deadline:     1744812000,
  signerNonce:  142
)`}</pre>
        )}
      </Card>
      <Card style={{ marginBottom: 14 }}>
        <SL>Security guarantees</SL>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          {(
            [
              [
                "Duplicate prevention",
                "settledOrders — each orderId settles once",
              ],
              ["Fee cap", "MAX_FEE_BPS = 1000 (10%) ceiling"],
              ["Signer rotation", "48h delay before new signer active"],
              ["Guardian pause", "Emergency halt, separate from owner"],
              ["EIP-1271", "Smart-contract wallets can sign"],
              ["Dust prevention", "MIN_GROSS_AMOUNT = 0.01 USDC"],
            ] as const
          ).map(([k, v]) => (
            <Row key={k} gap={10} align="flex-start">
              <Ic.check
                size={14}
                color={C.emFg}
                sw={2.5}
                style={{ marginTop: 3, flexShrink: 0 }}
              />
              <div>
                <div
                  style={{ fontSize: 12.5, fontWeight: 600, color: C.dim }}
                >
                  {k}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: C.mute,
                    marginTop: 2,
                    lineHeight: 1.5,
                  }}
                >
                  {v}
                </div>
              </div>
            </Row>
          ))}
        </div>
      </Card>
      <Row justify="flex-end">
        <Btn onClick={next} icon={<Ic.sig size={16} />}>
          Sign & execute settlement
        </Btn>
      </Row>
      <Api ep="/payments/pi_8f2ab7c1/authorize" />
    </div>
  );
};

/* ===== step 4: authorize (stripe) ===== */
const Step4s = ({ s, next }: { s: SessionState; next: () => void }) => {
  const [cn, setCn] = useState("4242 4242 4242 4242");
  return (
    <div style={{ animation: "haggle-fadeup 0.35s ease both" }}>
      <SH
        eb="STEP 04"
        title="Authorize · Stripe Crypto Onramp"
        sub="Stripe handles card authorization and KYC, converts USD to USDC, and delivers to Base L2."
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1.1fr) minmax(0,0.9fr)",
          gap: 14,
        }}
      >
        <Card accent="violet">
          <Row justify="space-between" style={{ marginBottom: 14 }}>
            <Row gap={10}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "#635BFF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                S
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Stripe hosted form
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: C.mute,
                    marginTop: 1,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  cs_onramp_9Ab2F…
                </div>
              </div>
            </Row>
            <Ic.lock size={14} color={C.mute} />
          </Row>
          {(
            [
              ["Email", "buyer@example.com", false],
              ["Card number", cn, true],
              ["Expiry", "04 / 29", false],
              ["CVC", "•••", false],
              ["ZIP", "94103", false],
            ] as [string, string, boolean][]
          ).map(([l, v, ed]) => (
            <div
              key={l}
              style={{
                border: `1px solid ${C.line2}`,
                borderRadius: 8,
                background: C.card2,
                padding: "8px 12px",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: C.mute,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                {l}
              </div>
              {ed ? (
                <input
                  value={v}
                  onChange={(e) => setCn(e.target.value)}
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: C.ink,
                    fontSize: 13,
                    width: "100%",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                />
              ) : (
                <span
                  style={{
                    fontSize: 13,
                    color: C.dim,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  {v}
                </span>
              )}
            </div>
          ))}
          <div
            style={{
              marginTop: 4,
              padding: 12,
              borderRadius: 8,
              background: C.violetBg,
              border: `1px dashed ${C.violetBd}`,
              fontSize: 12,
              color: C.dim,
              lineHeight: 1.5,
            }}
          >
            <Row gap={8} align="flex-start">
              <Ic.info
                size={14}
                color={C.violetFg}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div>
                Stripe converts{" "}
                <span
                  style={{
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ${(s.amount + s.amount * 0.015).toFixed(2)}
                </span>{" "}
                → USDC{" "}
                <span
                  style={{
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ${s.amount.toFixed(2)}
                </span>
                , delivered to Base L2. Stripe keeps{" "}
                <span
                  style={{
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ${(s.amount * 0.015).toFixed(2)}
                </span>
                .
              </div>
            </Row>
          </div>
        </Card>
        <Card>
          <SL>Onramp session</SL>
          <KV k="Mode" v="Stripe Crypto Onramp" />
          <KV k="Source" v="USD (card)" mono />
          <KV k="Destination" v="USDC on Base L2" mono />
          <KV
            k="Buyer charge"
            v={`$${(s.amount + s.amount * 0.015).toFixed(2)}`}
            mono
          />
          <KV k="Settles via" v="Webhook fulfillment" dim />
          <div
            style={{
              marginTop: 16,
              fontSize: 11.5,
              color: C.mute,
              lineHeight: 1.55,
            }}
          >
            On successful card authorization, Stripe fires a webhook to
            Haggle, which then proceeds with on-chain settlement.
          </div>
        </Card>
      </div>
      <Row justify="flex-end" style={{ marginTop: 18 }}>
        <Btn
          onClick={next}
          v="violet"
          icon={<Ic.card size={16} />}
        >
          Pay ${(s.amount + s.amount * 0.015).toFixed(2)} with card
        </Btn>
      </Row>
      <Api ep="/payments/pi_8f2ab7c1/onramp/session" />
    </div>
  );
};

/* ===== step 5: settle ===== */
const FC = ({
  from,
  to,
  amt,
  tone,
  note,
}: {
  from: string;
  to: string;
  amt: number;
  tone: "em" | "cyan" | "violet";
  note?: string;
}) => {
  const col = tone === "em" ? C.emFg : tone === "cyan" ? C.cyanFg : C.violetFg;
  return (
    <Card accent={tone} style={{ padding: 14 }}>
      <div style={{ fontSize: 11, color: C.mute }}>
        <span
          style={{
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          {from}
        </span>{" "}
        →{" "}
        <span
          style={{
            color: col,
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          {to}
        </span>
      </div>
      <Money value={amt} size={18} tone={tone} bold style={{ marginTop: 6 }} />
      <div
        style={{
          marginTop: 10,
          height: 3,
          borderRadius: 2,
          background: "rgba(20,20,26,0.08)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "35%",
            background: `linear-gradient(90deg, transparent, ${col}, transparent)`,
            animation: "haggle-flow 1.4s linear infinite",
          }}
        />
      </div>
      {note && (
        <div
          style={{
            fontSize: 10,
            color: C.faint,
            marginTop: 6,
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          {note}
        </div>
      )}
    </Card>
  );
};

const RS = ({
  lbl,
  amt,
  tone,
}: {
  lbl: string;
  amt: number;
  tone?: "em" | "cyan" | "violet";
}) => (
  <div
    style={{
      padding: 12,
      borderRadius: 10,
      background: C.card2,
      border: `1px solid ${C.line}`,
    }}
  >
    <div
      style={{
        fontSize: 9.5,
        color: C.mute,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        marginBottom: 6,
        fontFamily:
          "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
      }}
    >
      {lbl}
    </div>
    <Money value={amt} size={17} tone={tone} bold />
  </div>
);

const Step5 = ({
  s,
  settling,
  cont,
}: {
  s: SessionState;
  settling: boolean;
  cont: () => void;
}) => {
  const hf = s.amount * 0.015;
  const sf = s.rail === "stripe" ? s.amount * 0.015 : 0;
  const sel = s.amount - hf;
  if (settling)
    return (
      <div style={{ animation: "haggle-fadeup 0.35s ease both" }}>
        <SH
          eb="STEP 05 · EXECUTING"
          title="Settling on-chain…"
          sub={
            s.rail === "x402"
              ? "HaggleSettlementRouter is atomically distributing USDC on Base L2."
              : "Awaiting Stripe fulfillment, then executing on-chain split."
          }
        />
        <Card
          style={{
            marginBottom: 14,
            padding: 36,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: 84,
              height: 84,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: "2px solid transparent",
                borderTopColor: C.cyan,
                borderRightColor: "rgba(8,145,178,0.25)",
                borderRadius: "50%",
                animation: "haggle-spin-slow 1.2s linear infinite",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 14,
                border: "2px solid transparent",
                borderTopColor: C.violet,
                borderLeftColor: "rgba(124,58,237,0.25)",
                borderRadius: "50%",
                animation: "haggle-spin-rev 1.6s linear infinite",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: C.cyanFg,
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                fontSize: 10,
                letterSpacing: "0.1em",
              }}
            >
              TX
            </div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            Broadcasting transaction
          </div>
          <div
            style={{
              fontSize: 12,
              color: C.mute,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            block confirm · signer verify · atomic transfer
          </div>
        </Card>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              s.rail === "stripe" ? "1fr 1fr 1fr" : "1fr 1fr",
            gap: 10,
          }}
        >
          <FC from="Buyer" to="Seller" amt={sel} tone="em" />
          <FC from="Buyer" to="Haggle" amt={hf} tone="cyan" />
          {s.rail === "stripe" && (
            <FC from="Buyer" to="Stripe" amt={sf} tone="violet" note="retained" />
          )}
        </div>
      </div>
    );
  return (
    <div style={{ animation: "haggle-fadeup 0.35s ease both" }}>
      <SH
        eb="STEP 05 · COMPLETE"
        title="Settled on-chain ✓"
        sub="USDC distributed atomically. Shipment record created. Order → FULFILLMENT_PENDING."
      />
      <Card accent="em" style={{ marginBottom: 14 }}>
        <Row gap={12} style={{ marginBottom: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: C.emBg,
              border: `2px solid ${C.emBd}`,
              color: C.emFg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ic.check size={22} sw={2.5} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              Settlement receipt
            </div>
            <div
              style={{
                fontSize: 11,
                color: C.mute,
                marginTop: 2,
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              tx 0x8f2a…b7c1 · block 12,483,917 · Base L2
            </div>
          </div>
        </Row>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          <RS lbl="Total paid" amt={s.amount + sf} />
          <RS lbl="Seller receives" amt={sel} tone="em" />
          <RS lbl="Haggle fee" amt={hf} tone="cyan" />
          {sf > 0 && <RS lbl="Stripe fee" amt={sf} tone="violet" />}
        </div>
      </Card>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Card accent="cyan">
          <Row gap={10} style={{ marginBottom: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: C.cyanBg,
                border: `1px solid ${C.cyanBd}`,
                color: C.cyanFg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ic.flame size={16} />
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: C.mute,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                Haggle fee wallet
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: C.dim,
                  marginTop: 2,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                0xHagg…F33E
              </div>
            </div>
          </Row>
          <Money value={hf} size={32} tone="cyan" bold />
          <div style={{ fontSize: 11.5, color: C.mute, marginTop: 6 }}>
            + credited from this trade (1.5%)
          </div>
        </Card>
        <Card>
          <SL>Auto-created resources</SL>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <Row justify="space-between">
              <Row gap={10}>
                <Ic.shield size={14} color={C.mute} />
                <div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: C.dim,
                    }}
                  >
                    Settlement Release
                  </div>
                  <div style={{ fontSize: 11, color: C.mute }}>
                    Phase 1 + 2
                  </div>
                </div>
              </Row>
              <Badge tone="slate" subtle>
                Pending
              </Badge>
            </Row>
            <Row justify="space-between">
              <Row gap={10}>
                <Ic.pkg size={14} color={C.mute} />
                <div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: C.dim,
                    }}
                  >
                    Shipment Record
                  </div>
                  <div style={{ fontSize: 11, color: C.mute }}>
                    LABEL_PENDING
                  </div>
                </div>
              </Row>
              <Badge tone="slate" subtle>
                Pending
              </Badge>
            </Row>
            <Row justify="space-between">
              <Row gap={10}>
                <Ic.file size={14} color={C.mute} />
                <div>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: C.dim,
                    }}
                  >
                    Order status
                  </div>
                  <div style={{ fontSize: 11, color: C.mute }}>
                    → FULFILLMENT_PENDING
                  </div>
                </div>
              </Row>
              <Badge tone="em" subtle>
                Updated
              </Badge>
            </Row>
          </div>
        </Card>
      </div>
      <Row justify="flex-end">
        <Btn onClick={cont} iconRight={<Ic.arrow size={16} />}>
          Continue to shipping
        </Btn>
      </Row>
      <Api ep="/payments/pi_8f2ab7c1/settle" />
    </div>
  );
};

/* ===== step 6: ship ===== */
const SHIP_EVENTS = [
  {
    t: "Apr 18 · 14:02",
    code: "label.created",
    loc: "Austin, TX 78701",
    msg: "Label purchased · USPS Priority Mail",
    phase: "labelCreated",
  },
  {
    t: "Apr 18 · 17:40",
    code: "origin.accepted",
    loc: "Austin, TX 78701",
    msg: "Accepted by carrier at origin facility",
    phase: "inTransit",
  },
  {
    t: "Apr 19 · 08:15",
    code: "in_transit",
    loc: "Memphis, TN 38118",
    msg: "Arrived at distribution center",
    phase: "inTransit",
  },
  {
    t: "Apr 20 · 03:02",
    code: "in_transit",
    loc: "Newark, NJ 07102",
    msg: "Departed facility",
    phase: "inTransit",
  },
  {
    t: "Apr 20 · 11:22",
    code: "out_for_delivery",
    loc: "Brooklyn, NY 11201",
    msg: "Out for delivery with local carrier",
    phase: "outForDelivery",
  },
  {
    t: "Apr 20 · 14:33",
    code: "delivered",
    loc: "Brooklyn, NY 11201",
    msg: "Delivered · signed for · left at front door",
    phase: "delivered",
  },
];

const PHASE_ORDER = [
  "labelPending",
  "labelCreated",
  "inTransit",
  "outForDelivery",
  "delivered",
];

// Weight tiers based on USPS Ground Advantage rates (matching shipping-core)
// Buffer = next tier rate - current tier rate (NOT a % of item price)
const WEIGHT_TIERS = [
  { tier: "T1", range: "0 – 1.0 lb", rate: 6.00, nextRate: 7.50, buffer: 1.50 },
  { tier: "T2", range: "1.0 – 2.0 lb", rate: 7.50, nextRate: 9.00, buffer: 1.50 },
  { tier: "T3", range: "2.0 – 3.0 lb", rate: 9.00, nextRate: 11.00, buffer: 2.00 },
  { tier: "T4", range: "3.0 – 5.0 lb", rate: 11.00, nextRate: 14.00, buffer: 3.00 },
];

const visibleEvents = (sub: string) => {
  const maxIdx = PHASE_ORDER.indexOf(sub);
  return SHIP_EVENTS.filter(
    (e) => PHASE_ORDER.indexOf(e.phase) <= maxIdx
  );
};

const SLABadge = ({ status }: { status: "ok" | "warn" | "bad" | "fulfilled" }) => {
  const m = {
    ok: { tone: "em" as const, lbl: "ON TRACK" },
    warn: { tone: "amber" as const, lbl: "AT RISK" },
    bad: { tone: "red" as const, lbl: "VIOLATED" },
    fulfilled: { tone: "em" as const, lbl: "FULFILLED" },
  }[status];
  return <Badge tone={m.tone}>{m.lbl}</Badge>;
};

const Step6 = ({
  s,
  sub,
  act,
}: {
  s: SessionState;
  sub: string;
  act: () => void;
}) => {
  const declaredWeight = 0.82;
  const tier = WEIGHT_TIERS[0];
  const baseRate = tier.rate;
  const bufferAmt = tier.buffer; // next tier rate - current tier rate ($1.50)
  const routeStops = [
    {
      city: "Austin, TX",
      code: "ORIGIN",
      done: PHASE_ORDER.indexOf(sub) >= 1,
    },
    {
      city: "Memphis, TN",
      code: "HUB",
      done: PHASE_ORDER.indexOf(sub) >= 2,
    },
    {
      city: "Newark, NJ",
      code: "HUB",
      done: PHASE_ORDER.indexOf(sub) >= 2,
    },
    {
      city: "Brooklyn, NY",
      code: "DEST",
      done: PHASE_ORDER.indexOf(sub) >= 3,
    },
  ];
  const transitDaysTotal = 3;
  const transitDaysElapsed =
    sub === "inTransit"
      ? 2
      : sub === "outForDelivery" || sub === "delivered"
        ? 3
        : 0;
  const progressPct = Math.min(
    100,
    (transitDaysElapsed / transitDaysTotal) * 100
  );
  const events = visibleEvents(sub);

  return (
    <div style={{ animation: "haggle-fadeup 0.35s ease both" }}>
      <SH
        eb="STEP 06"
        title="Ship"
        sub="Seller creates a label, hands to carrier, we track events until delivery — with weight-buffer reconciliation and SLA enforcement on top."
      />

      {/* shipment header */}
      <Card style={{ marginBottom: 14 }}>
        <Row justify="space-between" style={{ marginBottom: 14 }} wrap gap={8}>
          <Row gap={12}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: C.card2,
                border: `1px solid ${C.line2}`,
                color: C.dim,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ic.pkg size={18} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Shipment shp_2c9a7e
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: C.mute,
                  marginTop: 2,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                USPS Priority · via EasyPost · rate_R7p3f
              </div>
            </div>
          </Row>
          <Badge
            tone={
              sub === "labelPending"
                ? "amber"
                : sub === "delivered"
                  ? "em"
                  : sub === "inTransit" || sub === "outForDelivery"
                    ? "cyan"
                    : "slate"
            }
          >
            {sub === "labelPending" && "Label pending"}
            {sub === "labelCreated" && "Label created"}
            {sub === "inTransit" && "In transit"}
            {sub === "outForDelivery" && "Out for delivery"}
            {sub === "delivered" && "Delivered"}
          </Badge>
        </Row>

        {sub !== "labelPending" && (
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              background: C.card2,
              border: `1px solid ${C.line}`,
              marginBottom: 14,
            }}
          >
            <Row justify="space-between" wrap gap={10}>
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color: C.mute,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  Tracking number
                </div>
                <div
                  style={{
                    fontSize: 16,
                    color: C.cyanFg,
                    marginTop: 4,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  9400 1118 9922 4127 5543 21
                </div>
              </div>
              <Row gap={8}>
                {sub === "labelCreated" && (
                  <Btn v="secondary" size="sm" icon={<Ic.file size={12} />}>
                    Download label PDF
                  </Btn>
                )}
                <Btn v="secondary" size="sm" icon={<Ic.ext size={12} />}>
                  USPS tracking
                </Btn>
              </Row>
            </Row>
          </div>
        )}
      </Card>

      {/* LABEL PENDING: package details + SLA countdown */}
      {sub === "labelPending" && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <Card>
              <SL
                right={
                  <span
                    style={{
                      fontSize: 10,
                      color: C.faint,
                      fontFamily:
                        "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    }}
                  >
                    seller declared
                  </span>
                }
              >
                Package details
              </SL>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                {(
                  [
                    ["Declared weight", "0.82 lb", "weight tier T1"],
                    ["Dimensions", "7 × 5 × 3 in", "LWH inches"],
                    [
                      "Category",
                      "Electronics · phone",
                      "restricted list OK",
                    ],
                    [
                      "Contents",
                      "iPhone 14 Pro 128GB",
                      "$1,200 declared value",
                    ],
                    ["Origin", "Austin, TX 78701", "seller verified"],
                    [
                      "Destination",
                      "Brooklyn, NY 11201",
                      "buyer confirmed",
                    ],
                  ] as const
                ).map(([k, v, note]) => (
                  <div
                    key={k}
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      background: C.card2,
                      border: `1px solid ${C.line}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 9.5,
                        color: C.mute,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        fontFamily:
                          "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                      }}
                    >
                      {k}
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: C.dim,
                        marginTop: 4,
                        fontWeight: 500,
                      }}
                    >
                      {v}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: C.faint,
                        marginTop: 2,
                        fontFamily:
                          "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                      }}
                    >
                      {note}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <SL>Route · estimate</SL>
              <div style={{ padding: "8px 0" }}>
                {routeStops.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "20px 1fr auto",
                      gap: 10,
                      alignItems: "center",
                      padding: "6px 0",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background:
                            i === 0
                              ? C.cyanFg
                              : i === routeStops.length - 1
                                ? C.emFg
                                : C.faint,
                        }}
                      />
                      {i < routeStops.length - 1 && (
                        <div
                          style={{
                            width: 1,
                            height: 16,
                            background: C.line2,
                            marginTop: 2,
                          }}
                        />
                      )}
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 12.5,
                          color: C.dim,
                          fontWeight: 500,
                        }}
                      >
                        {r.city}
                      </div>
                      <div
                        style={{
                          fontSize: 9.5,
                          color: C.faint,
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          fontFamily:
                            "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                        }}
                      >
                        {r.code}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 10,
                  borderTop: `1px dashed ${C.line}`,
                  fontSize: 11.5,
                  color: C.mute,
                }}
              >
                Estimated transit{" "}
                <span style={{ color: C.dim, fontWeight: 600 }}>
                  2–3 business days
                </span>
              </div>
            </Card>
          </div>

          {/* SLA countdown */}
          <Card accent="amber" style={{ marginBottom: 14 }}>
            <Row
              justify="space-between"
              style={{ marginBottom: 12 }}
              wrap
              gap={10}
            >
              <Row gap={10}>
                <Ic.alert size={16} color={C.amberFg} />
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>
                  Shipping SLA · 3-day deadline
                </div>
              </Row>
              <SLABadge status="ok" />
            </Row>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(180,83,9,0.04)",
                  border: `1px solid ${C.amberBd}`,
                }}
              >
                <div
                  style={{
                    fontSize: 9.5,
                    color: C.mute,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  Deadline
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.amberFg,
                    marginTop: 4,
                  }}
                >
                  Apr 21 · 23:59 CT
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: C.faint,
                    marginTop: 2,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  in 2d 18h 22m
                </div>
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(180,83,9,0.04)",
                  border: `1px solid ${C.amberBd}`,
                }}
              >
                <div
                  style={{
                    fontSize: 9.5,
                    color: C.mute,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  Penalty
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.amberFg,
                    marginTop: 4,
                  }}
                >
                  2% / day
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: C.faint,
                    marginTop: 2,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  deducted from seller
                </div>
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(180,83,9,0.04)",
                  border: `1px solid ${C.amberBd}`,
                }}
              >
                <div
                  style={{
                    fontSize: 9.5,
                    color: C.mute,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  Breach action
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.amberFg,
                    marginTop: 4,
                  }}
                >
                  Auto-dispute
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: C.faint,
                    marginTop: 2,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  buyer notified
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: C.mute,
                lineHeight: 1.55,
              }}
            >
              Seller must produce a scanned label within 72 hours of payment
              settlement. After the deadline, a 2% daily penalty is deducted
              from the seller payout and the order is flagged for dispute
              review.
            </div>
          </Card>
        </>
      )}

      {/* LABEL CREATED: shipping cost breakdown */}
      {sub === "labelCreated" && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
              gap: 14,
              marginBottom: 14,
            }}
          >
            <Card>
              <SL>Shipping cost breakdown</SL>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                }}
              >
                <KV
                  k="USPS Priority rate"
                  v={`$${baseRate.toFixed(2)}`}
                  mono
                />
                <KV
                  k="Declared weight"
                  v={`${declaredWeight} lb`}
                  mono
                />
                <KV
                  k="Weight tier"
                  v={`${tier.tier} · ${tier.range}`}
                  mono
                />
                <KV
                  k="Weight buffer (next tier diff)"
                  v={`$${bufferAmt.toFixed(2)}`}
                  mono
                />
                <KV k="EasyPost fee" v="$0.05" mono />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "10px 0 4px",
                    borderTop: `1px solid ${C.line}`,
                    marginTop: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: C.ink,
                    }}
                  >
                    Seller pays (label)
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: C.ink,
                      fontFamily:
                        "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    ${(baseRate + 0.05).toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: C.mute,
                    marginTop: 6,
                    lineHeight: 1.55,
                  }}
                >
                  The{" "}
                  <span style={{ color: C.violetFg, fontWeight: 500 }}>
                    ${bufferAmt.toFixed(2)} buffer
                  </span>{" "}
                  is held from seller payout. Released after 14-day APV window
                  if declared weight matches carrier scan.
                </div>
              </div>
            </Card>
            <Card>
              <SL>Label document</SL>
              <div
                style={{
                  border: `1px dashed ${C.line2}`,
                  borderRadius: 10,
                  background: C.card2,
                  padding: 18,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: "80%",
                    margin: "0 auto 14px",
                    padding: 14,
                    background: "#fff",
                    border: `1px solid ${C.line2}`,
                    borderRadius: 6,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    fontSize: 10,
                    textAlign: "left",
                    lineHeight: 1.6,
                    color: C.dim,
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    USPS PRIORITY MAIL ®
                  </div>
                  <div style={{ fontSize: 8, color: C.mute }}>FROM:</div>
                  <div>Seller · 78701</div>
                  <div style={{ fontSize: 8, color: C.mute, marginTop: 4 }}>
                    TO:
                  </div>
                  <div>Buyer · 11201</div>
                  <div
                    style={{
                      marginTop: 8,
                      padding: "8px 4px",
                      borderTop: `1px dashed ${C.line}`,
                      borderBottom: `1px dashed ${C.line}`,
                    }}
                  >
                    {/* CSS barcode — Code 128 style */}
                    <svg viewBox="0 0 200 40" style={{ width: "100%", height: 36 }}>
                      {(() => {
                        const pattern = "110100100001101001000011010010011101001001110110100100011010011100101100100011011001001110100110010011010011001001101001100111010010011011011001001";
                        let x = 10;
                        return pattern.split("").map((bit, i) => {
                          const bar = <rect key={i} x={x} y={2} width={1} height={36} fill={bit === "1" ? C.ink : "transparent"} />;
                          x += 1;
                          return bar;
                        });
                      })()}
                    </svg>
                  </div>
                  <div
                    style={{
                      textAlign: "center",
                      marginTop: 4,
                      fontSize: 9,
                    }}
                  >
                    9400 1118 9922 4127 5543 21
                  </div>
                </div>
                <Row gap={8} justify="center">
                  <Btn v="secondary" size="sm" icon={<Ic.file size={12} />}>
                    Download PDF
                  </Btn>
                  <Btn v="ghost" size="sm" icon={<Ic.ext size={12} />}>
                    Print
                  </Btn>
                </Row>
              </div>
            </Card>
          </div>
        </>
      )}

      {/* IN TRANSIT: progress + weight buffer status */}
      {(sub === "inTransit" || sub === "outForDelivery") && (
        <>
          <Card style={{ marginBottom: 14 }}>
            <SL
              right={
                <span
                  style={{
                    fontSize: 10,
                    color: C.faint,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  day {transitDaysElapsed} of ~{transitDaysTotal}
                </span>
              }
            >
              Delivery progress
            </SL>
            <div
              style={{
                position: "relative",
                height: 6,
                borderRadius: 999,
                background: "rgba(20,20,26,0.06)",
                overflow: "hidden",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${progressPct}%`,
                  background: `linear-gradient(90deg, ${C.cyan}, ${C.violet})`,
                  borderRadius: 999,
                  transition: "width 0.4s",
                }}
              />
            </div>
            {/* route stops visualization */}
            <div
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: `repeat(${routeStops.length}, 1fr)`,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 9,
                  left: "12.5%",
                  right: "12.5%",
                  height: 2,
                  background: C.line2,
                  zIndex: 0,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 9,
                  left: "12.5%",
                  width: `${(progressPct * (1 - 0.25)).toFixed(1)}%`,
                  height: 2,
                  background: C.cyanFg,
                  zIndex: 1,
                }}
              />
              {routeStops.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    zIndex: 2,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: r.done ? C.cyanFg : C.card,
                      border: `2px solid ${r.done ? C.cyanFg : C.line2}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                    }}
                  >
                    {r.done && <Ic.check size={11} sw={3} />}
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 11.5,
                      fontWeight: r.done ? 600 : 400,
                      color: r.done ? C.dim : C.mute,
                      textAlign: "center",
                    }}
                  >
                    {r.city}
                  </div>
                  <div
                    style={{
                      fontSize: 9.5,
                      color: C.faint,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginTop: 2,
                      fontFamily:
                        "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    }}
                  >
                    {r.code}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Weight buffer status */}
          <Card accent="violet" style={{ marginBottom: 14 }}>
            <Row
              justify="space-between"
              style={{ marginBottom: 12 }}
              wrap
              gap={10}
            >
              <Row gap={10}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: C.violetBg,
                    border: `1px solid ${C.violetBd}`,
                    color: C.violetFg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ic.pkg size={15} />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: C.ink,
                    }}
                  >
                    Weight buffer · APV pending
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: C.mute,
                      marginTop: 2,
                      fontFamily:
                        "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    }}
                  >
                    held · released post-delivery + carrier confirmation
                  </div>
                </div>
              </Row>
              <Badge tone="violet" subtle>
                HOLDING
              </Badge>
            </Row>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 10,
              }}
            >
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(124,58,237,0.04)",
                  border: `1px solid ${C.violetBd}`,
                }}
              >
                <div
                  style={{
                    fontSize: 9.5,
                    color: C.mute,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  Declared
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: C.dim,
                    marginTop: 4,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {declaredWeight} lb
                </div>
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(124,58,237,0.04)",
                  border: `1px solid ${C.violetBd}`,
                }}
              >
                <div
                  style={{
                    fontSize: 9.5,
                    color: C.mute,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  Tier
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.violetFg,
                    marginTop: 4,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  {tier.tier} · ${tier.buffer.toFixed(2)}
                </div>
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(124,58,237,0.04)",
                  border: `1px solid ${C.violetBd}`,
                }}
              >
                <div
                  style={{
                    fontSize: 9.5,
                    color: C.mute,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  Buffer held
                </div>
                <Money
                  value={bufferAmt}
                  size={14}
                  tone="violet"
                  bold
                  style={{ marginTop: 4, display: "inline-block" }}
                />
              </div>
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "rgba(124,58,237,0.04)",
                  border: `1px solid ${C.violetBd}`,
                }}
              >
                <div
                  style={{
                    fontSize: 9.5,
                    color: C.mute,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  APV status
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.violetFg,
                    marginTop: 4,
                  }}
                >
                  Awaiting scan
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* event timeline */}
      {sub !== "labelPending" && (
        <Card style={{ marginBottom: 14 }}>
          <SL
            right={
              <span
                style={{
                  fontSize: 10,
                  color: C.faint,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                {events.length} events
              </span>
            }
          >
            Tracking events
          </SL>
          {events.map((e, i) => {
            const isLast = i === events.length - 1;
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 18px 1fr auto",
                  gap: 12,
                  alignItems: "start",
                  padding: "10px 0",
                  borderBottom:
                    i < events.length - 1
                      ? `1px dashed ${C.line}`
                      : "none",
                }}
              >
                <span
                  style={{
                    fontSize: 10.5,
                    color: C.faint,
                    paddingTop: 3,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  {e.t}
                </span>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: 5,
                  }}
                >
                  <div
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: isLast ? C.cyan : C.em,
                      ...(isLast
                        ? {
                            animation:
                              "haggle-pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
                          }
                        : {}),
                    }}
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: C.dim,
                      fontWeight: isLast ? 600 : 500,
                    }}
                  >
                    {e.msg}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: C.mute,
                      marginTop: 3,
                      fontFamily:
                        "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    }}
                  >
                    {e.code} · {e.loc}
                  </div>
                </div>
                {isLast && (
                  <Badge tone="cyan" subtle>
                    LATEST
                  </Badge>
                )}
              </div>
            );
          })}
        </Card>
      )}

      <Row justify="flex-end">
        {sub === "labelPending" && (
          <Btn onClick={act} icon={<Ic.file size={14} />}>
            Create shipping label
          </Btn>
        )}
        {sub === "labelCreated" && (
          <Btn onClick={act} icon={<Ic.truck size={14} />}>
            Mark as shipped
          </Btn>
        )}
        {sub === "inTransit" && (
          <Btn onClick={act} icon={<Ic.truck size={14} />}>
            Advance → Out for delivery
          </Btn>
        )}
        {sub === "outForDelivery" && (
          <Btn onClick={act} icon={<Ic.check size={14} />}>
            Confirm delivery
          </Btn>
        )}
      </Row>
      <Api
        ep={
          sub === "labelPending"
            ? "/shipments/shp_2c9a7e/label"
            : "/shipments/shp_2c9a7e/event"
        }
      />
    </div>
  );
};

/* ===== step 7: delivered ===== */
const PhaseBig = ({
  n,
  lbl,
  amt,
  pct,
  cond,
  countdown,
  deadline,
  tone,
  active,
  status,
}: {
  n: string;
  lbl: string;
  amt: number;
  pct: number;
  cond: string;
  countdown: string;
  deadline: string;
  tone: "cyan" | "violet";
  active?: boolean;
  status: string;
}) => {
  const col = tone === "cyan" ? C.cyanFg : C.violetFg;
  const bd = tone === "cyan" ? C.cyanBd : C.violetBd;
  const bg = tone === "cyan" ? C.cyanBg : C.violetBg;
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        background: active ? bg : C.card2,
        border: `1px solid ${active ? bd : C.line}`,
      }}
    >
      <Row justify="space-between" style={{ marginBottom: 12 }}>
        <Row gap={8}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "#fff",
              border: `1px solid ${bd}`,
              color: col,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            {n}
          </div>
          <span
            style={{
              fontSize: 10,
              color: col,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              fontWeight: 600,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            PHASE {n}
          </span>
        </Row>
        <Badge tone={tone} subtle>
          {status}
        </Badge>
      </Row>
      <div
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: C.ink,
          marginBottom: 4,
        }}
      >
        {lbl}
      </div>
      <Row gap={8} align="baseline" style={{ marginBottom: 10 }}>
        <Money value={amt} size={22} tone={tone} bold />
        <span
          style={{
            fontSize: 11,
            color: C.faint,
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          {pct}%
        </span>
      </Row>
      <div
        style={{
          fontSize: 11.5,
          color: C.mute,
          lineHeight: 1.5,
          marginBottom: 8,
        }}
      >
        {cond}
      </div>
      <div
        style={{
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.6)",
          border: `1px dashed ${bd}`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: col,
            fontWeight: 600,
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          {countdown}
        </div>
        <div
          style={{
            fontSize: 10,
            color: C.mute,
            marginTop: 2,
            fontFamily:
              "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
          }}
        >
          target: {deadline}
        </div>
      </div>
    </div>
  );
};

/* ===== buddy species & rarity for egg reveal ===== */
const BUDDY_SPECIES = [
  { id: "FOX", emoji: "🦊", name: "Fox", category: "Electronics" },
  { id: "RABBIT", emoji: "🐰", name: "Rabbit", category: "Clothing" },
  { id: "BEAR", emoji: "🐻", name: "Bear", category: "Sports" },
  { id: "CAT", emoji: "🐱", name: "Cat", category: "Home" },
  { id: "OWL", emoji: "🦉", name: "Owl", category: "Collectibles" },
  { id: "DRAGON", emoji: "🐉", name: "Dragon", category: "Jewelry" },
  { id: "EAGLE", emoji: "🦅", name: "Eagle", category: "Vehicles" },
  { id: "WOLF", emoji: "🐺", name: "Wolf", category: "Other" },
];

const BUDDY_RARITIES = [
  { id: "COMMON", label: "Common", color: "#94a3b8", weight: 55, glow: "rgba(148,163,184,0.3)" },
  { id: "UNCOMMON", label: "Uncommon", color: "#22c55e", weight: 28, glow: "rgba(34,197,94,0.3)" },
  { id: "RARE", label: "Rare", color: "#3b82f6", weight: 13, glow: "rgba(59,130,246,0.4)" },
  { id: "EPIC", label: "Epic", color: "#a855f7", weight: 3.9, glow: "rgba(168,85,247,0.5)" },
  { id: "LEGENDARY", label: "Legendary", color: "#f97316", weight: 0.097, glow: "rgba(249,115,22,0.6)" },
  { id: "MYTHIC", label: "Mythic", color: "#ef4444", weight: 0.003, glow: "rgba(239,68,68,0.7)" },
];

function rollBuddy() {
  // Electronics → FOX as primary, but add some randomness
  const species = Math.random() < 0.6 ? BUDDY_SPECIES[0] : BUDDY_SPECIES[Math.floor(Math.random() * BUDDY_SPECIES.length)];
  // Weighted rarity roll
  const totalWeight = BUDDY_RARITIES.reduce((a, r) => a + r.weight, 0);
  let roll = Math.random() * totalWeight;
  let rarity = BUDDY_RARITIES[0];
  for (const r of BUDDY_RARITIES) {
    roll -= r.weight;
    if (roll <= 0) { rarity = r; break; }
  }
  return { species, rarity };
}

type DisputeMode = false | "open" | "t1" | "t2" | "resolved_buyer" | "resolved_partial" | "resolved_seller";
type DeliveredPhase = "delivered" | "confirming" | "confirmed" | "egg_offer" | "egg_crack" | "egg_hatch" | "buddy_reveal" | "complete" | "done" | "dispute";

const Step7 = ({
  s,
  reset,
  disputeMode,
  onDispute,
}: {
  s: SessionState;
  reset: () => void;
  disputeMode: DisputeMode;
  onDispute: (mode: DisputeMode) => void;
}) => {
  const hf = s.amount * 0.015;
  const sel = s.amount - hf;
  const tier = WEIGHT_TIERS[0];
  const phase2Amt = tier.buffer;
  const phase1Amt = sel - phase2Amt;

  const [phase, setPhase] = useState<DeliveredPhase>("delivered");
  const [buddy, setBuddy] = useState<{ species: typeof BUDDY_SPECIES[0]; rarity: typeof BUDDY_RARITIES[0] } | null>(null);

  function handleConfirm() {
    setPhase("confirming");
    setTimeout(() => {
      setPhase("confirmed");
      setTimeout(() => {
        const b = rollBuddy();
        setBuddy(b);
        setPhase("egg_offer");
      }, 1200);
    }, 1000);
  }

  function handleOpenEgg() {
    setPhase("egg_crack");
    setTimeout(() => setPhase("egg_hatch"), 1300);
    setTimeout(() => setPhase("buddy_reveal"), 2100);
    setTimeout(() => setPhase("complete"), 3600);
  }

  const apvScenarios = [
    {
      actual: "≤ 1.00 lb",
      band: "T1 match",
      adjustment: 0,
      status: "no_change",
    },
    {
      actual: "1.01 – 3.00 lb",
      band: "T1 → T2",
      adjustment: -(tier.rate * 0.52),
      status: "partial",
    },
    {
      actual: "3.01 – 5.00 lb",
      band: "T1 → T3",
      adjustment: -(tier.rate * 1.32),
      status: "significant",
    },
    {
      actual: "> 5.00 lb",
      band: "T1 → T4+",
      adjustment: -phase2Amt,
      status: "full_claim",
    },
  ];

  return (
    <div style={{ animation: "haggle-fadeup 0.35s ease both" }}>
      <SH
        eb="STEP 07 · DELIVERED"
        title="Package delivered ✓"
        sub="Buyer review window runs for 24 hours. Weight-buffer APV holds for 14 days while USPS posts its carrier-scanned weight."
      />

      {/* delivered hero */}
      <Card accent="em" style={{ marginBottom: 14, padding: 22 }}>
        <Row gap={16} align="center">
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: C.emBg,
              border: `2px solid ${C.emBd}`,
              color: C.emFg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Ic.check size={28} sw={2.5} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: C.ink }}>
              Delivered · Apr 20 · 14:33 CT
            </div>
            <div style={{ fontSize: 12.5, color: C.mute, marginTop: 3 }}>
              Signed for at Brooklyn, NY 11201 · left at front door
            </div>
          </div>
          <Row gap={6}>
            <Badge tone="em">Delivered</Badge>
            <SLABadge status="fulfilled" />
          </Row>
        </Row>
      </Card>

      {/* Settlement Release 2 phase */}
      <Card style={{ marginBottom: 14 }}>
        <SL
          right={
            <span
              style={{
                fontSize: 10,
                color: C.faint,
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              seller payout
            </span>
          }
        >
          Settlement release · 2 phases
        </SL>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <PhaseBig
            n="1"
            lbl="Product amount"
            amt={phase1Amt}
            pct={sel > 0 ? Math.round((phase1Amt / sel) * 100) : 99}
            cond="Delivery + 24h buyer review period"
            countdown="Releases in 23h 57m"
            deadline="Apr 21 · 14:33 CT"
            tone="cyan"
            active
            status="COUNTDOWN"
          />
          <PhaseBig
            n="2"
            lbl="Weight buffer"
            amt={phase2Amt}
            pct={sel > 0 ? Math.round((phase2Amt / sel) * 100) : 1}
            cond="USPS APV reconciliation · 14-day hold"
            countdown="Releases in 13d 23h"
            deadline="May 4 · 14:33 CT"
            tone="violet"
            status="HOLDING"
          />
        </div>

        {/* visual timeline bar */}
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 10,
            background: C.card2,
            border: `1px solid ${C.line}`,
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              color: C.mute,
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              marginBottom: 10,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            Release timeline (from delivery)
          </div>
          <div style={{ position: "relative", height: 52 }}>
            {/* track background */}
            <div style={{ position: "absolute", top: 24, left: 0, right: 0, height: 3, background: "rgba(20,20,26,0.06)", borderRadius: 999 }} />
            {/* phase 1 fill */}
            <div style={{ position: "absolute", top: 24, left: 0, width: "7.1%", height: 3, background: C.cyanFg, borderRadius: 999 }} />
            {/* dots */}
            <div style={{ position: "absolute", top: 0, left: 0, textAlign: "left" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.cyanFg, margin: "0 auto 4px" }} />
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: C.cyanFg, fontWeight: 600 }}>D+0</span>
            </div>
            <div style={{ position: "absolute", top: 0, left: "7.1%", textAlign: "center", transform: "translateX(-50%)" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.cyan, margin: "0 auto 4px" }} />
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: C.cyanFg, fontWeight: 600 }}>D+1</span>
            </div>
            <div style={{ position: "absolute", top: 0, right: 0, textAlign: "right" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.violet, margin: "0 0 4px auto" }} />
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: C.violetFg, fontWeight: 600 }}>D+14</span>
            </div>
            {/* labels below track */}
            <div style={{ position: "absolute", top: 32, left: 0, fontSize: 10, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: C.mute }}>Delivered</div>
            <div style={{ position: "absolute", top: 32, left: "7.1%", fontSize: 10, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: C.mute }}>Product release</div>
            <div style={{ position: "absolute", top: 32, right: 0, fontSize: 10, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", color: C.mute }}>Buffer release</div>
          </div>
        </div>
      </Card>

      {/* APV scenarios table */}
      <Card accent="violet" style={{ marginBottom: 14 }}>
        <Row
          justify="space-between"
          style={{ marginBottom: 12 }}
          wrap
          gap={10}
        >
          <Row gap={10}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: C.violetBg,
                border: `1px solid ${C.violetBd}`,
                color: C.violetFg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ic.pkg size={15} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                Weight correction scenarios · APV
              </div>
              <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>
                how the buffer resolves depending on USPS-scanned weight
              </div>
            </div>
          </Row>
          <span
            style={{
              fontSize: 10,
              color: C.mute,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            declared: 0.82 lb · tier T1
          </span>
        </Row>
        <div
          style={{
            borderRadius: 10,
            border: `1px solid ${C.line}`,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
              padding: "10px 14px",
              background: "rgba(20,20,26,0.02)",
              borderBottom: `1px solid ${C.line}`,
            }}
          >
            {["Actual weight", "Tier shift", "Adjustment", "Seller impact"].map(
              (h) => (
                <span
                  key={h}
                  style={{
                    fontSize: 10,
                    color: C.mute,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  {h}
                </span>
              )
            )}
          </div>
          {apvScenarios.map((row, i) => {
            const neg = row.adjustment < 0;
            const isFull = row.status === "full_claim";
            const statusCol =
              row.status === "no_change"
                ? C.emFg
                : row.status === "partial"
                  ? C.amberFg
                  : row.status === "significant"
                    ? C.amberFg
                    : C.redFg;
            const statusLbl =
              row.status === "no_change"
                ? "Full release"
                : row.status === "partial"
                  ? "Partial clawback"
                  : row.status === "significant"
                    ? "Major clawback"
                    : "Buffer exhausted";
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
                  padding: "11px 14px",
                  borderTop: i === 0 ? "none" : `1px solid ${C.line}`,
                  alignItems: "center",
                  background:
                    i === 0 ? C.emBg : isFull ? C.redBg : "transparent",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: C.dim,
                    fontWeight: 500,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  {row.actual}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: C.mute,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  {row.band}
                </span>
                <span
                  style={{
                    fontSize: 12.5,
                    color: neg ? C.redFg : C.emFg,
                    fontWeight: 600,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.adjustment === 0
                    ? "±$0.00"
                    : `-$${Math.abs(row.adjustment).toFixed(2)}`}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: statusCol,
                    fontWeight: 600,
                  }}
                >
                  {statusLbl}
                </span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: C.mute,
            lineHeight: 1.55,
          }}
        >
          Adjustments are deducted from the{" "}
          <span style={{ color: C.violetFg }}>
            ${phase2Amt.toFixed(2)} weight buffer
          </span>{" "}
          before Phase 2 release. If a clawback exceeds the buffer, additional
          amounts are deducted from seller&apos;s future payouts.
        </div>
      </Card>

      {/* SLA result card */}
      <Card accent="em" style={{ marginBottom: 14 }}>
        <Row
          justify="space-between"
          style={{ marginBottom: 14 }}
          wrap
          gap={10}
        >
          <Row gap={10}>
            <Ic.shield size={16} color={C.emFg} />
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>
              Shipping SLA · result
            </div>
          </Row>
          <SLABadge status="fulfilled" />
        </Row>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
          }}
        >
          {(
            [
              ["Deadline", "Apr 21 · 23:59", "3-day SLA", C.mute],
              ["Actual ship", "Apr 18 · 17:40", "on day 1", C.emFg],
              ["Margin", "2d 6h early", "no penalty", C.emFg],
              ["Penalty applied", "$0.00", "—", C.emFg],
            ] as [string, string, string, string][]
          ).map(([k, v, note, col]) => (
            <div
              key={k}
              style={{
                padding: 10,
                borderRadius: 8,
                background: "rgba(5,150,105,0.04)",
                border: `1px solid ${C.emBd}`,
              }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  color: C.mute,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                {k}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: col,
                  marginTop: 4,
                }}
              >
                {v}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: C.faint,
                  marginTop: 2,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                {note}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* full event log */}
      <Card style={{ marginBottom: 14 }}>
        <SL
          right={
            <span
              style={{
                fontSize: 10,
                color: C.faint,
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              {SHIP_EVENTS.length} events · Apr 18 – Apr 20
            </span>
          }
        >
          Complete tracking log
        </SL>
        {SHIP_EVENTS.map((e, i) => {
          const isLast = i === SHIP_EVENTS.length - 1;
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 18px 1fr auto",
                gap: 12,
                alignItems: "start",
                padding: "10px 0",
                borderBottom:
                  i < SHIP_EVENTS.length - 1
                    ? `1px dashed ${C.line}`
                    : "none",
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  color: C.faint,
                  paddingTop: 3,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                {e.t}
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: 5,
                }}
              >
                <div
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: isLast ? C.emFg : C.em,
                  }}
                />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: C.dim,
                    fontWeight: isLast ? 600 : 500,
                  }}
                >
                  {e.msg}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: C.mute,
                    marginTop: 3,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                  }}
                >
                  {e.code} · {e.loc}
                </div>
              </div>
              {isLast && (
                <Badge tone="em" subtle>
                  DELIVERED
                </Badge>
              )}
            </div>
          );
        })}
      </Card>

      {/* dispute / done row */}
      {/* ── Buyer Confirmation ── */}
      {phase === "delivered" && (
        <>
          <Card accent="cyan" style={{ marginBottom: 14 }}>
            <Row justify="space-between" wrap gap={10}>
              <Row gap={12}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: C.cyanBg, border: `1px solid ${C.cyanBd}`, color: C.cyanFg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic.check size={20} sw={2.5} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Confirm receipt & release payment</div>
                  <div style={{ fontSize: 12, color: C.mute, marginTop: 3, lineHeight: 1.5 }}>
                    Item matches description? Confirm to release <Money value={phase1Amt} size={12} tone="cyan" bold /> to seller immediately.
                    <br />Auto-confirms in 23h 57m if no action taken.
                  </div>
                </div>
              </Row>
              <Btn onClick={handleConfirm} icon={<Ic.check size={14} />}>
                Confirm & release
              </Btn>
            </Row>
          </Card>
          <Card style={{ marginBottom: 14 }}>
            <Row justify="space-between" wrap gap={10}>
              <Row gap={12}>
                <Ic.alert size={16} color={C.redFg} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.dim }}>Not what you expected?</div>
                  <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2 }}>Open a dispute before the review window closes.</div>
                </div>
              </Row>
              <Btn v="danger" size="sm" icon={<Ic.alert size={13} />} onClick={() => {
                setPhase("dispute");
                onDispute("open");
              }}>Report an issue</Btn>
            </Row>
          </Card>
        </>
      )}

      {/* ── Confirming spinner ── */}
      {phase === "confirming" && (
        <Card style={{ marginBottom: 14, padding: 36, textAlign: "center" }}>
          <div style={{ position: "relative", width: 56, height: 56, margin: "0 auto 16px" }}>
            <div style={{ position: "absolute", inset: 0, border: "2px solid transparent", borderTopColor: C.cyan, borderRadius: "50%", animation: "haggle-spin-slow 1.2s linear infinite" }} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Releasing payment to seller...</div>
          <div style={{ fontSize: 12, color: C.mute, marginTop: 4 }}>
            Settlement Release Phase 1 → <Money value={phase1Amt} size={12} tone="cyan" bold /> to seller wallet
          </div>
        </Card>
      )}

      {/* ── Confirmed ── */}
      {phase === "confirmed" && (
        <Card accent="em" style={{ marginBottom: 14, padding: 28, textAlign: "center" }}>
          <div style={{ width: 48, height: 48, margin: "0 auto 12px", borderRadius: "50%", background: C.emBg, border: `2px solid ${C.emBd}`, color: C.emFg, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Ic.check size={24} sw={2.5} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Payment released!</div>
          <div style={{ fontSize: 12, color: C.mute, marginTop: 6 }}>
            <Money value={phase1Amt} size={13} tone="em" bold /> sent to seller wallet. Trade complete.
          </div>
        </Card>
      )}

      {/* ── Optional reward intro ── */}
      {phase === "egg_offer" && buddy && (
        <Card accent="cyan" style={{ marginBottom: 14, padding: 28 }}>
          <Row justify="space-between" align="center" wrap gap={16}>
            <Row gap={14} align="center" style={{ flex: 1, minWidth: 260 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: C.cyanBg,
                  border: `1px solid ${C.cyanBd}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 30,
                }}
              >
                🥚
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>
                  축하해요, 에그가 떨어졌어요
                </div>
                <div style={{ fontSize: 12, color: C.mute, marginTop: 5, lineHeight: 1.55 }}>
                  거래는 이미 완료됐습니다. 에그와 버디는 선택형 보상이라 지금 열어도 되고,
                  관심 없으면 다음 거래로 넘어가도 됩니다.
                </div>
              </div>
            </Row>
            <Row gap={8} wrap>
              <Btn v="secondary" onClick={() => setPhase("done")}>
                나중에 보기
              </Btn>
              <Btn onClick={handleOpenEgg}>
                에그 열기
              </Btn>
            </Row>
          </Row>
        </Card>
      )}

      {phase === "done" && (
        <Card accent="em" style={{ marginBottom: 14, padding: 22 }}>
          <Row gap={12} align="center">
            <div style={{ width: 40, height: 40, borderRadius: 10, background: C.emBg, border: `1px solid ${C.emBd}`, color: C.emFg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ic.check size={20} sw={2.5} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Trade complete</div>
              <div style={{ fontSize: 12, color: C.mute, marginTop: 3 }}>
                에그는 보상함에 저장됩니다. 버디를 몰라도 거래는 그대로 사용할 수 있습니다.
              </div>
            </div>
          </Row>
        </Card>
      )}

      {/* ── Egg open ── */}
      {(phase === "egg_crack" || phase === "egg_hatch") && (
        <Card style={{ marginBottom: 14, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: C.mute, marginBottom: 16, fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", textTransform: "uppercase", letterSpacing: "0.14em" }}>
            Optional reward layer
          </div>
          <div style={{
            fontSize: phase === "egg_crack" ? 72 : phase === "egg_hatch" ? 84 : 64,
            transition: "all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
            transform: phase === "egg_crack" ? "rotate(8deg) scale(1.1)" : phase === "egg_hatch" ? "scale(1.3)" : "scale(1)",
            filter: phase === "egg_hatch" ? "brightness(1.5)" : "none",
            animation: phase === "egg_crack" ? "haggle-shake 0.3s ease infinite" : "none",
          }}>
            🥚
          </div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 12, fontWeight: 500 }}>
            {phase === "egg_crack" && "It's cracking!"}
            {phase === "egg_hatch" && "Hatching...!"}
          </div>
        </Card>
      )}

      {/* ── Buddy Reveal ── */}
      {(phase === "buddy_reveal" || phase === "complete") && buddy && (
        <Card style={{
          marginBottom: 14,
          padding: 36,
          textAlign: "center",
          background: `radial-gradient(circle at center, ${buddy.rarity.glow} 0%, transparent 70%), ${C.card}`,
          border: `2px solid ${buddy.rarity.color}40`,
        }}>
          <div style={{
            fontSize: phase === "complete" ? 72 : 80,
            transition: "all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
            transform: phase === "buddy_reveal" ? "scale(0) rotate(-180deg)" : "scale(1) rotate(0deg)",
            marginBottom: 16,
          }}>
            {buddy.species.emoji}
          </div>
          <div style={{
            display: "inline-block",
            padding: "4px 16px",
            borderRadius: 999,
            background: `${buddy.rarity.color}18`,
            border: `1px solid ${buddy.rarity.color}40`,
            color: buddy.rarity.color,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 12,
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          }}>
            {buddy.rarity.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
            {buddy.species.name}
          </div>
          <div style={{ fontSize: 12, color: C.mute }}>
            {buddy.species.category} specialist · earned from this trade
          </div>

          {/* Buddy details */}
          {phase === "complete" && (
            <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div style={{ padding: 10, borderRadius: 8, background: C.card2, border: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 9, color: C.mute, fontFamily: "var(--font-mono, monospace)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Species</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{buddy.species.emoji} {buddy.species.name}</div>
              </div>
              <div style={{ padding: 10, borderRadius: 8, background: C.card2, border: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 9, color: C.mute, fontFamily: "var(--font-mono, monospace)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Rarity</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: buddy.rarity.color }}>{buddy.rarity.label}</div>
              </div>
              <div style={{ padding: 10, borderRadius: 8, background: C.card2, border: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 9, color: C.mute, fontFamily: "var(--font-mono, monospace)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Level</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Lv. 1</div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── Dispute flow ── */}
      {phase === "dispute" && (
        <>
          {/* Step 1: Dispute opened → auto T1 processing */}
          {disputeMode === "open" && (
            <Card accent="red" style={{ marginBottom: 14 }}>
              <Row gap={12} style={{ marginBottom: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: C.redBg, border: `1px solid ${C.redBd}`, color: C.redFg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic.alert size={22} />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>Dispute opened · funds frozen</div>
                  <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>All releases are paused. T1 automatic review starting...</div>
                </div>
              </Row>
              <div style={{ padding: 12, borderRadius: 8, background: C.redBg, border: `1px dashed ${C.redBd}`, marginBottom: 14, fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
                <strong style={{ color: C.redFg }}>Reason:</strong> Item not as described — battery health 72% vs listed 92%.
              </div>
              <Btn full onClick={() => onDispute("t1")} icon={<Ic.arrow size={14} />}>
                Start T1 auto-review
              </Btn>
              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                <Link href="/demo/dispute/buyer" target="_blank" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: C.cyanBg, border: `1px solid ${C.cyanBd}`, fontSize: 11, fontWeight: 600, color: C.cyanFg, textDecoration: "none" }}>
                  🛡 Buyer view →
                </Link>
                <Link href="/demo/dispute/seller" target="_blank" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: C.violetBg, border: `1px solid ${C.violetBd}`, fontSize: 11, fontWeight: 600, color: C.violetFg, textDecoration: "none" }}>
                  🛡 Seller view →
                </Link>
              </div>
              <Api method="POST" ep="/disputes · reason: ITEM_NOT_AS_DESCRIBED" />
            </Card>
          )}

          {/* Step 2: T1 result — system decides, user accepts or escalates */}
          {disputeMode === "t1" && (
            <Card style={{ marginBottom: 14 }}>
              <Row justify="space-between" style={{ marginBottom: 14 }} wrap gap={8}>
                <div>
                  <Badge tone="amber">TIER 1 · AUTO-RESOLUTION</Badge>
                  <div style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>System ruling: partial refund</div>
                  <div style={{ fontSize: 12, color: C.mute, marginTop: 4, lineHeight: 1.5 }}>
                    Based on trust scores (buyer: 78, seller: 65) and evidence analysis,
                    the system recommends a <strong style={{ color: C.amberFg }}>$50.00 partial refund</strong> for the battery discrepancy.
                  </div>
                </div>
              </Row>
              <div style={{ padding: 12, borderRadius: 8, background: C.card2, border: `1px solid ${C.line}`, marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", color: C.mute, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>T1 RULING · BREAKDOWN</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div style={{ padding: 10, borderRadius: 6, background: C.amberBg, border: `1px solid ${C.amberBd}` }}>
                    <div style={{ fontSize: 9, color: C.mute, fontFamily: "var(--font-mono, monospace)" }}>BUYER RECEIVES</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.amberFg, marginTop: 2 }}>$50.00</div>
                    <div style={{ fontSize: 10, color: C.mute, marginTop: 3 }}>Refund for battery discrepancy</div>
                    <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>+ keeps the item</div>
                  </div>
                  <div style={{ padding: 10, borderRadius: 6, background: C.card2, border: `1px solid ${C.line}` }}>
                    <div style={{ fontSize: 9, color: C.mute, fontFamily: "var(--font-mono, monospace)" }}>SELLER RECEIVES</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.dim, marginTop: 2 }}>${(sel - 50).toFixed(2)}</div>
                    <div style={{ fontSize: 10, color: C.mute, marginTop: 3 }}>Original ${sel.toFixed(2)} − $50 refund</div>
                    <div style={{ fontSize: 10, color: C.mute, marginTop: 1 }}>Item stays with buyer</div>
                  </div>
                </div>
                <div style={{ padding: 8, borderRadius: 6, background: C.card2, border: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: C.mute }}>Haggle fee (unchanged)</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.cyanFg }}>${hf.toFixed(2)}</span>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Btn v="ghost" style={{ border: `1px solid ${C.emBd}`, background: C.emBg }} onClick={() => onDispute("resolved_partial")} full>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.emFg }}>Accept ruling</div>
                    <div style={{ fontSize: 10, color: C.mute }}>$50 refund · case closed</div>
                  </div>
                </Btn>
                <Btn v="ghost" style={{ border: `1px solid ${C.violetBd}`, background: C.violetBg }} onClick={() => onDispute("t2")} full>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.violetFg }}>Escalate to T2</div>
                    <div style={{ fontSize: 10, color: C.mute }}>DS panel review · deposit req.</div>
                  </div>
                </Btn>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                <Link href="/demo/dispute/buyer" target="_blank" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: C.cyanBg, border: `1px solid ${C.cyanBd}`, fontSize: 11, fontWeight: 600, color: C.cyanFg, textDecoration: "none" }}>
                  🛡 Buyer full view →
                </Link>
                <Link href="/demo/dispute/seller" target="_blank" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: C.violetBg, border: `1px solid ${C.violetBd}`, fontSize: 11, fontWeight: 600, color: C.violetFg, textDecoration: "none" }}>
                  🛡 Seller full view →
                </Link>
              </div>
              <Api method="POST" ep="/disputes/:id/review · tier: T1" />
            </Card>
          )}

          {/* Step 3: T2 panel — system decides again */}
          {disputeMode === "t2" && (
            <Card accent="violet" style={{ marginBottom: 14 }}>
              <Row justify="space-between" style={{ marginBottom: 14 }} wrap gap={8}>
                <div>
                  <Badge tone="violet">TIER 2 · DS PANEL REVIEW</Badge>
                  <div style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>Panel ruling: buyer wins</div>
                  <div style={{ fontSize: 12, color: C.mute, marginTop: 4, lineHeight: 1.5 }}>
                    DS panel reviewed photos + IMEI check. Battery at 72% confirmed — seller misrepresented condition.
                    <strong style={{ color: C.emFg }}> Full refund ordered.</strong>
                  </div>
                </div>
              </Row>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div style={{ padding: 10, borderRadius: 8, background: C.violetBg, border: `1px solid ${C.violetBd}` }}>
                  <div style={{ fontSize: 10, color: C.mute, fontFamily: "var(--font-mono, monospace)" }}>ESCALATION DEPOSIT</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.violetFg, marginTop: 4 }}>${(s.amount * 0.05).toFixed(2)}</div>
                  <div style={{ fontSize: 10, color: C.emFg, marginTop: 2 }}>✓ Refunded (you won)</div>
                </div>
                <div style={{ padding: 10, borderRadius: 8, background: C.emBg, border: `1px solid ${C.emBd}` }}>
                  <div style={{ fontSize: 10, color: C.mute, fontFamily: "var(--font-mono, monospace)" }}>RULING</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.emFg, marginTop: 4 }}>Buyer wins</div>
                  <div style={{ fontSize: 10, color: C.mute, marginTop: 2 }}>Full refund · seller trust −15</div>
                </div>
              </div>
              <Btn full onClick={() => onDispute("resolved_buyer")} icon={<Ic.check size={14} />}>
                Accept T2 ruling · receive refund
              </Btn>
              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                <Link href="/demo/dispute/panel" target="_blank" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: C.amberBg, border: `1px solid ${C.amberBd}`, fontSize: 11, fontWeight: 600, color: C.amberFg, textDecoration: "none" }}>
                  ⚖️ Panel view →
                </Link>
                <Link href="/demo/dispute/reviewer" target="_blank" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: C.emBg, border: `1px solid ${C.emBd}`, fontSize: 11, fontWeight: 600, color: C.emFg, textDecoration: "none" }}>
                  👤 Reviewer view →
                </Link>
              </div>
              <Api method="POST" ep="/disputes/:id/resolve · outcome: buyer_favor" />
            </Card>
          )}

          {/* Step 4: Resolution result */}
          {(disputeMode === "resolved_buyer" || disputeMode === "resolved_partial" || disputeMode === "resolved_seller") && (
            <Card accent={disputeMode === "resolved_buyer" ? "em" : disputeMode === "resolved_partial" ? "amber" : undefined} style={{ marginBottom: 14, textAlign: "center", padding: 28 }}>
              <div style={{
                width: 52, height: 52, margin: "0 auto 14px", borderRadius: "50%",
                background: disputeMode === "resolved_buyer" ? C.emBg : disputeMode === "resolved_partial" ? C.amberBg : C.card2,
                border: `2px solid ${disputeMode === "resolved_buyer" ? C.emBd : disputeMode === "resolved_partial" ? C.amberBd : C.line}`,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24,
              }}>
                {disputeMode === "resolved_buyer" ? "↩️" : disputeMode === "resolved_partial" ? "⚖️" : "✅"}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                {disputeMode === "resolved_buyer" && "Buyer wins · full refund"}
                {disputeMode === "resolved_partial" && "Partial refund · $50.00"}
                {disputeMode === "resolved_seller" && "Seller wins · funds released"}
              </div>
              <div style={{ fontSize: 12, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>
                {disputeMode === "resolved_buyer" && `$${s.amount.toFixed(2)} returned to buyer wallet. Seller trust score decreased.`}
                {disputeMode === "resolved_partial" && `Buyer keeps the item + receives $50.00 refund. Seller receives $${(sel - 50).toFixed(2)} (original $${sel.toFixed(2)} − $50). Haggle fee $${hf.toFixed(2)} unchanged.`}
                {disputeMode === "resolved_seller" && `$${sel.toFixed(2)} released to seller wallet. Dispute deposit returned.`}
              </div>
              <div style={{ fontSize: 11, color: C.violetFg, marginTop: 8, fontFamily: "var(--font-mono, monospace)" }}>
                Evidence anchored on-chain · HaggleDisputeRegistry
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 6, justifyContent: "center" }}>
                <Link href="/demo/dispute" target="_blank" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: C.card2, border: `1px solid ${C.line}`, fontSize: 11, fontWeight: 600, color: C.dim, textDecoration: "none" }}>
                  View all dispute perspectives →
                </Link>
              </div>
              <Api method="POST" ep="/disputes/:id/resolve" />
            </Card>
          )}
        </>
      )}

      {/* ── Final actions ── */}
      {((phase === "complete" || phase === "done") || (phase === "dispute" && (disputeMode === "resolved_buyer" || disputeMode === "resolved_partial" || disputeMode === "resolved_seller"))) && (
        <Row justify="flex-end" gap={10}>
          <Btn v="secondary" onClick={reset} icon={<Ic.restart size={14} />}>
            Run demo again
          </Btn>
        </Row>
      )}
    </div>
  );
};

/* ===== on-chain diagram ===== */
const DN = ({
  x,
  y,
  w,
  h,
  lbl,
  sub,
  tone,
  ic,
  big,
  small: _small,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  lbl: string;
  sub: string;
  tone: "slate" | "cyan" | "violet" | "em";
  ic: "wallet" | "shield" | "card" | "flame";
  big?: boolean;
  small?: boolean;
}) => {
  const cs = {
    slate: {
      f: C.dim,
      b: "rgba(20,20,26,0.04)",
      d: "rgba(20,20,26,0.15)",
    },
    cyan: { f: C.cyanFg, b: C.cyanBg, d: C.cyanBd },
    violet: { f: C.violetFg, b: C.violetBg, d: C.violetBd },
    em: { f: C.emFg, b: C.emBg, d: C.emBd },
  }[tone];
  const ps: Record<string, string> = {
    wallet: "M3 6h18v13H3zM3 10h18M16 14h3",
    shield:
      "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z",
    card: "M3 6h18v12H3zM3 10h18",
    flame: "M12 3s5 4 5 9a5 5 0 01-10 0c0-2 1-3 2-4",
  };
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={12}
        fill={cs.b}
        stroke={cs.d}
        strokeWidth={big ? 1.6 : 1}
      />
      {big && (
        <rect
          x={x - 3}
          y={y - 3}
          width={w + 6}
          height={h + 6}
          rx={14}
          fill="none"
          stroke={cs.d}
          strokeWidth={0.5}
          strokeDasharray="4 4"
        />
      )}
      <g
        transform={`translate(${x + 12}, ${y + 14})`}
        fill="none"
        stroke={cs.f}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ps[ic]} />
      </g>
      <text
        x={x + 46}
        y={y + 24}
        fill={cs.f}
        fontSize={_small ? 11 : 12.5}
        fontWeight="600"
        fontFamily="Inter, sans-serif"
      >
        {lbl}
      </text>
      <text
        x={x + 46}
        y={y + 40}
        fill="rgba(61,61,69,0.78)"
        fontSize={11}
        fontFamily="JetBrains Mono, monospace"
      >
        {sub}
      </text>
    </g>
  );
};

const EE = ({
  d,
  tone,
  lbl,
  lx,
  ly,
  flow,
}: {
  d: string;
  tone: "cyan" | "violet" | "em" | "slate";
  lbl?: string;
  lx?: number;
  ly?: number;
  flow: boolean;
}) => {
  const g =
    tone === "cyan"
      ? "url(#eCy)"
      : tone === "violet"
        ? "url(#eVi)"
        : tone === "em"
          ? "url(#eEm)"
          : "rgba(20,20,26,0.3)";
  const cs: Record<string, string> = {
    cyan: C.cyanFg,
    violet: C.violetFg,
    em: C.emFg,
    slate: C.dim,
  };
  return (
    <g>
      <path d={d} fill="none" stroke={g} strokeWidth={1.8} />
      {flow && (
        <path
          d={d}
          fill="none"
          stroke={cs[tone]}
          strokeWidth={2.2}
          strokeDasharray="4 36"
          strokeLinecap="round"
          style={{ animation: "haggle-dash 1.6s linear infinite" }}
        />
      )}
      {lbl && lx !== undefined && ly !== undefined && (
        <text
          x={lx}
          y={ly}
          fill={cs[tone]}
          fontSize="11"
          fontFamily="JetBrains Mono, monospace"
          textAnchor="middle"
        >
          {lbl}
        </text>
      )}
    </g>
  );
};

const OnChain = ({
  s,
  settling,
  curStep,
  disputeMode,
}: {
  s: SessionState;
  settling: boolean;
  curStep: number;
  disputeMode: DisputeMode;
}) => {
  const hf = s.amount * 0.015;
  const sf = s.rail === "stripe" ? s.amount * 0.015 : 0;
  const sel = s.amount - hf;
  const buyerT = s.amount + sf;
  const inDispute = !!disputeMode;
  const isResolved = disputeMode === "resolved_buyer" || disputeMode === "resolved_partial" || disputeMode === "resolved_seller";
  // Flow animation: stop when disputed (frozen), resume when resolved
  const flow = (settling || curStep >= 4) && (!inDispute || isResolved);
  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${C.line}`,
        background: `linear-gradient(180deg, rgba(8,145,178,0.02), rgba(124,58,237,0.02) 50%, #fff)`,
        padding: 22,
      }}
    >
      <Row justify="space-between" style={{ marginBottom: 18 }} wrap gap={10}>
        <div>
          <div
            style={{
              fontSize: 10.5,
              color: C.mute,
              letterSpacing: "0.16em",
              marginBottom: 4,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            ON-CHAIN SETTLEMENT
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            HaggleSettlementRouter · atomic USDC split
          </div>
        </div>
        <Row gap={8}>
          <Badge tone="violet" subtle>
            Base L2
          </Badge>
          <Badge tone="slate" subtle>
            <span
              style={{
                color: C.dim,
                fontSize: 10,
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              0x4E3A…B7c1
            </span>
          </Badge>
          <Badge tone="em" subtle icon={<Ic.lock size={10} />}>
            Non-custodial
          </Badge>
        </Row>
      </Row>
      <svg
        viewBox="0 0 900 240"
        style={{ width: "100%", height: "auto", maxHeight: 260 }}
      >
        <defs>
          <linearGradient id="eCy" x1="0" x2="1">
            <stop offset="0" stopColor="rgba(8,145,178,0.15)" />
            <stop offset="0.5" stopColor="rgba(8,145,178,0.7)" />
            <stop offset="1" stopColor="rgba(8,145,178,0.15)" />
          </linearGradient>
          <linearGradient id="eVi" x1="0" x2="1">
            <stop offset="0" stopColor="rgba(124,58,237,0.15)" />
            <stop offset="0.5" stopColor="rgba(124,58,237,0.7)" />
            <stop offset="1" stopColor="rgba(124,58,237,0.15)" />
          </linearGradient>
          <linearGradient id="eEm" x1="0" x2="1">
            <stop offset="0" stopColor="rgba(5,150,105,0.15)" />
            <stop offset="0.5" stopColor="rgba(5,150,105,0.7)" />
            <stop offset="1" stopColor="rgba(5,150,105,0.15)" />
          </linearGradient>
        </defs>
        {s.rail === "x402" ? (
          <>
            <DN
              x={40}
              y={100}
              w={150}
              h={80}
              lbl="Buyer Wallet"
              sub="0xBu7e…a12C"
              tone="slate"
              ic="wallet"
            />
            <DN
              x={360}
              y={80}
              w={180}
              h={120}
              lbl="Settlement Router"
              sub="executeSettlement()"
              tone="violet"
              big
              ic="shield"
            />
            <DN
              x={700}
              y={30}
              w={160}
              h={66}
              lbl="Seller Wallet"
              sub={`$${sel.toFixed(2)}`}
              tone="em"
              ic="wallet"
            />
            <DN
              x={700}
              y={160}
              w={160}
              h={66}
              lbl="Haggle Fee"
              sub={`$${hf.toFixed(2)}`}
              tone="cyan"
              ic="flame"
            />
            <EE
              d="M 190 140 C 270 140, 300 140, 360 140"
              tone="slate"
              lbl={`USDC $${s.amount.toFixed(2)}`}
              lx={275}
              ly={132}
              flow={flow}
            />
            <EE
              d="M 540 125 C 620 120, 640 70, 700 63"
              tone="em"
              lbl={`$${sel.toFixed(2)}`}
              lx={615}
              ly={87}
              flow={flow}
            />
            <EE
              d="M 540 160 C 620 170, 640 190, 700 193"
              tone="cyan"
              lbl={`$${hf.toFixed(2)}`}
              lx={615}
              ly={190}
              flow={flow}
            />
          </>
        ) : (
          <>
            <DN
              x={20}
              y={100}
              w={130}
              h={80}
              lbl="Buyer Card"
              sub={`$${buyerT.toFixed(2)}`}
              tone="slate"
              ic="card"
            />
            <DN
              x={200}
              y={100}
              w={140}
              h={80}
              lbl="Stripe Onramp"
              sub="USD → USDC"
              tone="violet"
              ic="card"
            />
            <DN
              x={395}
              y={20}
              w={120}
              h={50}
              lbl="Stripe retains"
              sub={`$${sf.toFixed(2)}`}
              tone="violet"
              ic="flame"
              small
            />
            <DN
              x={395}
              y={120}
              w={160}
              h={90}
              lbl="Settlement Router"
              sub="atomic split"
              tone="violet"
              ic="shield"
            />
            <DN
              x={700}
              y={70}
              w={160}
              h={66}
              lbl="Seller"
              sub={`$${sel.toFixed(2)}`}
              tone="em"
              ic="wallet"
            />
            <DN
              x={700}
              y={170}
              w={160}
              h={66}
              lbl="Haggle Fee"
              sub={`$${hf.toFixed(2)}`}
              tone="cyan"
              ic="flame"
            />
            <EE
              d="M 150 140 C 175 140, 180 140, 200 140"
              tone="slate"
              lbl={`$${buyerT.toFixed(2)}`}
              lx={175}
              ly={132}
              flow={flow}
            />
            <EE
              d="M 340 125 C 365 90, 380 60, 395 46"
              tone="violet"
              lbl="fee"
              lx={360}
              ly={82}
              flow={flow}
            />
            <EE
              d="M 340 155 C 365 160, 380 165, 395 165"
              tone="violet"
              lbl={`$${s.amount.toFixed(2)}`}
              lx={365}
              ly={180}
              flow={flow}
            />
            <EE
              d="M 555 150 C 620 150, 640 105, 700 103"
              tone="em"
              lbl={`$${sel.toFixed(2)}`}
              lx={620}
              ly={122}
              flow={flow}
            />
            <EE
              d="M 555 180 C 620 190, 640 200, 700 203"
              tone="cyan"
              lbl={`$${hf.toFixed(2)}`}
              lx={620}
              ly={210}
              flow={flow}
            />
          </>
        )}
      </svg>
      {/* ── Fund lifecycle — always-visible overview ── */}
      {(() => {
        const buf = WEIGHT_TIERS[0].buffer;
        const prodAmt = sel - buf;

        // Resolved states
        const isResolved = disputeMode === "resolved_buyer" || disputeMode === "resolved_partial" || disputeMode === "resolved_seller";

        // Define all lifecycle nodes — changes in dispute
        const nodes = inDispute ? [
          { id: "buyer", icon: "💰", label: "Buyer", sub: `$${(s.amount + sf).toFixed(2)}`, col: C.dim },
          { id: "lock", icon: "🔒", label: "Locked", sub: "Router", col: C.violetFg },
          { id: "split", icon: "⚡", label: "Split", sub: "Atomic", col: C.cyanFg },
          { id: "freeze", icon: "🛑", label: "Frozen", sub: "Disputed", col: C.redFg },
          { id: "resolve", icon: "⚖️", label: "Resolve", sub: isResolved ? "Done" : "Pending", col: isResolved ? C.emFg : C.amberFg },
          { id: "result", icon: isResolved ? (disputeMode === "resolved_buyer" ? "↩️" : disputeMode === "resolved_partial" ? "⚖️" : "✅") : "❓", label: isResolved ? (disputeMode === "resolved_buyer" ? "Refunded" : disputeMode === "resolved_partial" ? "Split" : "Released") : "Pending", sub: isResolved ? "Complete" : "—", col: isResolved ? C.emFg : C.faint },
        ] : [
          { id: "buyer", icon: "💰", label: "Buyer", sub: `$${(s.amount + sf).toFixed(2)}`, col: C.dim },
          { id: "lock", icon: "🔒", label: "Locked", sub: "Router", col: C.violetFg },
          { id: "split", icon: "⚡", label: "Split", sub: "Atomic", col: C.cyanFg },
          { id: "ship", icon: "📦", label: "Shipping", sub: "In transit", col: C.dim },
          { id: "review", icon: "⏳", label: "Review", sub: "24h", col: C.emFg },
          { id: "done", icon: "✅", label: "Released", sub: "Seller paid", col: C.emFg },
        ];

        // Map curStep to active node index
        const activeIdx = inDispute
          ? (isResolved ? 5 : disputeMode === "t1" || disputeMode === "t2" ? 4 : 3)
          : curStep <= 2 ? 0 : curStep === 3 ? 0 : curStep === 4 ? (settling ? 1 : 2) : curStep === 5 ? 3 : curStep >= 6 ? 4 : 0;
        const doneIdx = inDispute
          ? (isResolved ? 4 : disputeMode === "t1" || disputeMode === "t2" ? 3 : 2)
          : curStep <= 2 ? -1 : curStep === 3 ? -1 : curStep === 4 ? (settling ? 0 : 1) : curStep === 5 ? 2 : curStep >= 6 ? 3 : -1;

        return (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px dashed ${C.line}` }}>

            {/* Always-visible lifecycle bar */}
            <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${nodes.length}, 1fr)`, gap: 0, marginBottom: 16 }}>
              {/* connector */}
              <div style={{ position: "absolute", top: 18, left: "8%", right: "8%", height: 2, background: C.line, zIndex: 0 }} />
              <div style={{ position: "absolute", top: 18, left: "8%", height: 2, zIndex: 1, background: inDispute ? `linear-gradient(90deg, ${C.cyanFg}, ${C.redFg})` : `linear-gradient(90deg, ${C.cyanFg}, ${C.em})`, width: `${Math.max(0, (doneIdx / (nodes.length - 1)) * 100)}%`, transition: "width 0.6s" }} />

              {nodes.map((n, i) => {
                const done = i <= doneIdx;
                const active = i === activeIdx;
                return (
                  <div key={n.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", zIndex: 2 }}>
                    <div className={active ? "pulse-ring" : ""} style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: done ? C.emBg : active ? C.cyanBg : C.card,
                      border: `2px solid ${done ? C.emBd : active ? C.cyanBd : C.line}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: done ? 14 : 16, transition: "all 0.3s",
                    }}>
                      {done ? <Ic.check size={14} color={C.emFg} sw={2.5} /> : n.icon}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: done ? C.emFg : active ? C.cyanFg : C.mute, marginTop: 6 }}>{n.label}</div>
                    <div style={{ fontSize: 9, color: C.faint, fontFamily: "var(--font-mono, monospace)" }}>{n.sub}</div>
                  </div>
                );
              })}
            </div>

            {/* Current state detail card */}
            <div style={{ borderRadius: 10, border: `1px solid ${C.line}`, overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", background: C.card2, borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", color: C.mute, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  {inDispute ? (isResolved ? "Dispute resolved" : "Funds frozen · dispute active") : curStep < 4 ? "Awaiting payment" : curStep === 4 ? "Settlement executing" : curStep === 5 ? "Awaiting delivery" : "Buyer review period"}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["EIP-712", "Non-custodial", "Atomic"] as const).map((t) => (
                    <span key={t} style={{ padding: "2px 6px", borderRadius: 4, background: C.card2, border: `1px solid ${C.line}`, fontSize: 9, color: C.mute, fontFamily: "var(--font-mono, monospace)" }}>{t}</span>
                  ))}
                </div>
              </div>
              <div style={{ padding: 14 }}>

                {/* Amount distribution bar — always visible, changes per step */}
                <div style={{ display: "flex", height: 36, borderRadius: 8, overflow: "hidden", border: `1px solid ${inDispute && !isResolved ? C.redBd : C.line}`, marginBottom: 12 }}>
                  {/* Dispute: frozen bar */}
                  {inDispute && !isResolved && (
                    <div style={{ width: "100%", background: `repeating-linear-gradient(45deg, ${C.redBg}, ${C.redBg} 6px, rgba(220,38,38,0.14) 6px, rgba(220,38,38,0.14) 12px)`, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.redFg }}>🛑 ${sel.toFixed(2)} FROZEN · dispute in progress</span>
                    </div>
                  )}
                  {/* Dispute resolved: buyer refund */}
                  {disputeMode === "resolved_buyer" && (
                    <>
                      <div style={{ flex: 1, background: C.emBg, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: C.emFg }}>↩️ ${s.amount.toFixed(2)} → buyer refund</span>
                      </div>
                    </>
                  )}
                  {/* Dispute resolved: partial — buyer keeps item + gets refund from seller portion */}
                  {disputeMode === "resolved_partial" && (
                    <>
                      <div style={{ width: "12%", background: C.amberBg, display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                        <span style={{ fontSize: 9, fontWeight: 600, color: C.amberFg }}>↩️ $50</span>
                      </div>
                      <div style={{ flex: 1, background: C.emBg, display: "flex", alignItems: "center", paddingLeft: 10, gap: 4, borderLeft: `1px solid ${C.line}` }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: C.emFg }}>${(sel - 50).toFixed(2)} → seller</span>
                      </div>
                      <div style={{ width: 60, background: C.cyanBg, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: `1px solid ${C.line}` }}>
                        <span style={{ fontSize: 9, fontWeight: 600, color: C.cyanFg }}>${hf.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  {/* Dispute resolved: seller wins */}
                  {disputeMode === "resolved_seller" && (
                    <>
                      <div style={{ flex: 1, background: C.emBg, display: "flex", alignItems: "center", paddingLeft: 10, gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: C.emFg }}>✅ ${sel.toFixed(2)} → seller released</span>
                      </div>
                      <div style={{ width: 60, background: C.cyanBg, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: `1px solid ${C.line}` }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: C.cyanFg }}>${hf.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                  {/* Normal flow (no dispute) */}
                  {!inDispute && curStep < 4 && (
                    <div style={{ width: "100%", background: C.card2, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: C.dim }}>💰 <strong>${s.amount.toFixed(2)}</strong> in buyer wallet</span>
                    </div>
                  )}
                  {!inDispute && curStep === 4 && (
                    <div style={{ width: "100%", background: `repeating-linear-gradient(45deg, ${C.violetBg}, ${C.violetBg} 6px, rgba(124,58,237,0.14) 6px, rgba(124,58,237,0.14) 12px)`, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.violetFg }}>🔒 ${s.amount.toFixed(2)} in Settlement Router</span>
                    </div>
                  )}
                  {!inDispute && curStep >= 5 && (
                    <>
                      <div style={{ flex: 1, background: curStep >= 6 ? C.emBg : `repeating-linear-gradient(45deg, ${C.emBg}, ${C.emBg} 6px, rgba(5,150,105,0.14) 6px, rgba(5,150,105,0.14) 12px)`, display: "flex", alignItems: "center", paddingLeft: 10, gap: 4 }}>
                        <span style={{ fontSize: 10 }}>{curStep >= 6 ? "⏳" : "🔒"}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: C.emFg }}>${prodAmt.toFixed(2)}</span>
                      </div>
                      <div style={{ width: 70, background: C.violetBg, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: `1px solid ${C.line}`, gap: 3 }}>
                        <span style={{ fontSize: 9 }}>🔒</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: C.violetFg }}>${buf.toFixed(2)}</span>
                      </div>
                      <div style={{ width: 60, background: C.cyanBg, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: `1px solid ${C.line}` }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: C.cyanFg }}>${hf.toFixed(2)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Release schedule — after delivery, normal path only */}
                {!inDispute && curStep >= 6 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                    <div style={{ padding: 10, borderRadius: 8, background: C.emBg, border: `1px solid ${C.emBd}` }}>
                      <div style={{ fontSize: 9, fontFamily: "var(--font-mono, monospace)", color: C.emFg, fontWeight: 600, marginBottom: 4 }}>PHASE 1 · 24H</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.emFg }}>${prodAmt.toFixed(2)}</div>
                      <div style={{ fontSize: 9.5, color: C.mute, marginTop: 3 }}>Buyer confirm or auto → seller</div>
                    </div>
                    <div style={{ padding: 10, borderRadius: 8, background: C.violetBg, border: `1px solid ${C.violetBd}` }}>
                      <div style={{ fontSize: 9, fontFamily: "var(--font-mono, monospace)", color: C.violetFg, fontWeight: 600, marginBottom: 4 }}>PHASE 2 · 14D</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.violetFg }}>${buf.toFixed(2)}</div>
                      <div style={{ fontSize: 9.5, color: C.mute, marginTop: 3 }}>Weight APV check → seller (adj.)</div>
                    </div>
                    <div style={{ padding: 10, borderRadius: 8, background: C.cyanBg, border: `1px solid ${C.cyanBd}` }}>
                      <div style={{ fontSize: 9, fontFamily: "var(--font-mono, monospace)", color: C.cyanFg, fontWeight: 600, marginBottom: 4 }}>FEE · COLLECTED</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.cyanFg }}>${hf.toFixed(2)}</div>
                      <div style={{ fontSize: 9.5, color: C.mute, marginTop: 3 }}>1.5% → Haggle treasury</div>
                    </div>
                  </div>
                )}

                {/* ── Dispute path — what happens to money if disputed ── */}
                {curStep >= 6 && (
                  <div style={{ borderRadius: 8, border: `1px solid ${C.redBd}`, overflow: "hidden" }}>
                    <div style={{ padding: "8px 12px", background: C.redBg, display: "flex", alignItems: "center", gap: 8 }}>
                      <Ic.alert size={13} color={C.redFg} />
                      <span style={{ fontSize: 10, fontWeight: 600, color: C.redFg, fontFamily: "var(--font-mono, monospace)", textTransform: "uppercase", letterSpacing: "0.08em" }}>If disputed</span>
                    </div>
                    <div style={{ padding: "10px 12px" }}>
                      {/* Dispute flow as horizontal steps */}
                      <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
                        {([
                          { icon: "🛑", label: "Freeze", sub: "All funds held", col: C.redFg },
                          { icon: "📋", label: "T1 Auto", sub: "Trust-based", col: C.amberFg },
                          { icon: "👥", label: "T2 Panel", sub: "DS review", col: C.violetFg },
                          { icon: "⚖️", label: "T3 Arbitration", sub: "Final ruling", col: C.dim },
                        ] as const).map((d, i) => (
                          <React.Fragment key={d.label}>
                            {i > 0 && <div style={{ width: 20, height: 1, background: C.line2, flexShrink: 0 }} />}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 6, background: C.card2, border: `1px solid ${C.line}`, flexShrink: 0 }}>
                              <span style={{ fontSize: 13 }}>{d.icon}</span>
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 600, color: d.col }}>{d.label}</div>
                                <div style={{ fontSize: 8.5, color: C.mute }}>{d.sub}</div>
                              </div>
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                      {/* Resolution outcomes */}
                      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                        <div style={{ padding: "6px 8px", borderRadius: 6, background: C.emBg, border: `1px solid ${C.emBd}`, textAlign: "center" }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: C.emFg, fontFamily: "var(--font-mono, monospace)" }}>BUYER WINS</div>
                          <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>${s.amount.toFixed(2)} → buyer refund</div>
                        </div>
                        <div style={{ padding: "6px 8px", borderRadius: 6, background: C.amberBg, border: `1px solid ${C.amberBd}`, textAlign: "center" }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: C.amberFg, fontFamily: "var(--font-mono, monospace)" }}>PARTIAL</div>
                          <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>Split by ruling amount</div>
                        </div>
                        <div style={{ padding: "6px 8px", borderRadius: 6, background: C.card2, border: `1px solid ${C.line}`, textAlign: "center" }}>
                          <div style={{ fontSize: 9, fontWeight: 600, color: C.dim, fontFamily: "var(--font-mono, monospace)" }}>SELLER WINS</div>
                          <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>${sel.toFixed(2)} → seller release</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* tx info */}
                {curStep >= 5 && (
                  <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, fontSize: 10, fontFamily: "var(--font-mono, monospace)", color: C.mute }}>
                    <span>tx <span style={{ color: C.dim }}>0x8f2a…b7c1</span></span>
                    <span>block <span style={{ color: C.dim }}>12,483,917</span></span>
                    <span>gas <span style={{ color: C.emFg }}>$0.00</span></span>
                    <span>chain <span style={{ color: C.violetFg }}>Base L2</span></span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── DisputeRegistry — compact (appears after delivery) ── */}
      {curStep >= 6 && (
        <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <Row gap={10}>
            <Ic.shield size={16} color={C.mute} />
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.dim }}>HaggleDisputeRegistry</span>
              <span style={{ fontSize: 11, color: C.mute, marginLeft: 8 }}>On-chain evidence anchoring · standby</span>
            </div>
          </Row>
          <div style={{ display: "flex", gap: 6 }}>
            {(["anchorDispute", "supersede", "revoke"] as const).map((fn) => (
              <span key={fn} style={{ padding: "3px 8px", borderRadius: 5, background: C.card2, border: `1px solid ${C.line}`, fontSize: 10, fontFamily: "var(--font-mono, monospace)", color: C.mute }}>{fn}()</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ===== types ===== */
interface SessionState {
  amount: number;
  rail: string;
  item: string;
}

interface LogEntry {
  t: string;
  act: string;
  ep: string;
  id: string;
}

/* ===== steps config ===== */
const STEPS = [
  { k: "rail", lbl: "Rail select", ep: "—" },
  { k: "prepare", lbl: "Prepare", ep: "/payments/prepare" },
  { k: "quote", lbl: "Quote", ep: "/payments/:id/quote" },
  { k: "authorize", lbl: "Authorize", ep: "/payments/:id/authorize" },
  { k: "settle", lbl: "Settle", ep: "/payments/:id/settle" },
  { k: "ship", lbl: "Ship", ep: "/shipments/:id/label" },
  { k: "delivered", lbl: "Delivered", ep: "/shipments/:id/event" },
];

const SHIP_SEQ = [
  "labelPending",
  "labelCreated",
  "inTransit",
  "outForDelivery",
  "delivered",
];

/* ===== main component ===== */
export default function CheckoutFlow({
  agreedPrice,
  itemTitle,
  rounds,
  onComplete,
}: CheckoutFlowProps) {
  const [rail, setRail] = useState("x402");
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const [settling, setSettling] = useState(false);
  const [shipSub, setShipSub] = useState("labelPending");
  const [disputeMode, setDisputeMode] = useState<false | "open" | "t1" | "t2" | "resolved_buyer" | "resolved_partial" | "resolved_seller">(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(true);
  const [auto, setAuto] = useState(false);
  const [autoSpeed] = useState(1.0);

  // Inject keyframes once
  useEffect(() => {
    const styleId = "haggle-checkout-keyframes";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = KEYFRAMES;
    document.head.appendChild(style);
    return () => {
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, []);

  const s: SessionState = {
    amount: agreedPrice,
    rail,
    item: itemTitle,
  };

  const addLog = useCallback(
    (act: string, ep: string) =>
      setLog((l) =>
        [
          {
            t: new Date().toLocaleTimeString("en-US", { hour12: false }),
            act,
            ep,
            id: Math.random().toString(36).slice(2, 8),
          },
          ...l,
        ].slice(0, 30)
      ),
    []
  );

  const md = useCallback(
    (i: number) => setDone((d) => (d.includes(i) ? d : [...d, i])),
    []
  );

  const next = useCallback(() => {
    const c = STEPS[idx];
    addLog(c.lbl, c.ep);
    md(idx);

    // Try real API call, fall back to mock transition
    if (c.k === "prepare") {
      api
        .post("/payments/prepare", {
          orderId: "ord_8f2ab7c1e4",
          amount: s.amount,
          rail: s.rail,
        })
        .catch(() => {
          /* demo mode: silent fallback */
        });
    }

    if (c.k === "authorize") {
      setIdx(4);
      setSettling(true);

      // Try real API
      api
        .post(`/payments/pi_8f2ab7c1/authorize`, {
          rail: s.rail,
          amount: s.amount,
        })
        .catch(() => {
          /* demo mode */
        });

      setTimeout(
        () => {
          setSettling(false);
          addLog("Settle executed", "/payments/:id/settle");
          md(4);
        },
        3200 / autoSpeed
      );
      return;
    }
    if (idx < 6) setIdx(idx + 1);
  }, [idx, addLog, md, s.amount, s.rail, autoSpeed]);

  const shipAct = useCallback(() => {
    const cur = SHIP_SEQ.indexOf(shipSub);
    const nx = cur + 1;
    const lb: Record<string, [string, string]> = {
      labelPending: ["Label created", "/shipments/:id/label"],
      labelCreated: ["Event: ship", "/shipments/:id/event"],
      inTransit: ["Event: out_for_delivery", "/shipments/:id/event"],
      outForDelivery: ["Event: deliver", "/shipments/:id/event"],
    };
    const entry = lb[shipSub];
    if (entry) addLog(entry[0], entry[1]);
    if (nx >= SHIP_SEQ.length - 1) {
      md(5);
      setIdx(6);
      setShipSub("delivered");
    } else {
      setShipSub(SHIP_SEQ[nx]);
    }
  }, [shipSub, addLog, md]);

  const reset = useCallback(() => {
    setIdx(0);
    setDone([]);
    setSettling(false);
    setShipSub("labelPending");
    setLog([]);
    setAuto(false);
  }, []);

  const jump = useCallback((i: number) => {
    setIdx(i);
    if (i < 6) setShipSub("labelPending");
  }, []);

  // Auto-play
  useEffect(() => {
    if (!auto) return;
    const to = setTimeout(
      () => {
        if (idx < 4) next();
        else if (idx === 4 && !settling && done.includes(4)) setIdx(5);
        else if (idx === 5) shipAct();
        else {
          setAuto(false);
          onComplete();
        }
      },
      settling ? 3400 / autoSpeed : 1200 / autoSpeed
    );
    return () => clearTimeout(to);
  }, [auto, idx, settling, shipSub, done, next, shipAct, autoSpeed, onComplete]);

  const renderStep = () => {
    const k = STEPS[idx].k;
    if (k === "rail")
      return <Step1 s={s} setRail={setRail} next={next} />;
    if (k === "prepare") return <Step2 s={s} next={next} />;
    if (k === "quote") return <Step3 s={s} next={next} />;
    if (k === "authorize")
      return s.rail === "x402" ? (
        <Step4x s={s} next={next} />
      ) : (
        <Step4s s={s} next={next} />
      );
    if (k === "settle")
      return (
        <Step5
          s={s}
          settling={settling}
          cont={() => {
            md(4);
            setIdx(5);
          }}
        />
      );
    if (k === "ship")
      return <Step6 s={s} sub={shipSub} act={shipAct} />;
    if (k === "delivered") return <Step7 s={s} reset={reset} disputeMode={disputeMode} onDispute={setDisputeMode} />;
    return null;
  };

  const cur = STEPS[idx];
  const market = 520;
  const saved = market - s.amount;

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100vh",
        padding: "22px clamp(16px, 3vw, 36px) 40px",
        color: C.ink,
        fontFamily:
          "var(--font-sans, 'Inter', system-ui, -apple-system, sans-serif)",
      }}
    >
      {/* grid background */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          backgroundImage:
            "linear-gradient(to right, rgba(20,20,26,0.03) 1px, transparent 1px), linear-gradient(to bottom, rgba(20,20,26,0.03) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at top, black 40%, transparent 90%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at top, black 40%, transparent 90%)",
        }}
      />

      {/* top bar */}
      <Row justify="space-between" style={{ marginBottom: 18 }} wrap gap={12}>
        <Row gap={12}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: `linear-gradient(135deg, ${C.cyan}, ${C.violet})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 15,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            H
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Haggle{" "}
              <span style={{ color: C.mute, fontWeight: 400 }}>
                · checkout
              </span>
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: C.faint,
                marginTop: 1,
                letterSpacing: "0.04em",
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              ord_8f2ab7c1e4 · pi_8f2ab7c1 · Base L2
            </div>
          </div>
        </Row>
        <Row gap={8}>
          <Btn
            v="ghost"
            size="sm"
            onClick={() => setAuto(!auto)}
            icon={
              auto ? <Ic.pause size={13} /> : <Ic.play size={13} />
            }
          >
            {auto ? "Pause demo" : "Auto-play demo"}
          </Btn>
          <Btn
            v="secondary"
            size="sm"
            onClick={reset}
            icon={<Ic.restart size={13} />}
          >
            Reset
          </Btn>
        </Row>
      </Row>

      {/* negotiation summary */}
      <Card style={{ padding: "18px 22px" }}>
        <Row justify="space-between" wrap gap={18}>
          <Row gap={16} style={{ flex: "1 1 320px", minWidth: 0 }}>
            <PS label="iPhone 14 Pro" size={64} />
            <div style={{ minWidth: 0 }}>
              <Row gap={8} style={{ marginBottom: 6 }}>
                <Badge tone="em" icon={<Ic.check size={10} sw={3} />}>
                  Negotiation accepted
                </Badge>
                <Badge tone="slate" subtle>
                  {rounds} rounds
                </Badge>
              </Row>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{s.item}</div>
              <div style={{ fontSize: 12, color: C.mute, marginTop: 4 }}>
                Swappa median{" "}
                <span
                  style={{
                    color: C.dim,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ${market}
                </span>{" "}
                · saved{" "}
                <span
                  style={{
                    color: C.emFg,
                    fontFamily:
                      "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ${saved.toFixed(0)}
                </span>
              </div>
            </div>
          </Row>
          <div
            style={{
              borderLeft: `1px solid ${C.line}`,
              paddingLeft: 22,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: C.mute,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              Agreed price
            </div>
            <Money value={s.amount} size={28} bold />
            <div
              style={{
                fontSize: 10.5,
                color: C.faint,
                marginTop: 2,
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              USD · settled in USDC
            </div>
          </div>
          <div
            style={{
              borderLeft: `1px solid ${C.line}`,
              paddingLeft: 22,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: C.mute,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              Current step
            </div>
            <Row gap={8} style={{ marginTop: 8 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: C.cyan,
                  animation:
                    "haggle-pulse 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
                }}
              />
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {cur.lbl}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: C.faint,
                  fontFamily:
                    "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                }}
              >
                {idx + 1}/{STEPS.length}
              </span>
            </Row>
            <div
              style={{
                fontSize: 10.5,
                color: C.faint,
                marginTop: 6,
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
              }}
            >
              {cur.ep !== "—" ? `next: ${cur.ep}` : "rail selection"}
            </div>
          </div>
        </Row>
      </Card>

      {/* main grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 280px)",
          gap: 18,
          marginTop: 18,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Card style={{ marginBottom: 18, padding: "18px 24px 14px" }}>
            <Timeline steps={STEPS} cur={idx} done={done} onJump={jump} />
          </Card>
          <Card style={{ padding: 28, minHeight: 540 }}>
            {renderStep()}
          </Card>
        </div>

        {/* activity log sidebar */}
        <div style={{ minWidth: 0 }}>
          <Card
            style={{
              padding: 0,
              overflow: "hidden",
              position: "sticky",
              top: 22,
            }}
          >
            <button
              onClick={() => setLogOpen(!logOpen)}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                padding: "14px 18px",
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                color: C.ink,
              }}
            >
              <Row gap={10}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: C.card2,
                    border: `1px solid ${C.line}`,
                    color: C.cyanFg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: C.cyanFg,
                    }}
                  />
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    Activity log
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: C.faint,
                      fontFamily:
                        "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                    }}
                  >
                    {log.length} API calls
                  </div>
                </div>
              </Row>
              <Ic.chev
                size={14}
                color={C.mute}
                style={{
                  transform: logOpen ? "none" : "rotate(-90deg)",
                  transition: "0.2s",
                }}
              />
            </button>
            {logOpen && (
              <div
                style={{
                  borderTop: `1px solid ${C.line}`,
                  maxHeight: 380,
                  overflowY: "auto",
                }}
              >
                {log.length === 0 ? (
                  <div
                    style={{
                      padding: "24px 18px",
                      textAlign: "center",
                      fontSize: 11,
                      color: C.faint,
                    }}
                  >
                    <span
                      style={{
                        fontFamily:
                          "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                      }}
                    >
                      No API calls yet — advance a step.
                    </span>
                  </div>
                ) : (
                  log.map((e) => (
                    <div
                      key={e.id}
                      style={{
                        padding: "10px 18px",
                        borderTop: `1px solid ${C.line}`,
                        fontSize: 11,
                        fontFamily:
                          "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
                        display: "grid",
                        gridTemplateColumns: "56px 12px 1fr",
                        gap: 8,
                        alignItems: "start",
                      }}
                    >
                      <span style={{ color: C.faint }}>{e.t}</span>
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          marginTop: 5,
                          background: C.emFg,
                        }}
                      />
                      <div>
                        <div
                          style={{
                            color: C.dim,
                            fontFamily:
                              "var(--font-sans, 'Inter', system-ui, sans-serif)",
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          {e.act}
                        </div>
                        <div
                          style={{
                            color: C.mute,
                            fontSize: 10.5,
                            marginTop: 1,
                          }}
                        >
                          {e.ep}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* on-chain diagram */}
      <div style={{ marginTop: 18 }}>
        <OnChain s={s} settling={settling} curStep={idx} disputeMode={disputeMode} />
      </div>

      {/* footer */}
      <Row
        justify="space-between"
        style={{ marginTop: 22, fontSize: 11, color: C.faint }}
        wrap
        gap={8}
      >
        <Row gap={16}>
          <span
            style={{
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            Haggle Protocol v0.9.2
          </span>
          <span>Non-custodial · Transparent · Buyer-protected</span>
        </Row>
        <Row gap={10}>
          <span
            style={{
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            Base L2 · ⛽ gas $0.00
          </span>
          <span
            style={{
              color: C.emFg,
              fontFamily:
                "var(--font-mono, 'JetBrains Mono', ui-monospace, Menlo, monospace)",
            }}
          >
            ● mainnet healthy
          </span>
        </Row>
      </Row>
    </div>
  );
}
