import type { ReactNode } from "react";
import { SettingsProvider } from "@/lib/settings";
import { ProfilesProvider } from "@/features/profiles/profiles";
import { ParentalProvider } from "@/lib/parental";
import { TraktProvider } from "@/lib/trakt/provider";
import { AnilistProvider } from "@/lib/anilist/provider";
import { MalProvider } from "@/lib/mal/provider";
import { SimklProvider } from "@/lib/simkl/provider";
import { LetterboxdProvider } from "@/lib/stremboxd/provider";
import { RankingsProvider } from "@/lib/rankings";
import { AuthProvider } from "@/lib/auth";
import { OnboardingProvider } from "@/lib/onboarding";
import { TogetherProvider } from "@/lib/together/provider";
import { ViewProvider } from "@/app/navigation/view";
import { SearchProvider } from "@/lib/search-context";
import { DvrProvider } from "@/lib/dvr/provider";
import { FavoritesProvider } from "@/lib/iptv/favorites";
import { MediaFavoritesProvider } from "@/lib/media-favorites";
import { CharacterFavoritesProvider } from "@/lib/character-favorites";
import { LocalWatchlistProvider } from "@/features/watchlist/local";
import { ContextMenuProvider } from "@/lib/context-menu";
import { TopRankModalProvider } from "@/lib/top-rank-modal";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider syncTorrentEnginePolicy>
      <ProfilesProvider>
        <ParentalProvider>
          <TraktProvider>
            <AnilistProvider>
              <MalProvider>
                <SimklProvider>
                  <LetterboxdProvider>
                    <RankingsProvider>
                      <AuthProvider>
                        <OnboardingProvider>
                          <TogetherProvider>
                            <ViewProvider>
                              <SearchProvider>
                                <DvrProvider>
                                  <FavoritesProvider>
                                    <MediaFavoritesProvider>
                                      <CharacterFavoritesProvider>
                                        <LocalWatchlistProvider>
                                          <ContextMenuProvider>
                                            <TopRankModalProvider>{children}</TopRankModalProvider>
                                          </ContextMenuProvider>
                                        </LocalWatchlistProvider>
                                      </CharacterFavoritesProvider>
                                    </MediaFavoritesProvider>
                                  </FavoritesProvider>
                                </DvrProvider>
                              </SearchProvider>
                            </ViewProvider>
                          </TogetherProvider>
                        </OnboardingProvider>
                      </AuthProvider>
                    </RankingsProvider>
                  </LetterboxdProvider>
                </SimklProvider>
              </MalProvider>
            </AnilistProvider>
          </TraktProvider>
        </ParentalProvider>
      </ProfilesProvider>
    </SettingsProvider>
  );
}
