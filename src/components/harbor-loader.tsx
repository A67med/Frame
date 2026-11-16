import { FrameMark } from "./icons/frame-mark";
import { CustomArtwork } from "./custom-artwork";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<Size, string> = {
  xs: "h-7 w-7",
  sm: "h-20 w-20",
  md: "h-32 w-32",
  lg: "h-44 w-44",
  xl: "h-60 w-60",
};

export function HarborLoader({
  size = "md",
  caption,
  className = "",
  original = false,
}: {
  size?: Size;
  caption?: string;
  className?: string;
  keyed?: boolean;
  logos?: string[];
  original?: boolean;
}) {
  const mark = (
    <FrameMark
      className={`harbor-loader-art ${SIZE_CLASS[size]} text-ink motion-safe:animate-pulse`}
    />
  );
  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${className}`} role="status">
      {original ? (
        mark
      ) : (
        <CustomArtwork
          role="loading"
          className={`harbor-loader-art ${SIZE_CLASS[size]}`}
          fallback={mark}
        />
      )}
      {caption && (
        <p className="harbor-loader-cap mt-1 text-[12.5px] font-medium uppercase tracking-[0.18em] text-ink-muted">
          {caption}
        </p>
      )}
    </div>
  );
}
