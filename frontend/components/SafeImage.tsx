/**
 * Image with automatic fallback when the remote URI fails to load.
 * Keeps the venue cards looking good even when an upstream photo URL is
 * temporarily broken (Unsplash 404, network error, etc.).
 */
import { useState } from 'react';
import { Image, ImageProps, ImageSourcePropType } from 'react-native';

const DEFAULT_FALLBACK: ImageSourcePropType = {
  uri:
    'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=1200&q=80',
};

type Props = Omit<ImageProps, 'source'> & {
  uri?: string | null;
  fallback?: ImageSourcePropType;
};

export function SafeImage({ uri, fallback = DEFAULT_FALLBACK, ...rest }: Props) {
  const [failed, setFailed] = useState(false);
  const source: ImageSourcePropType =
    !uri || failed ? fallback : { uri };
  return <Image {...rest} source={source} onError={() => setFailed(true)} />;
}
