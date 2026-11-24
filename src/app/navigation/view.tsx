import type { SectionId } from "@/views/settings/shared";
import {
  navigateUnderPreview,
  previewPageStack,
  withoutTrailingPlayers,
} from "../../features/player/engine/docked-navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { subscribeOpenProfile } from "@/lib/social/open-profile";
import { subscribeOpenGroup } from "@/lib/social/open-group";
import { useBigPicture } from "@/lib/big-picture";
import type { Meta } from "../../lib/cinemeta";
import type { PeopleDept, RankSource } from "../../lib/harbor-rank";
import { profileFromMeta, trackEvent } from "../../features/discovery/discover";
import type { StreamingService } from "../../lib/settings";
import { useTogether } from "../../lib/together/provider";
import { beginMarathonAdvance } from "../../lib/fullscreen-state";
import { consumeBack } from "../../lib/back-intercept";
import { useSectionBackActive } from "../../lib/section-back";
import type { SubtitleLoadMetadata } from "../../features/subtitles/types";

export type View =
  | "home"
  | "settings"
  | "anime"
  | "discover"
  | "catalogs"
  | "plugins"
  | "addons"
  | "calendar"
  | "movies"
  | "shows"
  | "music"
  | "games"
  | "kids"
  | "library"
  | "collections-hub"
  | "live"
  | "sports"
  | "vod"
  | "downloads"
  | "wrapped"
  | "manga"
  | "ebook"
  | "people"
  | "radar"
  | "following";

export type PlayEpisode = {
  season: number;
  episode: number;
  name?: string;
  imdbId?: string;
  imdbSeason?: number;
  imdbEpisode?: number;
  absoluteNumber?: number;
  tvdbEpisodeId?: number;
  kitsuStreamId?: string;
  sourceMetaId?: string;
  videoId?: string;
  still?: string;
  overview?: string;
  rating?: number;
  airDate?: string;
  runtime?: number;
};

/** Source identity stays separate from the provider coordinates used for episode details. */
export type EpisodeDetailPlayback = { meta: Meta; episode: PlayEpisode };

export type PlayerSrc = {
  /** The video moved to its own window, so the player keeps the session but yields the page. */
  pipDocked?: boolean;
  meta: Meta;
  playbackTraceId?: string;
  proxySessionId?: string;
  historyUrl?: string;
  imdbId?: string;
  imdbIdVerified?: boolean;
  episode?: PlayEpisode;
  /** Last logical episode covered by the physical source. */
  episodeEnd?: number;
  episodeSpan?: import("../../lib/episode-span").EpisodeSpan;
  url: string;
  title: string;
  subtitle?: string;
  notWebReady?: boolean;
  isAnime?: boolean;
  subtitles?: Array<{
    url: string;
    lang?: string;
    id?: string;
    /** The path came from the user's local library or a configured home server, not an addon. */
    trustedSource?: boolean;
  }>;
  subtitlePreselect?: {
    off: boolean;
    url?: string;
    lang?: string;
    title?: string;
    metadata?: SubtitleLoadMetadata;
  };
  attempt?: number;
  autoFired?: boolean;
  resume?: boolean;
  startFromZero?: boolean;
  streamRef?: PlayerStreamRef;
  liveProgram?: string;
  isLive?: boolean;
  headers?: Record<string, string>;
  homeServer?: {
    connectionId: string;
    itemId: string;
    versionId: string;
    quality: import("../../lib/media-server/types").MediaServerQuality;
    playbackSessionId?: string;
  };
  startPositionMs?: number;
  startPaused?: boolean;
};

export type PlayerStreamRef = {
  /** Exact media filename selected after local/torrent/debrid resolution. */
  resolvedFilename?: string | null;
  infoHash?: string | null;
  fileIdx?: number | null;
  addonId?: string | null;
  title?: string | null;
  parsedTitle?: string | null;
  resolution?: string | null;
  quality?: string | null;
  releaseGroup?: string | null;
  source?: string | null;
  size?: number | null;
  bingeGroup?: string | null;
  cachedSlugs?: string[];
};

export type GridSpec = {
  title: string;
  fetcher: (page: number, loaded?: number) => Promise<Meta[]>;
  initial?: Meta[];
  /** Last complete page in initial; use 0 for a capped/filtered row preview. */
  initialPage?: number;
  kidsHero?: { grad: string; art: string; name: string };
};

export type MetaFilter =
  | { kind: "year"; mediaType: "movie" | "tv"; value: number }
  | { kind: "runtime"; mediaType: "movie" | "tv"; value: number }
  | { kind: "genre"; mediaType: "movie" | "tv"; name: string; id: number }
  | { kind: "studio"; mediaType: "movie" | "tv"; name: string; id: number }
  | { kind: "country"; mediaType: "movie" | "tv"; name: string; iso: string }
  | { kind: "language"; mediaType: "movie" | "tv"; name: string; iso: string }
  | { kind: "network"; mediaType: "movie" | "tv"; name: string; id: number };

