import { memo } from "react";
import type { ComponentProps } from "react";
import type { PlayerSnapshot } from "@/features/player/engine/bridge";
import { mapErrorSourceKey } from "@/features/player/engine/html5/error-map";
import type { PlayerSrc } from "@/app/navigation/view";
import { isLivePlaybackSrc } from "@/features/player/engine/live-src";
import { CinematicPlayerLoader } from "./cinematic-player-loader";
import { LiveChannelError } from "./live-channel-error";
import { LocalFileError } from "./local-file-error";

export const LoaderLayer = memo(function LoaderLayer({
  src,
  snap,
  isLocalSrc,
  forceShow,
  sourceFailed,
  onCancel,
  engineStats,
  onShowingChange,
  onRetry,
  onBrowseChannels,
}: {
  src: PlayerSrc;
  snap: PlayerSnapshot;
  isLocalSrc: boolean;
  forceShow: boolean;
  sourceFailed: boolean;
  onCancel: () => void;
  engineStats: ComponentProps<typeof CinematicPlayerLoader>["engineStats"];
  onShowingChange: (showing: boolean) => void;
  onRetry: () => void;
  onBrowseChannels?: () => void;
}) {
  const isLiveSrc = isLivePlaybackSrc(src);
  return (
    <>
      {(isLocalSrc || isLiveSrc) && snap.errorCode != null ? null : (
        <CinematicPlayerLoader
          src={src}
          snap={snap}
          forceShow={forceShow}
          failed={sourceFailed && !isLocalSrc && !isLiveSrc}
          onCancel={onCancel}
          engineStats={engineStats}
          onShowingChange={onShowingChange}
        />
      )}

      {isLocalSrc && snap.errorCode != null && (
        <LocalFileError
          path={src.url}
          errorSourceKey={mapErrorSourceKey(snap.errorCode)}
          errorDetail={snap.errorMessage}
          onBack={onCancel}
          onRetry={onRetry}
        />
      )}

      {!isLocalSrc && isLiveSrc && snap.errorCode != null && (
        <LiveChannelError
          channelName={src.title ?? src.meta.name}
          onBack={onCancel}
          onRetry={onRetry}
          onBrowse={onBrowseChannels}
        />
      )}
    </>
  );
});
