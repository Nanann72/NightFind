/**
 * Single source of truth for music genres across the app
 * (onboarding, settings preferences, club filters, people search).
 * IDs match the `music_styles` values assigned to clubs by the backend.
 */
export type MusicGenre = { id: string; label: string; emoji: string };

export const MUSIC_GENRES: MusicGenre[] = [
  { id: 'techno', label: 'Techno', emoji: '⚡️' },
  { id: 'house', label: 'House', emoji: '🏠' },
  { id: 'afro-house', label: 'Afro House', emoji: '🥁' },
  { id: 'electronic', label: 'Électro', emoji: '🌌' },
  { id: 'edm', label: 'EDM', emoji: '🎆' },
  { id: 'minimal', label: 'Minimal', emoji: '🎛️' },
  { id: 'hip-hop', label: 'Hip-Hop / Rap', emoji: '🎤' },
  { id: 'rnb', label: 'RnB', emoji: '💜' },
  { id: 'latin', label: 'Latin', emoji: '💃' },
  { id: 'reggaeton', label: 'Reggaeton', emoji: '🔥' },
  { id: 'disco', label: 'Disco', emoji: '🕺' },
  { id: 'funk', label: 'Funk', emoji: '🪩' },
  { id: 'soul', label: 'Soul', emoji: '🎶' },
  { id: 'jazz', label: 'Jazz', emoji: '🎷' },
  { id: 'pop', label: 'Pop', emoji: '🎧' },
  { id: 'rock', label: 'Rock', emoji: '🎸' },
  { id: 'indie', label: 'Indie', emoji: '🌙' },
  { id: 'lounge', label: 'Lounge', emoji: '🍸' },
];
