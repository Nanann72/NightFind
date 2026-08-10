/**
 * Tableau de bord propriétaire (Phase 5).
 * Stats (vues, favoris, check-ins, musiques), édition des infos du bar,
 * gestion du menu et des événements, accès à la mise en avant payante.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, Image, Modal, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeImage } from '../components/SafeImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { api, Club, MenuItem, NFEvent } from '../lib/api';
import { MUSIC_GENRES } from '../lib/musicGenres';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<string, string> = {
  mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi',
  fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche',
};

type HourRow = { open: boolean; from: string; to: string };

export default function OwnerDashboard() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [club, setClub] = useState<(Club & { menu?: MenuItem[] }) | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Edit state
  const [description, setDescription] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [styles_, setStyles_] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [hours, setHours] = useState<Record<string, HourRow>>({});
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [newItem, setNewItem] = useState({ name: '', price: '', category: '' });
  const [events, setEvents] = useState<NFEvent[]>([]);
  const [partner, setPartner] = useState<any>(null);
  const [redeemCode, setRedeemCode] = useState('');

  // Event modal
  const [evtModal, setEvtModal] = useState(false);
  const [evt, setEvt] = useState({ title: '', dj: '', date: '', price: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([api.ownerGetClub(), api.ownerStats()]);
      setClub(c);
      setStats(s);
      setDescription(c.description || '');
      setAvgPrice(String(c.avg_price ?? ''));
      setStyles_(c.music_styles || []);
      setPhotos(c.photos || []);
      setMenu(c.menu || []);
      // Normalize hours (seed shape only is editable; Google strings kept as-is)
      const h: Record<string, HourRow> = {};
      DAYS.forEach((d) => {
        const v: any = (c.hours as any)?.[d];
        if (v && typeof v === 'object') h[d] = { open: !!v.open, from: v.from || '22:00', to: v.to || '05:00' };
        else h[d] = { open: false, from: '22:00', to: '05:00' };
      });
      setHours(h);
      const full = await api.getClub(c.club_id);
      setEvents(full.events || []);
      api.ownerPartner().then(setPartner).catch(() => {});
    } catch (e: any) {
      if (e?.status === 403) {
        Alert.alert('Accès réservé', 'Cette page est réservée aux propriétaires de bars vérifiés.');
        router.back();
        return;
      }
      Alert.alert('Erreur', e?.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const toggleStyle = (id: string) =>
    setStyles_((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id].slice(0, 6));

  const addPhoto = async () => {
    if (photos.length >= 6) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        Alert.alert('Accès aux photos refusé', 'Autorise Night Finder dans les Réglages pour ajouter des photos.');
      }
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.base64) return;
    setPhotos((prev) => [...prev, `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`]);
  };

  const saveInfo = async () => {
    setSaving('info');
    try {
      await api.ownerUpdateClub({
        description: description.trim(),
        avg_price: parseFloat(avgPrice.replace(',', '.')) || 0,
        music_styles: styles_,
        photos,
        hours,
      });
      Alert.alert('✅ Enregistré', 'Les informations de ton établissement sont à jour.');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Enregistrement impossible');
    } finally {
      setSaving(null);
    }
  };

  const addMenuItem = () => {
    const name = newItem.name.trim();
    if (!name) return;
    const price = parseFloat(newItem.price.replace(',', '.')) || 0;
    setMenu((prev) => [...prev, { name, price, category: newItem.category.trim() }]);
    setNewItem({ name: '', price: '', category: '' });
  };

  const saveMenu = async () => {
    setSaving('menu');
    try {
      await api.ownerSetMenu(menu);
      Alert.alert('✅ Menu enregistré', 'Ta carte est visible sur la fiche de ton bar.');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Enregistrement impossible');
    } finally {
      setSaving(null);
    }
  };

  const createEvent = async () => {
    if (!evt.title.trim() || !evt.date.trim()) {
      Alert.alert('Champs incomplets', 'Titre et date sont obligatoires (ex : 2026-07-14 23:00).');
      return;
    }
    const parsed = new Date(evt.date.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) {
      Alert.alert('Date invalide', 'Format attendu : AAAA-MM-JJ HH:MM');
      return;
    }
    const iso = parsed.toISOString();
    setSaving('event');
    try {
      const created = await api.ownerCreateEvent({
        title: evt.title.trim(),
        dj: evt.dj.trim(),
        date: iso,
        entry_price: parseFloat(evt.price.replace(',', '.')) || 0,
      });
      setEvents((prev) => [...prev, created]);
      setEvtModal(false);
      setEvt({ title: '', dj: '', date: '', price: '' });
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Création impossible');
    } finally {
      setSaving(null);
    }
  };

  const deleteEvent = (ev: NFEvent) => {
    Alert.alert('Supprimer ?', ev.title, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          try {
            await api.ownerDeleteEvent(ev.event_id);
            setEvents((prev) => prev.filter((e) => e.event_id !== ev.event_id));
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || 'Suppression impossible');
          }
        },
      },
    ]);
  };

  const redeemGuestCoupon = async () => {
    const code = redeemCode.trim();
    if (!code) return;
    setSaving('redeem');
    try {
      const r = await api.ownerRedeemCoupon(code);
      setRedeemCode('');
      Alert.alert('✅ Coupon valide', `Applique -${r.discount_pct}% à l'addition de ton invité.`);
      api.ownerPartner().then(setPartner).catch(() => {});
    } catch (e: any) {
      Alert.alert('Coupon refusé', e?.message || 'Coupon invalide');
    } finally {
      setSaving(null);
    }
  };

  const StatCard = ({ icon, value, label }: { icon: any; value: number; label: string }) => (    <View style={styles.statCard}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="owner-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mon établissement</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || !club ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.primary} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 40 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Club header */}
            <View style={styles.clubRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.clubName} numberOfLines={1}>{club.name}</Text>
                <View style={styles.verifiedRow}>
                  <Ionicons name="checkmark-circle" size={14} color="#1D9BF0" />
                  <Text style={styles.verifiedText}>Bar Vérifié</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.promoteBtn}
                onPress={() => router.push('/promote-bar' as any)}
                testID="owner-promote-btn"
              >
                <Ionicons name="star" size={14} color="#fff" />
                <Text style={styles.promoteText}>Mettre en avant</Text>
              </TouchableOpacity>
            </View>

            {stats?.active_promotion && (
              <View style={styles.promoBanner}>
                <Ionicons name="star" size={15} color="#F59E0B" />
                <Text style={styles.promoBannerText}>
                  {`${stats.active_promotion.plan_label} active jusqu'au ${new Date(stats.active_promotion.ends_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`}
                </Text>
              </View>
            )}

            {/* Stats */}
            <Text style={styles.sectionTitle}>Statistiques</Text>
            <View style={styles.statsRow}>
              <StatCard icon="eye-outline" value={stats?.views ?? 0} label="Vues" />
              <StatCard icon="heart-outline" value={stats?.favorites ?? 0} label="Favoris" />
              <StatCard icon="location-outline" value={stats?.checkins ?? 0} label="Check-ins" />
              <StatCard icon="musical-notes-outline" value={stats?.songs ?? 0} label="Musiques" />
            </View>

            {/* Code -10% invités */}
            {partner && (
              <>
                <Text style={styles.sectionTitle}>Mon code -10% invités 🎟️</Text>
                <View style={styles.partnerCard}>
                  <Image source={{ uri: partner.qr_url }} style={styles.qrImage} />
                  <Text style={styles.partnerCode} testID="owner-partner-code">{partner.partner_code}</Text>
                  <Text style={styles.partnerHint}>
                    {"Affiche ce QR code dans ton bar : toute personne qui s'inscrit avec reçoit un coupon -10% chez toi."}
                  </Text>
                  <View style={styles.partnerStatsRow}>
                    <Text style={styles.partnerStat}>{partner.stats?.issued ?? 0} coupons émis</Text>
                    <Text style={styles.partnerStat}>{partner.stats?.used ?? 0} utilisés</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.copyBtn}
                    onPress={async () => {
                      await Clipboard.setStringAsync(partner.landing_url);
                      Alert.alert('Copié !', 'Lien de parrainage copié dans le presse-papier.');
                    }}
                    testID="owner-copy-link"
                  >
                    <Ionicons name="copy-outline" size={15} color={colors.primary} />
                    <Text style={styles.copyText}>Copier le lien de parrainage</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.subLabel}>{"Valider le coupon d'un invité"}</Text>
                <View style={styles.addItemRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="Code coupon (ex : NF-AB12CD)"
                    placeholderTextColor={colors.textTertiary}
                    value={redeemCode}
                    onChangeText={setRedeemCode}
                    autoCapitalize="characters"
                    testID="owner-redeem-input"
                  />
                  <TouchableOpacity
                    style={[styles.addBtn, saving === 'redeem' && { opacity: 0.6 }]}
                    onPress={redeemGuestCoupon}
                    disabled={!!saving}
                    testID="owner-redeem-btn"
                  >
                    {saving === 'redeem' ? <ActivityIndicator color="#fff" size="small" /> : (
                      <Ionicons name="checkmark" size={20} color="#fff" />
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Infos */}
            <Text style={styles.sectionTitle}>Informations</Text>
            <TextInput
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              placeholder="Description de l'établissement…"
              placeholderTextColor={colors.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              testID="owner-description"
            />
            <TextInput
              style={styles.input}
              placeholder="Prix moyen (€)"
              placeholderTextColor={colors.textTertiary}
              value={avgPrice}
              onChangeText={setAvgPrice}
              keyboardType="decimal-pad"
              testID="owner-avg-price"
            />
            <Text style={styles.subLabel}>Styles musicaux (6 max)</Text>
            <View style={styles.chipsWrap}>
              {MUSIC_GENRES.map((g) => (
                <TouchableOpacity
                  key={g.id}
                  style={[styles.chip, styles_.includes(g.id) && styles.chipActive]}
                  onPress={() => toggleStyle(g.id)}
                  testID={`genre-${g.id}`}
                >
                  <Text style={[styles.chipText, styles_.includes(g.id) && styles.chipTextActive]}>
                    {g.emoji} {g.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.subLabel}>Photos (6 max)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
              {photos.map((p, i) => (
                <View key={i} style={styles.photoBox}>
                  <SafeImage uri={p} width={320} style={styles.photo} />
                  <TouchableOpacity
                    style={styles.photoRemove}
                    onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Ionicons name="close" size={13} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < 6 && (
                <TouchableOpacity style={styles.photoAdd} onPress={addPhoto} testID="owner-add-photo">
                  <Ionicons name="add" size={26} color={colors.primary} />
                </TouchableOpacity>
              )}
            </ScrollView>

            <Text style={styles.subLabel}>Horaires</Text>
            {DAYS.map((d) => (
              <View key={d} style={styles.hourRow}>
                <Text style={styles.dayLabel}>{DAY_LABELS[d]}</Text>
                <Switch
                  value={hours[d]?.open}
                  onValueChange={(v) => setHours((prev) => ({ ...prev, [d]: { ...prev[d], open: v } }))}
                  trackColor={{ true: colors.primary }}
                />
                {hours[d]?.open ? (
                  <>
                    <TextInput
                      style={styles.hourInput}
                      value={hours[d].from}
                      onChangeText={(v) => setHours((prev) => ({ ...prev, [d]: { ...prev[d], from: v } }))}
                      placeholder="22:00"
                      placeholderTextColor={colors.textTertiary}
                    />
                    <Text style={{ color: colors.textTertiary }}>–</Text>
                    <TextInput
                      style={styles.hourInput}
                      value={hours[d].to}
                      onChangeText={(v) => setHours((prev) => ({ ...prev, [d]: { ...prev[d], to: v } }))}
                      placeholder="05:00"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </>
                ) : (
                  <Text style={styles.closedText}>Fermé</Text>
                )}
              </View>
            ))}

            <TouchableOpacity
              style={[styles.saveBtn, saving === 'info' && { opacity: 0.6 }]}
              onPress={saveInfo}
              disabled={!!saving}
              testID="owner-save-info"
            >
              {saving === 'info' ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.saveText}>Enregistrer les informations</Text>
              )}
            </TouchableOpacity>

            {/* Menu */}
            <Text style={styles.sectionTitle}>Carte & Menu</Text>
            {menu.map((m, i) => (
              <View key={i} style={styles.menuRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuName}>{m.name}</Text>
                  {!!m.category && <Text style={styles.menuCat}>{m.category}</Text>}
                </View>
                <Text style={styles.menuPrice}>{Number(m.price).toFixed(2)}€</Text>
                <TouchableOpacity onPress={() => setMenu((prev) => prev.filter((_, j) => j !== i))}>
                  <Ionicons name="trash-outline" size={17} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.addItemRow}>
              <TextInput
                style={[styles.input, { flex: 2, marginBottom: 0 }]}
                placeholder="Nom (ex : Mojito)"
                placeholderTextColor={colors.textTertiary}
                value={newItem.name}
                onChangeText={(v) => setNewItem((p) => ({ ...p, name: v }))}
                testID="menu-name"
              />
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Prix €"
                placeholderTextColor={colors.textTertiary}
                value={newItem.price}
                onChangeText={(v) => setNewItem((p) => ({ ...p, price: v }))}
                keyboardType="decimal-pad"
                testID="menu-price"
              />
              <TouchableOpacity style={styles.addBtn} onPress={addMenuItem} testID="menu-add">
                <Ionicons name="add" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Catégorie (optionnel — Cocktails, Bières…)"
              placeholderTextColor={colors.textTertiary}
              value={newItem.category}
              onChangeText={(v) => setNewItem((p) => ({ ...p, category: v }))}
              testID="menu-category"
            />
            <TouchableOpacity
              style={[styles.saveBtn, { marginTop: 0 }, saving === 'menu' && { opacity: 0.6 }]}
              onPress={saveMenu}
              disabled={!!saving}
              testID="owner-save-menu"
            >
              {saving === 'menu' ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.saveText}>Enregistrer le menu</Text>
              )}
            </TouchableOpacity>

            {/* Events */}
            <View style={styles.eventsHeader}>
              <Text style={styles.sectionTitle}>Événements</Text>
              <TouchableOpacity style={styles.addEvtBtn} onPress={() => setEvtModal(true)} testID="owner-add-event">
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addEvtText}>Créer</Text>
              </TouchableOpacity>
            </View>
            {events.length === 0 && <Text style={styles.emptyText}>Aucun événement à venir.</Text>}
            {events.map((e) => (
              <View key={e.event_id} style={styles.menuRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuName}>{e.title}</Text>
                  <Text style={styles.menuCat}>
                    {new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {e.dj ? ` · ${e.dj}` : ''} · {Number(e.entry_price).toFixed(0)}€
                  </Text>
                </View>
                <TouchableOpacity onPress={() => deleteEvent(e)} testID={`del-evt-${e.event_id}`}>
                  <Ionicons name="trash-outline" size={17} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Event creation modal */}
      <Modal visible={evtModal} animationType="slide" transparent onRequestClose={() => setEvtModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setEvtModal(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nouvel événement</Text>
            <TextInput
              style={styles.input} placeholder="Titre (ex : Soirée Techno)"
              placeholderTextColor={colors.textTertiary}
              value={evt.title} onChangeText={(v) => setEvt((p) => ({ ...p, title: v }))}
              testID="evt-title"
            />
            <TextInput
              style={styles.input} placeholder="Date (AAAA-MM-JJ HH:MM)"
              placeholderTextColor={colors.textTertiary}
              value={evt.date} onChangeText={(v) => setEvt((p) => ({ ...p, date: v }))}
              testID="evt-date"
            />
            <TextInput
              style={styles.input} placeholder="DJ / artiste (optionnel)"
              placeholderTextColor={colors.textTertiary}
              value={evt.dj} onChangeText={(v) => setEvt((p) => ({ ...p, dj: v }))}
              testID="evt-dj"
            />
            <TextInput
              style={styles.input} placeholder="Prix d'entrée € (0 = gratuit)"
              placeholderTextColor={colors.textTertiary}
              value={evt.price} onChangeText={(v) => setEvt((p) => ({ ...p, price: v }))}
              keyboardType="decimal-pad"
              testID="evt-price"
            />
            <TouchableOpacity
              style={[styles.saveBtn, { marginTop: spacing.sm }, saving === 'event' && { opacity: 0.6 }]}
              onPress={createEvent}
              disabled={!!saving}
              testID="evt-save"
            >
              {saving === 'event' ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.saveText}>{"Créer l'événement"}</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    },
    backBtn: {
      width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
    clubRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    clubName: { color: colors.textPrimary, fontSize: 20, fontWeight: '900' },
    verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    verifiedText: { color: '#1D9BF0', fontSize: 12.5, fontWeight: '700' },
    promoteBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: '#F59E0B', borderRadius: 999,
      paddingHorizontal: 14, paddingVertical: 9,
    },
    promoteText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
    promoBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm,
      backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: radius.md,
      padding: spacing.sm, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)',
    },
    promoBannerText: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '600', flex: 1 },
    sectionTitle: {
      color: colors.textPrimary, fontSize: 15, fontWeight: '800',
      marginTop: spacing.xl, marginBottom: spacing.sm,
    },
    statsRow: { flexDirection: 'row', gap: spacing.sm },
    statCard: {
      flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg,
      padding: spacing.sm, alignItems: 'center', gap: 3,
      borderWidth: 1, borderColor: colors.border,
    },
    statValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
    statLabel: { color: colors.textTertiary, fontSize: 10.5, fontWeight: '600' },
    partnerCard: {
      backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
      alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border,
      marginBottom: spacing.sm,
    },
    qrImage: { width: 170, height: 170, borderRadius: radius.md, backgroundColor: '#fff' },
    partnerCode: { color: colors.primary, fontSize: 22, fontWeight: '900', letterSpacing: 4 },
    partnerHint: { color: colors.textSecondary, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
    partnerStatsRow: { flexDirection: 'row', gap: spacing.lg },
    partnerStat: { color: colors.textTertiary, fontSize: 12, fontWeight: '700' },
    copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6 },
    copyText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    input: {
      backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
      borderColor: colors.border, color: colors.textPrimary, fontSize: 14.5,
      paddingHorizontal: spacing.md, paddingVertical: 12, marginBottom: spacing.sm,
    },
    subLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: 8, marginTop: 4 },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
    chip: {
      borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
    chipTextActive: { color: '#fff' },
    photoBox: { marginRight: 8 },
    photo: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.surfaceElevated },
    photoRemove: {
      position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.65)',
      borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    },
    photoAdd: {
      width: 76, height: 76, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed',
      borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    hourRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    dayLabel: { color: colors.textPrimary, fontSize: 13.5, width: 78 },
    hourInput: {
      backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1,
      borderColor: colors.border, color: colors.textPrimary, fontSize: 13,
      paddingHorizontal: 8, paddingVertical: 6, width: 62, textAlign: 'center',
    },
    closedText: { color: colors.textTertiary, fontSize: 13 },
    saveBtn: {
      backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 14,
      alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm,
    },
    saveText: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
    menuRow: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm,
      borderWidth: 1, borderColor: colors.border, marginBottom: 6,
    },
    menuName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
    menuCat: { color: colors.textTertiary, fontSize: 11.5, marginTop: 1 },
    menuPrice: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
    addItemRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
    addBtn: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },
    eventsHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    addEvtBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.primary, borderRadius: 999,
      paddingHorizontal: 12, paddingVertical: 7, marginBottom: spacing.sm,
    },
    addEvtText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
    emptyText: { color: colors.textTertiary, fontSize: 13, marginBottom: spacing.sm },
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
    modalCard: {
      backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
      padding: spacing.lg, paddingBottom: spacing.xl,
    },
    modalTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', marginBottom: spacing.md },
  });
