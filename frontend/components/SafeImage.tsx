/**
 * Premium image with disk/memory caching (expo-image), blur-up placeholder,
 * fade transition and an elegant neutral fallback when the source fails —
 * no more misleading generic stock photo repeated across cards.
 */
import { useState } from 'react';
import { View, ViewStyle, StyleProp } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Subtle dark blurhash used while the real photo streams in.
const BLURHASH = 'L03[xW9F00~q00%M-;IU00xu~qD%';

type Props = {
  uri?: string | null;
  style?: StyleProp<ViewStyle>;
  resizeMode?: 'cover' | 'contain';
  /** Largeur max demandée au backend pour les photos Google Places (perf réseau). */
  width?: number;
  testID?: string;
};

function resolveUri(uri?: string | null, width?: number): string | null {
  if (!uri) return null;
  if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:')) return uri;
  if (uri.startsWith('/api/')) {
    let path = uri;
    // Vignettes : demande une image plus légère au proxy photo (cache par taille).
    if (width && path.startsWith('/api/places/photo')) {
      path = path.includes('max_width=')
        ? path.replace(/max_width=\d+/, `max_width=${width}`)
        : `${path}&max_width=${width}`;
    }
    return BASE_URL ? `${BASE_URL}${path}` : path;
  }
  return uri;
}

export function SafeImage({ uri, style, resizeMode = 'cover', width, testID }: Props) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveUri(uri, width);
  if (!resolved || failed) {
    return (
      <View
        style={[style, { backgroundColor: '#1C1C21', alignItems: 'center', justifyContent: 'center' }]}
        testID={testID}
      >
        <Ionicons name="musical-notes" size={28} color="#3F3F46" />
      </View>
    );
  }
  return (
    <ExpoImage
      source={{ uri: resolved }}
      style={style as any}
      contentFit={resizeMode}
      transition={220}
      placeholder={{ blurhash: BLURHASH }}
      cachePolicy="memory-disk"
      onError={() => setFailed(true)}
      testID={testID}
    />
  );
}
