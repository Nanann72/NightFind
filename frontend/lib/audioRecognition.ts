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

export type ScanResult = {
  ok: boolean;
  recognised?: boolean;
  title?: string;
  artist?: string;
  reason?: 'no-mic-permission' | 'native-only' | 'error' | 'unknown' | 'no-audio-recorded' | 'audd-not-recognised';
  errorMessage?: string;
};

async function recordAndRecognise(club: Club, returnResult = false): Promise<ScanResult> {
  if (Platform.OS === 'web') {
    return {
      ok: false,
      reason: 'native-only',
      errorMessage: "L'écoute audio nécessite l'app native (iOS/Android). Indisponible sur le web.",
    };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoAudio = require('expo-audio');
    const permission = await ExpoAudio.requestRecordingPermissionsAsync();
    if (!permission?.granted) {
      return {
        ok: false,
        reason: 'no-mic-permission',
        errorMessage: 'Autorise le microphone dans les réglages pour identifier la musique.',
      };
    }

    await ExpoAudio.setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    const recorder = ExpoAudio.createAudioRecorder(
      ExpoAudio.RecordingPresets.HIGH_QUALITY,
    );
    await recorder.prepareToRecordAsync();
    recorder.record();
    await new Promise((r) => setTimeout(r, SAMPLE_DURATION_MS));
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      return {
        ok: false,
        reason: 'no-audio-recorded',
        errorMessage: "Impossible d'enregistrer l'audio. Vérifie que le micro fonctionne.",
      };
    }

    const FileSystem = require('expo-file-system');
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64) {
      return { ok: false, reason: 'no-audio-recorded', errorMessage: 'Fichier audio vide.' };
    }

    const resp: any = await api.recognizeAudio(club.club_id, base64);
    if (returnResult) {
      return {
        ok: true,
        recognised: !!resp?.recognised,
        title: resp?.song?.title,
        artist: resp?.song?.artist,
        reason: resp?.recognised ? undefined : 'audd-not-recognised',
        errorMessage: resp?.recognised
          ? undefined
          : "Aucune musique reconnue. Rapproche-toi des enceintes et réessaie.",
      };
    }
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message || e || 'Erreur inconnue').slice(0, 200);
    if (typeof console !== 'undefined') console.warn('[audioRecognition] error:', msg);
    return { ok: false, reason: 'error', errorMessage: msg };
  }
}

/** One-shot Shazam-like scan; returns the result so the UI can show feedback. */
export async function scanOnce(club: Club): Promise<ScanResult> {
  return recordAndRecognise(club, true);
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
