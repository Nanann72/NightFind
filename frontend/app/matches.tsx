import { Redirect } from 'expo-router';

/** Legacy route — conversations now live in the Chats tab. */
export default function MatchesRedirect() {
  return <Redirect href="/(tabs)/chats" />;
}
