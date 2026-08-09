import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'nf_recent_clubs_v1';
const MAX = 8;

export type RecentClub = {
  club_id: string;
  name: string;
  photo?: string | null;
  city?: string;
  viewed_at: number;
};

/** Track the clubs the user recently opened (smart UX — quick re-access). */
export async function trackClubView(club: Omit<RecentClub, 'viewed_at'>): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list: RecentClub[] = raw ? JSON.parse(raw) : [];
    const next = [
      { ...club, viewed_at: Date.now() },
      ...list.filter((c) => c.club_id !== club.club_id),
    ].slice(0, MAX);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export async function getRecentClubs(): Promise<RecentClub[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
