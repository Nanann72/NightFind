import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { api, Club } from './api';

type FiltersState = {
  music?: string;
  max_price?: number;
  open_now?: boolean;
  vip?: boolean;
  terrasse?: boolean;
  radius_km: number;
};

const defaultFilters: FiltersState = { radius_km: 50 };

type Ctx = {
  clubs: Club[];
  favorites: Set<string>;
  loading: boolean;
  filters: FiltersState;
  setFilters: (f: FiltersState) => void;
  refresh: (coords?: { lat: number; lng: number } | null) => Promise<void>;
  toggleFavorite: (clubId: string) => Promise<void>;
};

const C = createContext<Ctx | null>(null);

export function ClubsProvider({ children }: { children: React.ReactNode }) {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [favorites, setFavs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersState] = useState<FiltersState>(defaultFilters);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const refresh = useCallback(
    async (c?: { lat: number; lng: number } | null) => {
      const useCoords = c ?? coords;
      if (c !== undefined) setCoords(c);
      setLoading(true);
      try {
        const list = await api.listClubs({
          lat: useCoords?.lat,
          lng: useCoords?.lng,
          radius_km: filters.radius_km,
          music: filters.music,
          max_price: filters.max_price,
          open_now: filters.open_now || undefined,
          vip: filters.vip || undefined,
          terrasse: filters.terrasse || undefined,
        });
        setClubs(list);
      } catch {
        setClubs([]);
      } finally {
        setLoading(false);
      }
      try {
        const favs = await api.getFavorites();
        setFavs(new Set(favs.map((f) => f.club_id)));
      } catch {}
    },
    [coords, filters],
  );

  useEffect(() => {
    refresh();
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilters = useCallback((f: FiltersState) => setFiltersState(f), []);

  const toggleFavorite = useCallback(
    async (clubId: string) => {
      setFavs((prev) => {
        const next = new Set(prev);
        if (next.has(clubId)) {
          next.delete(clubId);
          api.removeFavorite(clubId).catch(() => {});
        } else {
          next.add(clubId);
          api.addFavorite(clubId).catch(() => {});
        }
        return next;
      });
    },
    [],
  );

  return (
    <C.Provider
      value={{ clubs, favorites, loading, filters, setFilters, refresh, toggleFavorite }}
    >
      {children}
    </C.Provider>
  );
}

export function useClubs() {
  const ctx = useContext(C);
  if (!ctx) throw new Error('useClubs must be used inside ClubsProvider');
  return ctx;
}
