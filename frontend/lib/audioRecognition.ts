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
const SAMPLE_DURATION_MS = 8000; // background live-listening sample
// Shazam-like fast scan: 5s first pass — Audd identifies most tracks with 4-6s.
const FAST_SAMPLE_MS = 5000;
// The retry sample RECORDS IN PARALLEL while the 1st API call is in flight,
// so a no-match retry costs only ~4 extra seconds instead of 12.
const RETRY_SAMPLE_MS = 9000;

/**
 * Optimized recording options for music recognition.
 * Mono + AAC 64 kbps keeps a 10-12s sample around 80-100 KB (vs ~2 MB with
 * the default HIGH_QUALITY preset on iOS which can fall back to near-PCM),
 * which fixes the "Audio too large (1.5 MB)" backend rejection while staying
 * well within Audd.io's sweet spot for recognition accuracy.
 */
function buildRecognitionRecordingOptions(ExpoAudio: any) {
  return {
    extension: '.m4a',
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
    android: {
      outputFormat: 'mpeg4',
      audioEncoder: 'aac',
    },
    ios: {
      outputFormat: ExpoAudio?.IOSOutputFormat?.MPEG4AAC ?? 'aac ',
      audioQuality: ExpoAudio?.AudioQuality?.MAX ?? 127,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {
      mimeType: 'audio/webm',
      bitsPerSecond: 64000,
    },
  };
}

// Hard client-side cap — backend accepts up to ~5 MB but anything above
// ~2 MB means the codec fell back to uncompressed audio; fail fast with a
// clear message instead of a server 413.
const MAX_BASE64_LENGTH = 2_800_000; // ≈ 2.1 MB raw

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

type CancelToken = { cancelled: boolean };

/** Record a mic sample and return it as base64 (or a typed error).
 *  Supports early cancellation (checked every 250ms) so a parallel retry
 *  recording can be aborted the moment the first pass matches. */
async function recordSampleBase64(
  durationMs: number,
  cancel?: CancelToken,
): Promise<{ base64?: string; error?: ScanResult; aborted?: boolean }> {
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
      error: {
        ok: false,
        reason: 'no-mic-permission',
        errorMessage:
          'Autorise le microphone dans les réglages pour identifier la musique.',
      },
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
  const recorder = new RecorderClass(buildRecognitionRecordingOptions(ExpoAudio));
  await recorder.prepareToRecordAsync();
  recorder.record();
  // Sleep in 250ms slices so cancellation frees the mic immediately.
  const started = Date.now();
  while (Date.now() - started < durationMs) {
    if (cancel?.cancelled) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await recorder.stop();
  if (cancel?.cancelled) return { aborted: true };
  const uri: string | null = recorder.uri;
  if (!uri) {
    return {
      error: {
        ok: false,
        reason: 'no-audio-recorded',
        errorMessage:
          "Impossible d'enregistrer l'audio. Vérifie que le micro fonctionne.",
      },
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
  // Silence/short-buffer heuristic proportional to duration (~3 chars/ms of
  // base64 for mono AAC@64kbps music; near-silence compresses far below).
  const minLen = Math.min(30_000, Math.floor(durationMs * 2.5));
  if (!base64 || base64.length < minLen) {
    return {
      error: {
        ok: false,
        reason: 'no-audio-recorded',
        errorMessage:
          "Le micro n'a presque rien capté. Rapproche ton téléphone de la source sonore et réessaie.",
      },
    };
  }
  if (base64.length > MAX_BASE64_LENGTH) {
    return {
      error: {
        ok: false,
        reason: 'error',
        errorMessage:
          "L'échantillon audio est trop volumineux. Réessaie — si le problème persiste, redémarre l'application.",
      },
    };
  }
  return { base64 };
}

/** Send a sample to the backend → Audd.io and map the response. */
async function recogniseSample(club: Club, base64: string): Promise<ScanResult> {
  const resp: any = await api.recognizeAudio(club.club_id, base64);
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
      : 'Aucune musique reconnue. Essaie de rapprocher ton téléphone de la source sonore.',
  };
}

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
    const sample = await recordSampleBase64(sampleDurationMs);
    if (sample.error) return sample.error;
    if (!sample.base64) {
      return { ok: false, reason: 'no-audio-recorded', errorMessage: 'Fichier audio vide.' };
    }
    const result = await recogniseSample(club, sample.base64);
    return returnResult ? result : { ok: true };
  } catch (e: any) {
    const msg = String(e?.message || e || 'Erreur inconnue').slice(0, 200);
    if (typeof console !== 'undefined') {
      console.warn('[audioRecognition] error:', msg);
    }
    return { ok: false, reason: 'error', errorMessage: msg };
  }
}

/** Shazam-like fast scan.
 *  Pass 1 : 5s sample → sent immediately (most tracks match here → ~6s total).
 *  While the API call is in flight, a longer 9s sample is ALREADY recording in
 *  parallel — on a no-match we only wait for the tail of that recording
 *  instead of starting a brand-new 12s capture (old flow: up to ~27s). */
export async function scanOnce(club: Club): Promise<ScanResult> {
  if (Platform.OS === 'web') {
    return {
      ok: false,
      reason: 'native-only',
      errorMessage:
        "L'écoute audio nécessite l'app native (iOS/Android). Indisponible sur le web.",
    };
  }
  try {
    // Pass 1 — fast 5s capture
    const p1 = await recordSampleBase64(FAST_SAMPLE_MS);
    if (p1.error) return p1.error;
    if (!p1.base64) {
      return { ok: false, reason: 'no-audio-recorded', errorMessage: 'Fichier audio vide.' };
    }

    // Start the longer retry recording NOW, in parallel with the API call.
    const cancel: CancelToken = { cancelled: false };
    const p2Promise = recordSampleBase64(RETRY_SAMPLE_MS, cancel).catch(
      () => ({}) as Awaited<ReturnType<typeof recordSampleBase64>>,
    );

    const first = await recogniseSample(club, p1.base64);
    if (first.recognised) {
      cancel.cancelled = true; // free the mic immediately
      return first;
    }
    // Hard failure (quota, réseau, service down) : retrying would fail too.
    if (!first.ok) {
      cancel.cancelled = true;
      return first;
    }

    // Clean no-match → the longer sample is already almost done recording.
    const p2 = await p2Promise;
    if (p2.error || !p2.base64) return first;
    const second = await recogniseSample(club, p2.base64);
    return second.recognised
      ? second
      : { ...second, errorMessage: second.errorMessage || first.errorMessage };
  } catch (e: any) {
    const msg = String(e?.message || e || 'Erreur inconnue').slice(0, 200);
    if (typeof console !== 'undefined') {
      console.warn('[audioRecognition] scan error:', msg);
    }
    return { ok: false, reason: 'error', errorMessage: msg };
  }
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
