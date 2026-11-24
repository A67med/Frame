import { useSyncExternalStore } from "react";
import { safeFetch } from "@/infrastructure/networking/safe-fetch";
import { assertSafeUrl } from "@/features/addons/runtime/host-http";
import { PluginWorker } from "@/features/addons/runtime/worker-host";
import { normalizeRepoUrl } from "@/features/addons/streams/manifest";
import { PluginError } from "@/features/addons/streams/types";
import {
  looksLikeAndroidExtensionRepo,
  looksLikeStremioAddon,
} from "@/features/addons/streams/manifest";
import { streamKind } from "./kinds/stream";
import type { KindAdapter, PluginKind, RepoView } from "./types";

export type {
  CheckResult,
  EntryView,
  HealthView,
  KindAdapter,
  LogLine,
  PluginKind,
  PluginState,
  PluginView,
  RepoView,
  SettingsField,
} from "./types";
export { repoHost } from "./types";

const adapters: KindAdapter[] = [streamKind];

export function pluginKinds(): KindAdapter[] {
  return adapters;
}

export function kindFor(kind: PluginKind): KindAdapter {
  const found = adapters.find((a) => a.kind === kind);
  if (!found) throw new Error(`unknown plugin kind ${kind}`);
  return found;
}

export function loadPluginKinds(): Promise<void> {
  return Promise.all(adapters.map((a) => a.load())).then(() => undefined);
}

export function subscribePluginKinds(cb: () => void): () => void {
  const offs = adapters.map((a) => a.subscribe(cb));
  return () => {
    for (const off of offs) off();
  };
}

let version = 0;
const bump = () => {
  version += 1;
};
let wired = false;
function ensureWired(): void {
  if (wired) return;
  wired = true;
  subscribePluginKinds(bump);
}

export function usePluginKindsVersion(): number {
  ensureWired();
  return useSyncExternalStore(
    subscribePluginKinds,
    () => version,
    () => version,
  );
}

export function useStreamPluginCount(): number {
  ensureWired();
  return useSyncExternalStore(
    subscribePluginKinds,
    () => streamKind.plugins().filter((p) => p.state === "ok" || p.state === "update").length,
    () => 0,
  );
}

async function probeKind(entryUrl: string): Promise<PluginKind | null> {
  try {
    const target = assertSafeUrl(entryUrl);
    const res = await safeFetch(target, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const source = await res.text();
    if (source.length > 2 * 1024 * 1024) return null;
    const worker = new PluginWorker(
      {
        id: "probe",
        name: "probe",
        version: "0",
        lang: "en",
        nsfw: false,
        repoUrl: target,
        source,
        hash: "",
        enabled: true,
        hasTags: false,
      },
      { readyTimeoutMs: 8_000, denyHttp: true },
    );
    try {
      const meta = await worker.meta();
      const methods = new Set(meta.methods ?? []);
      if (methods.has("streams")) return "stream";
      return null;
    } finally {
      worker.dispose();
    }
  } catch {
    return null;
  }
}

export async function detectRepoKind(rawUrl: string): Promise<{ kind: PluginKind; url: string }> {
  const url = normalizeRepoUrl(rawUrl);
  const target = assertSafeUrl(url);
  let res: Response;
  try {
    res = await safeFetch(target, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new PluginError("no-answer");
  }
  if (!res.ok) throw new PluginError("no-answer", `HTTP ${res.status}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    throw new PluginError("not-a-repo");
  }
  const json = (
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  ) as Record<string, unknown>;
  if (looksLikeAndroidExtensionRepo(json, parsed)) return { kind: "stream", url };
  if (looksLikeStremioAddon(json)) throw new PluginError("stremio-addon");
  if (Array.isArray(json.scrapers)) return { kind: "stream", url };
  if (Array.isArray(parsed) && parsed.some((e) => e && typeof e === "object" && "filename" in e)) {
    return { kind: "stream", url };
  }
  const type = typeof json.type === "string" ? json.type : "";
  if (type === "stream") return { kind: type, url };
  if (type === "manga" || type === "ebook") throw new PluginError("not-a-repo");
  if (Array.isArray(json.plugins)) {
    const first = json.plugins.find(
      (p) => p && typeof p === "object" && typeof (p as { entry?: unknown }).entry === "string",
    ) as { entry: string } | undefined;
    if (first) {
      try {
        const probed = await probeKind(new URL(first.entry, url).href);
        if (probed === "stream") return { kind: "stream", url };
      } catch {
        throw new PluginError("not-a-repo");
      }
    }
  }
  throw new PluginError("not-a-repo");
}

export async function addRepoAnyKind(rawUrl: string): Promise<RepoView> {
  const { kind, url } = await detectRepoKind(rawUrl);
  return kindFor(kind).addRepo(url);
}
