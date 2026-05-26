/**
 * Agent mascot SVGs. Rendered via dangerouslySetInnerHTML.
 * Static content — no XSS risk.
 */

export type AgentKey = "hugo" | "pepper" | "mochi" | "sage" | "olive";

export interface Agent {
  name: string;
  svg: string;
}

export const AGENTS: Record<AgentKey, Agent> = {
  hugo: {
    name: "Agent Hugo",
    svg: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="40" cy="48" rx="26" ry="28" fill="#DCAA5E"/>
      <ellipse cx="40" cy="22" rx="22" ry="8" fill="#9A6A24"/>
      <ellipse cx="40" cy="20" rx="22" ry="6" fill="#B8823E"/>
      <circle cx="52" cy="16" r="3" fill="#75501B"/>
      <path d="M28 42 L36 40" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round"/>
      <path d="M52 40 L44 42" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round"/>
      <circle cx="32" cy="48" r="2.5" fill="#1B2A4A"/>
      <circle cx="48" cy="48" r="2.5" fill="#1B2A4A"/>
      <ellipse cx="24" cy="56" rx="3" ry="2" fill="#C8412E" opacity="0.25"/>
      <ellipse cx="56" cy="56" rx="3" ry="2" fill="#C8412E" opacity="0.25"/>
      <path d="M36 60 L44 60" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
  },
  pepper: {
    name: "Agent Pepper",
    svg: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="40" cy="48" rx="26" ry="28" fill="#3E8E5A"/>
      <path d="M40 18 Q40 12, 36 10" stroke="#285F3D" stroke-width="2.5" stroke-linecap="round" fill="none"/>
      <ellipse cx="35" cy="8" rx="3" ry="4" fill="#3E8E5A" transform="rotate(-20 35 8)"/>
      <circle cx="30" cy="46" r="6" fill="none" stroke="#1B2A4A" stroke-width="1.8"/>
      <circle cx="50" cy="46" r="6" fill="none" stroke="#1B2A4A" stroke-width="1.8"/>
      <line x1="36" y1="46" x2="44" y2="46" stroke="#1B2A4A" stroke-width="1.8"/>
      <circle cx="30" cy="46" r="2" fill="#1B2A4A"/>
      <circle cx="50" cy="46" r="2" fill="#1B2A4A"/>
      <ellipse cx="22" cy="56" rx="3" ry="2" fill="#D69A4C" opacity="0.4"/>
      <ellipse cx="58" cy="56" rx="3" ry="2" fill="#D69A4C" opacity="0.4"/>
      <path d="M34 60 Q40 64, 46 60" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  mochi: {
    name: "Agent Mochi",
    svg: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="40" cy="50" rx="28" ry="26" fill="#F6E6CC"/>
      <ellipse cx="14" cy="44" rx="6" ry="7" fill="#F6E6CC" transform="rotate(-20 14 44)"/>
      <path d="M36 18 Q40 14, 44 18" stroke="#D69A4C" stroke-width="2.5" stroke-linecap="round" fill="none"/>
      <circle cx="40" cy="20" r="2" fill="#D69A4C"/>
      <path d="M28 48 Q32 44, 36 48" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round" fill="none"/>
      <path d="M44 48 Q48 44, 52 48" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round" fill="none"/>
      <ellipse cx="24" cy="56" rx="4" ry="3" fill="#E07A1F" opacity="0.4"/>
      <ellipse cx="56" cy="56" rx="4" ry="3" fill="#E07A1F" opacity="0.4"/>
      <path d="M34 60 Q40 66, 46 60" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  sage: {
    name: "Agent Sage",
    svg: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="40" cy="48" rx="26" ry="28" fill="#4F6088"/>
      <path d="M28 70 L40 60 L52 70 Z" fill="#FBF9F5"/>
      <path d="M40 60 L40 70" stroke="#1B2A4A" stroke-width="1.2"/>
      <circle cx="40" cy="64" r="2" fill="#D69A4C"/>
      <path d="M22 30 Q26 20, 40 18 Q54 20, 58 30 Q50 22, 40 24 Q30 22, 22 30 Z" fill="#1B2A4A"/>
      <path d="M28 46 L36 46" stroke="#FBF9F5" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M44 46 L52 46" stroke="#FBF9F5" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="32" cy="46" r="1.5" fill="#1B2A4A"/>
      <circle cx="48" cy="46" r="1.5" fill="#1B2A4A"/>
      <path d="M35 56 Q40 59, 45 56" stroke="#FBF9F5" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
  olive: {
    name: "Agent Olive",
    svg: `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="40" cy="50" rx="26" ry="26" fill="#A9A08D"/>
      <path d="M40 22 Q34 14, 28 16 Q32 22, 40 24" fill="#3E8E5A"/>
      <path d="M40 22 Q46 14, 52 16 Q48 22, 40 24" fill="#3E8E5A"/>
      <path d="M40 24 L40 16" stroke="#285F3D" stroke-width="1.5"/>
      <path d="M28 48 Q32 46, 36 48" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round" fill="none"/>
      <path d="M44 48 Q48 46, 52 48" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round" fill="none"/>
      <circle cx="32" cy="48" r="1.2" fill="#1B2A4A"/>
      <circle cx="48" cy="48" r="1.2" fill="#1B2A4A"/>
      <ellipse cx="22" cy="56" rx="3" ry="2" fill="#D69A4C" opacity="0.45"/>
      <ellipse cx="58" cy="56" rx="3" ry="2" fill="#D69A4C" opacity="0.45"/>
      <path d="M36 60 Q40 63, 44 60" stroke="#1B2A4A" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`,
  },
};
