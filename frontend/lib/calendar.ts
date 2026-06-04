/**
 * Add events to the user's device calendar.
 *
 * Option C strategy from the product spec:
 *   - Native devices (iOS / Android): use expo-calendar to write the event
 *     into the system calendar (Apple Calendar on iOS, Google Calendar on Android).
 *   - Web / Expo Go fallback: generate an .ics file and trigger a download /
 *     share sheet so the user can import it into any calendar app.
 */
import { Platform, Alert, Linking } from 'react-native';

export type CalendarEvent = {
  title: string;
  startsAt: Date;
  endsAt?: Date;
  location?: string;
  notes?: string;
  url?: string;
};

const DEFAULT_DURATION_HOURS = 4;
const DEFAULT_REMINDER_MIN = 60;

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toICSDate(d: Date) {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function escapeICS(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function buildICS(ev: CalendarEvent): string {
  const start = ev.startsAt;
  const end =
    ev.endsAt ||
    new Date(start.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);
  const uid = `${start.getTime()}-${Math.random().toString(36).slice(2, 8)}@nightfinder`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Night Finder//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICS(ev.title)}`,
    ev.location ? `LOCATION:${escapeICS(ev.location)}` : '',
    ev.notes ? `DESCRIPTION:${escapeICS(ev.notes)}` : '',
    ev.url ? `URL:${escapeICS(ev.url)}` : '',
    'BEGIN:VALARM',
    `TRIGGER:-PT${DEFAULT_REMINDER_MIN}M`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeICS(ev.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.join('\r\n');
}

async function fallbackICS(ev: CalendarEvent): Promise<boolean> {
  const ics = buildICS(ev);

  if (Platform.OS === 'web') {
    try {
      // Use Blob + anchor to trigger a download in the browser
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${ev.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  }

  // Native fallback (Expo Go without expo-calendar): write file + share sheet
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sharing = require('expo-sharing');
    const path = `${FileSystem.cacheDirectory}nightfinder-${Date.now()}.ics`;
    await FileSystem.writeAsStringAsync(path, ics, { encoding: 'utf8' });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, {
        mimeType: 'text/calendar',
        UTI: 'public.calendar-event',
        dialogTitle: 'Ajouter au calendrier',
      });
      return true;
    }
  } catch {
    // fallthrough
  }
  return false;
}

/**
 * Add an event to the user's device calendar.
 * Returns true if the event was successfully added (or the share sheet was
 * presented successfully on web/Expo Go).
 */
export async function addToCalendar(ev: CalendarEvent): Promise<boolean> {
  // Web — always use the .ics download
  if (Platform.OS === 'web') {
    const ok = await fallbackICS(ev);
    if (!ok) {
      Alert.alert('Erreur', 'Impossible de générer le fichier calendrier.');
    }
    return ok;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Calendar = require('expo-calendar');

    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.status !== 'granted') {
      // ── Permission denied. Offer fallback to .ics share so we never dead-end.
      const canAskAgain = perm.canAskAgain;
      const fb = await fallbackICS(ev);
      if (fb) return true;
      Alert.alert(
        'Accès calendrier refusé',
        canAskAgain
          ? "Active l'accès au calendrier pour ajouter automatiquement les soirées."
          : "Tu peux activer l'accès dans les réglages système pour automatiser l'ajout.",
        [
          { text: 'Plus tard', style: 'cancel' },
          ...(!canAskAgain
            ? [{ text: 'Réglages', onPress: () => Linking.openSettings() }]
            : []),
        ],
      );
      return false;
    }

    // Locate the default writable calendar
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars.find(
      (c: any) => c.allowsModifications && c.source && c.source.name,
    );
    if (!writable) {
      Alert.alert('Aucun calendrier disponible', 'Impossible de trouver un calendrier sur ton device.');
      return false;
    }

    const end =
      ev.endsAt ||
      new Date(ev.startsAt.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);

    await Calendar.createEventAsync(writable.id, {
      title: ev.title,
      startDate: ev.startsAt,
      endDate: end,
      location: ev.location,
      notes: ev.notes,
      url: ev.url,
      alarms: [{ relativeOffset: -DEFAULT_REMINDER_MIN }],
    });

    Alert.alert('✅ Ajouté au calendrier', `${ev.title} a été ajouté à ton agenda.`);
    return true;
  } catch (err) {
    // Calendar module unavailable (Expo Go) — fallback to .ics share
    const ok = await fallbackICS(ev);
    if (!ok) {
      Alert.alert('Erreur', "Impossible d'ajouter l'événement au calendrier.");
    }
    return ok;
  }
}
