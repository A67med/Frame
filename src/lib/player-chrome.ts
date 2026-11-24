import {
  getActiveProfile,
  updateActiveProfileConfig,
  type SaveResult,
} from "./player-chrome-profiles";
import {
  DEFAULT_STREMIO_CONFIG,
  DEFAULT_DEFAULT_CONFIG,
  type PlayerChromeConfig,
  type PlayerControlConfig,
  type PlayerSlot,
  type ThemeId,
} from "@/features/player/chrome-layout";
export * from "@/features/player/chrome-layout";

function baselineFor(theme: ThemeId): PlayerChromeConfig {
  return theme === "stremio" ? DEFAULT_STREMIO_CONFIG : DEFAULT_DEFAULT_CONFIG;
}

export function readPlayerChromeConfig(theme: ThemeId): PlayerChromeConfig {
  const active = getActiveProfile(theme);
  return active?.config ?? baselineFor(theme);
}

export function writePlayerChromeConfig(theme: ThemeId, config: PlayerChromeConfig): SaveResult {
  const res = updateActiveProfileConfig(theme, config);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export function resetPlayerChromeConfig(theme: ThemeId): PlayerChromeConfig {
  const baseline = baselineFor(theme);
  updateActiveProfileConfig(theme, baseline);
  return baseline;
}

export function controlsInSlot(
  config: PlayerChromeConfig,
  slot: PlayerSlot,
): PlayerControlConfig[] {
  return config.controls
    .filter((c) => c.slot === slot && !c.hidden)
    .slice()
    .sort((a, b) => a.order - b.order);
}

export const PLAYER_CHROME_CHANGED_EVENT = "harbor:player-chrome-changed";

export function notifyPlayerChromeChanged(theme: ThemeId): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CHANGED_EVENT, { detail: { theme } }));
}
