import { useEffect } from "react";
import { modalOverlayClose, modalOverlaySync } from "@/lib/modal-overlay";
import type { Settings } from "@/lib/settings";

export function useMpvEmbed(params: { engine: "html5" | "mpv"; settings: Settings }) {
  const { engine, settings } = params;

  useEffect(() => {
    if (engine !== "mpv" || !settings.playerMpvEmbed) return;
    let cancelled = false;
    let unMove: (() => void) | null = null;
    let unResize: (() => void) | null = null;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (cancelled) return;
        const win = getCurrentWindow();
        unMove = await win.onMoved(() => void modalOverlaySync());
        if (cancelled) {
          unMove();
          return;
        }
        unResize = await win.onResized(() => void modalOverlaySync());
        if (cancelled) unResize();
      } catch {}
    })();
    return () => {
      cancelled = true;
      unMove?.();
      unResize?.();
      void modalOverlayClose();
    };
  }, [engine, settings.playerMpvEmbed]);
}
