// Temporarily disabled — the expo-camera native plugin was causing a black
// screen on TestFlight builds. Will be re-enabled in a future build once the
// native rebuild path is stable.
import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function BeRealCaptureDisabled() {
  const router = useRouter();
  useEffect(() => {
    // Auto-redirect away — the feature is offline for now.
    router.replace('/');
  }, [router]);
  return (
    <View style={styles.root}>
      <Text style={styles.text}>Fonctionnalité bientôt disponible</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: '#fff', fontSize: 16 },
});
