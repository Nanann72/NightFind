import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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

type Coords = { lat: number; lng: number } | null;

type Ctx = {
  clubs: Club[];
  favorites: Set<string>;
  loading: boolean;
  filters: FiltersState;
  coords: Coords;
  setCoords: (c: Coords) => void;
  setFilters: (f: FiltersState) => void;
  refresh: () => Promise<void>;
  toggleFavorite: (clubId: string) => Promise<void>;
};

const C = createContext<Ctx | null>(null);

export function ClubsProvider({ children }: { children: React.ReactNode }) {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [favorites, setFavs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersState] = useState<FiltersState>(defaultFilters);
  const [coords, setCoordsState] = useState<Coords>(null);
  const reqIdRef = useRef(0);

  const fetchClubs = useCallback(
    async (f: FiltersState, c: Coords) => {
      const myId = ++reqIdRef.current;
      setLoading(true);
      try {
        const list = await api.listClubs({
          lat: c?.lat,
          lng: c?.lng,
          radius_km: f.radius_km,
          music: f.music,
          max_price: f.max_price,
          open_now: f.open_now || undefined,
          vip: f.vip || undefined,
          terrasse: f.terrasse || undefined,
        });
        // Drop stale responses
        if (myId !== reqIdRef.current) return;
        setClubs(list);
      } catch {
        if (myId !== reqIdRef.current) return;
        setClubs([]);
      } finally {
        if (myId === reqIdRef.current) setLoading(false);
      }
    },
    [],
  );

  const fetchFavorites = useCallback(async () => {
    try {
      const favs = await api.getFavorites();
      setFavs(new Set(favs.map((f) => f.club_id)));
    } catch {
      setFavs(new Set());
    }
  }, []);

  // Re-fetch whenever filters or coords change
  useEffect(() => {
    fetchClubs(filters, coords);
  }, [filters, coords, fetchClubs]);

  // Load favorites once at mount
  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const setFilters = useCallback((f: FiltersState) => setFiltersState(f), []);
  const setCoords = useCallback((c: Coords) => setCoordsState(c), []);
  const refresh = useCallback(async () => {
    await Promise.all([fetchClubs(filters, coords), fetchFavorites()]);
  }, [fetchClubs, fetchFavorites, filters, coords]);

  const toggleFavorite = useCallback(async (clubId: string) => {
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
  }, []);

  return (
    <C.Provider
      value={{
        clubs,
        favorites,
        loading,
        filters,
        coords,
        setCoords,
        setFilters,
        refresh,
        toggleFavorite,
      }}
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
