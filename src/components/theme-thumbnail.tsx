import type { CSSProperties } from "react";
import { FONT_PAIRS, type ThemePreset } from "@/lib/theme";
import { normalizeThemeDesign, themeDesignTokens } from "@/lib/theme-design";

/** A token-driven style diagram, never a screenshot of a different application layout. */
export function ThemeThumbnail({ theme }: { theme: ThemePreset }) {
  const design = normalizeThemeDesign(theme.design);
  const pair = FONT_PAIRS[theme.fontPair ?? "general-sans"];
  const style = {
    ...theme.tokens,
    ...themeDesignTokens(design),
    "--font-display": pair.display,
    "--font-sans": pair.sans,
    background: "var(--color-canvas)",
    color: "var(--color-ink)",
  } as CSSProperties;
  if (theme.layout === "frame" && design.composition === "la-la-land") {
    return (
      <svg aria-hidden="true" viewBox="0 0 320 180" className="h-full w-full" style={style}>
        <rect width="320" height="180" fill="var(--color-canvas)" />
        <path d="M0 17H320" stroke="var(--color-edge-soft)" />
        <text x="10" y="11" fontSize="7" fill="var(--color-ink)">
          Frame
        </text>
        <rect x="110" y="4" width="100" height="8" rx="4" fill="var(--color-surface)" />
        <text
          x="160"
          y="44"
          textAnchor="middle"
          fontSize="18"
          fontFamily="var(--font-display)"
          fontStyle="italic"
          fill="var(--color-ink)"
        >
          {theme.name}
        </text>
        <svg x="23" y="54" width="274" height="79" viewBox="0 0 274 79">
          <rect width="274" height="79" rx="4" fill="var(--color-elevated)" />
          <circle cx="201" cy="25" r="13" fill="var(--color-accent)" />
          <path d="M0 70 Q78 62 150 39 T274 34 V79 H0Z" fill="var(--color-raised)" />
          <path d="M0 76 Q65 48 124 59 T274 41 V79 H0Z" fill="var(--color-surface)" />
          <path d="M12 51h57m-57 5h37" stroke="var(--color-ink)" strokeWidth="2" />
          <rect x="12" y="64" width="26" height="6" rx="3" fill="var(--color-accent)" />
        </svg>
        <path d="M98 140h26m8 0h26m8 0h26m8 0h20" stroke="var(--color-ink-muted)" />
        <rect
          x="73"
          y="152"
          width="174"
          height="21"
          rx="9"
          fill="var(--color-surface)"
          stroke="var(--color-edge)"
        />
        <rect x="77" y="155" width="30" height="15" rx="6" fill="var(--color-elevated)" />
        {[82, 117, 152, 187].map((x, i) => (
          <g key={x} stroke={i === 0 ? "var(--color-accent)" : "var(--color-ink-muted)"}>
            <circle cx={x + 2} cy="162" r="2" fill="none" />
            <line x1={x + 7} x2={x + 18} y1="162" y2="162" />
          </g>
        ))}
        <path d="M219 157v11m7-6h10" stroke="var(--color-ink-muted)" />
      </svg>
    );
  }
  if (theme.id === "project-hail-mary") {
    return (
      <svg aria-hidden="true" viewBox="0 0 320 180" className="h-full w-full" style={style}>
        <rect width="320" height="180" fill="var(--color-canvas)" />
        <rect x="8" y="7" width="49" height="165" rx="14" fill="var(--color-surface)" />
        <text x="16" y="25" fontSize="10" fill="var(--color-accent)">
          Frame
        </text>
        {[39, 55, 71, 87, 103].map((y) => (
          <g key={y}>
            <circle cx="18" cy={y} r="3" fill="var(--color-accent)" />
            <path d={`M26 ${y}h21`} stroke="var(--color-ink-muted)" />
          </g>
        ))}
        <rect x="68" y="12" width="128" height="9" rx="5" fill="var(--color-elevated)" />
        <rect x="68" y="30" width="242" height="88" rx="10" fill="var(--color-elevated)" />
        <circle cx="262" cy="63" r="22" fill="var(--color-accent-soft)" />
        <text x="80" y="82" fontSize="15" fill="var(--color-ink)">
          Project Hail Mary
        </text>
        <rect x="80" y="94" width="35" height="10" rx="5" fill="var(--color-accent)" />
        {[68, 118, 168, 218, 268].map((x) => (
          <rect
            key={x}
            x={x}
            y="128"
            width="41"
            height="47"
            rx="5"
            fill="var(--color-surface)"
            stroke="var(--color-edge)"
          />
        ))}
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 320 180" className="h-full w-full" style={style}>
      <rect width="320" height="180" fill="var(--color-canvas)" />
      <path d="M28 0V180 M28 22H320" stroke="var(--color-edge)" />
      <path d="M10 8h8v3h-5v5h-3z" fill="var(--color-accent)" />
      {[34, 52, 70, 88, 106].map((y, i) => (
        <rect
          key={y}
          x="6"
          y={y}
          width="16"
          height="12"
          rx={design.navigation === "pill" ? 6 : 1}
          fill={i === 0 ? "var(--color-accent-soft)" : "var(--color-surface)"}
          stroke={i === 0 ? "var(--color-accent)" : "none"}
        />
      ))}
      <text x="39" y="15" fontSize="8" fontFamily="var(--font-sans)" fill="var(--color-ink)">
        Frame
      </text>
      <rect x="136" y="6" width="112" height="10" rx="5" fill="var(--color-elevated)" />
      <text
        x="39"
        y="47"
        fontFamily="var(--frame-display)"
        fontSize={16 * design.headingScale}
        fill="var(--color-ink)"
      >
        {theme.name}
      </text>
      <path d="M39 56H307" stroke="var(--color-edge)" />
      <rect
        x="39"
        y="65"
        width="197"
        height="64"
        rx={design.radius / 3}
        fill="var(--color-surface)"
      />
      <path d="M145 65L236 129H115z" fill="var(--color-elevated)" />
      <circle cx="199" cy="84" r="12" fill="var(--color-accent)" opacity="0.45" />
      <rect x="49" y="88" width="72" height="4" fill="var(--color-ink)" />
      <rect x="49" y="98" width="92" height="2" fill="var(--color-ink-muted)" />
      <rect
        x="49"
        y="110"
        width="28"
        height="10"
        rx={design.radius / 4}
        fill="var(--color-accent)"
      />
      {[67, 88, 109].map((y) => (
        <g key={y}>
          <path d={`M246 ${y}H306`} stroke="var(--color-edge)" />
          <rect x="246" y={y + 6} width="46" height="3" fill="var(--color-ink-muted)" />
        </g>
      ))}
      {[39, 95, 151, 207, 263].map((x) => (
        <g key={x}>
          <rect
            x={x}
            y="140"
            width="45"
            height="24"
            rx={design.radius / 3}
            fill="var(--color-elevated)"
          />
          <path d={`M${x} 171h32`} stroke="var(--color-ink-muted)" />
        </g>
      ))}
    </svg>
  );
}
