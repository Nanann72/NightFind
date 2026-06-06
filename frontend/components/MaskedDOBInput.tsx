import { useState, useEffect, useRef } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../lib/theme';

type Props = {
  /** Canonical value YYYY-MM-DD (empty string if not set) */
  value: string;
  /** Called with canonical YYYY-MM-DD value (or '' if cleared/invalid in progress) */
  onChange: (yyyyMmDd: string) => void;
  testID?: string;
  placeholder?: string;
};

// Format display: DD/MM/YYYY
// Canonical (returned to parent): YYYY-MM-DD
// Auto inserts slashes as the user types numbers.

function canonicalToDisplay(canonical: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(canonical)) return '';
  const [y, m, d] = canonical.split('-');
  return `${d}/${m}/${y}`;
}

function displayToCanonical(display: string): string {
  // Accept DD/MM/YYYY only
  const m = display.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  if (mm < 1 || mm > 12) return '';
  if (dd < 1 || dd > 31) return '';
  if (yyyy < 1900 || yyyy > 2100) return '';
  // Validate actual calendar date
  const dt = new Date(yyyy, mm - 1, dd);
  if (
    dt.getFullYear() !== yyyy ||
    dt.getMonth() !== mm - 1 ||
    dt.getDate() !== dd
  ) {
    return '';
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Apply DD/MM/YYYY mask while typing.
 *  - keeps only digits
 *  - auto-inserts "/" at positions 2 and 4
 *  - caps at 8 digits total
 */
function applyMask(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i === 2 || i === 4) out += '/';
    out += digits[i];
  }
  return out;
}

export function MaskedDOBInput({
  value,
  onChange,
  testID,
  placeholder = 'JJ/MM/AAAA',
}: Props) {
  const [display, setDisplay] = useState(canonicalToDisplay(value));
  const lastEmittedRef = useRef<string>(value);

  // Sync display when external value changes (e.g. profile loaded)
  useEffect(() => {
    const next = canonicalToDisplay(value);
    if (next !== display && value !== lastEmittedRef.current) {
      setDisplay(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = (raw: string) => {
    const masked = applyMask(raw);
    setDisplay(masked);
    if (masked.length === 10) {
      const canonical = displayToCanonical(masked);
      lastEmittedRef.current = canonical;
      onChange(canonical); // '' if invalid date
    } else {
      lastEmittedRef.current = '';
      onChange('');
    }
  };

  return (
    <View style={styles.field}>
      <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
      <TextInput
        value={display}
        onChangeText={handleChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        keyboardType={Platform.OS === 'ios' ? 'number-pad' : 'numeric'}
        maxLength={10}
        style={styles.input}
        autoCorrect={false}
        autoComplete="birthdate-full"
        textContentType="none"
        testID={testID}
        accessibilityLabel="Date de naissance, format jour slash mois slash année"
      />
    </View>
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
  input: {
    flex: 1,
    color: colors.textPrimary,
    paddingVertical: 16,
    fontSize: 15,
    letterSpacing: 1,
  },
});
