import { effectiveTmdbLanguage, get } from "@/lib/providers/tmdb/tmdb-client";
import { movieMeta, type RawMovie } from "@/lib/providers/tmdb/tmdb-meta-mappers";
import { createCatalogCache } from "@/lib/providers/tmdb/tmdb-catalog-cache";
import type { RadarItem } from "./radar";

const calendars = createCatalogCache();

type ReleaseDates = {
  results: { iso_3166_1: string; release_dates: { type: number; release_date: string }[] }[];
};

export function validDigitalDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  if (value.includes("T") && !Number.isFinite(Date.parse(value))) return null;
  const day = value.slice(0, 10);
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? day : null;
}

export function digitalReleaseDay(
  data: ReleaseDates,
  region: string,
  from: string,
  to: string,
): string | null {
  if (!Array.isArray(data?.results)) throw new Error("invalid-release-dates");
  const dates: string[] = [];
  for (const country of data.results) {
    if (country?.iso_3166_1 !== region) continue;
    if (!Array.isArray(country.release_dates)) throw new Error("invalid-release-dates");
    for (const release of country.release_dates) {
      if (release?.type !== 4) continue;
      const day = validDigitalDay(release.release_date);
      if (day && day >= from && day <= to) dates.push(day);
    }
  }
  return dates.sort()[0] ?? null;
}

/** Read every discovery page in the window, then verify regional type-4 records. */
export async function fetchDigitalReleases(
  key: string,
  region: string,
  from: string,
  to: string,
): Promise<RadarItem[]> {
  if (!key) throw new Error("missing-tmdb-key");
  if (
    !/^[A-Z]{2}$/.test(region) ||
    validDigitalDay(from) !== from ||
    validDigitalDay(to) !== to ||
    from > to
  ) {
    throw new Error("invalid-release-window");
  }
  const cacheKey = JSON.stringify([key, region, from, to, effectiveTmdbLanguage()]);
  const cached = calendars.get<RadarItem[]>(cacheKey);
  if (cached) return cached;
  const movies = new Map<number, RawMovie>();
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const data = await get<{ results: RawMovie[]; total_pages: number }>(key, "discover/movie", {
      region,
      with_release_type: "4",
      "release_date.gte": from,
      "release_date.lte": to,
      sort_by: "primary_release_date.asc",
      include_adult: "false",
      page: String(page),
    });
    if (
      !data ||
      !Array.isArray(data.results) ||
      !Number.isInteger(data.total_pages) ||
      data.total_pages < 0
    ) {
      throw new Error("digital-releases-unavailable");
    }
    // TMDB cannot serve pages above 500; never present a truncated calendar as complete.
    if (data.total_pages > 500) throw new Error("release-window-too-large");
    totalPages = data.total_pages;
    for (const movie of data.results) {
      if (
        !movie ||
        !Number.isInteger(movie.id) ||
        movie.id <= 0 ||
        typeof movie.title !== "string"
      ) {
        throw new Error("invalid-movie");
      }
      movies.set(movie.id, movie);
    }
  }
  const items: RadarItem[] = [];
  const candidates = [...movies.values()];
  // Bound pending work as well as the shared TMDB scheduler's HTTP concurrency.
  for (let i = 0; i < candidates.length; i += 6) {
    const batch = await Promise.all(
      candidates.slice(i, i + 6).map(async (movie) => {
        const data = await get<ReleaseDates>(key, `movie/${movie.id}/release_dates`);
        if (!data) throw new Error("digital-releases-unavailable");
        const day = digitalReleaseDay(data, region, from, to);
        return day ? { ...movieMeta(movie), radarDate: day } : null;
      }),
    );
    for (const item of batch) if (item) items.push(item);
  }
  items.sort((a, b) => a.radarDate!.localeCompare(b.radarDate!) || a.name.localeCompare(b.name));
  calendars.set(cacheKey, items);
  return items;
}
