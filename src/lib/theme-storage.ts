const DB_NAME = "harbor-theme";
const DB_VERSION = 1;
const STORE = "kv";
const BG_KEY = "bg";
const LEGACY_LOCALSTORAGE_KEY = "harbor.theme.bg";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function bgKey(profileId?: string): string {
  return profileId ? `bg_${profileId}` : BG_KEY;
}

export async function loadBgImage(profileId?: string): Promise<string | null> {
  const db = await openDB();
  if (!db) return readLegacy();
  const key = bgKey(profileId);
  try {
    const scoped = await themeKvGet(key);
    if (scoped) return scoped;

    // A profile with no image of its own yet: adopt the pre-profile-scoping
    // global background exactly once, then retire the global key.
    if (profileId) {
      const globalLegacy = await themeKvGet(BG_KEY);
      if (globalLegacy) {
        await themeKvPut(key, globalLegacy);
        await themeKvDelete(BG_KEY);
        return globalLegacy;
      }
    }

    const legacy = readLegacy();
    if (legacy) {
      await themeKvPut(key, legacy);
      try {
        localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
      } catch {
        /* ignore */
      }
      return legacy;
    }
    return null;
  } catch {
    return readLegacy();
  }
}

export async function saveBgImage(data: string | null, profileId?: string): Promise<boolean> {
  const key = bgKey(profileId);
  if (data == null) return themeKvDelete(key);
  return themeKvPut(key, data);
}

export type RecentBackground = { id: string; name: string; thumbnail: string };
const RECENT_LIMIT = 8;

function recentIndex(profile: string) {
  return `recent:${profile}`;
}
function recentImage(profile: string, id: string) {
  return `recent-image:${profile}:${id}`;
}

export async function readRecentBackgrounds(profile: string): Promise<RecentBackground[] | null> {
  const stored = await themeKvGet(recentIndex(profile));
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(validRecent).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function validRecent(value: unknown): value is RecentBackground {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<RecentBackground>;
  return (
    typeof row.id === "string" &&
    /^[a-f0-9]{64}$/.test(row.id) &&
    typeof row.name === "string" &&
    typeof row.thumbnail === "string"
  );
}

export function loadRecentBackground(profile: string, id: string) {
  return themeKvGet(recentImage(profile, id));
}

export async function backgroundId(data: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}

type RecentChange =
  | { add: RecentBackground; data: string; initialize?: boolean }
  | { remove: string }
  | { clear: true };

export async function changeRecentBackgrounds(
  profile: string,
  change: RecentChange,
): Promise<RecentBackground[]> {
  const db = await openDB();
  if (!db) throw new Error("Background storage unavailable");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const key = recentIndex(profile);
    const req = store.get(key);
    let next: RecentBackground[] = [];
    req.onsuccess = () => {
      let previous: RecentBackground[] = [];
      try {
        const rows = JSON.parse(req.result ?? "[]");
        if (Array.isArray(rows)) previous = rows.filter(validRecent);
      } catch {
        /* Replace an unreadable index. */
      }
      if ("add" in change) {
        if (change.initialize && req.result != null) {
          next = previous;
          return;
        }
        next = [change.add, ...previous.filter((row) => row.id !== change.add.id)].slice(
          0,
          RECENT_LIMIT,
        );
        store.put(change.data, recentImage(profile, change.add.id));
      } else if ("remove" in change) next = previous.filter((row) => row.id !== change.remove);
      for (const row of previous)
        if (!next.some((kept) => kept.id === row.id)) store.delete(recentImage(profile, row.id));
      store.put(JSON.stringify(next), key);
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = () => reject(tx.error ?? new Error("Background storage unavailable"));
  });
}

export async function deleteProfileBgImage(profileId: string): Promise<boolean> {
  await changeRecentBackgrounds(profileId, { clear: true }).catch(() => {});
  return themeKvDelete(bgKey(profileId));
}

export async function themeKvGet(key: string): Promise<string | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function themeKvPut(key: string, value: string): Promise<boolean> {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function themeKvDelete(key: string): Promise<boolean> {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function readLegacy(): string | null {
  try {
    return localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
  } catch {
    return null;
  }
}

const PICKER_BG_KEY = "bg_picker";
const PICKER_DIM_KEY = "bg_picker_dim";

export async function loadPickerBg(): Promise<{ image: string | null; dim: number }> {
  const [image, dim] = await Promise.all([
    themeKvGet(PICKER_BG_KEY).catch(() => null),
    themeKvGet(PICKER_DIM_KEY).catch(() => null),
  ]);
  const parsed = dim === null ? NaN : Number(dim);
  if (!Number.isFinite(parsed)) return { image, dim: 55 };
  // Current sliders store whole percentages: a saved 1 must remain 1%, not 100%.
  const pct = parsed > 0 && parsed < 1 ? parsed * 100 : parsed;
  return { image, dim: Math.min(100, Math.max(0, Math.round(pct))) };
}

export async function savePickerBg(data: string | null): Promise<boolean> {
  if (data == null) return themeKvDelete(PICKER_BG_KEY);
  return themeKvPut(PICKER_BG_KEY, data);
}

export async function savePickerBgDim(dim: number): Promise<boolean> {
  return themeKvPut(PICKER_DIM_KEY, String(dim));
}
