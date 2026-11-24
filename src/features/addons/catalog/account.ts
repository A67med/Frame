import { safeFetch as fetch } from "@/infrastructure/networking/safe-fetch";

const STREMIO_API = "https://api.strem.io/api";

export type CatalogDef = {
  id: string;
  type: string;
  name: string;
  extra?: Array<{ name: string; isRequired?: boolean; options?: string[] }>;
  // The older manifest form. An addon may declare search through either this or
  // `extra`, and reading only `extra` left those addons never queried at all.
  extraSupported?: string[];
};

export type AddonResource = string | { name: string; types?: string[]; idPrefixes?: string[] };

export type Addon = {
  manifest: {
    id: string;
    name: string;
    version?: string;
    description?: string;
    logo?: string;
    background?: string;
    contactEmail?: string;
    catalogs?: CatalogDef[];
    resources?: AddonResource[];
    types?: string[];
    idPrefixes?: string[];
    behaviorHints?: {
      adult?: boolean;
      p2p?: boolean;
      configurable?: boolean;
      configurationRequired?: boolean;
    };
  };
  transportUrl: string;
};

async function call<T>(path: string, body: object): Promise<T | null> {
  try {
    const res = await fetch(`${STREMIO_API}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json.result ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function userAddons(authKey: string): Promise<Addon[]> {
  const result = await call<{ addons: Addon[] }>("addonCollectionGet", {
    authKey,
    type: "user",
    update: false,
  });
  return result?.addons ?? [];
}

export async function setUserAddons(authKey: string, addons: Addon[]): Promise<boolean> {
  const result = await call<{ success?: boolean }>("addonCollectionSet", {
    authKey,
    type: "user",
    addons: addons.map((a) => {
      const raw = a as Record<string, unknown>;
      return {
        transportUrl: a.transportUrl,
        transportName: typeof raw.transportName === "string" ? raw.transportName : "",
        manifest: a.manifest,
        flags: (raw.flags as { official?: boolean; protected?: boolean } | undefined) ?? {
          official: false,
          protected: false,
        },
      };
    }),
  });
  return result != null;
}

export async function getUserAddonsRaw(authKey: string): Promise<Addon[] | null> {
  const result = await call<{ addons: Addon[] }>("addonCollectionGet", {
    authKey,
    type: "user",
    update: false,
  });
  if (!result || !Array.isArray(result.addons)) return null;
  return result.addons;
}

export async function setUserAddonsRaw(authKey: string, addons: Addon[]): Promise<boolean> {
  if (addons.length === 0) return false;
  const result = await call<{ success?: boolean }>("addonCollectionSet", {
    authKey,
    type: "user",
    addons,
  });
  return result != null;
}
