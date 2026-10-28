import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../auth/AuthContext';
import { GradientButton } from '../components/AuthForm';
import { useViewportSize } from '../components/MobileViewport';
import { PetArt } from '../components/PetArt';
import { PetCompanion } from '../components/PetCompanion';
import { Sparkles } from '../components/Sparkles';
import { Text } from '../components/Typography';
import { useReduceMotion } from '../components/useReduceMotion';
import { petById } from '../pets';
import { tabLabel, TabKey } from '../tabs';
import { authTheme } from '../theme';

type Slide = { icon?: string; tab?: TabKey; title: string; body: string; tip: string };

/** Welcome + feature tour, shown once after the pet is named. `name` is the pet's name. */
const slides = (name: string): Slide[] => [
  { title: 'Chào mừng đến với Mirabi!', body: `${name} sẽ đồng hành cùng bạn mỗi ngày. Cùng xem nhanh những gì bạn có thể làm nhé.`,
    tip: `Mình là ${name}, rất vui được gặp bạn!` },
  { icon: '🏠', tab: 'Home', title: 'Trang chủ & nhiệm vụ hằng ngày',
    body: 'Xem thú cưng, mục tiêu hôm nay và nhiệm vụ hằng ngày. Bạn cũng có thể chia sẻ suy nghĩ để cùng phản tư nhẹ nhàng.',
    tip: 'Chạm vào mình ở trang chủ để chơi cùng nha!' },
  { icon: '📚', tab: 'Study', title: 'Học tập: Pomodoro & khóa học',
    body: 'Bấm giờ 25 phút cho một việc nhỏ, lưu phiên học để nhận XP, và khám phá các khóa học ngắn về sáng tạo, công nghệ, kỹ năng sống.',
    tip: 'Mỗi phiên tập trung giúp mình lớn thêm đó!' },
  { icon: '🏡', tab: 'Room', title: 'Phòng cá nhân của pet',
    body: 'Trang trí căn phòng nhỏ của pet, chụp ảnh lưu vào Album kỷ niệm và ghé thăm phòng của bạn bè.',
    tip: 'Mình rất mong được ở trong một căn phòng thật xinh!' },
  { icon: '💬', tab: 'Community', title: 'Bạn bè',
    body: 'Kết bạn bằng mã hoặc mã QR và ghé thăm phòng của nhau.',
    tip: 'Lan tỏa năng lượng tốt cùng mình nhé!' },
  { icon: '✨', tab: 'More', title: 'Tiện ích: phòng, cửa hàng & cài đặt',
    body: 'Chạm vào ảnh đại diện ở trang chủ để xem hồ sơ và thú cưng. Mục Tiện ích có thêm Bảng tin, cửa hàng, thành tựu và cài đặt.',
    tip: 'Sẵn sàng chưa? Bắt đầu thôi!' },
];

export function WelcomeTour() {
  const { user, completeOnboarding } = useAuth();
  const { height } = useViewportSize();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const enter = useRef(new Animated.Value(1)).current;
  const pet = petById(user?.pet);
  const petName = user?.pet_name ?? pet.name;
  const all = slides(petName);
  const slide = all[index];
  const last = index === all.length - 1;
  const compact = height < 720;

  useEffect(() => {
    if (reduceMotion) return;
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [index, reduceMotion, enter]);

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    await completeOnboarding();
  }

  const slideIn = { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] };
  const heroSize = compact ? 150 : 190;
  return (
    <LinearGradient colors={authTheme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
      <StatusBar barStyle="dark-content" />
      <Sparkles />
      <View style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.topBar}>
          <Text style={styles.step}>{index + 1}/{all.length}</Text>
          {!last && (
            <Pressable onPress={finish} hitSlop={10} accessibilityRole="button" accessibilityLabel="Bỏ qua hướng dẫn" style={styles.skip}>
              <Text style={styles.skipText}>Bỏ qua</Text>
            </Pressable>
          )}
        </View>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.column, slideIn]}>
            <View style={[styles.hero, { height: heroSize + 20 }]}>
              {slide.icon
                ? <LinearGradient colors={authTheme.halo} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={[styles.iconHalo, { width: heroSize, height: heroSize, borderRadius: heroSize / 2 }]}>
                    <Text style={{ fontSize: heroSize * 0.4 }} accessibilityElementsHidden importantForAccessibility="no">{slide.icon}</Text>
                    {slide.tab ? <Text style={styles.tabChip}>Mục {tabLabel(slide.tab)}</Text> : null}
                  </LinearGradient>
                : <PetCompanion pet={pet.id} size={heroSize} stage={user?.level} interactive />}
            </View>
            <Text style={styles.title} accessibilityRole="header">{slide.title}</Text>
            <Text style={styles.body}>{slide.body}</Text>
            <View style={styles.tipRow}>
              <PetArt pet={pet.id} size={64} stage={user?.level} />
              <View style={styles.bubble}>
                <Text style={styles.bubbleName}>{petName}</Text>
                <Text style={styles.bubbleText}>{slide.tip}</Text>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
        <View style={styles.bottom}>
          <View style={styles.dots} accessibilityLabel={`Trang ${index + 1} trên ${all.length}`}>
            {all.map((_, i) => <View key={i} style={[styles.dot, i === index && styles.dotActive]} />)}
          </View>
          <GradientButton title={last ? 'Bắt đầu thôi ✨' : 'Tiếp tục'} onPress={last ? finish : () => setIndex(index + 1)}
            loading={finishing} loadingTitle="Đang mở Mirabi…" />
          {index > 0 && !finishing && (
            <Pressable onPress={() => setIndex(index - 1)} hitSlop={8} accessibilityRole="button" style={styles.backBtn}>
              <Text style={styles.backText}>← Quay lại</Text>
            </Pressable>
          )}
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, minHeight: 52 },
  step: { color: authTheme.muted, fontWeight: '800', fontSize: 14 },
  skip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  skipText: { color: authTheme.link, fontWeight: '800', fontSize: 15 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 8 },
  column: { width: '100%', maxWidth: 440, alignSelf: 'center', alignItems: 'center' },
  hero: { justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  iconHalo: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)',
    shadowColor: authTheme.shadow, shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  tabChip: { position: 'absolute', bottom: -6, backgroundColor: '#FFFFFF', color: authTheme.link, fontWeight: '900', fontSize: 13,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, overflow: 'hidden' },
  title: { fontSize: 24, fontWeight: '900', color: authTheme.ink, textAlign: 'center', marginTop: 10 },
  body: { fontSize: 15, lineHeight: 23, color: authTheme.muted, textAlign: 'center', marginTop: 8 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 20, alignSelf: 'stretch' },
  bubble: { flex: 1, backgroundColor: authTheme.glass, borderColor: authTheme.glassBorder, borderWidth: 1.5, borderRadius: 18,
    borderBottomLeftRadius: 4, paddingVertical: 10, paddingHorizontal: 14, marginLeft: 6, marginBottom: 14 },
  bubbleName: { fontSize: 12, fontWeight: '900', color: authTheme.link, marginBottom: 2 },
  bubbleText: { fontSize: 14, lineHeight: 20, color: authTheme.ink },
  bottom: { paddingHorizontal: 20, paddingBottom: 18, width: '100%', maxWidth: 480, alignSelf: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(19,111,168,0.25)' },
  dotActive: { width: 22, backgroundColor: authTheme.link },
  backBtn: { minHeight: 44, justifyContent: 'center', alignSelf: 'center' },
  backText: { color: authTheme.link, fontWeight: '800', fontSize: 14 },
});
