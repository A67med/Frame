import type { TrackInfo } from "@/features/player/engine/bridge";
import type { SubtitleAddHandler } from "@/features/player/engine/subtitle-load";
import type { GeneratedSubtitleGroup } from "@/features/subtitles/types";

export type SubtitleMenuProps = {
  generated?: GeneratedSubtitleGroup[];
  engine?: "html5" | "mpv";
  tracks: TrackInfo[];
  selectedId: string | null;
  delaySec: number;
  onSelect: (id: string | null) => void;
  onSelectSecondary?: (id: string | null) => void;
  onDelay: (sec: number) => void;
  onEnterSync?: () => void;
  onAddSubtitle: SubtitleAddHandler;
  metaImdbId?: string | null;
  metaTitle?: string | null;
  metaReleaseDate?: string | null;
  season?: number | null;
  episode?: number | null;
  preferredLanguages?: string[];
  useOverlayPopup?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenStyleBar?: () => void;
  iconUrl?: string;
};

export type Group = { langKey: string; langDisplay: string; variants: TrackInfo[] };
