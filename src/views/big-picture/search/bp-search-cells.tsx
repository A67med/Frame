import type { Meta } from "@/lib/cinemeta";
import { pushBigPicture } from "@/lib/big-picture";
import { BpResultCard } from "../bp-result-card";
import { BpTile } from "../bp-tile";
import {
  BpAddonHitCell,
  BpChannelCell,
  BpCollectionCell,
  BpPersonCell,
  animeMeta,
} from "../bp-search-rows";
import type { BpSearchSection } from "../use-bp-search";
import type { BpGroupCell } from "./bp-search-group";

export type BpCellHandlers = {
  onSelect: (m: Meta) => void;
  onCommit: () => void;
};

const WIDE = "clamp(230px, 19vw, 380px)";
const HERO = "clamp(360px, 30vw, 620px)";

function addonBase(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json$/, "");
}

function titleCell(m: Meta, width: string, h: BpCellHandlers): BpGroupCell {
  return {
    key: m.id,
    node: (
      <div className="shrink-0" style={{ width }}>
        <BpResultCard meta={m} onSelect={h.onSelect} />
      </div>
    ),
  };
}

export function bpSearchCells(section: BpSearchSection, h: BpCellHandlers): BpGroupCell[] {
  switch (section.kind) {
    case "top":
      return section.meta ? [titleCell(section.meta, HERO, h)] : [];

    case "titles":
      return section.metas.map((m) => titleCell(m, WIDE, h));

    case "people":
      return section.people.map((p) => ({
        key: `person:${p.id}`,
        node: (
          <BpPersonCell
            person={p}
            onOpen={() => {
              h.onCommit();
              pushBigPicture({ kind: "person", personId: p.id, name: p.name });
            }}
          />
        ),
      }));

    case "anime":
      return section.anime.map((hit) => {
        const meta = animeMeta(hit);
        return { key: meta.id, node: <BpTile meta={meta} onSelect={h.onSelect} /> };
      });

    case "livetv":
      return section.channels.map((hit) => ({
        key: `iptv:${hit.playlistId}:${hit.channelId}`,
        node: <BpChannelCell hit={hit} onCommit={h.onCommit} />,
      }));

    case "collections":
      return section.collections.map((hit) => ({
        key: `collection:${hit.id}`,
        node: <BpCollectionCell hit={hit} onCommit={h.onCommit} />,
      }));

    case "addonIndex":
      // An entry with no transport url has no base to browse, so it is dropped
      // rather than drawn as a card that cannot open.
      return section.addons.flatMap((hit) => {
        const url = hit.transportUrl;
        if (!url) return [];
        return [
          {
            key: `addonhit:${hit.id}`,
            node: (
              <BpAddonHitCell
                hit={hit}
                onOpen={() => {
                  h.onCommit();
                  pushBigPicture({
                    kind: "addon",
                    addonId: hit.id,
                    name: hit.name,
                    base: addonBase(url),
                    logo: hit.logo,
                  });
                }}
              />
            ),
          },
        ];
      });
  }
}
