import { ThemeThumbnail } from "@/components/theme-thumbnail";
import { useT } from "@/lib/i18n";
import { Check } from "../icons";
import { selectableThemes, type ActiveThemeId } from "@/lib/theme";

export function ColorThemeBody({
  activePreset,
  onSelect,
}: {
  activePreset: ActiveThemeId;
  onSelect: (id: ActiveThemeId) => void;
}) {
  const t = useT();
  return (
    <div className="animate-fade-in grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {selectableThemes().map((p) => {
        const active = activePreset === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            aria-pressed={active}
            className={`group relative flex min-h-[168px] flex-col justify-end overflow-hidden rounded-[10px] border p-4 text-start transition ${
              active ? "border-ink" : "border-edge-soft hover:border-edge"
            }`}
            style={{ background: p.swatch[0] }}
          >
            <div className="relative mb-3 aspect-video w-full">
              <ThemeThumbnail theme={p} />
            </div>
            <div
              className="absolute inset-x-0 top-0 h-2/5 pointer-events-none opacity-10"
              style={{
                background: `linear-gradient(180deg, ${p.swatch[1]}, ${p.swatch[0]})`,
              }}
            />
            <div
              className="absolute end-3 top-3 flex h-7 w-7 items-center justify-center rounded-full"
              style={{ background: p.swatch[2] }}
            >
              {active && <Check size={14} strokeWidth={3} style={{ color: p.swatch[0] }} />}
            </div>
            <div className="relative">
              <p
                className="text-[16.5px] font-semibold leading-[24px]"
                style={{ color: p.swatch[2] }}
              >
                {t(p.name)}
              </p>
              <p
                className="mt-0.5 text-[15.5px] leading-[22px]"
                style={{ color: p.tokens["--color-ink-muted"] }}
              >
                {t(p.blurb)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
