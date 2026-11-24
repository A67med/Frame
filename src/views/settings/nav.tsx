import { SETTINGS_OPTIONS, type SettingsOption } from "@/features/settings/search/options";
import { useMemo, useState } from "react";
import { useSettings } from "@/lib/settings";
import { useT } from "@/lib/i18n";
import { activeLayout } from "@/lib/theme";
import { useView } from "@/app/navigation/view";
import {
  matchesSettingsSearch,
  rankSettingsSearch,
  setSettingsSearchVocabulary,
} from "./search-match";
import { settingsAnchor, type SectionId } from "./shared";
import { TOP_GROUPS } from "./groups";
import { markSectionSeen, useSettingsNew } from "./settings-new";
import { useExperimentalAccess } from "@/lib/updater/experimental-access";
import { IconChevronRight } from "./nav-icons";
import { NAV_GROUPS, NAV_ITEM_BY_ID, type NavItem } from "./nav-groups";

setSettingsSearchVocabulary([
  ...SETTINGS_OPTIONS.flatMap((o) => [
    o.label,
    ...(o.anchorTitle ? [o.anchorTitle] : []),
    ...(o.keywords ?? []),
  ]),
  ...NAV_GROUPS.flatMap((g) => [
    g.heading ?? "",
    ...g.items.flatMap((it) => [it.label, ...(it.keywords ?? [])]),
  ]),
]);

export function useNavSearch(trimmed: string) {
  const t = useT();
  const experimentalAccess = useExperimentalAccess();
  const matches = useMemo<NavItem[] | null>(() => {
    if (!trimmed) return null;
    const out: NavItem[] = [];
    for (const group of NAV_GROUPS) {
      const groupHit = group.heading ? matchesSettingsSearch(trimmed, [group.heading], t) : false;
      for (const item of group.items) {
        const hit =
          groupHit || matchesSettingsSearch(trimmed, [item.label], t, item.keywords ?? []);
        if (hit) out.push(item);
      }
    }
    return out.sort(
      (a, b) =>
        rankSettingsSearch(trimmed, a.label, a.keywords ?? []) -
        rankSettingsSearch(trimmed, b.label, b.keywords ?? []),
    );
  }, [t, trimmed]);
  const optionMatches = useMemo<SettingsOption[] | null>(() => {
    if (!trimmed) return null;
    return SETTINGS_OPTIONS.filter(
      (o) =>
        (o.label !== "Experimental builds" || experimentalAccess) &&
        matchesSettingsSearch(
          trimmed,
          o.anchorTitle ? [o.label, o.anchorTitle] : [o.label],
          t,
          o.keywords ?? [],
        ),
    ).sort(
      (a, b) =>
        rankSettingsSearch(trimmed, a.label, a.keywords ?? []) -
        rankSettingsSearch(trimmed, b.label, b.keywords ?? []),
    );
  }, [experimentalAccess, t, trimmed]);
  return { matches, optionMatches };
}

const NAV_CHIP =
  "inline-flex h-[22px] shrink-0 items-center rounded-md px-2 text-[13px] font-bold uppercase leading-[17px] tracking-[0.72px]";

const NAV_FIELD =
  "group/find flex h-11 min-w-0 shrink-0 items-center rounded-[10px] bg-elevated px-3 transition-colors focus-within:bg-raised";

const NAV_FIELD_GLYPH =
  "me-2.5 shrink-0 text-ink-subtle transition-colors group-focus-within/find:text-ink";

const NAV_FIELD_INPUT =
  "min-w-0 flex-1 bg-transparent text-[16.5px] text-ink outline-none placeholder:text-ink-subtle";

const NAV_FIELD_CLEAR =
  "animate-badge-pop harbor-press-pop ms-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-subtle transition-colors hover:bg-raised hover:text-ink";

const NAV_BACK =
  "harbor-press-pop grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-ink-muted transition-colors hover:bg-elevated hover:text-ink";

const NAV_OPTION_ROW =
  "group relative flex min-h-[64px] w-full items-center gap-[10px] ps-[14px] pe-[10px] py-[9px] text-start text-ink-muted transition-colors hover:bg-elevated hover:text-ink";

const NAV_ICON_SLOT = "grid h-5 w-5 shrink-0 place-items-center";

const NAV_SECTION =
  "flex min-h-[38px] items-center gap-[10px] ps-[14px] pe-3 pt-2 text-[13px] font-extrabold uppercase leading-[17px] tracking-[0.72px] text-ink-subtle";

