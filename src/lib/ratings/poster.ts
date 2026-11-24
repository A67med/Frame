import { tmdbImdbCached } from "@/lib/providers/tmdb/tmdb-imdb-resolve";

const IMDB_IN_KEY = /(tt\d{7,})/;

const STORE_KEY = "harbor.ratingposters.v1";

let disk: Record<string, string> | null = null;

function readDisk(): Record<string, string> {
  if (disk) return disk;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    disk = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    disk = {};
  }
  return disk;
}

function metahub(tconst: string): string {
  return `https://images.metahub.space/poster/medium/${tconst}/img`;
}

export function ratingPosterSrc(itemKey: string, poster?: string): string | undefined {
  if (poster) return poster;
  if (!itemKey) return undefined;
  const direct = IMDB_IN_KEY.exec(itemKey);
  if (direct) return metahub(direct[1]);
  const mapped = tmdbImdbCached(itemKey);
  if (mapped) {
    const m = IMDB_IN_KEY.exec(mapped);
    if (m) return metahub(m[1]);
  }
  const cached = readDisk()[itemKey];
  return cached ?? undefined;
}
