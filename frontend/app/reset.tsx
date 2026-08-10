/**
 * Alias public /reset — cible des liens email de réinitialisation
 * (https://nightfinder.app/reset?token=...). Redirige vers l'écran
 * /reset-password en conservant le token.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function Reset() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return (
    <Redirect
      href={{ pathname: '/reset-password', params: token ? { token } : {} } as any}
    />
  );
}