export type Frame =
  | { kind: "home" }
  | { kind: "settings" }
  | { kind: "anime" }
  | { kind: "discover" }
  | { kind: "catalogs" }
  | { kind: "plugins" }
  | { kind: "addons" }
  | { kind: "addon-detail"; id: string }
  | { kind: "calendar" }
  | { kind: "wrapped" }
  | { kind: "queue" }
  | { kind: "movies" }
  | { kind: "shows" }
  | { kind: "music" }
  | { kind: "games" }
  | { kind: "kids" }
  | { kind: "library" }
  | { kind: "live" }
  | { kind: "sports" }
  | { kind: "vod" }
  | { kind: "downloads" }
  | { kind: "manga"; mangaId?: string }
  | { kind: "ebook"; ebookId?: string }
  | { kind: "radar" }
  | { kind: "following" }
  | { kind: "people"; source?: RankSource; dept?: PeopleDept; focusSource?: boolean; nonce: number }
  | { kind: "service"; service: StreamingService }
  | {
      kind: "meta";
      meta: Meta;
      liveContext?: boolean;
      episodeHint?: { season: number; episode: number };
      seasonEntryId?: string;
    }
  | { kind: "addon-collection"; meta: Meta }
  | {
      kind: "episode-detail";
      seriesId: string;
      season: number;
      episode: number;
      seriesMeta?: Meta;
      playback?: EpisodeDetailPlayback;
    }
  | { kind: "person"; id: number }
  | { kind: "profile"; handle: string }
  | { kind: "feed" }
  | { kind: "groups" }
  | { kind: "group"; id: string }
  | { kind: "list"; handle: string; listId: string }
  | { kind: "collection"; id: number }
  | { kind: "collections" }
  | { kind: "collections-hub" }
  | { kind: "filter"; filter: MetaFilter }
  | { kind: "brands"; brand: "studio" | "network" }
  | { kind: "grid"; grid: GridSpec }
  | { kind: "award"; awardType: import("../../lib/providers/wikidata").AwardType }
  | { kind: "anime-award"; sourceId: import("../../lib/anime-awards").AwardSourceId }
  | { kind: "curated-list"; listId: string }
  | {
      kind: "picker";
      meta: Meta;
      episode?: PlayEpisode;
      autoPlay?: boolean;
      attempt?: number;
      intent?: "play" | "download";
      seasonEpisodes?: PlayEpisode[];
      resume?: boolean;
    }
  | { kind: "player"; src: PlayerSrc }
  | { kind: "match-detail" };

export type ScrollSnapshot = {
  anchor?: string;
  delta: number;
  fallback: number;
};

/** How long to wait before asking again whether a layer has been laid out, and how many times.
 * A view that is on screen is laid out within a frame or two; anything longer means it is parked
 * and genuinely has no height, so the asking stops rather than running forever. */

export type SettingsSection = SectionId;

type ViewValue = {
  openGames: () => void;
  view: View;
  setView: (v: View) => void;
  openSettings: (section?: SettingsSection) => void;
  settingsSectionRequest: { section: SettingsSection | null; nonce: number };
  topKind: Frame["kind"];
  topPath: string;
  rootFrame: Frame;
  service: StreamingService | null;
  openService: (s: StreamingService | null) => void;
  meta: Meta | null;
  metaLiveContext: boolean;
  metaEpisodeHint: { season: number; episode: number } | null;
  metaSeasonEntryId: string | null;
  openMeta: (
    m: Meta | null,
    opts?: {
      liveContext?: boolean;
      episodeHint?: { season: number; episode: number };
      seasonEntryId?: string;
      exact?: boolean;
    },
  ) => void;
  episodeDetail: {
    seriesId: string;
    season: number;
    episode: number;
    seriesMeta?: Meta;
    playback?: EpisodeDetailPlayback;
  } | null;
  openEpisodeDetail: (
    seriesId: string,
    season: number,
    episode: number,
    seriesMeta?: Meta,
    playback?: EpisodeDetailPlayback,
  ) => void;
  promoteMetaToRoot: () => void;
  personId: number | null;
  openPerson: (id: number | null) => void;
  profileHandle: string | null;
  openProfile: (handle: string) => void;
  feedOpen: boolean;
  openFeed: () => void;
  groupsOpen: boolean;
  openGroups: () => void;
  groupId: string | null;
  openGroup: (id: string) => void;
  listHandle: string | null;
  listId: string | null;
  openList: (handle: string, listId: string) => void;
  collectionId: number | null;
  openCollection: (id: number) => void;
  peopleInit: {
    source?: RankSource;
    dept?: PeopleDept;
    focusSource?: boolean;
    nonce: number;
  } | null;
  openPeople: (opts?: { source?: RankSource; dept?: PeopleDept; focusSource?: boolean }) => void;
  addonCollectionMeta: Meta | null;
  openQueue: () => void;
  filter: MetaFilter | null;
  openFilter: (f: MetaFilter) => void;
  brands: "studio" | "network" | null;
  openBrands: (brand: "studio" | "network") => void;
  grid: GridSpec | null;
  openGrid: (g: GridSpec) => void;
  openCollections: () => void;
  stackKinds: Frame["kind"][];
  awardType: import("../../lib/providers/wikidata").AwardType | null;
  openAward: (t: import("../../lib/providers/wikidata").AwardType) => void;
  animeAwardSource: import("../../lib/anime-awards").AwardSourceId | null;
  openAnimeAward: (s: import("../../lib/anime-awards").AwardSourceId) => void;
  curatedListId: string | null;
  openCuratedList: (id: string) => void;
  homeResetTick: number;
  picker: {
    meta: Meta;
    episode?: PlayEpisode;
    autoPlay?: boolean;
    attempt?: number;
    intent?: "play" | "download";
    seasonEpisodes?: PlayEpisode[];
    resume?: boolean;
  } | null;
  openPicker: (
    meta: Meta,
    episode?: PlayEpisode,
    opts?: {
      autoPlay?: boolean;
      attempt?: number;
      intent?: "play" | "download";
      seasonEpisodes?: PlayEpisode[];
      resume?: boolean;
    },
  ) => void;
  player: PlayerSrc | null;
  openPlayer: (src: PlayerSrc) => void;
  replacePlayerSrc: (src: PlayerSrc) => void;
  pendingLiveSrc: PlayerSrc | null;
  confirmLeavePartyForLive: () => void;
  cancelLeavePartyForLive: () => void;
  addonDetailId: string | null;
  openAddonDetail: (id: string) => void;
  navDepth: number;
  canGoBack: boolean;
  goBack: () => void;
  canGoForward: boolean;
  goForward: () => void;
  exitPlayback: () => void;
  setPipDocked: (docked: boolean) => void;
  exitPickerToDetail: (m: Meta) => void;
  exitPlayer: () => void;
  rememberScroll: (key: string, snap: ScrollSnapshot) => void;
  recallScroll: (key: string) => ScrollSnapshot | null;
  rememberRowScroll: (key: string, scrollLeft: number) => void;
  recallRowScroll: (key: string) => number | null;
  chromeHidden: boolean;
  setChromeHidden: (b: boolean) => void;
  setNavStack: (updater: (s: Frame[]) => Frame[]) => void;
};

