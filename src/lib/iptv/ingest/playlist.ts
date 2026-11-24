import { fetchBoundedText } from "../bounded-response";
import { filterChannelsForDisplay } from "../divider-filter";
import type { IptvChannel, IptvPlaylist, IptvPlaylistSource } from "../types";

const CONNECT_TIMEOUT_S = 30;
export async function fetchM3uText(url: string, signal?: AbortSignal): Promise<string> {
  const text = await fetchBoundedText(
    async (requestSignal) => {
      try {
        return await iptvFetch(url, requestSignal);
      } catch (error) {
        requestSignal.throwIfAborted();
        throw new Error(networkErrorMessage(error));
      }
    },
    { signal, httpError: (response) => httpErrorMessage(response.status, response.statusText) },
  );
  if (!text) {
    throw new Error("Playlist server returned an empty body");
  }
  return text;
}

async function iptvFetch(url: string, signal?: AbortSignal): Promise<Response> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    try {
      return await tauriFetch(url, {
        method: "GET",
        signal,
        headers: {
          "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
          Accept: "audio/x-mpegurl, application/x-mpegURL, application/octet-stream, */*",
        },
        connectTimeout: CONNECT_TIMEOUT_S * 1000,
        maxRedirections: 5,
      } as unknown as RequestInit);
    } catch (e) {
      if (!/scope|not allowed/i.test(String(e))) throw e;
      const { safeFetch } = await import("@/infrastructure/networking/safe-fetch");
      return safeFetch(url, {
        signal,
        headers: {
          "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
          Accept: "audio/x-mpegurl, application/x-mpegURL, application/octet-stream, */*",
        },
      });
    }
  }
  return fetch(url, { cache: "no-store", signal });
}

function httpErrorMessage(status: number, statusText: string): string {
  if (status === 401) {
    return "HTTP 401: bad username or password. Check the URL credentials with your provider.";
  }
  if (status === 403) {
    return "HTTP 403: your IP or device is blocked from this playlist. Some providers geo-restrict or device-limit accounts.";
  }
  if (status === 404) {
    return "HTTP 404: playlist URL not found on this server. Check the URL for typos.";
  }
  if (status === 429) {
    return "HTTP 429: provider is rate-limiting your account. Wait a minute and try again.";
  }
  if (status === 503) {
    return "HTTP 503: provider is refusing service right now. Most common cause: account is at its max-connections limit (other devices/players still logged in). Close other sessions, or contact your provider if the credentials are valid.";
  }
  return `HTTP ${status} ${statusText}`;
}

function networkErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  if (lower.includes("cancel") || lower.includes("abort")) {
    return `Server did not respond (gave up after ${CONNECT_TIMEOUT_S}s). The provider may be rate-limiting your IP or down.`;
  }
  if (lower.includes("dns") || lower.includes("resolve")) {
    return `Could not resolve playlist hostname. Check the URL for typos.`;
  }
  if (lower.includes("connection refused") || lower.includes("refused")) {
    return `Playlist server refused the connection.`;
  }
  if (lower.includes("reset")) {
    return `Playlist server reset the connection. Some providers reject generic clients; try with their official app to confirm credentials work.`;
  }
  return `Network error: ${raw}`;
}

export function shapePlaylist(src: IptvPlaylistSource, channels: IptvChannel[]): IptvPlaylist {
  const cleaned = filterChannelsForDisplay(channels);
  return {
    id: src.id,
    name: src.name,
    url: src.url,
    epgUrl: src.epgUrl ?? null,
    channels: cleaned,
    fetchedAt: Date.now(),
    groups: uniqueGroups(cleaned),
  };
}

function uniqueGroups(channels: { group: string | null }[]): string[] {
  const set = new Set<string>();
  for (const c of channels) {
    if (c.group) set.add(c.group);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
