/**
 * Live listening — production version using Audd.io.
 *
 * Records a short ~5 second sample from the microphone every 90s while the
 * user is checked in at a club, sends it to our FastAPI backend which
 * forwards it to Audd.io for recognition. Detected tracks are persisted in
 * MongoDB and shown in the "Mes musiques" screen.
 *
 * Falls back to the legacy mock library if microphone recording is not
 * available on the current platform (e.g. web preview, Expo Go limits).
 */
import { Platform } from 'react-native';
import { api, Club } from './api';

const DETECT_INTERVAL_MS = 90 * 1000; // 90s between detections
const SESSION_DURATION_MS = 10 * 60 * 1000; // stop after 10 min
const SAMPLE_DURATION_MS = 5000; // 5 seconds of audio

const sessions = new Map<string, ReturnType<typeof setInterval>>();

async function recordAndRecognise(club: Club): Promise<void> {
  if (Platform.OS === 'web') {
    // Web preview / Expo Go fallback — keep the mock library experience
    const lib = await import('./liveListening');
    // simulate a single detection
    (lib as any).recordTrack?.(club);
    return;
  }
  try {
    // Lazy require so the web bundle doesn't try to load the native module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoAudio = require('expo-audio');
    const permission = await ExpoAudio.requestRecordingPermissionsAsync();
    if (!permission?.granted) return;

    await ExpoAudio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    const recorder = ExpoAudio.createAudioRecorder(
      ExpoAudio.RecordingPresets.HIGH_QUALITY,
    );
    await recorder.prepareToRecordAsync();
    await recorder.record();
    await new Promise((r) => setTimeout(r, SAMPLE_DURATION_MS));
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;

    // Read file into base64 then send to backend
    const FileSystem = require('expo-file-system');
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64) return;

    await api.recognizeAudio(club.club_id, base64);
  } catch {
    // Silently ignore — recognition will be retried on next tick
  }
}

export function startLiveListening(club: Club): void {
  if (sessions.has(club.club_id)) return;
  recordAndRecognise(club);
  const id = setInterval(() => recordAndRecognise(club), DETECT_INTERVAL_MS);
  sessions.set(club.club_id, id);
  setTimeout(() => stopLiveListening(club.club_id), SESSION_DURATION_MS);
}

export function stopLiveListening(clubId: string): void {
  const id = sessions.get(clubId);
  if (id) {
    clearInterval(id);
    sessions.delete(clubId);
  }
}

export function isLiveListening(clubId: string): boolean {
  return sessions.has(clubId);
}
