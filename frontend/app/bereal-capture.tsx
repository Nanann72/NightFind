import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

const WINDOW_SECONDS = 5 * 60;

export default function BerealCapture() {
  const { clubId, clubName } = useLocalSearchParams<{
    clubId: string;
    clubName?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WINDOW_SECONDS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await api.momentWindowState();
        if (cancelled) return;
        if (!state.in_window) {
          Alert.alert('Trop tard', 'Ta fenêtre de 5 min est passée.', [
            { text: 'OK', onPress: () => router.back() },
          ]);
          return;
        }
        setSecondsLeft(Math.max(1, state.seconds_left ?? WINDOW_SECONDS));
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={48} color={colors.textPrimary} />
        <Text style={styles.permTitle}>Caméra requise</Text>
        <Text style={styles.permText}>
          On a besoin de ta caméra pour capturer ton moment au club.
        </Text>
        <TouchableOpacity style={styles.ctaBtn} onPress={requestPermission}>
          <Text style={styles.ctaText}>Autoriser</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const mm = Math.floor(secondsLeft / 60);
  const ss = (secondsLeft % 60).toString().padStart(2, '0');

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.6,
      });
      if (photo?.base64) {
        setPhotoUri(`data:image/jpeg;base64,${photo.base64}`);
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Capture impossible');
    }
  };

  const publish = async () => {
    if (!photoUri || !clubId) return;
    setUploading(true);
    try {
      await api.uploadMoment(clubId, photoUri, caption);
      Alert.alert('Publié 🔥', 'Ton moment est en ligne sur la map.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/map') },
      ]);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message || 'Publication impossible');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.timerWrap}>
          <Ionicons name="timer-outline" size={14} color="#F472B6" />
          <Text style={styles.timerText}>
            {mm}:{ss}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.clubName}>📍 {clubName || 'Ton club'}</Text>

      {photoUri ? (
        <View style={styles.previewWrap}>
          <Image source={{ uri: photoUri }} style={styles.preview} />
          <TextInput
            style={styles.caption}
            placeholder="Une légende ? (optionnel)"
            placeholderTextColor="#71717A"
            value={caption}
            onChangeText={setCaption}
            maxLength={280}
            multiline
          />
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPhotoUri(null)}>
              <Text style={styles.secondaryText}>Reprendre</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ctaBtn} onPress={publish} disabled={uploading}>
              {uploading ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.ctaText}>Publier 🔥</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.cameraWrap}>
          <CameraView ref={cameraRef} style={styles.camera} facing={facing} />
          <View style={styles.captureRow}>
            <TouchableOpacity
              style={styles.flipBtn}
              onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            >
              <Ionicons name="sync" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.shutter} onPress={takePhoto}>
              <View style={styles.shutterInner} />
            </TouchableOpacity>
            <View style={{ width: 44 }} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: {
    flex: 1,
    backgroundColor: '#09090B',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: 12,
  },
  permTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  permText: { color: '#A1A1AA', textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  timerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(244,114,182,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  timerText: { color: '#F472B6', fontWeight: '900', fontSize: 14 },
  clubName: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  cameraWrap: { flex: 1 },
  camera: { flex: 1 },
  captureRow: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: spacing.lg,
  },
  flipBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  previewWrap: { flex: 1, padding: spacing.lg, gap: 12 },
  preview: { flex: 1, borderRadius: radius.lg, backgroundColor: '#000' },
  caption: {
    backgroundColor: '#18181B',
    color: '#fff',
    padding: 12,
    borderRadius: radius.md,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  actionRow: { flexDirection: 'row', gap: 12 },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: '#27272A',
    alignItems: 'center',
  },
  secondaryText: { color: '#fff', fontWeight: '800' },
  ctaBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.full,
    backgroundColor: '#F472B6',
    alignItems: 'center',
  },
  ctaText: { color: colors.bg, fontWeight: '900' },
});
