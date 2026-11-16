import { useThemePreview } from "./theme-preview";
import { useSettings } from "@/lib/settings";
import { getThemeById } from "@/lib/theme";

export function useHarborLogo(): { mark: string | null; wordmark: string | null } {
  const { settings } = useSettings();
  const preview = useThemePreview();
  const preset = settings.theme.preset !== "custom" ? getThemeById(settings.theme.preset) : null;
  const logo = preview ? preview.logo : preset?.logo;
  return {
    mark: settings.customLogoMark || logo?.mark || null,
    wordmark: settings.customLogoWordmark || logo?.wordmark || null,
  };
}
