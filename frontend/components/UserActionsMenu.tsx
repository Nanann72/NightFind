import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

const REASONS: { id: string; label: string; emoji: string }[] = [
  { id: 'inappropriate_photos', label: 'Photos inappropriées', emoji: '🚫' },
  { id: 'harassment', label: 'Harcèlement ou menaces', emoji: '⚠️' },
  { id: 'fake_profile', label: 'Faux profil', emoji: '🎭' },
  { id: 'underage', label: 'Mineur·e (moins de 18 ans)', emoji: '🔞' },
  { id: 'hate_speech', label: 'Discours haineux', emoji: '🚨' },
  { id: 'spam', label: 'Spam ou arnaque', emoji: '📵' },
  { id: 'other', label: 'Autre', emoji: '✏️' },
];

type Props = {
  targetUserId: string;
  targetName?: string;
  context?: 'swipe' | 'chat' | 'profile' | 'match-request';
  onBlocked?: () => void;
  /** Trigger element: by default a 3-dot icon in a round button */
  renderTrigger?: (open: () => void) => React.ReactNode;
  /** Icon color override (when using default trigger) */
  triggerColor?: string;
};

export function UserActionsMenu({
  targetUserId,
  targetName,
  context = 'profile',
  onBlocked,
  renderTrigger,
  triggerColor,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setMenuOpen(false);
    setReportOpen(false);
    setSelectedReason(null);
    setDetails('');
  };

  const confirmBlock = () => {
    setMenuOpen(false);
    Alert.alert(
      'Bloquer ' + (targetName || 'cette personne') + ' ?',
      "Vous ne pourrez plus vous voir ni vous contacter. Ce blocage est immédiat.",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Bloquer',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.blockUser(targetUserId);
              Alert.alert('Utilisateur bloqué', 'Cette personne ne pourra plus interagir avec toi.');
              onBlocked?.();
            } catch (e: any) {
              Alert.alert('Erreur', e?.message || 'Impossible de bloquer cet utilisateur.');
            }
          },
        },
      ],
    );
  };

  const submitReport = async () => {
    if (!selectedReason) return;
    setSubmitting(true);
    try {
      await api.reportUser(targetUserId, selectedReason, context, details.trim() || undefined);
      // Auto-block to protect the reporter — Apple best-practice for UGC apps
      try {
        await api.blockUser(targetUserId);
      } catch {}
      Alert.alert(
        'Signalement envoyé',
        "Merci ! Notre équipe va examiner ce profil. Cet utilisateur a aussi été bloqué pour ta protection.",
      );
      close();
      onBlocked?.();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Envoi du signalement impossible.');
    } finally {
      setSubmitting(false);
    }
  };

  const Trigger = renderTrigger
    ? renderTrigger(() => setMenuOpen(true))
    : (
      <TouchableOpacity
        onPress={() => setMenuOpen(true)}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityLabel="Plus d'options"
        accessibilityRole="button"
        testID="user-actions-trigger"
      >
        <Ionicons name="ellipsis-horizontal" size={22} color={triggerColor || colors.textPrimary} />
      </TouchableOpacity>
    );

  return (
    <>
      {Trigger}

      {/* Bottom-sheet menu */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <View style={styles.sheetRoot}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <TouchableOpacity
              style={styles.sheetRow}
              onPress={() => {
                setMenuOpen(false);
                setTimeout(() => setReportOpen(true), 220);
              }}
              testID="action-report"
            >
              <Ionicons name="flag-outline" size={20} color={colors.danger} />
              <Text style={styles.sheetText}>Signaler {targetName || 'cet utilisateur'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetRow}
              onPress={confirmBlock}
              testID="action-block"
            >
              <Ionicons name="ban-outline" size={20} color={colors.danger} />
              <Text style={styles.sheetText}>Bloquer {targetName || 'cet utilisateur'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sheetRow, styles.sheetCancel]} onPress={close}>
              <Text style={styles.sheetCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Report modal */}
      <Modal
        visible={reportOpen}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <View style={styles.sheetRoot}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close} />
          <View style={[styles.sheet, { paddingBottom: 32 }]}>
            <View style={styles.handle} />
            <Text style={styles.reportTitle}>Signaler {targetName || 'cet utilisateur'}</Text>
            <Text style={styles.reportSub}>
              Choisis un motif. Le signalement est confidentiel et examiné sous 24h.
            </Text>
            {REASONS.map((r) => {
              const sel = selectedReason === r.id;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.reasonRow, sel && styles.reasonRowSel]}
                  onPress={() => setSelectedReason(r.id)}
                  testID={`reason-${r.id}`}
                >
                  <Text style={styles.reasonEmoji}>{r.emoji}</Text>
                  <Text style={[styles.reasonLabel, sel && styles.reasonLabelSel]}>{r.label}</Text>
                  {sel && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
            {selectedReason === 'other' && (
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Décris brièvement (optionnel)"
                placeholderTextColor={colors.textTertiary}
                style={styles.detailsInput}
                multiline
                maxLength={500}
                returnKeyType="done"
                blurOnSubmit
              />
            )}
            <TouchableOpacity
              style={[styles.submitBtn, (!selectedReason || submitting) && { opacity: 0.5 }]}
              disabled={!selectedReason || submitting}
              onPress={submitReport}
              testID="submit-report"
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Envoyer le signalement</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={close} style={styles.skipBtn}>
              <Text style={styles.skipText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 38 : 24,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: 14,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 },
  sheetCancel: { borderBottomWidth: 0, justifyContent: 'center', marginTop: 6 },
  sheetCancelText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },

  reportTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '900', marginBottom: 4 },
  reportSub: { color: colors.textSecondary, fontSize: 13, marginBottom: 14, lineHeight: 18 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  reasonRowSel: { borderColor: colors.primary, backgroundColor: 'rgba(224,26,79,0.10)' },
  reasonEmoji: { fontSize: 18 },
  reasonLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', flex: 1 },
  reasonLabelSel: { color: colors.textPrimary },
  detailsInput: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    marginTop: 8,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitBtn: {
    marginTop: 14,
    backgroundColor: colors.danger,
    paddingVertical: 14,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  skipBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  skipText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
});
