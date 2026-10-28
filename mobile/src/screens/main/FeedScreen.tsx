import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { User } from '../../auth/AuthContext';
import { Text } from '../../components/Typography';
import { appTheme as t } from '../../theme';
import { Avatar, Button, Card, SoftInput } from '../../ui/kit';
import { BackHeader } from '../together/ui';
import { Post, request, showError } from './shared';

type Props = {
  user: User; posts: Post[]; onPosts: (p: Post[]) => void; /** After the user shares a post (counts toward a daily quest). */ onPosted?: () => void;
  onBack: () => void;
};

/** "Bảng tin", the post feed, opened from Tiện ích. */
export function FeedScreen({ user, posts, onPosts, onPosted, onBack }: Props) {
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  async function publish() {
    if (!draft.trim()) return;
    setPosting(true);
    try { await request('/api/community/posts', { method: 'POST', body: { body: draft } }); setDraft(''); onPosts(await request('/api/community/posts')); onPosted?.(); }
    catch (e) { showError('Lỗi', e); }
    finally { setPosting(false); }
  }
  async function like(id: number) {
    try { await request(`/api/community/posts/${id}/like`, { method: 'POST' }); onPosts(await request('/api/community/posts')); }
    catch (e) { showError('Lỗi', e); }
  }

  return (
    <>
      <BackHeader title="Bảng tin" subtitle="Lan tỏa điều tích cực" onBack={onBack} />
      <Card>
        <View style={styles.composer}>
          <Avatar name={user.display_name} theme={user.avatar_theme} size={40} />
          <SoftInput style={styles.input} multiline value={draft} onChangeText={setDraft} placeholder="Hôm nay bạn đã làm được điều gì?"
            accessibilityLabel="Nội dung bài viết" />
        </View>
        <Button title="Đăng bài" icon="send" onPress={publish} loading={posting} disabled={!draft.trim()} />
      </Card>

      {posts.map((p) => (
        <Card key={p.id}>
          <View style={styles.author}>
            <Avatar name={p.author} size={40} />
            <View>
              <Text style={styles.authorName}>{p.author}</Text>
              <Text style={styles.authorMeta}>Thành viên Mirabi</Text>
            </View>
          </View>
          <Text style={styles.body}>{p.body}</Text>
          <Pressable onPress={() => like(p.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Thích, ${p.likes} lượt thích`} style={styles.like}>
            <Ionicons name="heart" size={20} color="#E64980" />
            <Text style={styles.likeText}>{p.likes} · Thích</Text>
          </Pressable>
        </Card>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  input: { flex: 1 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  authorName: { fontSize: 15, fontWeight: '800', color: t.ink },
  authorMeta: { fontSize: 12, color: t.muted },
  body: { fontSize: 16, lineHeight: 24, color: t.ink, marginVertical: 12 },
  like: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36 },
  likeText: { fontSize: 14, fontWeight: '800', color: t.muted },
});
