import { useEffect, useRef, type RefObject } from "react";
import type { PlayerSnapshot } from "@/features/player/engine/bridge";
import { getPlaybackPosition } from "@/features/player/engine/playback-clock";
import { isNaturalEnd } from "@/features/player/engine/playback-end";
import type { PlayEpisode, PlayerSrc } from "@/app/navigation/view";

const STUB_MAX_SEC = 150;

export function useAutoNextEpisode(params: {
  src: PlayerSrc;
  snap: PlayerSnapshot;
  nextEp: PlayEpisode | null;
  canChangeEpisode: boolean;
  cancelled: boolean;
  startedNearEndRef: RefObject<boolean>;
  goToEpisode: (ep: PlayEpisode | null) => void;
}) {
  const { src, snap, nextEp, canChangeEpisode, cancelled, startedNearEndRef, goToEpisode } = params;
  const firedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (cancelled) return;
    if (!nextEp) return;
    if (!canChangeEpisode) return;
    if (snap.durationSec <= 0) return;
    if (snap.durationSec < STUB_MAX_SEC) return;
    if (startedNearEndRef.current) return;
    const pos = getPlaybackPosition();
    const naturalEnd = isNaturalEnd(snap, getPlaybackPosition());
    const errorAtEnd = snap.errorCode != null && pos >= snap.durationSec - 2;
    const reachedEnd = snap.status !== "playing" && pos >= snap.durationSec - 1;
    if (!naturalEnd && !errorAtEnd && !reachedEnd) return;
    if (firedForRef.current === src.url) return;
    firedForRef.current = src.url;
    goToEpisode(nextEp);
  }, [
    snap.status,
    snap.errorCode,
    snap.durationSec,
    src.url,
    nextEp,
    canChangeEpisode,
    cancelled,
    goToEpisode,
  ]);
}
