/**
 * Image with automatic fallback when the remote URI fails to load.
 * Keeps the venue cards looking good even when an upstream photo URL is
 * temporarily broken (Unsplash 404, network error, etc.).
 */
import { useState } from 'react';
import { Image, ImageProps, ImageSourcePropType } from 'react-native';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const DEFAULT_FALLBACK: ImageSourcePropType = {
  uri:
    'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=1200&q=80',
};

type Props = Omit<ImageProps, 'source'> & {
  uri?: string | null;
  fallback?: ImageSourcePropType;
};

function resolveUri(uri?: string | null): string | null {
  if (!uri) return null;
  // Absolute URL → as is. Backend proxy path → prefix with BASE_URL.
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  if (uri.startsWith('/api/') && BASE_URL) return `${BASE_URL}${uri}`;
  return uri;
}

export function SafeImage({ uri, fallback = DEFAULT_FALLBACK, ...rest }: Props) {
  const [failed, setFailed] = useState(false);
  const resolved = resolveUri(uri);
  const source: ImageSourcePropType =
    !resolved || failed ? fallback : { uri: resolved };
  return <Image {...rest} source={source} onError={() => setFailed(true)} />;
}
