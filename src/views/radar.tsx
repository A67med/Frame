import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackToTop } from "@/components/back-to-top";
import { FollowedPeopleChip } from "@/components/followed-people-chip";

import { PickCard } from "@/components/pick-card";
import { ScrollRootContext } from "@/components/row";
import { Spinner } from "@/components/spinner";
import { useAuth } from "@/lib/auth";
import type { Meta } from "@/lib/cinemeta";
import { getVoteEntries } from "@/lib/feed/preferences";
import type { FollowAttribution } from "@/lib/follow-credits";
import { useFollowCredits } from "@/lib/follow-credits";
import { useFollows } from "@/lib/follows";
import { useT } from "@/lib/i18n";
import { fetchForYou, type ForYouResult, type TasteInput } from "@/lib/radar/for-you";

import {
  fetchReleases,
  fetchTrendingPopular,
  type RadarItem,
  type RadarPage,
} from "@/lib/radar/radar";
import { appendUnique, localIsoDay, type ReleaseKind } from "@/lib/radar/release-dates";
import { movieWatchedIds } from "@/lib/movie-watched";
import { watchedFlagIds } from "@/lib/watched-flag";
import { useMyRatings } from "@/lib/ratings/store";
import { useSettings } from "@/lib/settings";
import { library } from "@/lib/stremio";
import { useScrollMemory, useView } from "@/lib/view";
import { readLocalEntries, subscribeWatchlist } from "@/lib/watchlist";
import { fetchDigitalReleases, type DigitalRelease } from "@/lib/radar/digital-releases";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtDate } from "./person/person-utils";

const PILL =
  "flex items-center gap-2 rounded-full px-3 py-1 text-[12.5px] font-medium ring-1 transition-colors disabled:opacity-60";

/** A poster card with an optional followed-people chip under it. */
const RadarCard = Object.assign(
  function RadarCard({
    meta,
    reason,
    people = [],
  }: {
    meta: Meta;
    reason?: string;
    people?: FollowAttribution[];
  }) {
    const t = useT();
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <PickCard meta={meta} reason={reason} />
        <small className="film-catalog-data hidden">
          {[
            meta.type === "series" ? t("Series") : t("Movie"),
            meta.releaseInfo,
            meta.originalLanguage?.toUpperCase(),
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
        <FollowedPeopleChip people={people} />
      </div>
    );
  },
  { isPosterCard: true as const },
);

function RowMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 items-center gap-3 text-[13px] text-ink-subtle">{children}</div>
  );
}

function RetryMessage({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <RowMessage>
      {t("TMDB didn't answer.")}
      <button type="button" onClick={onRetry} className="text-accent hover:underline">
        {t("Try again")}
      </button>
    </RowMessage>
  );
}

type PagedState = {
  items: RadarItem[];
  page: number;
  totalPages: number;
  loading: boolean;
  error: boolean;
};

const EMPTY_PAGED: PagedState = { items: [], page: 0, totalPages: 1, loading: true, error: false };

function usePagedSection(loadPage: (page: number) => Promise<RadarPage>) {
  const [state, setState] = useState<PagedState>(EMPTY_PAGED);
  const busy = useRef(false);
  const generation = useRef(0);

  const load = useCallback(
    async (page: number, reset: boolean) => {
      if (busy.current && !reset) return;
      const run = ++generation.current;
      busy.current = true;
      setState((s) => ({ ...(reset ? EMPTY_PAGED : s), loading: true, error: false }));
      try {
        const res = await loadPage(page);
        if (run !== generation.current) return;
        setState((s) => ({
          items: appendUnique(reset ? [] : s.items, res.items),
          page,
          totalPages: res.totalPages,
          loading: false,
          error: false,
        }));
      } catch {
        if (run === generation.current) setState((s) => ({ ...s, loading: false, error: true }));
      } finally {
        if (run === generation.current) busy.current = false;
      }
    },
    [loadPage],
  );

  useEffect(() => {
    void load(1, true);
  }, [load]);

  return {
    ...state,
    hasMore: state.page > 0 && state.page < state.totalPages,
    more: () => void load(state.page + 1, false),
    retry: () =>
      void load(Math.max(1, state.page + (state.items.length ? 1 : 0)), !state.items.length),
  };
}