const NAV_ROW_BASE =
  "no-press group relative flex min-h-[52px] w-full items-center gap-[10px] ps-[14px] pe-[10px] py-[7px] text-start text-[16.5px] leading-[22px] transition-colors";

const NAV_CHILD_BASE =
  "no-press group relative flex min-h-[44px] w-full items-center gap-[10px] ps-[44px] pe-[10px] py-[6px] text-start text-[15.5px] leading-[21px] transition-colors";

const NAV_ON = "bg-elevated font-semibold text-ink";

const NAV_OFF = "font-medium text-ink-muted hover:bg-elevated hover:text-ink";

const NAV_CHILD_OFF = "font-medium text-ink-subtle hover:bg-elevated hover:text-ink";

const NAV_TEXT = "min-w-0 flex-1 break-words";

function NavChip({ tone, children }: { tone: "accent" | "muted"; children: React.ReactNode }) {
  const skin = tone === "accent" ? "bg-accent-soft text-accent" : "bg-elevated text-ink-subtle";
  return <span className={`${NAV_CHIP} ${skin}`}>{children}</span>;
}

function NavNewDot() {
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />;
}

function NavSection({ label, rule }: { label: string; rule: boolean }) {
  return (
    <div className={NAV_SECTION}>
      <span className="shrink-0">{label}</span>
      {rule && <span aria-hidden className="h-px min-w-0 flex-1 bg-edge-soft" />}
    </div>
  );
}

function SearchField({
  query,
  setQuery,
  onSubmit,
}: {
  query: string;
  setQuery: (q: string) => void;
  onSubmit: () => void;
}) {
  const t = useT();
  const SEARCH_NAV_HINT = "Press Enter or Space to type";
  const SEARCH_EDIT_HINT = "Text mode — Esc to exit";
  // Let the field shrink inside the sidebar; its input's intrinsic width otherwise clips the corners.
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div data-settings-search-field data-tv-text-field className={NAV_FIELD}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={NAV_FIELD_GLYPH}
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search settings")}
          aria-describedby="settings-search-mode"
          className={NAV_FIELD_INPUT}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
            else if (e.key === "Escape") setQuery("");
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className={NAV_FIELD_CLEAR}
            aria-label={t("Clear")}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
      <div
        id="settings-search-mode"
        data-settings-search-mode
        aria-live="polite"
        className="flex min-h-5 items-center px-2 pt-1 text-[10.5px] leading-none"
      >
        <span data-settings-search-nav-hint className="hidden items-center gap-1.5 text-ink-subtle">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ink-subtle" />
          {t(SEARCH_NAV_HINT)}
        </span>
        <span
          data-settings-search-edit-hint
          className="hidden items-center gap-1.5 font-semibold text-accent"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {t(SEARCH_EDIT_HINT)}
        </span>
      </div>
    </div>
  );
}

function BackButton() {
  const t = useT();
  const { goBack, canGoBack, setView } = useView();
  return (
    <button
      type="button"
      onClick={() => (canGoBack ? goBack() : setView("home"))}
      aria-label={t("Back")}
      className={NAV_BACK}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="dir-icon"
        aria-hidden
      >
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </button>
  );
}

export function SettingsTools({
  query,
  setQuery,
  onSubmit,
}: {
  query: string;
  setQuery: (v: string) => void;
  onSubmit: (id: SectionId, anchor?: string, tab?: string) => void;
}) {
  const { settings } = useSettings();
  const navLayout = activeLayout(settings.theme);
  const showBack = navLayout === "custom";
  const { matches, optionMatches } = useNavSearch(query.trim().toLowerCase());
  const submit = () => {
    if (matches && matches.length > 0) {
      onSubmit(matches[0].id);
      setQuery("");
      return;
    }
    if (optionMatches && optionMatches.length > 0) {
      const o = optionMatches[0];
      onSubmit(o.section, o.anchorTitle ? settingsAnchor(o.anchorTitle) : undefined, o.tab);
      setQuery("");
    }
  };
  return (
    <div data-tv-nav-zone className="hset-tools">
      {showBack && <BackButton />}
      <SearchField query={query} setQuery={setQuery} onSubmit={submit} />
    </div>
  );
}

