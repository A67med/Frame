import { useActiveKid } from "./profiles";
import { useSettings } from "./settings";
import { useThemePreview } from "./theme-preview";

/** Imported themes keep their authored layout and CSS, even when based on Default. */
export function useCinematicDesktop(): boolean {
  const { settings } = useSettings();
  const preview = useThemePreview();
  const kid = useActiveKid();
  return (
    !kid && !preview && (settings.theme.preset === "frame" || settings.theme.preset === "amoled")
  );
}
