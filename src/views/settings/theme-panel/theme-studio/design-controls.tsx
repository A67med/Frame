import { useT } from "@/lib/i18n";
import type { ThemeDesign } from "@/lib/theme-design";

export function DesignControls({
  value,
  onChange,
}: {
  value: ThemeDesign;
  onChange: (value: ThemeDesign) => void;
}) {
  const t = useT();
  const choices = [
    {
      key: "heading",
      label: t("Heading style"),
      options: [
        ["editorial", t("Editorial serif")],
        ["display", t("Selected display font")],
        ["sans", t("Selected body font")],
      ],
    },
    {
      key: "surface",
      label: t("Surface treatment"),
      options: [
        ["solid", t("Solid")],
        ["glass", t("Frosted glass")],
        ["gradient", t("Atmospheric gradient")],
      ],
    },
    {
      key: "elevation",
      label: t("Elevation"),
      options: [
        ["none", t("None")],
        ["soft", t("Soft shadow")],
        ["glow", t("Accent glow")],
      ],
    },
    {
      key: "navigation",
      label: t("Navigation treatment"),
      options: [
        ["line", t("Accent line")],
        ["pill", t("Soft pill")],
        ["block", t("Square block")],
      ],
    },
  ] as const;
  const ranges = [
    { key: "radius", label: t("Corner radius"), min: 0, max: 24, step: 1, unit: "px" },
    { key: "density", label: t("Content spacing"), min: 0.8, max: 1.3, step: 0.05, unit: "×" },
    { key: "headingScale", label: t("Heading scale"), min: 0.85, max: 1.2, step: 0.05, unit: "×" },
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      {choices.map(({ key, label, options }) => (
        <label key={key} className="flex flex-col gap-2 text-sm text-ink-muted">
          {label}
          <select
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            className="min-h-11 rounded-md border border-edge bg-canvas px-3 text-ink"
          >
            {options.map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
      ))}
      {ranges.map(({ key, label, min, max, step, unit }) => (
        <label key={key} className="flex flex-col gap-2 text-sm text-ink-muted">
          <span className="flex justify-between">
            {label}
            <output>
              {value[key]}
              {unit}
            </output>
          </span>
          <input
            aria-label={label}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
            className="min-h-8 w-full accent-accent"
          />
        </label>
      ))}
    </div>
  );
}
