import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
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
  Image,
  Alert,
  Modal,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
} from 'react-native-reanimated';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { UserActionsMenu } from '../../components/UserActionsMenu';
import { radius, spacing, type ThemeColors, darkColors } from '../../lib/theme';
import { useThemeColors } from '../../lib/themeContext';

const POLL_MS = 3000;
const TYPING_POLL_MS = 2500;

type Message = {
  message_id: string;
  match_id: string;
  from_user_id: string;
  text: string;
  created_at: string;
  read_at?: string;
  edited_at?: string;
  deleted_at?: string;
};

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function Chat() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [other, setOther] = useState<{ user_id: string; name?: string; photo?: string } | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerLastRead, setPeerLastRead] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<Message | null>(null);
  const listRef = useRef<FlatList<any> | null>(null);
  const sinceRef = useRef<string | undefined>(undefined);
  const lastTypingSentRef = useRef<number>(0);

  // Dedup helper — prevents "two children with same key" crash
  const mergeMessages = useCallback((prev: Message[], incoming: Message[]) => {
    const map = new Map<string, Message>();
    for (const m of prev) map.set(m.message_id, m);
    for (const m of incoming) map.set(m.message_id, m); // incoming wins (read_at etc.)
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, []);

  const fetchInitial = useCallback(async () => {
    if (!matchId) return;
    setLoading(true);
    try {
      const list = await api.listMessages(matchId);
      setMessages(list || []);
      if (list && list.length > 0) sinceRef.current = list[list.length - 1].created_at;
      try {
        const matches = await api.listMatches();
        const m = (matches || []).find((x: any) => x.match_id === matchId);
        if (m) setOther({ user_id: m.with_user_id, name: m.name, photo: m.photo });
      } catch {}
      // Mark messages as read
      try { await api.markChatRead(matchId); } catch {}
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => { fetchInitial(); }, [fetchInitial]);

  // Polling for new messages
  useEffect(() => {
    if (!matchId) return;
    const id = setInterval(async () => {
      try {
        const since = sinceRef.current;
        const incoming = await api.listMessages(matchId, since);
        if (incoming && incoming.length > 0) {
          setMessages((m) => mergeMessages(m, incoming as Message[]));
          sinceRef.current = incoming[incoming.length - 1].created_at;
          // New incoming → mark as read
          try { await api.markChatRead(matchId); } catch {}
        }
      } catch {}
    }, POLL_MS);
    return () => clearInterval(id);
  }, [matchId, mergeMessages]);

  // Polling for peer state (typing + last_read)
  useEffect(() => {
    if (!matchId) return;
    const id = setInterval(async () => {
      try {
        const state = await api.getChatPeerState(matchId);
        setPeerTyping(!!state.is_typing);
        setPeerLastRead(state.peer_last_read_at);
      } catch {}
    }, TYPING_POLL_MS);
    return () => clearInterval(id);
  }, [matchId]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  const handleType = (t: string) => {
    setText(t);
    if (!matchId || !t.trim()) return;
    // Throttle typing pings to once every 3s
    const now = Date.now();
    if (now - lastTypingSentRef.current > 3000) {
      lastTypingSentRef.current = now;
      api.setTyping(matchId).catch(() => {});
    }
  };

  const send = async () => {
    const t = text.trim();
    if (!t || sending || !matchId) return;
    if (editingId) {
      // Save edit
      setSending(true);
      try {
        const res = await api.editMessage(editingId, t);
        setMessages((m) =>
          m.map((x) => (x.message_id === editingId ? { ...x, text: res.text, edited_at: res.edited_at } : x)),
        );
        setEditingId(null);
        setText('');
      } catch (e: any) {
        Alert.alert('Erreur', e?.message || 'Modification impossible');
      } finally {
        setSending(false);
      }
      return;
    }
    setSending(true);
    const optimisticId = `tmp_${Date.now()}`;
    const optimistic: Message = {
      message_id: optimisticId,
      match_id: matchId,
      from_user_id: user?.user_id || '',
      text: t,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => mergeMessages(m, [optimistic]));
    setText('');
    try {
      const saved = await api.sendMessage(matchId, t);
      setMessages((m) => {
        const cleaned = m.filter((x) => x.message_id !== optimisticId);
        return mergeMessages(cleaned, [saved as Message]);
      });
      sinceRef.current = saved.created_at;
    } catch {
      setMessages((m) => m.filter((x) => x.message_id !== optimisticId));
      setText(t);
    } finally {
      setSending(false);
    }
  };

  const onLongPressMessage = (msg: Message) => {
    if (msg.message_id.startsWith('tmp_') || msg.deleted_at) return;
    setActionMsg(msg);
  };

  const copyMessage = async () => {
    if (!actionMsg) return;
    try { await Clipboard.setStringAsync(actionMsg.text); } catch {}
    setActionMsg(null);
  };

  const startEdit = () => {
    if (!actionMsg) return;
    setEditingId(actionMsg.message_id);
    setText(actionMsg.text);
    setActionMsg(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setText('');
  };

  const deleteMessage = async () => {
    if (!actionMsg) return;
    const id = actionMsg.message_id;
    setActionMsg(null);
    Alert.alert('Supprimer ce message ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteMessage(id);
            setMessages((m) =>
              m.map((x) => (x.message_id === id ? { ...x, deleted_at: new Date().toISOString(), text: '' } : x)),
            );
          } catch (e: any) {
            Alert.alert('Erreur', e?.message || 'Suppression impossible');
          }
        },
      },
    ]);
  };

  const peerInitial = (other?.name || '?').trim().charAt(0).toUpperCase();
  const peerLastReadTs = peerLastRead ? new Date(peerLastRead).getTime() : 0;

  // Index of the last "mine" message that the peer has read
  const lastReadMineIdx = useMemo(() => {
    let idx = -1;
    if (!peerLastReadTs) return idx;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.from_user_id === user?.user_id && new Date(m.created_at).getTime() <= peerLastReadTs) {
        idx = i;
      }
    }
    return idx;
  }, [messages, peerLastReadTs, user?.user_id]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          activeOpacity={0.7}
          disabled={!other}
          onPress={() => other && router.push(`/user/${other.user_id}` as any)}
          testID="chat-header-profile"
        >
          {other?.photo ? (
            <Image source={{ uri: other.photo }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFb]}>
              <Text style={styles.headerAvatarInitial}>{peerInitial}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.headerName} numberOfLines={1}>{other?.name || 'Chat'}</Text>
            {peerTyping ? (
              <Text style={styles.headerStatus}>en train d&apos;écrire…</Text>
            ) : null}
          </View>
        </TouchableOpacity>
        {other ? (
          <UserActionsMenu
            targetUserId={other.user_id}
            targetName={other.name}
            context="chat"
            onBlocked={() => router.replace('/matches')}
          />
        ) : (
          <View style={{ width: 26 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.message_id}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 20 }}
          ListEmptyComponent={<Text style={styles.empty}>Lance la conversation 👋</Text>}
          renderItem={({ item, index }) => {
            const mine = item.from_user_id === user?.user_id;
            const showRead = mine && lastReadMineIdx === index;
            const isDeleted = !!item.deleted_at;
            const isEdited = !!item.edited_at;
            return (
              <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
                <TouchableOpacity
                  onLongPress={() => onLongPressMessage(item)}
                  activeOpacity={0.85}
                  delayLongPress={250}
                  style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther, isDeleted && styles.bubbleDeleted]}
                  accessibilityLabel={`Message: ${item.text || 'supprimé'}`}
                >
                  {isDeleted ? (
                    <Text style={[styles.bubbleText, styles.deletedText]}>Message supprimé</Text>
                  ) : (
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.text}</Text>
                  )}
                  <View style={styles.bubbleMetaRow}>
                    <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                      {formatTime(item.created_at)}{isEdited && !isDeleted ? ' · modifié' : ''}
                    </Text>
                    {mine && !isDeleted && (
                      <Ionicons
                        name={showRead ? 'checkmark-done' : 'checkmark'}
                        size={14}
                        color={showRead ? '#5ac8fa' : 'rgba(255,255,255,0.65)'}
                        style={{ marginLeft: 4 }}
                      />
                    )}
                  </View>
                </TouchableOpacity>
                {showRead && peerLastRead ? (
                  <Text style={styles.readReceipt} testID={`read-receipt-${item.message_id}`}>
                    Vu à {formatTime(peerLastRead)}
                  </Text>
                ) : null}
              </View>
            );
          }}
          ListFooterComponent={
            peerTyping ? <TypingBubble colors={colors} styles={styles} /> : null
          }
        />
      )}

      {/* Edit hint bar */}
      {editingId && (
        <View style={styles.editBar}>
          <Ionicons name="create-outline" size={16} color={colors.primary} />
          <Text style={styles.editBarText}>Modification du message…</Text>
          <TouchableOpacity onPress={cancelEdit}>
            <Text style={styles.editBarCancel}>Annuler</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
        <TextInput
          value={text}
          onChangeText={handleType}
          placeholder={editingId ? 'Modifie ton message…' : 'Écris un message…'}
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          multiline
          maxLength={1000}
          testID="chat-input"
          accessibilityLabel="Écrire un message"
        />
        <TouchableOpacity
          style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
          onPress={send}
          disabled={!text.trim() || sending}
          testID="chat-send"
          accessibilityLabel={editingId ? 'Enregistrer la modification' : 'Envoyer le message'}
          accessibilityRole="button"
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name={editingId ? 'checkmark' : 'send'} size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* Long-press action sheet */}
      <Modal
        visible={!!actionMsg}
        transparent
        animationType="slide"
        onRequestClose={() => setActionMsg(null)}
      >
        <View style={styles.sheetRoot}>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setActionMsg(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <TouchableOpacity style={styles.sheetRow} onPress={copyMessage}>
              <Ionicons name="copy-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.sheetText}>Copier</Text>
            </TouchableOpacity>
            {actionMsg && actionMsg.from_user_id === user?.user_id && (
              <>
                <TouchableOpacity style={styles.sheetRow} onPress={startEdit}>
                  <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
                  <Text style={styles.sheetText}>Modifier</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetRow} onPress={deleteMessage}>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                  <Text style={[styles.sheetText, { color: colors.danger }]}>Supprimer</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={[styles.sheetRow, styles.sheetCancel]}
              onPress={() => setActionMsg(null)}
            >
              <Text style={styles.sheetCancelText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceElevated },
  headerAvatarFb: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary },
  headerAvatarInitial: { color: '#fff', fontSize: 16, fontWeight: '900' },
  headerName: { color: colors.textPrimary, fontSize: 15, fontWeight: '900' },
  headerStatus: { color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textTertiary, textAlign: 'center', marginTop: 40 },
  bubbleRow: { flexDirection: 'row', marginBottom: 6, flexWrap: 'wrap' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleDeleted: { opacity: 0.6 },
  bubbleText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  deletedText: { fontStyle: 'italic', color: colors.textTertiary },
  bubbleMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, alignSelf: 'flex-end' },
  bubbleTime: { color: colors.textTertiary, fontSize: 10, fontWeight: '600' },
  bubbleTimeMine: { color: 'rgba(255,255,255,0.7)' },
  readReceipt: {
    width: '100%',
    textAlign: 'right',
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
    paddingRight: 4,
  },
  typingRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 6,
  },
  typingBubble: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'flex-end',
    minWidth: 52,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textTertiary,
  },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: spacing.lg, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  input: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.full,
    paddingHorizontal: 16, paddingVertical: 10, color: colors.textPrimary,
    maxHeight: 100, borderWidth: 1, borderColor: colors.border,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  editBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: spacing.lg, paddingVertical: 8,
    backgroundColor: 'rgba(224,26,79,0.12)',
    borderTopWidth: 1, borderTopColor: 'rgba(224,26,79,0.4)',
  },
  editBarText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13, flex: 1 },
  editBarCancel: { color: colors.primary, fontWeight: '800', fontSize: 13 },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 38 : 24,
    borderTopWidth: 1, borderTopColor: colors.borderStrong,
  },
  sheetHandle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 14 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 },
  sheetCancel: { borderBottomWidth: 0, justifyContent: 'center', marginTop: 6 },
  sheetCancelText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
});


