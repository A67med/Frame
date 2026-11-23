import { useState } from "react";
import { ThemeThumbnail } from "@/components/theme-thumbnail";
import { selectableThemes, type ThemePreset } from "@/lib/theme";
import { useT } from "@/lib/i18n";
import { PaletteSeam } from "../custom-themes-section/community-store/market/palette-seam";

export function PresetGallery({ onSeed }: { onSeed: (t: ThemePreset) => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const themes = selectableThemes().filter((p) =>
    `${p.name} ${p.blurb}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        aria-label={t("Find a theme")}
        placeholder={t("Find a theme")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="min-h-11 w-full rounded-md border border-edge bg-canvas px-3 text-ink"
      />
      <p className="text-xs text-ink-muted">{t("Built-in collection · Style previews")}</p>
      <div className="grid grid-cols-2 gap-2.5">
        {themes.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSeed(p)}
            title={t(p.name)}
            className="group/card flex flex-col overflow-hidden rounded-md bg-canvas text-start outline-none transition-colors duration-200 hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-raised">
              <ThemeThumbnail theme={p} />
              <div className="absolute inset-x-0 bottom-0">
                <PaletteSeam swatch={p.swatch} />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 px-3 pb-2.5 pt-2">
              <span className="truncate text-[15.5px] font-semibold leading-[22px] text-ink">
                {t(p.name)}
              </span>
              {p.blurb && (
                <span className="truncate text-[15.5px] leading-[22px] text-ink-subtle">
                  {t(p.blurb)}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
      {themes.length === 0 && (
        <p role="status" className="text-sm text-ink-muted">
          {t("No themes found")}
        </p>
      )}
    </div>
  );
}
