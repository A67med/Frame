/** Serializable visual choices. Layout remains a separate, explicit compatibility contract. */
export type ThemeDesign = {
  composition: "standard" | "la-la-land";
  radius: number;
  density: number;
  headingScale: number;
  heading: "editorial" | "display" | "sans";
  surface: "solid" | "glass" | "gradient";
  elevation: "none" | "soft" | "glow";
  navigation: "line" | "pill" | "block";
};

export const DEFAULT_THEME_DESIGN: ThemeDesign = {
  composition: "standard",
  radius: 8,
  density: 1,
  headingScale: 1,
  heading: "editorial",
  surface: "solid",
  elevation: "none",
  navigation: "line",
};

export function normalizeThemeDesign(value: unknown): ThemeDesign {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const number = (key: "radius" | "density" | "headingScale", min: number, max: number) => {
    const v = input[key];
    return typeof v === "number" && Number.isFinite(v)
      ? Math.min(max, Math.max(min, v))
      : DEFAULT_THEME_DESIGN[key];
  };
  const choice = <K extends "heading" | "surface" | "elevation" | "navigation" | "composition">(
    key: K,
    values: readonly ThemeDesign[K][],
  ): ThemeDesign[K] =>
    values.includes(input[key] as ThemeDesign[K])
      ? (input[key] as ThemeDesign[K])
      : DEFAULT_THEME_DESIGN[key];
  return {
    composition: choice("composition", ["standard", "la-la-land"]),
    radius: number("radius", 0, 24),
    density: number("density", 0.8, 1.3),
    headingScale: number("headingScale", 0.85, 1.2),
    heading: choice("heading", ["editorial", "display", "sans"]),
    surface: choice("surface", ["solid", "glass", "gradient"]),
    elevation: choice("elevation", ["none", "soft", "glow"]),
    navigation: choice("navigation", ["line", "pill", "block"]),
  };
}

export function themeDesignTokens(value: unknown): Record<string, string> {
  const d = normalizeThemeDesign(value);
  return {
    "--frame-radius": `${d.radius}px`,
    "--frame-density": String(d.density),
    "--frame-heading-scale": String(d.headingScale),
    "--frame-display":
      d.heading === "sans"
        ? "var(--font-sans)"
        : d.heading === "display"
          ? "var(--font-display)"
          : '"Fraunces", "Iowan Old Style", Georgia, serif',
    "--frame-panel":
      d.surface === "glass"
        ? "color-mix(in srgb, var(--color-surface) 88%, transparent)"
        : d.surface === "gradient"
          ? "linear-gradient(135deg, var(--color-surface), color-mix(in srgb, var(--color-accent) 12%, var(--color-canvas)))"
          : "color-mix(in srgb, var(--color-surface) 72%, var(--color-canvas))",
    "--frame-blur": d.surface === "glass" ? "blur(16px)" : "none",
    "--frame-elevation":
      d.elevation === "soft"
        ? "0 12px 32px rgb(0 0 0 / 18%)"
        : d.elevation === "glow"
          ? "0 8px 32px color-mix(in srgb, var(--color-accent) 16%, transparent)"
          : "none",
    "--frame-nav-radius":
      d.navigation === "pill" ? "24px" : d.navigation === "block" ? "0px" : "6px",
    "--frame-nav-marker": d.navigation === "line" ? "3px" : "0px",
  };
}
