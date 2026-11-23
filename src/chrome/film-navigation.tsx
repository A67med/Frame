import { useEffect, useId, useRef, useState } from "react";
import { Ellipsis, Lock } from "lucide-react";
import { pushBackHandler } from "@/lib/back-intercept";
import { useContextMenu } from "@/lib/context-menu";
import { useT } from "@/lib/i18n";
import type { View } from "@/lib/view";
import type { NavItem } from "./nav-items";
import { NavEditableItem, NavHiddenTray, useNavDrag } from "./nav-edit";
import { setNavEditMode, useNavEditMode } from "./nav-edit-mode";
import { SidebarBigPictureEntry } from "./sidebar/big-picture-entry";

function DockItem({
  item,
  visibleOrder,
  active,
  go,
  locked,
  directory = false,
  dismiss,
}: {
  item: NavItem;
  visibleOrder: NavItem["id"][];
  active: boolean;
  go: (item: NavItem) => void;
  locked: boolean;
  directory?: boolean;
  dismiss?: () => void;
}) {
  const t = useT();
  const editing = useNavEditMode();
  const drag = useNavDrag(item.id, "horizontal");
  const { open } = useContextMenu();
  const label = t(item.label);
  const navigate = () => {
    dismiss?.();
    go(item);
  };
  const button = (
    <button
      type="button"
      data-harbor-nav={item.id}
      aria-current={active ? "page" : undefined}
      title={locked && item.pinGated ? t("chrome.lockedShort", { label }) : label}
      data-nav-drop-id={editing && !directory ? item.id : undefined}
      onPointerDown={editing ? drag.onPointerDown : undefined}
      onKeyDown={drag.onKeyDown}
      onClick={() => {
        if (!editing) navigate();
      }}
      onContextMenu={(e) => {
        dismiss?.();
        open(e, {
          kind: "nav",
          visibleOrder,
          itemId: item.id,
          view: item.view,
          label,
          onOpen: navigate,
        });
      }}
    >
      {item.render(active)}
      <span>{label}</span>
      {locked && item.pinGated && <Lock size={12} />}
    </button>
  );
  return editing && !directory ? (
    <NavEditableItem itemId={item.id}>{button}</NavEditableItem>
  ) : (
    button
  );
}

export function FilmNavigation({
  items,
  settingsItem,
  go,
  view,
  locked,
}: {
  items: NavItem[];
  settingsItem?: NavItem;
  go: (item: NavItem) => void;
  view: View;
  locked: boolean;
}) {
  const t = useT();
  const id = useId();
  const editing = useNavEditMode();
  const { open } = useContextMenu();
  const panel = useRef<HTMLDivElement>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  useEffect(() => {
    if (!directoryOpen) return;
    return pushBackHandler(() => {
      if (!panel.current?.matches(":popover-open")) return false;
      panel.current.hidePopover();
      return true;
    });
  }, [directoryOpen]);
  const close = () => panel.current?.hidePopover();
  const visibleOrder = items.map((item) => item.id);
  const entry = (item: NavItem, directory = false) => (
    <DockItem
      key={item.id}
      item={item}
      visibleOrder={visibleOrder}
      active={item.view === view}
      locked={locked}
      go={go}
      directory={directory}
      dismiss={directory ? close : undefined}
    />
  );
  return (
    <nav
      aria-label={t("Navigation")}
      data-tv-nav-zone
      data-film-nav="la-la-land"
      data-editing={editing || undefined}
      data-tv-focus-scope={editing || undefined}
      onContextMenu={(e) => {
        if (!(e.target as HTMLElement).closest("button")) open(e, { kind: "nav" });
      }}
    >
      {editing && <NavHiddenTray orientation="horizontal" />}
      <div className="film-gallery-dock">
        <div className="film-dock-items">
          {(editing ? items : items.slice(0, 4)).map((item) => entry(item))}
        </div>
        {!editing && (
          <button
            type="button"
            className="film-directory-trigger"
            popoverTarget={id}
            aria-label={t("More")}
            title={t("More")}
          >
            <Ellipsis size={20} />
            <span>{t("More")}</span>
          </button>
        )}
      </div>
      <div
        popover="auto"
        onToggle={(e) => setDirectoryOpen(e.newState === "open")}
        role="dialog"
        aria-label={t("Navigation")}
        data-tv-focus-scope
        id={id}
        ref={panel}
        className="film-directory"
      >
        <header>
          <h2>{t("Navigation")}</h2>
          <button type="button" data-tv-modal-close popoverTarget={id} popoverTargetAction="hide">
            {t("Close")}
          </button>
        </header>
        <div className="film-directory-items">{items.map((item) => entry(item, true))}</div>
        <footer>
          {settingsItem && entry(settingsItem, true)}
          <SidebarBigPictureEntry collapsed={false} />
          <button
            onClick={() => {
              close();
              setNavEditMode(true);
            }}
          >
            {t("Edit sidebar")}
          </button>
        </footer>
      </div>
    </nav>
  );
}
