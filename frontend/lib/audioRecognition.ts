/**
 * Live listening — production version using Audd.io.
 *
 * Records a short ~5 second sample from the microphone every 90s while the
 * user is checked in at a club, sends it to our FastAPI backend which
 * forwards it to Audd.io for recognition. Detected tracks are persisted in
 * MongoDB and shown in the "Mes musiques" screen.
 *
 * Compatible with:
 *  - expo-audio ≥ 1.1 (uses AudioModule.AudioRecorder directly)
 *  - expo-file-system ≥ 19   (uses new File(uri).base64())
 * Falls back gracefully if microphone recording is not available on the
 * current platform (e.g. web preview, Expo Go limits).
 */
import { Platform } from 'react-native';
import { api, Club } from './api';

const DETECT_INTERVAL_MS = 90 * 1000; // 90s between detections
const SESSION_DURATION_MS = 10 * 60 * 1000; // stop after 10 min
const SAMPLE_DURATION_MS = 12000; // 12 seconds — Audd recommends 10-12s for noisy environments (clubs)
const RETRY_SAMPLE_DURATION_MS = 15000; // Auto-retry uses a longer sample for better hit rate

const sessions = new Map<string, ReturnType<typeof setInterval>>();

export type ScanResult = {
  ok: boolean;
  recognised?: boolean;
  title?: string;
  artist?: string;
  reason?:
    | 'no-mic-permission'
    | 'native-only'
    | 'error'
    | 'unknown'
    | 'no-audio-recorded'
    | 'audd-not-recognised';
  errorMessage?: string;
};

async function recordAndRecognise(
  club: Club,
  returnResult = false,
  sampleDurationMs: number = SAMPLE_DURATION_MS,
): Promise<ScanResult> {
  if (Platform.OS === 'web') {
    return {
      ok: false,
      reason: 'native-only',
      errorMessage:
        "L'écoute audio nécessite l'app native (iOS/Android). Indisponible sur le web.",
    };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoAudio = require('expo-audio');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AudioModule = require('expo-audio/build/AudioModule').default;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system');

    // 1. Permissions
    const permission = await ExpoAudio.requestRecordingPermissionsAsync();
    if (!permission?.granted) {
      return {
        ok: false,
        reason: 'no-mic-permission',
        errorMessage:
          'Autorise le microphone dans les réglages pour identifier la musique.',
      };
    }

    // 2. Activate recording audio mode
    await ExpoAudio.setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    // 3. Build recorder — instantiate AudioRecorder directly (no public
    //    createAudioRecorder API in expo-audio 1.1+)
    const RecorderClass =
      AudioModule?.AudioRecorder ||
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo-audio').AudioRecorder;
    if (!RecorderClass) {
      throw new Error('AudioRecorder class unavailable in expo-audio module');
    }
    const recorder = new RecorderClass(ExpoAudio.RecordingPresets.HIGH_QUALITY);
    await recorder.prepareToRecordAsync();
    recorder.record();
    await new Promise((r) => setTimeout(r, sampleDurationMs));
    await recorder.stop();
    const uri: string | null = recorder.uri;
    if (!uri) {
      return {
        ok: false,
        reason: 'no-audio-recorded',
        errorMessage:
          "Impossible d'enregistrer l'audio. Vérifie que le micro fonctionne.",
      };
    }

    // 4. Read file as base64 — modern API: new File(uri).base64()
    let base64 = '';
    try {
      if (FileSystem?.File) {
        const file = new FileSystem.File(uri);
        base64 = await file.base64();
      } else if (typeof FileSystem?.readAsStringAsync === 'function') {
        base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType?.Base64 || 'base64',
        });
      } else {
        throw new Error('No FileSystem.base64 API available');
      }
    } catch (readErr: any) {
      throw new Error(
        `Lecture audio impossible : ${String(readErr?.message || readErr)}`,
      );
    }
    if (!base64) {
      return {
        ok: false,
        reason: 'no-audio-recorded',
        errorMessage: 'Fichier audio vide.',
      };
    }
    // Heuristic silence/short-buffer detection. 12s of m4a@128kbps is ~180-240 KB.
    // base64 inflates by 33%, so a real sample should be > ~120KB encoded.
    // If we got significantly less, the mic was muted or the recording was
    // truncated by the OS → skip the API call to save quota and inform the user.
    if (base64.length < 60_000) {
      return {
        ok: false,
        reason: 'no-audio-recorded',
        errorMessage:
          "Le micro n'a presque rien capté. Rapproche-toi des enceintes (~1m), augmente le volume et réessaie.",
      };
    }

    // 5. Send to backend → Audd.io
    const resp: any = await api.recognizeAudio(club.club_id, base64);
    if (returnResult) {
      // Backend may surface an Audd API error (e.g. quota, auth) — show it.
      if (resp?.ok === false) {
        return {
          ok: false,
          recognised: false,
          reason: 'audd-not-recognised',
          errorMessage:
            resp?.error_message ||
            'Service de reconnaissance temporairement indisponible. Réessaie plus tard.',
        };
      }
      return {
        ok: true,
        recognised: !!resp?.recognised,
        title: resp?.song?.title || resp?.title,
        artist: resp?.song?.artist || resp?.artist,
        reason: resp?.recognised ? undefined : 'audd-not-recognised',
        errorMessage: resp?.recognised
          ? undefined
          : 'Aucune musique reconnue. Rapproche-toi des enceintes (~1m), augmente le volume et réessaie.',
      };
    }
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message || e || 'Erreur inconnue').slice(0, 200);
    if (typeof console !== 'undefined') {
      console.warn('[audioRecognition] error:', msg);
    }
    return { ok: false, reason: 'error', errorMessage: msg };
  }
}

/** One-shot Shazam-like scan with auto-retry on no-match.
 *  Strategy: 1st pass = 12s sample. If not recognised, retry once with a 15s
 *  sample for better hit rate in noisy environments (clubs). */
export async function scanOnce(club: Club): Promise<ScanResult> {
  const first = await recordAndRecognise(club, true, SAMPLE_DURATION_MS);
  // Only retry on a clean "no-match" — not on permission denials, silent mic,
  // network errors, or Audd quota issues (those will fail the retry too and
  // burn user time).
  if (first.ok && first.recognised === false && first.reason === 'audd-not-recognised') {
    const second = await recordAndRecognise(club, true, RETRY_SAMPLE_DURATION_MS);
    return second.ok && second.recognised
      ? second
      : { ...second, errorMessage: second.errorMessage || first.errorMessage };
  }
  return first;
}

export function startLiveListening(club: Club): void {
  if (sessions.has(club.club_id)) return;
  void recordAndRecognise(club);
  const id = setInterval(() => {
    void recordAndRecognise(club);
  }, DETECT_INTERVAL_MS);
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
