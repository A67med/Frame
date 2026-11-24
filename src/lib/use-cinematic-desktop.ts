import { activeLayout } from "./theme";
import { useActiveKid } from "@/features/profiles/profiles";
import { useSettings } from "./settings";
import { useThemePreview } from "./theme-preview";

/** Preview and saved themes use the same explicit layout contract. */
export function useCinematicDesktop(): boolean {
  const { settings } = useSettings();
  const preview = useThemePreview();
  const kid = useActiveKid();
  return !kid && (preview?.layout ?? activeLayout(settings.theme)) === "frame";
}
