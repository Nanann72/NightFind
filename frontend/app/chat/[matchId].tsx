import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { UserActionsMenu } from '../../components/UserActionsMenu';
import { colors, radius, spacing } from '../../lib/theme';

const POLL_MS = 3000;

export default function Chat() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [otherUser, setOtherUser] = useState<{ user_id: string; name?: string } | null>(null);
  const listRef = useRef<FlatList<any> | null>(null);
  const sinceRef = useRef<string | undefined>(undefined);

  const fetchInitial = useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
    try {
      const list = await api.listMessages(matchId);
      setMessages(list || []);
      if (list && list.length > 0) {
        sinceRef.current = list[list.length - 1].created_at;
      }
      // Also resolve the "other" user for the report/block menu
      try {
        const matches = await api.listMatches();
        const m = (matches || []).find((x: any) => x.match_id === matchId);
        if (m && m.other) setOtherUser({ user_id: m.other.user_id, name: m.other.name });
      } catch {}
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  // Polling for new messages (every 3s)
  useEffect(() => {
    if (!matchId) return;
    const id = setInterval(async () => {
      try {
        const since = sinceRef.current;
        const incoming = await api.listMessages(matchId, since);
        if (incoming && incoming.length > 0) {
          setMessages((m) => [...m, ...incoming]);
          sinceRef.current = incoming[incoming.length - 1].created_at;
        }
      } catch {
        // ignore polling errors
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [matchId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending || !matchId) return;
    setSending(true);
    const optimisticId = `tmp_${Date.now()}`;
    const optimistic = {
      message_id: optimisticId,
      match_id: matchId,
      from_user_id: user?.user_id,
      text: t,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setText('');
    try {
      const saved = await api.sendMessage(matchId, t);
      setMessages((m) =>
        m.map((x) => (x.message_id === optimisticId ? saved : x)),
      );
      sinceRef.current = saved.created_at;
    } catch {
      setMessages((m) => m.filter((x) => x.message_id !== optimisticId));
      setText(t);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{otherUser?.name || 'Chat'}</Text>
        {otherUser ? (
          <UserActionsMenu
            targetUserId={otherUser.user_id}
            targetName={otherUser.name}
            context="chat"
            onBlocked={() => router.replace('/matches')}
          />
        ) : (
          <View style={{ width: 26 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.message_id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 20 }}
          ListEmptyComponent={
            <Text style={styles.empty}>Lance la conversation 👋</Text>
          }
          renderItem={({ item }) => {
            const mine = item.from_user_id === user?.user_id;
            return (
              <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                  <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.text}</Text>
                </View>
              </View>
            );
          }}
        />
      )}

      <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Écris un message…"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          multiline
          maxLength={1000}
          testID="chat-input"
        />
        <TouchableOpacity
          style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
          onPress={send}
          disabled={!text.trim() || sending}
          testID="chat-send"
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="send" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textTertiary, textAlign: 'center', marginTop: 40 },
  bubbleRow: { flexDirection: 'row', marginBottom: 8 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: colors.bg },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.textPrimary,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
