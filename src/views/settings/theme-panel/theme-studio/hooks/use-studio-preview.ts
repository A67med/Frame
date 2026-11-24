import { useEffect, useState } from "react";
import type { ThemeLayout, ThemeBackground, ThemeLogo } from "@/lib/theme";
import type { NavCustomization } from "@/chrome/nav-items";
import { setThemePreview } from "@/lib/theme-preview";
import { useView } from "@/app/navigation/view";

export function useStudioPreview(
  layout: ThemeLayout,
  bokeh: boolean,
  navCustomization: NavCustomization,
  background?: ThemeBackground,
  logo?: ThemeLogo,
  composition?: import("@/lib/theme-design").ThemeDesign["composition"],
) {
  const { setView } = useView();
  const [inspectorHidden, setInspectorHidden] = useState(false);

  useEffect(() => {
    setView("home");
    return () => {
      setThemePreview(null);
      setView("settings");
    };
  }, [setView]);

  useEffect(() => {
    setThemePreview({ layout, bokeh, navCustomization, background, logo, composition });
  }, [layout, bokeh, navCustomization, background, logo, composition]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key ?? "").toLowerCase() === "p") {
        e.preventDefault();
        setInspectorHidden((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { inspectorHidden, setInspectorHidden };
}