// Module-level fallback: sub-components that aren't theme-aware
// keep rendering in dark mode until they're individually refactored to
// use `useThemeColors()`.
const colors = darkColors;
const styles = makeStyles(darkColors);

/**
 * Animated 3-dot typing indicator bubble (iMessage-style).
 */
function TypingBubble({
  colors,
  styles,
}: {
  colors: ThemeColors;
  styles: any;
}) {
  const d1 = useSharedValue(0);
  const d2 = useSharedValue(0);
  const d3 = useSharedValue(0);

  useEffect(() => {
    const loop = (sv: any, delay: number) => {
      sv.value = withRepeat(
        withDelay(delay, withSequence(withTiming(1, { duration: 400 }), withTiming(0, { duration: 400 }))),
        -1,
      );
    };
    loop(d1, 0);
    loop(d2, 150);
    loop(d3, 300);
  }, [d1, d2, d3]);

  const style1 = useAnimatedStyle(() => ({
    opacity: 0.35 + d1.value * 0.6,
    transform: [{ translateY: -d1.value * 2 }],
  }));
  const style2 = useAnimatedStyle(() => ({
    opacity: 0.35 + d2.value * 0.6,
    transform: [{ translateY: -d2.value * 2 }],
  }));
  const style3 = useAnimatedStyle(() => ({
    opacity: 0.35 + d3.value * 0.6,
    transform: [{ translateY: -d3.value * 2 }],
  }));

  return (
    <View style={styles.typingRow} testID="typing-bubble">
      <View style={styles.typingBubble}>
        <Animated.View style={[styles.typingDot, style1]} />
        <Animated.View style={[styles.typingDot, style2]} />
        <Animated.View style={[styles.typingDot, style3]} />
      </View>
    </View>
  );
}
