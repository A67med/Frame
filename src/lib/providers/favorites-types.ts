export type FavoriteKind = "game" | "book" | "music";

export type FavoriteMedia = {
  kind: FavoriteKind;
  id: string;
  name: string;
  image: string | null;
  imageFallback?: string | null;
  sub: string | null;
  url: string | null;
  source: string;
};
