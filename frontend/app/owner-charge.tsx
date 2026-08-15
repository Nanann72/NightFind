/**
 * Encaisser un verre -10% — flux patron (Stripe Connect).
 *  1. Compte de paiement Stripe (onboarding Express si absent)
 *  2. Scan du QR du coupon client (ou saisie manuelle du code)
 *  3. Saisie du prix normal du verre → -10% calculé
 *  4. QR de paiement affiché au client → paie par CB/Apple Pay → confirmation live
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as WebBrowser from 'expo-web-browser';
import QRCode from 'react-native-qrcode-svg';
import * as Haptics from 'expo-haptics';
import { api } from '../lib/api';
import { radius, spacing, type ThemeColors } from '../lib/theme';
import { useThemeColors } from '../lib/themeContext';

type Step = 'loading' | 'onboarding' | 'scan' | 'amount' | 'pay' | 'paid';

export default function OwnerCharge() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('loading');
  const [payStatus, setPayStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [order, setOrder] = useState<any>(null);
  const scannedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.ownerPaymentsStatus();
      setPayStatus(s);
      setStep(s.charges_enabled ? 'scan' : 'onboarding');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Impossible de vérifier ton compte de paiement.');
      setStep('onboarding');
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshStatus]);

  const startOnboarding = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.ownerPaymentsOnboarding();
      await WebBrowser.openBrowserAsync(r.url);
      await refreshStatus();
    } catch (e: any) {
      Alert.alert('Paiements non disponibles', e?.message || 'Réessaie plus tard.');
    } finally {
      setBusy(false);
    }
  };

  const openScanner = async () => {
    if (!camPerm?.granted) {
      if (camPerm?.canAskAgain === false) {
        Alert.alert(
          'Caméra désactivée',
          'Autorise la caméra dans les réglages pour scanner les coupons.',
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Ouvrir Réglages', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      const r = await requestCamPerm();
      if (!r.granted) return;
    }
    scannedRef.current = false;
    setShowCamera(true);
  };

  const onScanned = (data: string) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    setShowCamera(false);
    const clean = (data || '').trim().toUpperCase();
    setCode(clean);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setStep('amount');
  };

  const submitCode = () => {
    if (code.trim().length < 4) {
      Alert.alert('Code invalide', 'Saisis le code du coupon du client.');
      return;
    }
    setStep('amount');
  };

  const amountCents = Math.round(parseFloat(amount.replace(',', '.')) * 100) || 0;
  const discounted = Math.round(amountCents * 0.9);

  const createCharge = async () => {
    if (busy) return;
    if (amountCents < 100 || amountCents > 50000) {
      Alert.alert('Montant invalide', 'Entre 1€ et 500€.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.ownerChargeDrink(code.trim().toUpperCase(), amountCents);
      setOrder(r);
      setStep('pay');
      // Poll payment status every 2.5s
      pollRef.current = setInterval(async () => {
        try {
          const o = await api.ownerDrinkOrder(r.order_id);
          if (o.status === 'paid') {
            if (pollRef.current) clearInterval(pollRef.current);
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            }
            setStep('paid');
          } else if (o.status === 'expired') {
            if (pollRef.current) clearInterval(pollRef.current);
            Alert.alert('Expiré', 'Le lien de paiement a expiré. Recommence.');
            reset();
          }
        } catch {
          /* réseau : on retentera au tick suivant */
        }
      }, 2500);
    } catch (e: any) {
      Alert.alert('Impossible de créer le paiement', e?.message || 'Réessaie.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setCode('');
    setAmount('');
    setOrder(null);
    scannedRef.current = false;
    setStep('scan');
  };

  const eur = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="owner-charge-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="charge-back">
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Encaisser un verre 🍸</Text>
        <View style={styles.iconBtn} />
      </View>

      {showCamera && camPerm?.granted ? (
        <View style={styles.cameraWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(e) => onScanned(e.data)}
          />
          <View style={styles.scanFrame} pointerEvents="none" />
          <Text style={styles.scanHint}>Scanne le QR du coupon du client</Text>
          <TouchableOpacity style={styles.closeCam} onPress={() => setShowCamera(false)} testID="close-camera">
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {step === 'loading' && <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />}

          {step === 'onboarding' && (
            <View style={styles.card}>
              <View style={styles.bigIcon}>
                <Ionicons name="card-outline" size={30} color={colors.primary} />
              </View>
              <Text style={styles.cardTitle}>Compte de paiement requis</Text>
              <Text style={styles.cardText}>
                Pour recevoir l&apos;argent des verres payés dans l&apos;app, crée ton compte de
                paiement sécurisé Stripe (identité + IBAN, ~5 min). Les fonds sont versés
                directement sur ton compte bancaire.
              </Text>
              {payStatus?.configured === false ? (
                <Text style={styles.warnText}>
                  ⚠️ La clé Stripe de la plateforme n&apos;est pas encore configurée. Contacte
                  l&apos;administrateur Night Finder.
                </Text>
              ) : null}
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={startOnboarding}
                disabled={busy || payStatus?.configured === false}
                testID="start-onboarding-btn"
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="shield-checkmark" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>
                      {payStatus?.onboarded ? 'Compléter mon dossier' : 'Créer mon compte de paiement'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={refreshStatus} style={styles.linkBtn} testID="refresh-status-btn">
                <Text style={styles.linkText}>J&apos;ai terminé — vérifier mon statut</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'scan' && (
            <View style={styles.card}>
              <View style={styles.bigIcon}>
                <Ionicons name="qr-code-outline" size={30} color={colors.primary} />
              </View>
              <Text style={styles.cardTitle}>Coupon du client</Text>
              <Text style={styles.cardText}>
                Le client ouvre son coupon -10% dans l&apos;app (Mes avantages) — scanne son QR
                ou saisis son code.
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={openScanner} testID="open-scanner-btn">
                <Ionicons name="scan" size={17} color="#fff" />
                <Text style={styles.primaryBtnText}>Scanner le QR du coupon</Text>
              </TouchableOpacity>
              <Text style={styles.orText}>ou</Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                placeholder="Code du coupon (ex: NF-A1B2C3)"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="characters"
                style={styles.input}
                testID="coupon-code-input"
              />
              <TouchableOpacity style={styles.secondaryBtn} onPress={submitCode} testID="submit-code-btn">
                <Text style={styles.secondaryBtnText}>Valider le code</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'amount' && (
            <View style={styles.card}>
              <View style={styles.codePill}>
                <Ionicons name="ticket" size={14} color={colors.primary} />
                <Text style={styles.codePillText}>{code}</Text>
              </View>
              <Text style={styles.cardTitle}>Prix normal du verre</Text>
              <View style={styles.amountRow}>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="0,00"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                  style={styles.amountInput}
                  autoFocus
                  testID="amount-input"
                />
                <Text style={styles.euro}>€</Text>
              </View>
              {amountCents >= 100 && (
                <View style={styles.calcBox} testID="discount-preview">
                  <Text style={styles.calcLine}>Prix normal : {eur(amountCents)}</Text>
                  <Text style={styles.calcDiscount}>-10% → le client paie {eur(discounted)}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.primaryBtn, amountCents < 100 && { opacity: 0.5 }]}
                onPress={createCharge}
                disabled={busy || amountCents < 100}
                testID="create-charge-btn"
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="cash-outline" size={17} color="#fff" />
                    <Text style={styles.primaryBtnText}>Générer le paiement</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={reset} style={styles.linkBtn}>
                <Text style={styles.linkText}>Changer de coupon</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'pay' && order && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Fais scanner ce QR au client 📲</Text>
              <Text style={styles.cardText}>
                Le client scanne avec son appareil photo et paie {eur(order.amount_discounted)} par
                carte ou Apple Pay.
              </Text>
              <View style={styles.qrBox} testID="payment-qr">
                <QRCode value={order.checkout_url} size={210} backgroundColor="#FFFFFF" color="#000000" />
              </View>
              <View style={styles.waitRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={styles.waitText}>En attente du paiement…</Text>
              </View>
              <TouchableOpacity onPress={reset} style={styles.linkBtn} testID="cancel-charge-btn">
                <Text style={styles.linkText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'paid' && order && (
            <View style={styles.card} testID="payment-success">
              <Text style={styles.successEmoji}>🎉</Text>
              <Text style={styles.cardTitle}>Paiement reçu !</Text>
              <Text style={styles.cardText}>
                {eur(order.amount_discounted)} encaissés (commission plateforme :{' '}
                {eur(order.platform_fee)}). Le coupon du client est consommé — 1 verre, une
                seule fois. Santé ! 🍸
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={reset} testID="new-charge-btn">
                <Ionicons name="add" size={17} color="#fff" />
                <Text style={styles.primaryBtnText}>Nouvel encaissement</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  scroll: { padding: spacing.lg, paddingBottom: 80 },
  card: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 22,
    alignItems: 'center',
  },
  bigIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${colors.primary}1A`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  cardTitle: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  cardText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 18,
  },
  warnText: { color: '#F59E0B', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: 26,
    minHeight: 48,
    alignSelf: 'stretch',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  secondaryBtnText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  linkBtn: { marginTop: 14, minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.textSecondary, fontSize: 13, textDecorationLine: 'underline' },
  orText: { color: colors.textTertiary, fontSize: 13, marginVertical: 12 },
  input: {
    alignSelf: 'stretch',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.5,
    textAlign: 'center',
    marginBottom: 12,
  },
  codePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: `${colors.primary}1A`,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 14,
  },
  codePillText: { color: colors.primary, fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  amountInput: {
    color: colors.textPrimary,
    fontSize: 44,
    fontWeight: '800',
    minWidth: 130,
    textAlign: 'center',
  },
  euro: { color: colors.textSecondary, fontSize: 30, fontWeight: '700' },
  calcBox: {
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: 14,
    marginTop: 14,
    marginBottom: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  calcLine: { color: colors.textSecondary, fontSize: 13 },
  calcDiscount: { color: colors.primary, fontSize: 17, fontWeight: '800', marginTop: 4 },
  qrBox: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: radius.lg,
    marginVertical: 8,
  },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  waitText: { color: colors.textSecondary, fontSize: 13 },
  successEmoji: { fontSize: 54, marginBottom: 6 },
  cameraWrap: { flex: 1 },
  scanFrame: {
    position: 'absolute',
    top: '28%',
    left: '15%',
    right: '15%',
    aspectRatio: 1,
    borderWidth: 3,
    borderColor: '#fff',
    borderRadius: 24,
  },
  scanHint: {
    position: 'absolute',
    bottom: 110,
    alignSelf: 'center',
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  closeCam: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
