import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, LayoutGrid, Menu } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { ThemeDesign } from "@/lib/theme-design";
import type { View } from "@/lib/view";
import type { NavItem } from "./nav-items";
import { setNavEditMode } from "./nav-edit-mode";
import { SidebarBigPictureEntry } from "./sidebar/big-picture-entry";

type Film = Exclude<ThemeDesign["composition"], "standard">;
const shelf = new Set(["library", "collections", "following", "downloads", "calendar"]);
const core = new Set(["home", "discover", "radar", "library"]);
const groupNames = ["Discover", "My library", "More"] as const;
function group(item: NavItem) {
  if (shelf.has(item.id)) return "My library";
  return core.has(item.id) || ["movies", "shows", "catalogs", "anime"].includes(item.id)
    ? "Discover"
    : "More";
}

export function FilmNavigation({
  composition,
  items,
  settingsItem,
  go,
  view,
}: {
  composition: Film;
  items: NavItem[];
  settingsItem?: NavItem;
  go: (item: NavItem) => void;
  view: View;
}) {
  const t = useT();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const current = items.find((i) => i.view === view);
  const currentGroup = current ? group(current) : "Discover";
  const [section, setSection] = useState(currentGroup);
  useEffect(() => {
    setSection(currentGroup);
  }, [currentGroup]);
  const groups = groupNames.filter((name) => items.some((i) => group(i) === name));
  const navigate = (item: NavItem) => {
    panel.current?.hidePopover();
    go(item);
  };
  const link = (item: NavItem, icon = false) => (
    <button
      key={item.id}
      type="button"
      data-harbor-nav={item.id}
      aria-current={item.view === view ? "page" : undefined}
      title={t(item.label)}
      onClick={() => navigate(item)}
    >
      {icon && item.render(item.view === view)}
      <span>{t(item.label)}</span>
    </button>
  );
  const trigger = (label: string, icon = <Menu size={18} />) => (
    <button type="button" className="film-directory-trigger" popoverTarget={id} aria-label={label}>
      {icon}
      <span>{label}</span>
    </button>
  );
  const directory = (
    <div
      popover="auto"
      id={id}
      ref={panel}
      className={`film-directory film-directory-${composition}`}
    >
      <header>
        <h2>{t("Navigation")}</h2>
        <button type="button" popoverTarget={id} popoverTargetAction="hide">
          {t("Close")}
        </button>
      </header>
      <div className="film-directory-groups">
        {groups.map((name) => (
          <section key={name}>
            <h3>{t(name)}</h3>
            {items.filter((i) => group(i) === name).map((i) => link(i))}
          </section>
        ))}
      </div>
      <footer>
        {settingsItem && link(settingsItem)}
        <SidebarBigPictureEntry collapsed={false} />
        <button
          type="button"
          onClick={() => {
            panel.current?.hidePopover();
            setNavEditMode(true);
          }}
        >
          {t("Edit sidebar")}
        </button>
      </footer>
    </div>
  );
  const main = items.filter((i) => core.has(i.id));
  return (
    <nav aria-label={t("Navigation")} data-film-nav={composition}>
      {composition === "dune" && (
        <>
          <header>{trigger(t("Navigation"))}</header>
          <div className="film-dune-gates">{main.map((i) => link(i))}</div>
          <footer>
            {current && !core.has(current.id) && link(current)}
            {settingsItem && link(settingsItem)}
          </footer>
        </>
      )}
      {composition === "la-la-land" && (
        <div className="film-gallery-dock">
          {main.map((i) => link(i, true))}
          {trigger(t("More"), <ChevronDown size={17} />)}
        </div>
      )}
      {composition === "doomsday" && (
        <>
          <header>{trigger(t("Navigation"), <LayoutGrid size={20} />)}</header>
          <div className="film-module-switch">
            {groups.map((name) => (
              <button key={name} aria-pressed={section === name} onClick={() => setSection(name)}>
                {t(name)}
              </button>
            ))}
          </div>
          <div className="film-module-list">
            {items.filter((i) => group(i) === section).map((i) => link(i, true))}
          </div>
          <footer>{settingsItem && link(settingsItem, true)}</footer>
        </>
      )}
      {composition === "zodiac" && (
        <>
          <strong>{t("Index")}</strong>
          <div className="film-index-links">{main.map((i) => link(i))}</div>
          {trigger(t("Contents"), <ArrowUpRight size={14} />)}
        </>
      )}
      {directory}
    </nav>
  );
}
