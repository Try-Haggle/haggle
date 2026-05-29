/**
 * Product icon SVGs for listing card thumbnails.
 * Rendered via dangerouslySetInnerHTML — static content, no XSS risk.
 */

export type IconKey =
  | "laptop"
  | "iphone"
  | "airpods"
  | "ipad"
  | "watch"
  | "gopro"
  | "headphones"
  | "macmini"
  | "switch"
  | "pixel"
  | "drone"
  | "kindle"
  | "steamdeck"
  | "camera";

export const ICONS: Record<IconKey, string> = {
  laptop: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="14" y="22" width="72" height="46" rx="4" fill="#1B2A4A"/>
      <rect x="18" y="26" width="64" height="38" rx="2" fill="#0F1830"/>
      <rect x="40" y="40" width="20" height="10" rx="1.5" fill="#4F6088" opacity="0.5"/>
      <rect x="8" y="68" width="84" height="6" rx="2" fill="#1B2A4A"/>
      <rect x="42" y="68" width="16" height="3" rx="1" fill="#0F1830"/>
    </svg>`,
  iphone: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="32" y="10" width="36" height="80" rx="7" fill="#1B2A4A" stroke="#4F6088" stroke-width="1"/>
      <rect x="35" y="15" width="30" height="70" rx="4" fill="#0F1830"/>
      <rect x="46" y="17" width="8" height="2" rx="1" fill="#16223C"/>
      <rect x="36" y="20" width="14" height="14" rx="3" fill="#16223C"/>
      <circle cx="40" cy="24" r="2" fill="#4F6088"/>
      <circle cx="46" cy="24" r="2" fill="#4F6088"/>
      <circle cx="40" cy="30" r="2" fill="#4F6088"/>
    </svg>`,
  airpods: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="22" y="36" width="56" height="32" rx="14" fill="#FFFDF9" stroke="#1B2A4A" stroke-width="1.5"/>
      <circle cx="36" cy="52" r="6" fill="#1B2A4A"/>
      <circle cx="64" cy="52" r="6" fill="#1B2A4A"/>
      <path d="M34 56 Q34 64, 32 70" stroke="#1B2A4A" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M66 56 Q66 64, 68 70" stroke="#1B2A4A" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`,
  ipad: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="10" width="60" height="80" rx="5" fill="#1B2A4A"/>
      <rect x="24" y="14" width="52" height="72" rx="2" fill="#0F1830"/>
      <rect x="40" y="40" width="20" height="20" rx="2" fill="#4F6088" opacity="0.4"/>
    </svg>`,
  watch: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="32" y="14" width="36" height="14" rx="3" fill="#1B2A4A"/>
      <rect x="32" y="72" width="36" height="14" rx="3" fill="#1B2A4A"/>
      <rect x="28" y="28" width="44" height="44" rx="9" fill="#0F1830"/>
      <rect x="32" y="32" width="36" height="36" rx="6" fill="#1B2A4A"/>
      <circle cx="50" cy="50" r="8" fill="#D69A4C" opacity="0.7"/>
      <rect x="72" y="42" width="4" height="6" rx="1" fill="#D69A4C"/>
    </svg>`,
  gopro: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="28" width="60" height="44" rx="4" fill="#1B2A4A"/>
      <rect x="20" y="28" width="60" height="8" fill="#0F1830"/>
      <circle cx="50" cy="52" r="14" fill="#0F1830" stroke="#4F6088" stroke-width="1.5"/>
      <circle cx="50" cy="52" r="9" fill="#1B2A4A"/>
      <circle cx="50" cy="52" r="5" fill="#080D1A"/>
      <circle cx="50" cy="52" r="1.5" fill="#D69A4C"/>
      <rect x="68" y="32" width="6" height="4" rx="1" fill="#D69A4C"/>
    </svg>`,
  headphones: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 56 Q20 24, 50 24 Q80 24, 80 56" stroke="#1B2A4A" stroke-width="4" fill="none" stroke-linecap="round"/>
      <rect x="14" y="50" width="14" height="26" rx="6" fill="#1B2A4A"/>
      <rect x="72" y="50" width="14" height="26" rx="6" fill="#1B2A4A"/>
      <rect x="17" y="56" width="8" height="14" rx="2" fill="#4F6088"/>
      <rect x="75" y="56" width="8" height="14" rx="2" fill="#4F6088"/>
    </svg>`,
  macmini: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mmg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.4"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect x="18" y="34" width="64" height="36" rx="5" fill="#1B2A4A"/>
      <rect x="18" y="34" width="64" height="36" rx="5" fill="url(#mmg)" opacity="0.4"/>
      <circle cx="68" cy="52" r="2.5" fill="#D69A4C"/>
      <circle cx="74" cy="52" r="2.5" fill="#4F6088"/>
      <rect x="22" y="40" width="3" height="3" rx="0.5" fill="#4F6088"/>
      <rect x="22" y="46" width="3" height="3" rx="0.5" fill="#4F6088"/>
    </svg>`,
  switch: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="14" y="30" width="72" height="40" rx="5" fill="#1B2A4A"/>
      <rect x="14" y="30" width="14" height="40" rx="5" fill="#C8412E"/>
      <rect x="72" y="30" width="14" height="40" rx="5" fill="#2E6FD6"/>
      <rect x="28" y="32" width="44" height="36" rx="2" fill="#0F1830"/>
      <circle cx="21" cy="42" r="2" fill="#FBF9F5" opacity="0.6"/>
      <circle cx="79" cy="58" r="2" fill="#FBF9F5" opacity="0.6"/>
    </svg>`,
  pixel: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="32" y="10" width="36" height="80" rx="7" fill="#0F1830" stroke="#4F6088" stroke-width="1"/>
      <rect x="35" y="15" width="30" height="70" rx="4" fill="#080D1A"/>
      <rect x="34" y="20" width="32" height="6" rx="2" fill="#16223C"/>
      <circle cx="42" cy="23" r="2" fill="#4F6088"/>
      <circle cx="50" cy="23" r="2" fill="#4F6088"/>
      <circle cx="58" cy="23" r="2" fill="#4F6088"/>
    </svg>`,
  drone: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="52" rx="14" ry="8" fill="#1B2A4A"/>
      <circle cx="22" cy="36" r="10" fill="none" stroke="#4F6088" stroke-width="1.5"/>
      <circle cx="78" cy="36" r="10" fill="none" stroke="#4F6088" stroke-width="1.5"/>
      <circle cx="22" cy="68" r="10" fill="none" stroke="#4F6088" stroke-width="1.5"/>
      <circle cx="78" cy="68" r="10" fill="none" stroke="#4F6088" stroke-width="1.5"/>
      <line x1="30" y1="42" x2="42" y2="48" stroke="#1B2A4A" stroke-width="2.5"/>
      <line x1="70" y1="42" x2="58" y2="48" stroke="#1B2A4A" stroke-width="2.5"/>
      <line x1="30" y1="62" x2="42" y2="56" stroke="#1B2A4A" stroke-width="2.5"/>
      <line x1="70" y1="62" x2="58" y2="56" stroke="#1B2A4A" stroke-width="2.5"/>
      <circle cx="50" cy="52" r="3" fill="#D69A4C"/>
    </svg>`,
  kindle: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="22" y="14" width="56" height="72" rx="4" fill="#4F4B40"/>
      <rect x="26" y="18" width="48" height="58" rx="2" fill="#FAF8F3"/>
      <line x1="32" y1="30" x2="68" y2="30" stroke="#9A9079" stroke-width="1"/>
      <line x1="32" y1="36" x2="62" y2="36" stroke="#9A9079" stroke-width="1"/>
      <line x1="32" y1="42" x2="68" y2="42" stroke="#9A9079" stroke-width="1"/>
      <line x1="32" y1="48" x2="58" y2="48" stroke="#9A9079" stroke-width="1"/>
      <line x1="32" y1="54" x2="65" y2="54" stroke="#9A9079" stroke-width="1"/>
    </svg>`,
  steamdeck: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 36 Q10 28, 18 28 L82 28 Q90 28, 90 36 L90 64 Q90 76, 78 76 Q70 76, 68 70 L32 70 Q30 76, 22 76 Q10 76, 10 64 Z" fill="#1B2A4A"/>
      <rect x="28" y="34" width="44" height="32" rx="3" fill="#0F1830"/>
      <circle cx="20" cy="50" r="4" fill="#4F6088"/>
      <circle cx="80" cy="50" r="4" fill="#4F6088"/>
      <rect x="16" y="38" width="3" height="3" fill="#4F6088"/>
      <rect x="22" y="38" width="3" height="3" fill="#4F6088"/>
      <circle cx="78" cy="40" r="1.5" fill="#D69A4C"/>
      <circle cx="84" cy="40" r="1.5" fill="#4F6088"/>
    </svg>`,
  camera: `
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="14" y="32" width="72" height="46" rx="4" fill="#1B2A4A"/>
      <rect x="14" y="32" width="72" height="10" fill="#0F1830"/>
      <rect x="34" y="26" width="32" height="10" rx="2" fill="#16223C"/>
      <circle cx="50" cy="58" r="16" fill="#0F1830" stroke="#D69A4C" stroke-width="2"/>
      <circle cx="50" cy="58" r="10" fill="#1B2A4A"/>
      <circle cx="50" cy="58" r="5" fill="#080D1A"/>
      <circle cx="50" cy="58" r="1.5" fill="#D69A4C"/>
      <rect x="70" y="46" width="8" height="5" rx="1" fill="#D69A4C"/>
      <rect x="20" y="46" width="8" height="3" rx="1" fill="#FBF9F5" opacity="0.4"/>
    </svg>`,
};
