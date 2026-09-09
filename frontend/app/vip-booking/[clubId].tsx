/**
 * Réservation de carré VIP — plan des tables du club.
 * Choisis une date, tape un carré libre sur le plan (dancefloor, bar, DJ),
 * indique le nombre de personnes et confirme.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, VipTable } from '../../lib/api';
import { radius, spacing, type ThemeColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';

const PLAN_W = Dimensions.get('window').width - 32;
const PLAN_H = Math.round(PLAN_W * 1.05);
const TABLE_SIZE = 54;

function nextDates(n = 7): { date: string; label: string }[] {
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({
      date: iso,
      label: i === 0 ? 'Ce soir' : `${days[d.getDay()]} ${d.getDate()}`,
    });
  }
  return out;
}

export default function VipBooking() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { clubId } = useLocalSearchParams<{ clubId: string }>();

  const dates = useMemo(() => nextDates(), []);
  const [date, setDate] = useState(dates[0].date);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<VipTable[]>([]);
  const [myRes, setMyRes] = useState<any | null>(null);
  const [selected, setSelected] = useState<VipTable | null>(null);
  const [partySize, setPartySize] = useState(4);
  const [booking, setBooking] = useState(false);
  const [confirmed, setConfirmed] = useState<any | null>(null);
  const [awaitingPay, setAwaitingPay] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true);
    setSelected(null);
    setError(null);
    try {
      const r = await api.vipTables(clubId, date);
      setTables(r.tables || []);
      setMyRes(r.my_reservation || null);
    } catch {
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [clubId, date]);

  useEffect(() => { load(); }, [load]);

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const pickTable = (t: VipTable) => {
    if (t.booked) return;
    haptic();
    setSelected(t);
    setPartySize(Math.min(4, t.capacity));
    setError(null);
  };

  const reserve = async () => {
    if (!selected || !clubId || booking) return;
    setBooking(true);
    setError(null);
    try {
      const r = await api.vipReserve(clubId, selected.table_id, date, partySize);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (r?.checkout_url) {
        // Paiement Stripe hébergé
        setAwaitingPay(r);
        Linking.openURL(r.checkout_url).catch(() => {});
      } else {
        setConfirmed(r);
      }
    } catch (e: any) {
      setError(e?.message || 'Réservation impossible. Réessaie.');
    } finally {
      setBooking(false);
    }
  };

  const cancel = async () => {
    if (!myRes) return;
    try {
      await api.cancelVipReservation(myRes.reservation_id);
      setMyRes(null);
      setConfirmed(null);
      load();
    } catch {}
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]} testID="vip-booking-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8} testID="vip-back">
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Carré VIP 🍾</Text>
          <Text style={styles.subtitle}>Choisis ta table sur le plan</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* ── Dates ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.datesRow}>
          {dates.map((d) => (
            <TouchableOpacity
              key={d.date}
              style={[styles.dateChip, date === d.date && styles.dateChipActive]}
              onPress={() => { haptic(); setDate(d.date); setConfirmed(null); }}
              testID={`vip-date-${d.date}`}
            >
              <Text style={[styles.dateText, date === d.date && styles.dateTextActive]} allowFontScaling={false}>
                {d.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {awaitingPay && !confirmed && !myRes ? (
          <View style={styles.confirmCard} testID="vip-awaiting-payment">
            <Text style={styles.confirmEmoji}>💳</Text>
            <Text style={styles.confirmTitle}>Paiement en cours…</Text>
            <Text style={styles.confirmSub}>
              Carré {awaitingPay.table_name} · {awaitingPay.price}€ — finalise le paiement Stripe dans ton navigateur.
            </Text>
            <TouchableOpacity
              style={styles.reserveBtn}
              onPress={() => { setAwaitingPay(null); load(); }}
              testID="vip-refresh-payment"
            >
              <Text style={styles.reserveText}>J'ai payé — actualiser</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => awaitingPay.checkout_url && Linking.openURL(awaitingPay.checkout_url).catch(() => {})}
            >
              <Text style={styles.cancelText}>Rouvrir la page de paiement</Text>
            </TouchableOpacity>
          </View>
        ) : confirmed || myRes ? (
          /* ── Confirmation / réservation existante ── */
          <View style={styles.confirmCard} testID="vip-confirmation">
            <Text style={styles.confirmEmoji}>🎉</Text>
            <Text style={styles.confirmTitle}>Carré {(confirmed || myRes).table_name} réservé !</Text>
            <Text style={styles.confirmSub}>
              {(confirmed || myRes).date} · {(confirmed || myRes).party_size} personnes · {(confirmed || myRes).price}€
            </Text>
            <Text style={styles.confirmHint}>Présente-toi à l'entrée avec ton nom, ton carré t'attend.</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={cancel} testID="vip-cancel">
              <Text style={styles.cancelText}>Annuler la réservation</Text>
            </TouchableOpacity>
          </View>
        ) : loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* ── Plan de salle ── */}
            <View style={styles.plan} testID="vip-floor-plan">
              <View style={styles.djBooth}>
                <Text style={styles.zoneLabel} allowFontScaling={false}>🎧 DJ</Text>
              </View>
              <View style={styles.danceFloor}>
                <Text style={styles.zoneLabel} allowFontScaling={false}>Dancefloor</Text>
              </View>
              <View style={styles.bar}>
                <Text style={styles.zoneLabel} allowFontScaling={false}>🍸 Bar</Text>
              </View>
              <View style={styles.entrance}>
                <Text style={styles.zoneLabel} allowFontScaling={false}>Entrée ↓</Text>
              </View>
              {tables.map((t) => {
                const isSel = selected?.table_id === t.table_id;
                return (
                  <TouchableOpacity
                    key={t.table_id}
                    style={[
                      styles.table,
                      {
                        left: t.x * PLAN_W - TABLE_SIZE / 2,
                        top: t.y * PLAN_H - TABLE_SIZE / 2,
                      },
                      t.booked && styles.tableBooked,
                      isSel && styles.tableSelected,
                    ]}
                    onPress={() => pickTable(t)}
                    disabled={t.booked}
                    testID={`vip-table-${t.name}`}
                  >
                    <Text style={[styles.tableName, t.booked && { color: colors.textTertiary }]} allowFontScaling={false}>
                      {t.name}
                    </Text>
                    <Text style={[styles.tableCap, t.booked && { color: colors.textTertiary }]} allowFontScaling={false}>
                      {t.booked ? 'Réservé' : `${t.capacity} pers`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Légende */}
            <View style={styles.legend}>
              <View style={[styles.legendDot, { borderColor: colors.primary }]} />
              <Text style={styles.legendText}>Libre</Text>
              <View style={[styles.legendDot, { backgroundColor: colors.border, borderColor: colors.border }]} />
              <Text style={styles.legendText}>Réservé</Text>
            </View>

            {/* ── Détail table sélectionnée ── */}
            {selected && (
              <View style={styles.detailCard} testID="vip-detail-card">
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailTitle}>Carré {selected.name}</Text>
                    <Text style={styles.detailSub}>
                      Jusqu'à {selected.capacity} personnes · bouteille incluse
                    </Text>
                  </View>
                  <Text style={styles.detailPrice}>{selected.price}€</Text>
                </View>
                <View style={styles.stepperRow}>
                  <Text style={styles.stepperLabel}>Personnes</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setPartySize((p) => Math.max(1, p - 1))}
                    testID="vip-size-minus"
                  >
                    <Ionicons name="remove" size={18} color={colors.textPrimary} />
                  </TouchableOpacity>
                  <Text style={styles.stepValue} allowFontScaling={false}>{partySize}</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => setPartySize((p) => Math.min(selected.capacity, p + 1))}
                    testID="vip-size-plus"
                  >
                    <Ionicons name="add" size={18} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>
                {!!error && <Text style={styles.error}>{error}</Text>}
                <TouchableOpacity
                  style={styles.reserveBtn}
                  onPress={reserve}
                  disabled={booking}
                  testID="vip-reserve-btn"
                >
                  {booking ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.reserveText}>Réserver le carré {selected.name} — {selected.price}€</Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.payHint}>Paiement sécurisé par Stripe 💳</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.lg, marginBottom: 12 },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '900' },
  subtitle: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  datesRow: { gap: 8, paddingHorizontal: spacing.lg, paddingBottom: 14 },
  dateChip: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  dateChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateText: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  dateTextActive: { color: '#fff' },
  plan: {
    width: PLAN_W,
    height: PLAN_H,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  djBooth: {
    position: 'absolute',
    top: 0,
    left: PLAN_W * 0.32,
    width: PLAN_W * 0.36,
    height: 40,
    backgroundColor: colors.surfaceElevated,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  danceFloor: {
    position: 'absolute',
    left: PLAN_W * 0.30,
    top: PLAN_H * 0.32,
    width: PLAN_W * 0.40,
    height: PLAN_H * 0.34,
    borderWidth: 1.5,
    borderColor: 'rgba(225,29,72,0.35)',
    borderStyle: 'dashed',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: PLAN_H * 0.38,
    width: 34,
    height: PLAN_H * 0.26,
    backgroundColor: colors.surfaceElevated,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entrance: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  zoneLabel: { color: colors.textTertiary, fontSize: 10.5, fontWeight: '700' },
  table: {
    position: 'absolute',
    width: TABLE_SIZE,
    height: TABLE_SIZE,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableBooked: { borderColor: colors.border, backgroundColor: colors.surface, opacity: 0.7 },
  tableSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  tableName: { color: colors.textPrimary, fontSize: 13, fontWeight: '900' },
  tableCap: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', marginTop: 1 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    justifyContent: 'center',
    marginTop: 10,
  },
  legendDot: { width: 12, height: 12, borderRadius: 4, borderWidth: 1.5 },
  legendText: { color: colors.textTertiary, fontSize: 12, marginRight: 8 },
  detailCard: {
    marginHorizontal: spacing.lg,
    marginTop: 16,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 16,
  },
  detailTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  detailSub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  detailPrice: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  stepperLabel: { flex: 1, color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { color: colors.textPrimary, fontSize: 17, fontWeight: '900', minWidth: 24, textAlign: 'center' },
  reserveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  reserveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  payHint: { color: colors.textTertiary, fontSize: 11.5, textAlign: 'center', marginTop: 8 },
  error: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 10 },
  confirmCard: {
    marginHorizontal: spacing.lg,
    marginTop: 20,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: 'rgba(225,29,72,0.4)',
    borderRadius: radius.xl,
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  confirmEmoji: { fontSize: 40 },
  confirmTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '900' },
  confirmSub: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  confirmHint: { color: colors.textTertiary, fontSize: 12.5, textAlign: 'center', marginTop: 6 },
  cancelBtn: { marginTop: 14, paddingVertical: 8, paddingHorizontal: 16 },
  cancelText: { color: colors.primary, fontSize: 13.5, fontWeight: '700' },
});