const Ctx = createContext<ViewValue | null>(null);

const STACK_MAX = 30;
const SCROLL_MEM_MAX = 200;

function pushFrame(cur: Frame[], next: Frame): Frame[] {
  const out = [...cur, next];
  if (out.length <= STACK_MAX) return out;
  return [out[0], ...out.slice(out.length - STACK_MAX + 1)];
}

function frameKey(f: Frame): string {
  switch (f.kind) {
    case "match-detail":
      return "match-detail";
    case "home":
      return "home";
    case "settings":
      return "settings";
    case "anime":
      return "anime";
    case "discover":
      return "discover";
    case "catalogs":
      return "catalogs";
    case "plugins":
      return "plugins";
    case "addons":
      return "addons";
    case "addon-detail":
      return `addon-detail:${f.id}`;
    case "calendar":
      return "calendar";
    case "wrapped":
      return "wrapped";
    case "queue":
      return "queue";
    case "movies":
      return "movies";
    case "shows":
      return "shows";
    case "music":
      return "music";
    case "games":
      return "games";
    case "kids":
      return "kids";
    case "library":
      return "library";
    case "live":
      return "live";
    case "sports":
      return "sports";
    case "vod":
      return "vod";
    case "downloads":
      return "downloads";
    case "manga":
      return f.mangaId ? `manga:${f.mangaId}` : "manga";
    case "ebook":
      return f.ebookId ? `ebook:${f.ebookId}` : "ebook";
    case "people":
      return "people";
    case "radar":
      return "radar";
    case "following":
      return "following";
    case "service":
      return `service:${f.service}`;
    case "meta":
      return `meta:${f.meta.id}`;
    case "addon-collection":
      return `addon-collection:${f.meta.id}`;
    case "episode-detail":
      return `episode-detail:${f.seriesId}:${f.season}:${f.episode}`;
    case "person":
      return `person:${f.id}`;
    case "profile":
      return `profile:${f.handle}`;
    case "feed":
      return "feed";
    case "groups":
      return "groups";
    case "group":
      return `group:${f.id}`;
    case "list":
      return `list:${f.handle}:${f.listId}`;
    case "collection":
      return `collection:${f.id}`;
    case "collections":
      return "collections";
    case "collections-hub":
      return "collections-hub";
    case "filter":
      return `filter:${f.filter.kind}:${f.filter.mediaType}:${"name" in f.filter ? f.filter.name : f.filter.value}`;
    case "brands":
      return `brands:${f.brand}`;
    case "grid":
      return `grid:${f.grid.title}`;
    case "award":
      return `award:${f.awardType}`;
    case "anime-award":
      return `anime-award:${f.sourceId}`;
    case "curated-list":
      return `curated-list:${f.listId}`;
    case "picker": {
      const a = typeof f.attempt === "number" ? `:a${f.attempt}` : "";
      return f.episode
        ? `picker:${f.meta.id}:${f.episode.season}:${f.episode.episode}${a}`
        : `picker:${f.meta.id}${a}`;
    }
    case "player":
      return `player:${f.src.meta.id}:${f.src.url.slice(-32)}`;
  }
}

function syncFrameKey(f: Frame): string {
  if (f.kind === "player") {
    const id = f.src.meta.id || `local:${f.src.url.slice(-32)}`;
    const ep = f.src.episode;
    return ep ? `player:${id}:${ep.season}:${ep.episode}` : `player:${id}`;
  }
  if (f.kind === "picker") {
    return f.episode
      ? `picker:${f.meta.id}:${f.episode.season}:${f.episode.episode}`
      : `picker:${f.meta.id}`;
  }
  return frameKey(f);
}

