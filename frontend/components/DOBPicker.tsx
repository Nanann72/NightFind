import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Modal } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../lib/theme';

type Props = {
  value: string; // YYYY-MM-DD or ''
  onChange: (yyyyMmDd: string) => void;
  testID?: string;
  placeholder?: string;
};

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseValue(v: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map((n) => parseInt(n, 10));
    const dt = new Date(y, m - 1, d);
    if (!isNaN(dt.getTime())) return dt;
  }
  // default: 25 years ago (sensible adult default)
  const now = new Date();
  return new Date(now.getFullYear() - 25, now.getMonth(), now.getDate());
}

export function DOBPicker({ value, onChange, testID, placeholder = 'Date de naissance' }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(parseValue(value));

  const today = new Date();
  const maxDate = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  const minDate = new Date(today.getFullYear() - 100, 0, 1);

  const display = value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  if (Platform.OS === 'web') {
    // web fallback: native HTML date input via TextInput-equivalent
    return (
      <View style={styles.field} testID={testID}>
        <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        <input
          type="date"
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          max={toYMD(maxDate)}
          min={toYMD(minDate)}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: colors.textPrimary,
            fontSize: 15,
            padding: '14px 0',
            colorScheme: 'dark',
          } as any}
          placeholder={placeholder}
        />
      </View>
    );
  }

  const onAndroidChange = (event: DateTimePickerEvent, picked?: Date) => {
    setOpen(false);
    if (event.type === 'set' && picked) onChange(toYMD(picked));
  };

  const confirmIos = () => {
    onChange(toYMD(draft));
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.field}
        onPress={() => {
          setDraft(parseValue(value));
          setOpen(true);
        }}
        testID={testID}
        activeOpacity={0.7}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        <Text style={[styles.text, !display && styles.placeholder]} numberOfLines={1}>
          {display || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textTertiary} />
      </TouchableOpacity>

      {Platform.OS === 'android' && open && (
        <DateTimePicker
          value={parseValue(value)}
          mode="date"
          display="default"
          maximumDate={maxDate}
          minimumDate={minDate}
          onChange={onAndroidChange}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal
          visible={open}
          transparent
          animationType="slide"
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.iosRoot}>
            <TouchableOpacity style={styles.iosBackdrop} activeOpacity={1} onPress={() => setOpen(false)} />
            <View style={styles.iosSheet}>
              <View style={styles.iosHeader}>
                <TouchableOpacity onPress={() => setOpen(false)}>
                  <Text style={styles.iosCancel}>Annuler</Text>
                </TouchableOpacity>
                <Text style={styles.iosTitle}>Date de naissance</Text>
                <TouchableOpacity onPress={confirmIos}>
                  <Text style={styles.iosConfirm}>OK</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={draft}
                mode="date"
                display="spinner"
                maximumDate={maxDate}
                minimumDate={minDate}
                onChange={(_, d) => d && setDraft(d)}
                themeVariant="dark"
                textColor={colors.textPrimary as any}
                locale="fr-FR"
              />
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    gap: 10,
  },
  text: { flex: 1, color: colors.textPrimary, paddingVertical: 16, fontSize: 15 },
  placeholder: { color: colors.textTertiary },
  iosRoot: { flex: 1, justifyContent: 'flex-end' },
  iosBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  iosSheet: { backgroundColor: colors.bg, paddingBottom: 30, borderTopWidth: 1, borderTopColor: colors.border },
  iosHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iosCancel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  iosConfirm: { color: colors.primary, fontSize: 15, fontWeight: '900' },
  iosTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
});