export function SettingsNav({
  active,
  onChange,
  onOpenGroup,
  query: queryProp,
  setQuery: setQueryProp,
}: {
  active: SectionId;
  onChange: (id: SectionId, anchor?: string) => void;
  onOpenGroup?: (groupId: string) => void;
  query?: string;
  setQuery?: (v: string) => void;
}) {
  const { settings } = useSettings();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const t = useT();
  const isNew = useSettingsNew();
  const navLayout = activeLayout(settings.theme);
  const showBack = navLayout === "custom" || navLayout === "minui";
  const [ownQuery, setOwnQuery] = useState("");
  const hoisted = queryProp !== undefined;
  const query = hoisted ? queryProp : ownQuery;
  const setQuery = (v: string) => {
    if (setQueryProp) setQueryProp(v);
    if (!hoisted) setOwnQuery(v);
  };
  const trimmed = query.trim().toLowerCase();
  const sectionLabel = useMemo(() => {
    const m = new Map<SectionId, string>();
    for (const group of NAV_GROUPS) for (const item of group.items) m.set(item.id, item.label);
    return m;
  }, []);
  const { matches, optionMatches } = useNavSearch(trimmed);

  const libraryKeys = [
    settings.tmdbKey,
    settings.omdbKey,
    settings.rpdbKey,
    settings.fanartKey,
    settings.tvdbKey,
  ].filter(Boolean).length;

  const debridKeys = [
    settings.rdKey,
    settings.tbKey,
    settings.adKey,
    settings.pmKey,
    settings.dlKey,
  ].filter(Boolean).length;

  const debridChip = libraryKeys > 0 ? `${libraryKeys}/5` : null;

  const webhookActive =
    (settings.webhooks.discordUrl ||
      settings.webhooks.telegramUrl ||
      settings.webhooks.desktopEnabled) &&
    Object.values(settings.webhooks.sources).some(Boolean);

  const status: Record<SectionId, string | null> = {
    licenses: null,
    icons: null,
    basics: null,
    account: null,
    library: libraryKeys > 0 ? `${libraryKeys}/5` : null,
    trakt: null,
    anilist: null,
    mal: null,
    simkl: null,
    letterboxd: settings.letterboxd.enabled
      ? settings.letterboxd.mode === "full"
        ? "FULL"
        : "ON"
      : null,
    trackers: null,
    updates: null,
    streaming: debridChip,
    streamFilters: settings.customStreamFilters?.length
      ? String(settings.customStreamFilters.length)
      : null,
    p2p: null,
    language: null,
    subtitles: settings.subtitleAutoSync ? "sync" : null,
    player: settings.playerEngine === "auto" ? null : settings.playerEngine,
    mpv:
      (settings.mpvQuality ?? "balanced") === "balanced"
        ? null
        : settings.mpvQuality === "performance"
          ? "lite"
          : "max",
    anime: settings.playerMotionInterp || settings.playerSvp ? "on" : null,
    shaders:
      settings.playerAnime4k || Object.values(settings.playerShaders ?? {}).some((s) => s?.enabled)
        ? "on"
        : null,
    playerLayout: null,
    theme:
      settings.theme.preset === "frame" && settings.theme.fontPair === "general-sans" ? null : "•",
    badges: null,
    awardIcons: null,
    webhooks: webhookActive ? "live" : null,
    bug: null,
    support: null,
    storage: null,
    advanced: null,
  };

  const isLive = (chip: string) => chip === "live" || chip === "via relay";

  const renderItem = ({ id, label, Icon }: NavItem) => {
    const isActive = id === active;
    const chip = status[id];
    const debridChipLocal = id === "streaming" && debridKeys > 0 ? `${debridKeys}D` : null;
    return (
      <button
        key={id}
        data-active={isActive ? "" : undefined}
        onClick={() => {
          onChange(id);
          setQuery("");
        }}
        className={`${NAV_ROW_BASE} ${isActive ? NAV_ON : NAV_OFF}`}
      >
        <span className={NAV_ICON_SLOT}>
          <Icon size={20} strokeWidth={1.7} />
        </span>
        <span className={NAV_TEXT}>{t(label)}</span>
        {debridChipLocal && <NavChip tone="accent">{debridChipLocal}</NavChip>}
        {chip && <NavChip tone={isLive(chip) ? "accent" : "muted"}>{chip}</NavChip>}
      </button>
    );
  };

  const submit = () => {
    if (matches && matches.length > 0) {
      onChange(matches[0].id);
      setQuery("");
      return;
    }
    if (optionMatches && optionMatches.length > 0) {
      const o = optionMatches[0];
      onChange(o.section, o.anchorTitle ? settingsAnchor(o.anchorTitle) : undefined);
      setQuery("");
    }
  };

  return (
    <nav
      data-harbor-sidebar
      data-tv-nav-zone
      data-tv-scroll-focus
      className="hset-sidebar flex min-h-0 flex-col"
    >
      {!hoisted && (
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-2">
          {showBack && <BackButton />}
          <SearchField query={query} setQuery={setQuery} onSubmit={submit} />
        </div>
      )}
      {matches && (
        <div className="flex flex-col">
          {matches.length === 0 && (!optionMatches || optionMatches.length === 0) && (
            <NavSection label={t("No matches")} rule={false} />
          )}
          {matches.length > 0 && (
            <>
              <NavSection
                label={
                  matches.length === 1
                    ? t("{n} tab", { n: matches.length })
                    : t("{n} tabs", { n: matches.length })
                }
                rule={false}
              />
              {matches.map(renderItem)}
            </>
          )}
          {optionMatches && optionMatches.length > 0 && (
            <>
              <NavSection
                label={
                  optionMatches.length === 1
                    ? t("{n} option", { n: optionMatches.length })
                    : t("{n} options", { n: optionMatches.length })
                }
                rule={false}
              />
              {optionMatches.map((o) => (
                <button
                  key={`${o.section}-${o.label}`}
                  onClick={() => {
                    onChange(o.section, o.anchorTitle ? settingsAnchor(o.anchorTitle) : undefined);
                    setQuery("");
                  }}
                  className={NAV_OPTION_ROW}
                >
                  <span className={`${NAV_ICON_SLOT} text-ink-subtle group-hover:text-ink-muted`}>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[15.5px] font-medium leading-[21px] text-ink">
                      {t(o.label)}
                    </span>
                    <span className="block break-words text-[15.5px] leading-[20px] text-ink-subtle">
                      {t(sectionLabel.get(o.section) ?? o.section)}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {!matches &&
        TOP_GROUPS.map((group, gi) => {
          const prevSection = gi > 0 ? TOP_GROUPS[gi - 1].section : null;
          const showSection = group.section !== prevSection;
          const firstId = group.children[0];
          const meta = NAV_ITEM_BY_ID.get(firstId);
          const Icon = meta?.Icon;
          const isActive = group.children.includes(active);
          const multi = group.children.length > 1;
          const isOpen = multi ? openGroups.has(group.id) || isActive : false;
          const groupChip = group.children.map((c) => status[c]).find(Boolean);
          const groupDebrid =
            group.children.includes("streaming") && debridKeys > 0 ? `${debridKeys}D` : null;
          const anyNew = group.children.some((c) => isNew(c));
          return (
            <div key={group.id} className="flex flex-col">
              {showSection && <NavSection label={t(group.section)} rule />}
              <button
                aria-expanded={multi ? isOpen : undefined}
                data-active={isActive ? "" : undefined}
                onClick={() => {
                  if (multi) {
                    if (onOpenGroup) {
                      onOpenGroup(group.id);
                      group.children.forEach((c) => markSectionSeen(c));
                    }
                    setOpenGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    });
                    return;
                  }
                  onChange(firstId);
                  markSectionSeen(firstId);
                }}
                className={`${NAV_ROW_BASE} ${isActive ? NAV_ON : NAV_OFF}`}
              >
                <span className={NAV_ICON_SLOT}>
                  {Icon && <Icon size={20} strokeWidth={1.7} />}
                </span>
                <span className={NAV_TEXT}>{t(group.label)}</span>
                {anyNew && <NavNewDot />}
                {groupDebrid && <NavChip tone="accent">{groupDebrid}</NavChip>}
                {groupChip && (
                  <NavChip tone={isLive(groupChip) ? "accent" : "muted"}>{groupChip}</NavChip>
                )}
                {multi && (
                  <span aria-hidden className="dir-icon shrink-0 text-ink-subtle">
                    <span
                      className={`inline-flex transition-transform duration-150 ${
                        isOpen ? "rotate-90" : ""
                      }`}
                    >
                      <IconChevronRight size={15} strokeWidth={2} />
                    </span>
                  </span>
                )}
              </button>
              {isOpen && (
                <div className="harbor-nav-expand flex flex-col">
                  {group.children.map((childId) => {
                    const child = NAV_ITEM_BY_ID.get(childId);
                    if (!child) return null;
                    const on = childId === active;
                    return (
                      <button
                        key={childId}
                        data-active={on ? "" : undefined}
                        onClick={() => {
                          onChange(childId);
                          markSectionSeen(childId);
                        }}
                        className={`${NAV_CHILD_BASE} ${on ? NAV_ON : NAV_CHILD_OFF}`}
                      >
                        <span className={NAV_TEXT}>{t(child.label)}</span>
                        {isNew(childId) && <NavNewDot />}
                        {status[childId] && (
                          <NavChip tone={isLive(status[childId] as string) ? "accent" : "muted"}>
                            {status[childId]}
                          </NavChip>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
    </nav>
  );
}