function lastOfKind<K extends Frame["kind"]>(
  frames: Frame[],
  kind: K,
): Extract<Frame, { kind: K }> | undefined {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (f.kind === kind) return f as Extract<Frame, { kind: K }>;
  }
  return undefined;
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Frame[]>([{ kind: "home" }]);
  const [forwardStack, setForwardStack] = useState<Frame[]>([]);
  const stackRef = useRef(stack);
  const forwardStackRef = useRef(forwardStack);
  stackRef.current = stack;
  forwardStackRef.current = forwardStack;
  const [chromeHidden, setChromeHidden] = useState(false);
  // Big Picture is its own full-screen shell, so every layout's nav stands down
  // for it. That is exactly what chromeHidden means to the chrome components,
  // and routing it through here is what finally hides them: the MinUI dock read
  // chromeHidden but nothing ever set it for Big Picture, so it kept painting
  // over the shell as a bordered box.
  const bigPictureActive = useBigPicture().active;
  const sectionBackActive = useSectionBackActive();
  const [homeResetTick, setHomeResetTick] = useState(0);
  const scrollMem = useRef<Map<string, ScrollSnapshot>>(new Map());
  const rowScrollMem = useRef<Map<string, number>>(new Map());
  const rememberRowScroll = useCallback((k: string, scrollLeft: number) => {
    rowScrollMem.current.set(k, scrollLeft);
  }, []);
  const recallRowScroll = useCallback((k: string): number | null => {
    const v = rowScrollMem.current.get(k);
    return typeof v === "number" ? v : null;
  }, []);
  const rememberScroll = useCallback((k: string, snap: ScrollSnapshot) => {
    const m = scrollMem.current;
    m.delete(k);
    m.set(k, snap);
    while (m.size > SCROLL_MEM_MAX) {
      const oldest = m.keys().next().value;
      if (oldest === undefined) break;
      m.delete(oldest);
    }
  }, []);
  const recallScroll = useCallback((k: string): ScrollSnapshot | null => {
    const m = scrollMem.current;
    const v = m.get(k);
    if (!v) return null;
    m.delete(k);
    m.set(k, v);
    return v;
  }, []);

  const playbackTop = stack[stack.length - 1];
  const top =
    playbackTop.kind === "player" && playbackTop.src.pipDocked && stack.length > 1
      ? withoutTrailingPlayers(stack).at(-1)!
      : playbackTop;
  const rootFrame = stack[0];

  const view: View = (() => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i];
      if (f.kind === "settings") return "settings";
      if (f.kind === "anime") return "anime";
      if (f.kind === "addons" || f.kind === "addon-detail") return "addons";
      if (f.kind === "discover" || f.kind === "queue") return "discover";
      if (f.kind === "catalogs") return "catalogs";
      if (f.kind === "plugins") return "plugins";
      if (f.kind === "calendar") return "calendar";
      if (f.kind === "wrapped") return "wrapped";
      if (f.kind === "movies") return "movies";
      if (f.kind === "shows") return "shows";
      if (f.kind === "music") return "music";
      if (f.kind === "games") return "games";
      if (f.kind === "kids") return "kids";
      if (f.kind === "library") return "library";
      if (f.kind === "collections-hub") return "collections-hub";
      if (f.kind === "live") return "live";
      if (f.kind === "sports") return "sports";
      if (f.kind === "vod") return "vod";
      if (f.kind === "downloads") return "downloads";
      if (f.kind === "manga") return "manga";
      if (f.kind === "ebook") return "ebook";
      if (f.kind === "people") return "people";
      if (f.kind === "radar") return "radar";
      if (f.kind === "following") return "following";
      if (f.kind === "home") return "home";
    }
    return "home";
  })();
  const service = top.kind === "service" ? top.service : null;
  const metaFrame = stack
    .slice()
    .reverse()
    .find((f) => f.kind === "meta");
  const meta = metaFrame && metaFrame.kind === "meta" ? metaFrame.meta : null;
  const metaLiveContext =
    metaFrame && metaFrame.kind === "meta" ? metaFrame.liveContext === true : false;
  const metaEpisodeHint =
    metaFrame && metaFrame.kind === "meta" ? (metaFrame.episodeHint ?? null) : null;
  const metaSeasonEntryId =
    metaFrame && metaFrame.kind === "meta" ? (metaFrame.seasonEntryId ?? null) : null;
  const personFrame = lastOfKind(stack, "person");
  const personId = personFrame ? personFrame.id : null;
  const profileFrame = lastOfKind(stack, "profile");
  const profileHandle = profileFrame ? profileFrame.handle : null;
  const feedOpen = !!lastOfKind(stack, "feed");
  const groupsOpen = !!lastOfKind(stack, "groups");
  const groupFrame = lastOfKind(stack, "group");
  const groupId = groupFrame ? groupFrame.id : null;
  const listFrame = lastOfKind(stack, "list");
  const listHandle = listFrame ? listFrame.handle : null;
  const listId = listFrame ? listFrame.listId : null;
  const collectionFrame = lastOfKind(stack, "collection");
  const collectionId = collectionFrame ? collectionFrame.id : null;
  const peopleFrame = lastOfKind(stack, "people");
  const peopleInit = useMemo(
    () =>
      peopleFrame
        ? {
            source: peopleFrame.source,
            dept: peopleFrame.dept,
            focusSource: peopleFrame.focusSource,
            nonce: peopleFrame.nonce,
          }
        : null,
    [peopleFrame?.source, peopleFrame?.dept, peopleFrame?.focusSource, peopleFrame?.nonce],
  );
  const addonCollectionFrame = lastOfKind(stack, "addon-collection");
  const addonCollectionMeta = addonCollectionFrame ? addonCollectionFrame.meta : null;
  const episodeDetail = useMemo(
    () =>
      top.kind === "episode-detail"
        ? {
            seriesId: top.seriesId,
            season: top.season,
            episode: top.episode,
            seriesMeta: top.seriesMeta,
            playback: top.playback,
          }
        : null,
    [
      top.kind,
      top.kind === "episode-detail" ? top.seriesId : "",
      top.kind === "episode-detail" ? top.season : 0,
      top.kind === "episode-detail" ? top.episode : 0,
      top.kind === "episode-detail" ? top.seriesMeta : undefined,
      top.kind === "episode-detail" ? top.playback : undefined,
    ],
  );
  const filterFrame = lastOfKind(stack, "filter");
  const filter = filterFrame ? filterFrame.filter : null;
  const brandsFrame = lastOfKind(stack, "brands");
  const brands = brandsFrame ? brandsFrame.brand : null;
  const gridFrame = lastOfKind(stack, "grid");
  const grid = gridFrame ? gridFrame.grid : null;
  const awardType = top.kind === "award" ? top.awardType : null;
  const picker =
    top.kind === "picker"
      ? {
          meta: top.meta,
          episode: top.episode,
          autoPlay: top.autoPlay,
          attempt: top.attempt,
          intent: top.intent,
          seasonEpisodes: top.seasonEpisodes,
          resume: top.resume,
        }
      : null;
  const player = playbackTop.kind === "player" ? playbackTop.src : null;
  const canGoBack = previewPageStack(stack).length > 1 || sectionBackActive;
  const canGoForward = forwardStack.length > 0;

  const pop = useCallback(() => {
    if (consumeBack()) return;
    const cur = stackRef.current;
    const pages = previewPageStack(cur);
    if (pages.length <= 1) return;
    const nextStack = navigateUnderPreview(cur, (frames) => frames.slice(0, -1));
    const nextForwardStack = pushFrame(forwardStackRef.current, pages[pages.length - 1]);
    stackRef.current = nextStack;
    forwardStackRef.current = nextForwardStack;
    setStack(nextStack);
    setForwardStack(nextForwardStack);
  }, []);

  const goForward = useCallback(() => {
    const curForward = forwardStackRef.current;
    const nextFrame = curForward[curForward.length - 1];
    if (!nextFrame) return;
    const nextForwardStack = curForward.slice(0, -1);
    const nextStack = navigateUnderPreview(stackRef.current, (frames) =>
      pushFrame(frames, nextFrame),
    );
    stackRef.current = nextStack;
    forwardStackRef.current = nextForwardStack;
    setStack(nextStack);
    setForwardStack(nextForwardStack);
  }, []);

  const clearForwardStack = useCallback(() => {
    if (forwardStackRef.current.length === 0) return;
    forwardStackRef.current = [];
    setForwardStack([]);
  }, []);

  const setNavStack = useCallback(
    (updater: (s: Frame[]) => Frame[], preserveDock = true) => {
      clearForwardStack();
      setStack((current) =>
        preserveDock ? navigateUnderPreview(current, updater) : updater(current),
      );
    },
    [clearForwardStack],
  );

  const exitPlayback = useCallback(() => {
    setNavStack((s) => {
      let i = s.length - 1;
      while (i > 0 && (s[i].kind === "player" || s[i].kind === "picker")) i--;
      return s.slice(0, i + 1);
    }, false);
  }, [setNavStack]);

  /** Detached PiP yields the page without ending playback, so the frame stays on the
   *  stack and only stops being the one on screen. */
  const setPipDocked = useCallback(
    (docked: boolean) => {
      setNavStack((s) => {
        const at = s.length - 1;
        const frame = s[at];
        if (!frame || frame.kind !== "player") return s;
        if (!!frame.src.pipDocked === docked) return s;
        const next = s.slice();
        next[at] = { ...frame, src: { ...frame.src, pipDocked: docked } };
        return next;
      }, false);
    },
    [setNavStack],
  );

  const exitPickerToDetail = useCallback(
    (m: Meta) => {
      setNavStack((s) => {
        let i = s.length - 1;
        while (i > 0 && (s[i].kind === "player" || s[i].kind === "picker")) i--;
        const base = s.slice(0, i + 1);
        const top = base[base.length - 1];
        if (top && top.kind === "meta") return base;
        return [...base, { kind: "meta", meta: m }];
      });
    },
    [setNavStack],
  );

  const exitPlayer = useCallback(() => {
    setNavStack((s) => {
      let i = s.length - 1;
      while (i > 0 && s[i].kind === "player") i--;
      const next = s.slice(0, i + 1);
      const top = next[next.length - 1];
      if (top && top.kind === "picker" && top.autoPlay) {
        next[next.length - 1] = { ...top, autoPlay: false };
      }
      return next;
    }, false);
  }, [setNavStack]);

  const [sectionReq, setSectionReq] = useState<{ section: SettingsSection | null; nonce: number }>({
    section: null,
    nonce: 0,
  });

  const setView = useCallback(
    (v: View) => {
      if (typeof window !== "undefined") {
        window.__harborProfiler?.recordNav(`view:${v}`);
      }
      if (v === "home") setHomeResetTick((n) => n + 1);
      if (typeof window !== "undefined" && v !== "settings") {
        window.dispatchEvent(
          new CustomEvent("harbor:reset-row-scrolls", { detail: { prefix: `${v}:` } }),
        );
        const fireScrollTop = () =>
          window.dispatchEvent(new CustomEvent("harbor:scroll-top", { detail: { view: v } }));
        fireScrollTop();
        window.requestAnimationFrame(fireScrollTop);
        window.setTimeout(fireScrollTop, 60);
      }
      setNavStack((s) => {
        const t = s[s.length - 1];
        if (v === "home") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "home" }];
        }
        if (v === "anime") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "anime" }];
        }
        if (v === "discover") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "discover" }];
        }
        if (v === "catalogs") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "catalogs" }];
        }
        if (v === "plugins") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "plugins" }];
        }
        if (v === "addons") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "addons" }];
        }
        if (v === "calendar") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "calendar" }];
        }
        if (v === "wrapped") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "wrapped" }];
        }
        if (v === "downloads") {
          if (t.kind === "downloads") return s;
          return pushFrame(s, { kind: "downloads" });
        }
        if (v === "movies") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "movies" }];
        }
        if (v === "shows") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "shows" }];
        }
        if (v === "music") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "music" }];
        }
        if (v === "games") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "games" }];
        }
        if (v === "kids") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "kids" }];
        }
        if (v === "library") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "library" }];
        }
        if (v === "collections-hub") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "collections-hub" }];
        }
        if (v === "live") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "live" }];
        }
        if (v === "sports") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "sports" }];
        }
        if (v === "vod") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "vod" }];
        }
        if (v === "manga") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "manga" }];
        }
        if (v === "ebook") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "ebook" }];
        }
        if (v === "people") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: "people", nonce: Date.now() }];
        }
        if (v === "radar" || v === "following") {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return [{ kind: v }];
        }
        if (t.kind === "settings") return s;
        return pushFrame(s, { kind: "settings" });
      });
    },
    [setNavStack],
  );

  const openSettings = useCallback(
    (section?: SettingsSection) => {
      setSectionReq((r) => ({ section: section ?? null, nonce: r.nonce + 1 }));
      setNavStack((s) => {
        const t = s[s.length - 1];
        if (t.kind === "settings") return s;
        return pushFrame(s, { kind: "settings" });
      });
    },
    [setNavStack],
  );

  const openService = useCallback(
    (s: StreamingService | null) => {
      if (s === null) {
        setNavStack((cur) => {
          scrollMem.current.clear();
          rowScrollMem.current.clear();
          return cur.length === 1 && cur[0].kind === "home" ? cur : [{ kind: "home" }];
        });
        return;
      }
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (t.kind === "service" && t.service === s) return cur;
        return pushFrame(cur, { kind: "service", service: s });
      });
    },
    [setNavStack],
  );

  const promoteMetaToRoot = useCallback(() => {
    setNavStack((s) => {
      if (s.length === 0) return s;
      const top = s[s.length - 1];
      if (top.kind !== "meta") return s;
      const m = top.meta;
      let root: Frame;
      if (m.type === "series" || m.type === "tv" || m.type === "anime") root = { kind: "shows" };
      else root = { kind: "movies" };
      return [root, { kind: "meta", meta: m }];
    });
  }, [setNavStack]);

  const openMeta = useCallback(
    (
      m: Meta | null,
      opts?: {
        liveContext?: boolean;
        episodeHint?: { season: number; episode: number };
        seasonEntryId?: string;
        exact?: boolean;
      },
    ) => {
      if (m === null) {
        setNavStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
        return;
      }
      if (m.isCollection) {
        setNavStack((cur) => {
          const t = cur[cur.length - 1];
          if (t.kind === "addon-collection" && t.meta.id === m.id) return cur;
          return pushFrame(cur, { kind: "addon-collection", meta: m });
        });
        return;
      }
      const push = (target: Meta, seasonEntryId?: string) => {
        setNavStack((cur) => {
          const t = cur[cur.length - 1];
          if (t.kind === "meta" && t.meta.id === target.id) return cur;
          const returningToSeries =
            t.kind === "episode-detail" && (t.seriesMeta?.id ?? t.seriesId) === target.id;
          if (returningToSeries) {
            // The episode's series link returns to its parent, not another history entry.
            for (let i = cur.length - 2; i >= 0; i--) {
              const frame = cur[i];
              if (frame.kind === "meta" && frame.meta.id === target.id) return cur.slice(0, i + 1);
            }
          }
          trackEvent(target.id, "open", profileFromMeta(target));
          return pushFrame(returningToSeries ? cur.slice(0, -1) : cur, {
            kind: "meta",
            meta: target,
            liveContext: opts?.liveContext,
            episodeHint: opts?.episodeHint,
            seasonEntryId: seasonEntryId ?? opts?.seasonEntryId,
          });
        });
      };
      push(m);
    },
    [setNavStack],
  );

  const openPerson = useCallback(
    (id: number | null) => {
      if (id === null) {
        setNavStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
        return;
      }
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (t.kind === "person" && t.id === id) return cur;
        return pushFrame(cur, { kind: "person", id });
      });
    },
    [setNavStack],
  );

  const openProfile = useCallback(
    (handle: string) => {
      const h = handle.trim().toLowerCase();
      if (!h) return;
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (t.kind === "profile" && t.handle === h) return cur;
        return pushFrame(cur, { kind: "profile", handle: h });
      });
    },
    [setNavStack],
  );
  useEffect(() => subscribeOpenProfile(openProfile), [openProfile]);

  const openFeed = useCallback(() => {
    setNavStack((cur) => {
      const t = cur[cur.length - 1];
      if (t.kind === "feed") return cur;
      return pushFrame(cur, { kind: "feed" });
    });
  }, [setNavStack]);

  const openGroups = useCallback(() => {
    setNavStack((cur) => {
      const t = cur[cur.length - 1];
      if (t.kind === "groups") return cur;
      return pushFrame(cur, { kind: "groups" });
    });
  }, [setNavStack]);

  const openGroup = useCallback(
    (id: string) => {
      const g = id.trim();
      if (!g) return;
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (t.kind === "group" && t.id === g) return cur;
        return pushFrame(cur, { kind: "group", id: g });
      });
    },
    [setNavStack],
  );
  useEffect(() => subscribeOpenGroup(openGroup), [openGroup]);

  const openList = useCallback(
    (handle: string, listId: string) => {
      const h = handle.trim().toLowerCase();
      if (!h || !listId) return;
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (t.kind === "list" && t.handle === h && t.listId === listId) return cur;
        return pushFrame(cur, { kind: "list", handle: h, listId });
      });
    },
    [setNavStack],
  );

  const openQueue = useCallback(() => {
    setNavStack((cur) => {
      const t = cur[cur.length - 1];
      if (t.kind === "queue") return cur;
      return pushFrame(cur, { kind: "queue" });
    });
  }, [setNavStack]);

  const openCollection = useCallback(
    (id: number) => {
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (t.kind === "collection" && t.id === id) return cur;
        return pushFrame(cur, { kind: "collection", id });
      });
    },
    [setNavStack],
  );

  const openPeople = useCallback(
    (opts?: { source?: RankSource; dept?: PeopleDept; focusSource?: boolean }) => {
      setNavStack((cur) => {
        const top = cur[cur.length - 1];
        const frame: Frame = {
          kind: "people",
          source: opts?.source,
          dept: opts?.dept,
          focusSource: opts?.focusSource,
          nonce: Date.now(),
        };
        if (top.kind === "people") return [...cur.slice(0, -1), frame];
        return pushFrame(cur, frame);
      });
    },
    [setNavStack],
  );

  const openGames = useCallback(() => {
    setNavStack((cur) => (cur.at(-1)?.kind === "games" ? cur : pushFrame(cur, { kind: "games" })));
  }, [setNavStack]);

  const openEpisodeDetail = useCallback(
    (
      seriesId: string,
      season: number,
      episode: number,
      seriesMeta?: Meta,
      playback?: EpisodeDetailPlayback,
    ) => {
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (
          t.kind === "episode-detail" &&
          t.seriesId === seriesId &&
          t.season === season &&
          t.episode === episode &&
          t.seriesMeta?.id === seriesMeta?.id &&
          t.playback?.meta.id === playback?.meta.id &&
          t.playback?.episode.season === playback?.episode.season &&
          t.playback?.episode.episode === playback?.episode.episode
        ) {
          return cur;
        }
        return pushFrame(cur, {
          kind: "episode-detail",
          seriesId,
          season,
          episode,
          seriesMeta,
          playback,
        });
      });
    },
    [setNavStack],
  );

  const openAward = useCallback(
    (t: import("../../lib/providers/wikidata").AwardType) => {
      setNavStack((cur) => {
        const top = cur[cur.length - 1];
        if (top.kind === "award" && top.awardType === t) return cur;
        return pushFrame(cur, { kind: "award", awardType: t });
      });
    },
    [setNavStack],
  );

  const openAnimeAward = useCallback(
    (s: import("../../lib/anime-awards").AwardSourceId) => {
      setNavStack((cur) => {
        const top = cur[cur.length - 1];
        if (top.kind === "anime-award" && top.sourceId === s) return cur;
        return pushFrame(cur, { kind: "anime-award", sourceId: s });
      });
    },
    [setNavStack],
  );

  const openCuratedList = useCallback(
    (id: string) => {
      setNavStack((cur) => {
        const top = cur[cur.length - 1];
        if (top.kind === "curated-list" && top.listId === id) return cur;
        return pushFrame(cur, { kind: "curated-list", listId: id });
      });
    },
    [setNavStack],
  );

  const openFilter = useCallback(
    (f: MetaFilter) => {
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (
          t.kind === "filter" &&
          t.filter.kind === f.kind &&
          t.filter.mediaType === f.mediaType &&
          ("name" in f && "name" in t.filter
            ? t.filter.name === f.name
            : (t.filter as any).value === (f as any).value)
        ) {
          return cur;
        }
        return pushFrame(cur, { kind: "filter", filter: f });
      });
    },
    [setNavStack],
  );

  const openBrands = useCallback(
    (brand: "studio" | "network") => {
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (t.kind === "brands" && t.brand === brand) return cur;
        return pushFrame(cur, { kind: "brands", brand });
      });
    },
    [setNavStack],
  );

  const openGrid = useCallback(
    (g: GridSpec) => {
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (t.kind === "grid" && t.grid.title === g.title) return cur;
        return pushFrame(cur, { kind: "grid", grid: g });
      });
    },
    [setNavStack],
  );

  const openCollections = useCallback(() => {
    setNavStack((cur) => {
      const t = cur[cur.length - 1];
      if (t.kind === "collections") return cur;
      return pushFrame(cur, { kind: "collections" });
    });
  }, [setNavStack]);

  const openPicker = useCallback(
    (
      m: Meta,
      ep?: PlayEpisode,
      opts?: {
        autoPlay?: boolean;
        attempt?: number;
        intent?: "play" | "download";
        seasonEpisodes?: PlayEpisode[];
        resume?: boolean;
      },
    ) => {
      if (m.id?.startsWith("magnet:")) {
        setNavStack((s) => {
          let i = s.length - 1;
          while (i > 0 && (s[i].kind === "player" || s[i].kind === "picker")) i--;
          return s.slice(0, i + 1);
        });
        return;
      }
      if (opts?.autoPlay) beginMarathonAdvance();
      setNavStack((cur) => {
        const t = cur[cur.length - 1];
        if (
          t.kind === "picker" &&
          t.meta.id === m.id &&
          (t.attempt ?? 0) === (opts?.attempt ?? 0) &&
          (t.intent ?? "play") === (opts?.intent ?? "play") &&
          Boolean(t.seasonEpisodes?.length) === Boolean(opts?.seasonEpisodes?.length)
        ) {
          return cur;
        }
        return pushFrame(cur, {
          kind: "picker",
          meta: m,
          episode: ep,
          autoPlay: opts?.autoPlay,
          attempt: opts?.attempt,
          intent: opts?.intent,
          seasonEpisodes: opts?.seasonEpisodes,
          resume: opts?.resume,
        });
      });
    },
    [setNavStack],
  );

  const together = useTogether();
  const togetherRef = useRef(together);
  togetherRef.current = together;
  const [pendingLiveSrc, setPendingLiveSrc] = useState<PlayerSrc | null>(null);
  const pendingLiveSrcRef = useRef<PlayerSrc | null>(null);
  pendingLiveSrcRef.current = pendingLiveSrc;

  const openPlayer = useCallback(
    (src: PlayerSrc) => {
      if (src.meta.id?.startsWith("iptv:") && togetherRef.current.snapshot.state === "joined") {
        setPendingLiveSrc(src);
        return;
      }
      setNavStack((cur) => pushFrame(cur, { kind: "player", src }));
    },
    [setNavStack],
  );

  const confirmLeavePartyForLive = useCallback(() => {
    const src = pendingLiveSrcRef.current;
    setPendingLiveSrc(null);
    if (!src) return;
    togetherRef.current.leaveSession();
    setNavStack((cur) => pushFrame(cur, { kind: "player", src }));
  }, [setNavStack]);

  const cancelLeavePartyForLive = useCallback(() => setPendingLiveSrc(null), []);

  const replacePlayerSrc = useCallback(
    (src: PlayerSrc) => {
      setNavStack((cur) => {
        const top = cur[cur.length - 1];
        if (top.kind !== "player") return cur;
        return [...cur.slice(0, -1), { kind: "player", src }];
      }, false);
    },
    [setNavStack],
  );

  const openAddonDetail = useCallback(
    (id: string) => {
      setNavStack((cur) => {
        const top = cur[cur.length - 1];
        if (top.kind === "addon-detail" && top.id === id) return cur;
        if (top.kind === "addon-detail") return [...cur.slice(0, -1), { kind: "addon-detail", id }];
        return pushFrame(cur, { kind: "addon-detail", id });
      });
    },
    [setNavStack],
  );

  const addonDetailId = top.kind === "addon-detail" ? top.id : null;

  const topPath = useMemo(() => syncFrameKey(top), [top]);

  const stackKinds = useMemo(() => stack.map((f) => f.kind), [stack]);

  const value = useMemo(
    () => ({
      view,
      setView,
      openSettings,
      settingsSectionRequest: sectionReq,
      topKind: top.kind,
      topPath,
      rootFrame,
      service,
      openService,
      meta,
      metaLiveContext,
      metaEpisodeHint,
      metaSeasonEntryId,
      openMeta,
      promoteMetaToRoot,
      personId,
      openPerson,
      profileHandle,
      openProfile,
      feedOpen,
      openFeed,
      groupsOpen,
      openGroups,
      groupId,
      openGroup,
      listHandle,
      listId,
      openList,
      collectionId,
      openCollection,
      peopleInit,
      openPeople,
      addonCollectionMeta,
      episodeDetail,
      openEpisodeDetail,
      openQueue,
      openGames,
      filter,
      openFilter,
      brands,
      openBrands,
      grid,
      openGrid,
      openCollections,
      stackKinds,
      awardType,
      openAward,
      animeAwardSource: top.kind === "anime-award" ? top.sourceId : null,
      openAnimeAward,
      curatedListId: top.kind === "curated-list" ? top.listId : null,
      openCuratedList,
      homeResetTick,
      picker,
      openPicker,
      player,
      openPlayer,
      replacePlayerSrc,
      pendingLiveSrc,
      confirmLeavePartyForLive,
      cancelLeavePartyForLive,
      addonDetailId,
      openAddonDetail,
      navDepth: stack.length,
      canGoBack,
      goBack: pop,
      canGoForward,
      goForward,
      exitPlayback,
      setPipDocked,
      exitPickerToDetail,
      exitPlayer,
      rememberScroll,
      recallScroll,
      rememberRowScroll,
      recallRowScroll,
      chromeHidden: chromeHidden || bigPictureActive,
      setChromeHidden,
      setNavStack,
    }),
    [
      view,
      top.kind,
      topPath,
      rootFrame,
      service,
      meta,
      metaLiveContext,
      metaEpisodeHint,
      metaSeasonEntryId,
      promoteMetaToRoot,
      personId,
      profileHandle,
      feedOpen,
      openFeed,
      groupsOpen,
      openGroups,
      groupId,
      openGroup,
      listHandle,
      listId,
      openList,
      collectionId,
      openCollection,
      peopleInit,
      openPeople,
      addonCollectionMeta,
      episodeDetail,
      openEpisodeDetail,
      filter,
      brands,
      openGames,
      stackKinds,
      awardType,
      homeResetTick,
      picker,
      player,
      canGoBack,
      canGoForward,
      setView,
      openSettings,
      sectionReq,
      openService,
      openMeta,
      openPerson,
      openProfile,
      openQueue,
      openFilter,
      openBrands,
      grid,
      openGrid,
      openCollections,
      openAward,
      openAnimeAward,
      openCuratedList,
      openPicker,
      openPlayer,
      replacePlayerSrc,
      pendingLiveSrc,
      confirmLeavePartyForLive,
      cancelLeavePartyForLive,
      pop,
      goForward,
      exitPlayback,
      setPipDocked,
      exitPickerToDetail,
      exitPlayer,
      rememberScroll,
      recallScroll,
      chromeHidden,
      bigPictureActive,
      setNavStack,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type PlayerNavigation = Pick<
  ViewValue,
  "openMeta" | "exitPlayer" | "openPicker" | "replacePlayerSrc"
>;
const PlayerNavigationContext = createContext<PlayerNavigation | null>(null);
export const PlayerNavigationProvider = PlayerNavigationContext.Provider;

export function usePlayerNavigation(): PlayerNavigation {
  const forwarded = useContext(PlayerNavigationContext);
  const main = useContext(Ctx);
  const navigation = forwarded ?? main;
  if (!navigation) throw new Error("Player navigation provider is missing");
  return navigation;
}

export function useView() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useView outside ViewProvider");
  return v;
}

export { frameKey };
