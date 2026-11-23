import { fillStyle } from "@/components/slider";
import { AlertCircle, ImageDown, Trash2 } from "../icons";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { ROW_ACTION, ROW_ACTION_PRIMARY, SettingRow } from "../kit";
import {
  backgroundId,
  changeRecentBackgrounds,
  loadRecentBackground,
  readRecentBackgrounds,
  type RecentBackground,
} from "@/lib/theme-storage";
import { downscaleImage, processBackgroundImage } from "./image-utils";

function pickerShade(dim: number): string {
  const a = (v: number) => `rgb(0 0 0 / ${Math.min(0.94, Math.max(0, v))})`;
  return `linear-gradient(to bottom, ${a(dim + 0.14)} 0%, ${a(dim)} 38%, ${a(dim + 0.22)} 100%)`;
}

export function BackgroundPicker({
  imageData,
  dim,
  onImageChange,
  onDimChange,
  variant = "theme",
  recentProfile,
}: {
  imageData: string | null;
  dim: number;
  onImageChange: (data: string | null) => void;
  onDimChange: (dim: number) => void;
  recentProfile?: string;
  variant?: "theme" | "picker";
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<number | null>(null);
  const justSetRef = useRef(false);

  const flashError = (text: string) => {
    setError(text);
    if (errorTimerRef.current != null) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => setError(null), 6000);
  };

  useEffect(
    () => () => {
      if (errorTimerRef.current != null) window.clearTimeout(errorTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (justSetRef.current && !imageData) {
      flashError(
        t(
          "Couldn't save that background. Your local storage is full. Try a smaller crop or clear cached data.",
        ),
      );
      justSetRef.current = false;
    } else if (imageData) {
      justSetRef.current = false;
    }
  }, [imageData]);

  const [recent, setRecent] = useState<RecentBackground[]>([]);
  const [selected, setSelected] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    if (!recentProfile) return;
    async function restore(profile: string) {
      const id = imageData?.startsWith("data:image/") ? await backgroundId(imageData) : "";
      const rows = await readRecentBackgrounds(profile);
      if (!current) return;
      setSelected(id);
      if (rows !== null || !id || !imageData) {
        setRecent(rows ?? []);
        return;
      }
      const thumbnail = await downscaleImage(imageData, 192);
      if (!current || !thumbnail) return;
      const migrated = await changeRecentBackgrounds(profile, {
        add: { id, thumbnail, name: t("Background image") },
        data: imageData,
        initialize: true,
      });
      if (current) setRecent(migrated);
    }
    void restore(recentProfile).catch(() => {
      if (current) flashError(t("Background storage unavailable"));
    });
    return () => {
      current = false;
    };
  }, [recentProfile, imageData]);

  const manage = async (change: { remove: string } | { clear: true }) => {
    if (!recentProfile) return;
    setBusy(true);
    try {
      setRecent(await changeRecentBackgrounds(recentProfile, change));
    } catch {
      flashError(t("Background storage unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const processed = await processBackgroundImage(file);
      if (!processed) {
        flashError(
          t("Couldn't compress this image small enough. Try a different photo or crop it down."),
        );
        return;
      }
      if (recentProfile) {
        const thumbnail = await downscaleImage(processed, 192);
        if (!thumbnail) throw new Error("Invalid image");
        const id = await backgroundId(processed);
        const rows = await changeRecentBackgrounds(recentProfile, {
          add: { id, thumbnail, name: file.name },
          data: processed,
        });
        if (!mounted.current) return;
        setRecent(rows);
      }
      justSetRef.current = true;
      onImageChange(processed);
    } catch {
      flashError(t("Couldn't read that image. Try a different file."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[16/9] overflow-hidden rounded-md bg-elevated">
        {imageData ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${imageData})` }}
            />
            {variant === "picker" ? (
              <div className="absolute inset-0" style={{ background: pickerShade(dim) }} />
            ) : (
              <>
                <div className="absolute inset-0 bg-canvas/[0.45]" />
                <div className="absolute inset-0 bg-canvas" style={{ opacity: dim }} />
              </>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-subtle">
            <ImageDown size={32} strokeWidth={1.6} />
            <p className="text-[15.5px]">
              {variant === "picker"
                ? t("No background yet. The picker blurs the app behind it.")
                : t("No background image")}
            </p>
          </div>
        )}
        <div className="relative z-10 flex h-full flex-col items-start justify-end gap-1 p-5">
          <p className="harbor-settings-label">
            {variant === "picker" ? t("Who's watching preview") : t("Live preview")}
          </p>
          <p className="font-display text-[26px] font-medium tracking-tight text-ink">
            {variant === "picker" ? t("Who's watching?") : t("Tonight's picks")}
          </p>
          <p className="max-w-[66ch] text-[15.5px] leading-[22px] text-ink-muted">
            {variant === "picker"
              ? t("Profile names and avatars should stay readable at this dim.")
              : t("Both serif and body text should stay legible at this dim.")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0] ?? null;
            e.currentTarget.value = "";
            void onFile(f);
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className={ROW_ACTION_PRIMARY}
        >
          <ImageDown size={18} strokeWidth={2.2} />
          {busy ? t("Compressing…") : imageData ? t("Replace image") : t("Choose image")}
        </button>
        {imageData && !busy && (
          <button onClick={() => onImageChange(null)} className={ROW_ACTION}>
            <Trash2 size={18} strokeWidth={2.2} />
            {t("Remove")}
          </button>
        )}
        <p className="ms-auto max-w-[66ch] text-[15.5px] text-ink-subtle">
          {t("JPEG / PNG / WebP. Big files auto-compress to fit.")}
        </p>
      </div>
      {recentProfile && recent.length > 0 && (
        <section className="grid gap-3">
          <header className="flex justify-between">
            <h3>{t("Recently added")}</h3>
            <button
              disabled={busy}
              className="text-sm text-ink-muted"
              onClick={() => void manage({ clear: true })}
            >
              {t("Clear collection")}
            </button>
          </header>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-3">
            {recent.map((row) => (
              <div key={row.id} className="min-w-0">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={selected === row.id}
                  className={`block w-full overflow-hidden rounded-lg border-2 ${selected === row.id ? "border-accent" : "border-transparent"}`}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const data = await loadRecentBackground(recentProfile, row.id);
                      if (!mounted.current) return;
                      if (data?.startsWith("data:image/")) onImageChange(data);
                      else flashError(t("Image unavailable"));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <img
                    src={row.thumbnail}
                    alt={row.name}
                    loading="lazy"
                    className="aspect-video w-full object-cover"
                  />
                </button>
                <div className="flex items-center gap-1">
                  <span className="flex-1 truncate text-xs">{row.name}</span>
                  <button
                    type="button"
                    aria-label={t("Remove {name}", { name: row.name })}
                    disabled={busy}
                    onClick={() => void manage({ remove: row.id })}
                    className="p-2 hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {error && (
        <div className="flex animate-fade-in items-start gap-2.5 rounded-[10px] border border-danger/30 bg-elevated px-4 py-3 text-[15.5px] leading-[22px] text-danger">
          <AlertCircle size={18} strokeWidth={2.2} className="mt-[2px] shrink-0 text-danger" />
          <span className="max-w-[66ch]">{error}</span>
        </div>
      )}
      <SettingRow
        wide
        label={t("Dim overlay")}
        desc={
          variant === "picker"
            ? t("0% shows the raw image. 100% covers it in black. 60-80% keeps profiles readable.")
            : t(
                "0% shows the raw image. 100% covers it with the theme color. 60-80% is the readable sweet spot.",
              )
        }
      >
        <div className="flex w-full max-w-[520px] flex-wrap items-center gap-4">
          <input
            type="range"
            aria-label={t("Dim overlay")}
            min={0}
            max={100}
            step={5}
            value={Math.round(dim * 100)}
            onChange={(e) => onDimChange(parseInt(e.currentTarget.value, 10) / 100)}
            className="harbor-slider h-11 min-w-0 flex-1"
            style={fillStyle(Math.round(dim * 100), 0, 100, 5)}
          />
          <span className="w-[64px] shrink-0 text-end text-[15.5px] font-semibold tabular-nums text-ink">
            {Math.round(dim * 100)}%
          </span>
        </div>
      </SettingRow>
    </div>
  );
}
