/**
 * Live-listening mock for Night Finder.
 *
 * Replicates the UX of an audio-recognition engine (Shazam / ACR Cloud /
 * Audd.io) by streaming believable track names every 90 seconds while the
 * user is checked in at a club. Tracks are biased on the club's declared
 * music styles so the songs feel coherent with the venue.
 *
 * When you're ready to wire a real engine, swap `pickRandomTrack` for a
 * call to the chosen API and keep the same `api.addDetectedSong` payload.
 */
import { api, Club } from './api';

type Track = { title: string; artist: string };

const LIBRARY: Record<string, Track[]> = {
  techno: [
    { title: 'Phantom', artist: 'Charlotte de Witte' },
    { title: 'Pacific 808', artist: 'Amelie Lens' },
    { title: 'Energy Flash', artist: 'Joey Beltram' },
    { title: 'Saturn', artist: 'Adam Beyer' },
    { title: 'Forbidden Planet', artist: 'Boris Brejcha' },
    { title: 'Strings of Life', artist: 'Derrick May' },
  ],
  house: [
    { title: 'Feel It Still', artist: 'Folamour' },
    { title: 'Insomnia', artist: 'Faithless' },
    { title: 'Show Me Love', artist: 'Robin S' },
    { title: 'Music Sounds Better with You', artist: 'Stardust' },
    { title: 'Lone Stranger', artist: 'Peggy Gou' },
  ],
  electronic: [
    { title: 'Genesis', artist: 'Justice' },
    { title: 'D.A.N.C.E.', artist: 'Justice' },
    { title: 'Get Lucky', artist: 'Daft Punk' },
    { title: 'One More Time', artist: 'Daft Punk' },
    { title: 'Apollo', artist: 'Vitalic' },
  ],
  edm: [
    { title: 'Animals', artist: 'Martin Garrix' },
    { title: 'Titanium', artist: 'David Guetta' },
    { title: 'Levels', artist: 'Avicii' },
    { title: 'Don\'t You Worry Child', artist: 'Swedish House Mafia' },
  ],
  'hip-hop': [
    { title: 'Drip Too Hard', artist: 'Lil Baby' },
    { title: 'God\'s Plan', artist: 'Drake' },
    { title: 'Sicko Mode', artist: 'Travis Scott' },
    { title: 'Bricks', artist: 'PNL' },
    { title: 'Bande Organisée', artist: 'JuL & Naps' },
  ],
  rnb: [
    { title: 'After Hours', artist: 'The Weeknd' },
    { title: 'Pick Up the Phone', artist: 'Young Thug' },
    { title: 'Best Part', artist: 'Daniel Caesar' },
    { title: 'Earned It', artist: 'The Weeknd' },
  ],
  rock: [
    { title: 'Mr. Brightside', artist: 'The Killers' },
    { title: 'Seven Nation Army', artist: 'The White Stripes' },
    { title: 'Take Me Out', artist: 'Franz Ferdinand' },
    { title: 'Are You Gonna Be My Girl', artist: 'Jet' },
  ],
  pop: [
    { title: 'Flowers', artist: 'Miley Cyrus' },
    { title: 'Levitating', artist: 'Dua Lipa' },
    { title: 'Houdini', artist: 'Dua Lipa' },
    { title: 'Espresso', artist: 'Sabrina Carpenter' },
  ],
  indie: [
    { title: 'Do I Wanna Know?', artist: 'Arctic Monkeys' },
    { title: 'Pumped Up Kicks', artist: 'Foster the People' },
    { title: 'Glimpse of Us', artist: 'Joji' },
  ],
  jazz: [
    { title: 'So What', artist: 'Miles Davis' },
    { title: 'Take Five', artist: 'Dave Brubeck' },
    { title: 'Round Midnight', artist: 'Thelonious Monk' },
  ],
  soul: [
    { title: 'Try a Little Tenderness', artist: 'Otis Redding' },
    { title: 'Ain\'t No Sunshine', artist: 'Bill Withers' },
  ],
  lounge: [
    { title: 'Brazilian Soul', artist: 'Café del Mar' },
    { title: 'Sunset', artist: 'Kygo' },
    { title: 'Salalo', artist: 'Sahara Lounge' },
  ],
  live: [
    { title: 'Live performance — set highlights', artist: 'House DJ' },
  ],
  electronique: [
    { title: 'Apollo', artist: 'Vitalic' },
    { title: 'Strobe', artist: 'Deadmau5' },
  ],
  minimal: [
    { title: 'Lambretta', artist: 'Andhim' },
    { title: 'Distance', artist: 'Pan-Pot' },
  ],
};

const FALLBACK: Track[] = [
  { title: 'Mystery Set', artist: 'Resident DJ' },
  { title: 'Late Night Vibes', artist: 'Resident DJ' },
];

const sessions = new Map<string, ReturnType<typeof setInterval>>();
const DETECT_INTERVAL_MS = 90 * 1000; // 90s between detections
const SESSION_DURATION_MS = 10 * 60 * 1000; // stop after 10 min

function pickRandomTrack(musicStyles: string[]): Track {
  // Combine all matching style libraries
  const pool: Track[] = [];
  for (const s of musicStyles) {
    const key = s.toLowerCase();
    if (LIBRARY[key]) pool.push(...LIBRARY[key]);
  }
  const source = pool.length ? pool : FALLBACK;
  return source[Math.floor(Math.random() * source.length)];
}

async function recordTrack(club: Club): Promise<void> {
  const track = pickRandomTrack(club.music_styles || []);
  try {
    await api.addDetectedSong(
      club.club_id,
      track.title,
      track.artist,
      new Date().toISOString(),
      'auto',
    );
  } catch {
    // best-effort
  }
}

export function startLiveListeningMock(club: Club): void {
  if (sessions.has(club.club_id)) return; // already running
  // Fire one immediately for instant feedback
  recordTrack(club);
  const interval = setInterval(() => {
    recordTrack(club);
  }, DETECT_INTERVAL_MS);
  sessions.set(club.club_id, interval);

  // Auto-stop after SESSION_DURATION_MS
  setTimeout(() => stopLiveListeningMock(club.club_id), SESSION_DURATION_MS);
}

export function stopLiveListeningMock(clubId: string): void {
  const id = sessions.get(clubId);
  if (id) {
    clearInterval(id);
    sessions.delete(clubId);
  }
}

export function isLiveListening(clubId: string): boolean {
  return sessions.has(clubId);
}