function ShowMore({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={`${PILL} text-ink-subtle ring-edge-soft hover:text-ink`}
    >
      {loading && <Spinner size={12} />}
      {t("Show more")}
    </button>
  );
}

function useTasteInput(authKey: string | null): TasteInput {
  const ratings = useMyRatings();
  // readLocalEntries builds a new array on each call, so it can't be a store snapshot.
  const [watchlist, setWatchlist] = useState(readLocalEntries);
  useEffect(() => subscribeWatchlist(() => setWatchlist(readLocalEntries())), []);
  const [watched, setWatched] = useState<TasteInput["watched"]>([]);
  useEffect(() => {
    if (!authKey) {
      setWatched([]);
      return;
    }
    let cancelled = false;
    setWatched([]);
    library(authKey)
      .then((items) => {
        if (cancelled) return;
        setWatched(
          items
            .filter((i) => !i.removed && !i.temp && (i.state?.timeWatched ?? 0) > 0)
            .sort((a, b) => (b.state?.lastWatched ?? "").localeCompare(a.state?.lastWatched ?? ""))
            .map((i) => ({ id: i._id, type: i.type, name: i.name })),
        );
      })
      // Viewing history is one signal among several, so For You still works without it.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authKey]);
  return useMemo(() => {
    const localMovies = Array.from(movieWatchedIds(), (id) => ({ id, type: "movie" }));
    const flags = Array.from(watchedFlagIds(), (id) => ({
      id,
      type: id.startsWith("tmdb:tv:") ? "series" : id.startsWith("tmdb:movie:") ? "movie" : "",
    }));
    return {
      ratings,
      watchlist,
      watched: [...watched, ...localMovies, ...flags],
      votes: getVoteEntries(),
    };
  }, [ratings, watchlist, watched]);
}

function ForYouSection({ tmdbKey }: { tmdbKey: string }) {
  const t = useT();
  const { settings } = useSettings();
  const { authKey } = useAuth();
  const { people } = useFollows();
  const { credits, loading: creditsLoading } = useFollowCredits(tmdbKey, people);
  const { openMeta, setView } = useView();
  const taste = useTasteInput(authKey);
  const genres = settings.customCalendar.genres;
  const [result, setResult] = useState<ForYouResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (creditsLoading) return;
    let cancelled = false;
    setResult(null);
    fetchForYou(tmdbKey, { taste, follows: credits, genres, today: localIsoDay(Date.now()) })
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch(() => {
        if (!cancelled) setResult({ items: [], hasSignals: true, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [tmdbKey, taste, credits, genres, creditsLoading, attempt]);

  let body: React.ReactNode;
  if (!result) {
    body = (
      <RowMessage>
        <Spinner />
      </RowMessage>
    );
  } else if (result.failed) {
    body = <RetryMessage onRetry={() => setAttempt((n) => n + 1)} />;
  } else if (result.items.length === 0) {
    body = (
      <RowMessage>
        <div className="grid gap-3">
          <p>
            {result.hasSignals
              ? t("Nothing new to recommend right now.")
              : t("Follow people, rate titles or add to your watchlist to get recommendations.")}
          </p>
          <button
            type="button"
            className="justify-self-start rounded-full bg-accent px-4 py-2 text-canvas"
            onClick={() => setView("following")}
          >
            {t("Manage Following")}
          </button>
        </div>
      </RowMessage>
    );
  } else {
    const [lead, ...rest] = result.items;
    body = (
      <>
        <button
          type="button"
          onClick={() => openMeta(lead.meta)}
          className="relative isolate flex min-h-64 w-full flex-col justify-end overflow-hidden rounded-xl bg-surface p-7 text-start text-white"
        >
          {(lead.meta.background || lead.meta.poster) && (
            <img
              alt=""
              src={lead.meta.background || lead.meta.poster}
              className="absolute inset-0 -z-20 h-full w-full object-cover"
            />
          )}
          <span className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-black/50 to-transparent" />
          <strong className="max-w-xl font-display text-4xl">{lead.meta.name}</strong>
          <span>
            {lead.becauseOf
              ? t("Because of {title}", { title: lead.becauseOf })
              : lead.matchesGenres
                ? t("Matches your genres")
                : lead.people.map((p) => p.name).join(", ")}
          </span>
          <span className="mt-2 line-clamp-2 max-w-xl">{lead.meta.description}</span>
        </button>
        <div className="radar-grid">
          {rest.map((item) => (
            <RadarCard
              key={item.meta.id}
              meta={item.meta}
              people={item.people}
              reason={
                item.becauseOf
                  ? t("Because of {title}", { title: item.becauseOf })
                  : item.matchesGenres
                    ? t("Matches your genres")
                    : undefined
              }
            />
          ))}
        </div>
      </>
    );
  }
  return (
    <section className="film-recommendations grid gap-5">
      <h2 className="text-2xl font-semibold">{t("For You")}</h2>
      {body}
    </section>
  );
}

type MediaFilter = "all" | "movie" | "series";

function MediaSelect({
  value,
  change,
}: {
  value: MediaFilter;
  change: (next: MediaFilter) => void;
}) {
  const t = useT();
  return (
    <select
      className="rounded-lg bg-elevated px-3 py-2"
      aria-label={t("Media type")}
      value={value}
      onChange={(event) => change(event.target.value as MediaFilter)}
    >
      <option value="all">{t("All titles")}</option>
      <option value="movie">{t("Movies")}</option>
      <option value="series">{t("TV shows")}</option>
    </select>
  );
}

function Timeline({
  items,
  digital = false,
  descending = false,
  attribution,
}: {
  items: RadarItem[];
  digital?: boolean;
  descending?: boolean;
  attribution?: Map<string, FollowAttribution[]>;
}) {
  const t = useT();
  const { openMeta } = useView();
  const groups = new Map<string, RadarItem[]>();
  for (const item of items) {
    if (!item.radarDate) continue;
    const day = groups.get(item.radarDate) ?? [];
    day.push(item);
    groups.set(item.radarDate, day);
  }
  return (
    <div className="flex flex-col">
      {Array.from(groups.keys())
        .sort((a, b) => (descending ? b.localeCompare(a) : a.localeCompare(b)))
        .map((date) => (
          <section
            key={date}
            className="grid gap-3 border-t border-edge-soft py-4 sm:grid-cols-[9rem_1fr]"
          >
            <time dateTime={date} className="font-display text-lg text-accent">
              {fmtDate(date)}
            </time>
            <div className="grid gap-3">
              {groups.get(date)!.map((item) => (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => openMeta(item)}
                    className="flex w-full items-center gap-4 text-start hover:text-accent"
                  >
                    {item.poster && (
                      <img
                        alt=""
                        loading="lazy"
                        src={item.poster}
                        className="h-16 w-11 rounded object-cover"
                      />
                    )}
                    <span>
                      <strong className="block">{item.name}</strong>
                      <small>
                        {digital
                          ? t("Digital Releases") + " · " + t("Egypt")
                          : item.type === "series"
                            ? t("TV premiere")
                            : t("Movie release")}
                      </small>
                    </span>
                  </button>
                  <FollowedPeopleChip people={attribution?.get(item.id) ?? []} />
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

function TrendingSection({ tmdbKey }: { tmdbKey: string }) {
  const t = useT();
  const loadPage = useCallback((page: number) => fetchTrendingPopular(tmdbKey, page), [tmdbKey]);
  const s = usePagedSection(loadPage);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const shown = s.items.filter((item) => filter === "all" || item.type === filter);
  return (
    <section className="grid gap-5">
      <header className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">{t("Trending / Popular")}</h2>
        <MediaSelect value={filter} change={setFilter} />
      </header>
      {shown.length > 0 && (
        <div className="radar-grid">
          {shown.map((m) => (
            <RadarCard key={m.id} meta={m} />
          ))}
        </div>
      )}
      {s.error ? (
        <RetryMessage onRetry={s.retry} />
      ) : s.loading ? (
        <Spinner />
      ) : (
        !shown.length && <RowMessage>{t("TMDB lists nothing here yet.")}</RowMessage>
      )}
      {s.hasMore && !s.error && <ShowMore loading={s.loading} onClick={s.more} />}
    </section>
  );
}

function DigitalReleasesSection({ tmdbKey }: { tmdbKey: string }) {
  const t = useT();
  const { people } = useFollows();
  const { setView } = useView();
  const peopleKey = JSON.stringify(people);
  const [month, setMonth] = useState(() => localIsoDay(Date.now()).slice(0, 7));
  const [items, setItems] = useState<DigitalRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const region = "EG";
  const moveMonth = (delta: number) => {
    const [year, number] = month.split("-").map(Number);
    setMonth(localIsoDay(new Date(year, number - 1 + delta, 1).getTime()).slice(0, 7));
  };
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setItems([]);
    const [year, number] = month.split("-").map(Number);
    const end = localIsoDay(new Date(year, number, 0).getTime());
    fetchDigitalReleases(
      tmdbKey,
      region,
      `${month}-01`,
      end,
      JSON.parse(peopleKey),
      controller.signal,
    )
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tmdbKey, region, month, peopleKey, attempt]);
  return (
    <section className="grid gap-4">
      <h2 className="text-2xl font-semibold">
        {t("Digital Releases")} · {t("Egypt")}
      </h2>
      <p>
        {t("Movies from your Following. Verified TMDB digital dates for {region} only.", {
          region: t("Egypt"),
        })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={t("Previous month")}
          onClick={() => moveMonth(-1)}
          className="rounded-lg p-2 hover:bg-elevated"
        >
          <ChevronLeft size={18} className="dir-icon" />
        </button>
        <input
          type="month"
          aria-label={t("Release month")}
          value={month}
          onChange={(event) => {
            if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value);
          }}
          className="rounded-lg bg-surface px-3 py-2 text-[13px] text-ink ring-1 ring-edge-soft"
        />
        <button
          type="button"
          aria-label={t("Next month")}
          onClick={() => moveMonth(1)}
          className="rounded-lg p-2 hover:bg-elevated"
        >
          <ChevronRight size={18} className="dir-icon" />
        </button>
      </div>
      {loading ? (
        Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            aria-label={i === 0 ? t("Loading") : undefined}
            className="h-12 rounded-lg bg-elevated motion-safe:animate-pulse"
          />
        ))
      ) : error ? (
        <RetryMessage onRetry={() => setAttempt((n) => n + 1)} />
      ) : items.length ? (
        <Timeline
          digital
          items={items}
          attribution={new Map(items.map((item) => [item.id, item.people]))}
        />
      ) : (
        <div className="flex min-h-40 max-w-full flex-col justify-center gap-3 text-[13px] leading-relaxed text-ink-subtle">
          <p>
            {people.length
              ? t(
                  "No matching digital releases from your Following in Egypt this month. Try another month or follow more people; regional records may be incomplete.",
                )
              : t("Follow actors and directors to find their verified digital releases.")}
          </p>
          <button
            type="button"
            onClick={() => setView("following")}
            className="self-start text-accent hover:underline"
          >
            {t("Manage Following")}
          </button>
        </div>
      )}
    </section>
  );
}

function ReleasesSection({ tmdbKey }: { tmdbKey: string }) {
  const t = useT();
  const [kind, setKind] = useState<ReleaseKind>("upcoming");
  const loadPage = useCallback(
    (page: number) => fetchReleases(tmdbKey, kind, page),
    [tmdbKey, kind],
  );
  const s = usePagedSection(loadPage);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const { people } = useFollows();
  const { credits } = useFollowCredits(tmdbKey, people);
  const attribution = useMemo(() => new Map(credits.map((c) => [c.id, c.people])), [credits]);
  const shown = s.items.filter((item) => filter === "all" || item.type === filter);
  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-center gap-3">
        {(["upcoming", "new"] as const).map((id) => (
          <button key={id} aria-pressed={kind === id} className={PILL} onClick={() => setKind(id)}>
            {id === "new" ? t("Recently released") : t("Upcoming")}
          </button>
        ))}
        <MediaSelect value={filter} change={setFilter} />
      </header>
      <Timeline items={shown} descending={kind === "new"} attribution={attribution} />
      {s.error ? (
        <RetryMessage onRetry={s.retry} />
      ) : s.loading ? (
        <Spinner />
      ) : (
        !shown.length && <RowMessage>{t("TMDB lists nothing here yet.")}</RowMessage>
      )}
      {s.hasMore && !s.error && <ShowMore loading={s.loading} onClick={s.more} />}
    </section>
  );
}

export function RadarView({ active = true }: { active?: boolean }) {
  const t = useT();
  const { settings } = useSettings();
  const { openSettings, setView } = useView();
  const { people } = useFollows();
  const [space, setSpace] = useState("For You");
  const [digital, setDigital] = useState(false);
  const tmdbKey = settings.tmdbKey;
  const scrollRef = useRef<HTMLElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  useScrollMemory("radar", scrollRef, active);

  const scrollCb = useCallback((el: HTMLElement | null) => {
    (scrollRef as { current: HTMLElement | null }).current = el;
    setScrollEl(el);
  }, []);

  return (
    <main
      data-frame-page="radar"
      ref={scrollCb}
      className="relative h-full overflow-y-auto overflow-x-hidden bg-canvas"
    >
      <ScrollRootContext.Provider value={scrollEl}>
        <div className="relative flex w-full flex-col gap-6 px-5 md:px-12 pb-32 pt-12">
          <header className="frame-section-heading">
            <h1 className="text-[34px] font-semibold tracking-tight text-ink">{t("Radar")}</h1>
            <p className="mt-1 text-[14px] text-ink-subtle">
              {people.length > 0
                ? people.length === 1
                  ? t("Following 1 person.")
                  : t("Following {n} people.", { n: people.length })
                : t("Follow actors and directors to shape what you see here.")}{" "}
              <button
                type="button"
                onClick={() => setView("following")}
                className="text-accent hover:underline"
              >
                {t("Manage Following")}
              </button>
            </p>
          </header>
          {!tmdbKey ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl bg-surface p-6 ring-1 ring-edge-soft">
              <p className="text-[14px] text-ink">
                {t("Radar reads titles and people from TMDB. Add your TMDB key to use it.")}
              </p>
              <button
                type="button"
                onClick={() => openSettings("library")}
                className="rounded-full bg-accent px-4 py-1.5 text-[13px] font-semibold text-canvas"
              >
                {t("Add TMDB key")}
              </button>
            </div>
          ) : (
            <>
              <nav className="frame-radar-index" aria-label={t("Radar")}>
                {["For You", "Releases", "Explore"].map((label) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={space === label}
                    onClick={() => setSpace(label)}
                  >
                    {t(label)}
                  </button>
                ))}
              </nav>
              {active &&
                (space === "For You" ? (
                  <ForYouSection tmdbKey={tmdbKey} />
                ) : space === "Explore" ? (
                  <TrendingSection tmdbKey={tmdbKey} />
                ) : (
                  <section className="grid gap-5">
                    <div className="flex gap-3">
                      {[false, true].map((value) => (
                        <button
                          key={String(value)}
                          aria-pressed={digital === value}
                          className={PILL}
                          onClick={() => setDigital(value)}
                        >
                          {value
                            ? t("Digital Releases") + " · " + t("Egypt")
                            : t("Release calendar")}
                        </button>
                      ))}
                    </div>
                    {digital ? (
                      <DigitalReleasesSection tmdbKey={tmdbKey} />
                    ) : (
                      <ReleasesSection tmdbKey={tmdbKey} />
                    )}
                  </section>
                ))}
            </>
          )}
        </div>
        <BackToTop scrollRef={scrollRef} />
      </ScrollRootContext.Provider>
    </main>
  );
}
