function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isWeb(): boolean {
  return typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);
}

export type OsClass = "windows" | "web";

export function osClass(): OsClass {
  return isTauri() ? "windows" : "web";
}

export function applyOsDataset(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.os = osClass();
}

export function isWindowsDesktop(): boolean {
  return osClass() === "windows";
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|iPad/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1) return true;
  if (
    (navigator.maxTouchPoints ?? 0) > 0 &&
    Math.min(window.innerWidth, window.innerHeight) < 640
  ) {
    return true;
  }
  return false;
}

export function isRemoteRoute(): boolean {
  try {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/remote" || path.endsWith("/remote")) return true;
    if (path === "/setup" || path.endsWith("/setup")) return true;
    const q = new URLSearchParams(window.location.search);
    return q.get("remote") === "1" || q.get("setup") !== null;
  } catch {
    return false;
  }
}

let mobileWebCache: boolean | null = null;

export function isMobileWeb(): boolean {
  if (mobileWebCache !== null) return mobileWebCache;
  let forcedOn = false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("desktop") === "1") {
      mobileWebCache = false;
      return false;
    }
    if (q.get("mobile") === "1") forcedOn = true;
  } catch {
    /* ignore */
  }
  mobileWebCache = forcedOn || (isWeb() && isMobileDevice());
  return mobileWebCache;
}

export function isSetupRoute(): boolean {
  try {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    return path === "/setup" || path.endsWith("/setup");
  } catch {
    return false;
  }
}
