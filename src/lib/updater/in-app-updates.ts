const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function inAppUpdatesSupported(): Promise<boolean> {
  return Promise.resolve(IS_TAURI);
}

export function useInAppUpdatesSupported(): boolean {
  return IS_TAURI;
}
