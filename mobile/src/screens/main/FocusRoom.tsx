import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/Typography';
import { PetArt } from '../../components/PetArt';
import { hasSprite } from '../../petSprites';
import { useReduceMotion } from '../../components/useReduceMotion';

type Props = { petId: string; petName: string | null; petLevel: number; resting: boolean; compact: boolean };

/** Resolution-independent room; original PetArt remains intact, including evolution stages. The pet always sits at the
 * desk here, even while it is out on a walk: walking and studying are separate. */
export const FocusRoom = memo(function FocusRoom({ petId, petName, petLevel, resting, compact }: Props) {
  const reduce = useReduceMotion();
  const writing = useRef(new Animated.Value(0)).current;
  const greeting = useRef(new Animated.Value(0)).current;
  // A drawn study strip brings its own book, so the room's book and pencil step aside while it plays.
  const drawnStudy = !resting && hasSprite(petId, petLevel, 'study');
  useEffect(() => { if (reduce) { greeting.stopAnimation(); greeting.setValue(0); } return () => greeting.stopAnimation(); }, [reduce, greeting]);
  useEffect(() => {
    writing.setValue(0);
    if (reduce || resting || drawnStudy) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(writing, { toValue: 1, duration: 950, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(writing, { toValue: 0, duration: 950, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.delay(1200),
    ]));
    loop.start(); return () => loop.stop();
  }, [reduce, resting, drawnStudy, writing]);
  const size = compact ? 96 : 145;
  return <View testID="focus-room" style={s.room}>
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible accessibilityRole="image" accessibilityLabel="Căn phòng học ấm áp với cửa sổ vòm, bàn gỗ, đèn đọc sách và cây xanh">
      <Svg width="100%" height="100%" viewBox="0 0 800 520" preserveAspectRatio="xMidYMid meet">
        <Defs>
          <LinearGradient id="room-wall" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#F8F0E5" /><Stop offset="1" stopColor="#E8E5F1" /></LinearGradient>
          <LinearGradient id="room-sky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#A7B3D8" /><Stop offset="1" stopColor="#E1CFE1" /></LinearGradient>
          <LinearGradient id="room-floor" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#E7D9CB" /><Stop offset="1" stopColor="#F0E6DD" /></LinearGradient>
          <RadialGradient id="room-lamp"><Stop offset="0" stopColor="#FFEAC0" stopOpacity=".75" /><Stop offset="1" stopColor="#FFEAC0" stopOpacity="0" /></RadialGradient>
          <ClipPath id="room-window"><Path d="M248 283V135a92 92 0 0 1 184 0v148Z" /></ClipPath>
        </Defs>
        <Rect width="800" height="520" rx="26" fill="url(#room-wall)" />
        <Path d="M0 392H800V520H0Z" fill="url(#room-floor)" />
        <Path d="M0 392H800M0 398H800" stroke="#D7C8BA" strokeWidth="2" />
        <G stroke="#DCCEC1" strokeWidth="1.5" opacity=".55"><Path d="M0 440H800M0 487H800M125 398L55 520M323 398L299 520M519 398L548 520M714 398L792 520" /></G>
        <Ellipse cx="421" cy="455" rx="242" ry="43" fill="#C9BCBD" opacity=".2" />
        <Ellipse cx="421" cy="449" rx="218" ry="40" fill="#D4DDDC" />
        <Ellipse cx="421" cy="449" rx="192" ry="29" fill="none" stroke="#EAF0E9" strokeWidth="2" />
        {/* Arched window and a quiet fantasy landscape. */}
        <Path d="M232 292V135a108 108 0 0 1 216 0v157Z" fill="#D1BDAE" />
        <Path d="M240 288V135a100 100 0 0 1 200 0v153Z" fill="#FFF7EB" />
        <G clipPath="url(#room-window)">
          <Rect x="245" y="38" width="192" height="250" fill="url(#room-sky)" />
          <Circle cx="383" cy="100" r="24" fill="#FFF4D7" /><Circle cx="394" cy="91" r="22" fill="#AFB6D6" />
          <G fill="#FFF9ED"><Circle cx="284" cy="104" r="2" /><Circle cx="321" cy="76" r="1.5" /><Circle cx="411" cy="145" r="2" /><Path d="M301 136v10m-5-5h10M356 165v8m-4-4h8" stroke="#FFF9ED" strokeWidth="1.5" /></G>
          <Path d="M244 232q48-68 95-12t105-20v94H244Z" fill="#9EAFC1" /><Path d="M240 262q54-47 106-18t96-5v65H240Z" fill="#90A9B2" />
          <Path d="M268 263l13-47 13 47m-7-28 13-45 13 45m83 45 15-51 15 51" fill="#789AA2" />
        </G>
        <Path d="M340 54V286M248 184H432" stroke="#FFF5E7" strokeWidth="9" />
        <Rect x="222" y="286" width="236" height="14" rx="6" fill="#C5AA94" /><Rect x="223" y="285" width="235" height="5" rx="2" fill="#ECD6BE" />
        <Path d="M197 57q-26 117 8 224l35 8q-31-153 1-231Z" fill="#DFD3CF" opacity=".8" />
        <Path d="M461 60q31 112 3 217l-23 11q26-163-7-231Z" fill="#DFD3CF" opacity=".65" />
        {/* A shelf, little books and trailing leaves. */}
        <Rect x="540" y="123" width="164" height="10" rx="4" fill="#B9947B" /><Path d="M554 133v17m136-17v17" stroke="#B9947B" strokeWidth="6" />
        <Rect x="555" y="73" width="17" height="50" rx="3" fill="#B6BBCB" /><Rect x="575" y="80" width="15" height="43" rx="3" fill="#D6A89B" />
        <Rect x="593" y="68" width="18" height="55" rx="3" fill="#9EB9AF" /><Path d="M558 83h11m-11 5h11m28-8h10" stroke="#FFF2DF" strokeWidth="2" />
        <Path d="M651 123l-5-27h34l-5 27Z" fill="#D9B89F" /><Path d="M663 98q-28-30-38-9 18 20 38 9Zm0 0q-1-44 23-39 5 28-23 39Zm4 1q37 8 18 35-19 21-4 37" stroke="#8DA58A" strokeWidth="4" fill="none" />
        <G fill="#92AB91"><Ellipse cx="684" cy="132" rx="12" ry="5" transform="rotate(-35 684 132)" /><Ellipse cx="677" cy="151" rx="11" ry="5" transform="rotate(25 677 151)" /><Ellipse cx="680" cy="170" rx="10" ry="5" transform="rotate(-30 680 170)" /></G>
        {/* Warm hanging fairy lights. */}
        <Path d="M65 39Q345 114 742 36" fill="none" stroke="#BAAE9C" strokeWidth="2" />
        {[110, 188, 269, 350, 431, 512, 593, 674].map((x, i) => <G key={x}><Circle cx={x} cy={60 + Math.sin(i / 7 * Math.PI) * 17} r="14" fill="#FFF4D1" opacity=".5" /><Circle cx={x} cy={60 + Math.sin(i / 7 * Math.PI) * 17} r="4" fill="#FFF6DC" /></G>)}
        {/* Floor plant. */}
        <Path d="M115 426l-16-63h68l-14 63q-18 8-38 0Z" fill="#CBA58E" /><Ellipse cx="133" cy="363" rx="34" ry="8" fill="#B18E78" />
        <Path d="M134 366q-4-69-35-100m34 77q30-66 51-85m-50 91q-37-39-57-35m58 13q-1-83 12-105" fill="none" stroke="#82977C" strokeWidth="5" />
        <G fill="#97AF8E"><Ellipse cx="102" cy="274" rx="14" ry="32" transform="rotate(-37 102 274)" /><Ellipse cx="172" cy="277" rx="13" ry="34" transform="rotate(38 172 277)" /><Ellipse cx="147" cy="241" rx="13" ry="33" transform="rotate(10 147 241)" /><Ellipse cx="90" cy="320" rx="14" ry="29" transform="rotate(-63 90 320)" /></G>
        {/* Desk, chair, reading lamp and mug. */}
        <Rect x="361" y="283" width="120" height="119" rx="42" fill="#B8ADB6" /><Rect x="371" y="291" width="100" height="103" rx="36" fill="#C8BDC4" />
        <Path d="M249 367l-18 86h15l23-86m294 0 18 86h-15l-23-86" fill="#B38E75" />
        <Rect x="210" y="349" width="397" height="20" rx="9" fill="#B48C6D" /><Rect x="209" y="341" width="400" height="13" rx="6" fill="#D8B999" />
        <Ellipse cx="546" cy="314" rx="95" ry="57" fill="url(#room-lamp)" />
        <Path d="M555 339V252l-37-31" fill="none" stroke="#889D9B" strokeWidth="7" strokeLinecap="round" /><Ellipse cx="554" cy="339" rx="29" ry="5" fill="#889D9B" />
        <Path d="M488 237q1-31 32-28l26 33Z" fill="#91A9A2" /><Path d="M488 237l58 5" stroke="#D7E2CD" strokeWidth="5" strokeLinecap="round" />
        <Rect x="266" y="321" width="37" height="20" rx="3" fill="#C5B8D3" /><Path d="M272 326h28m-28 5h28" stroke="#EAE1EB" strokeWidth="2" />
        <Path d="M310 314h23v21q-10 9-23 0Z" fill="#F5E7DA" /><Path d="M333 320q19-1 14 11-4 6-14 2" fill="none" stroke="#E5CEB8" strokeWidth="4" />
        <Path d="M318 305q-5-6 0-11m8 12q-5-6 0-11" stroke="#EDE4DC" strokeWidth="2" fill="none" />
        <Rect x="627" y="305" width="63" height="78" rx="6" fill="#DDD0BD" /><Rect x="636" y="312" width="45" height="63" rx="3" fill="#EDE5D8" />
        <Path d="M648 359l8-28 9 28m-14-10h11" stroke="#9BB0AC" strokeWidth="3" fill="none" />
        <G fill="#FFF9E9" opacity=".9"><Path d="M502 176v14m-7-7h14M201 325v10m-5-5h10M606 264v12m-6-6h12" /></G>
      </Svg>
    </View>
    <Pressable style={[s.pet, { width: size, height: size, marginLeft: -size / 2 }]} accessibilityRole="button" accessibilityLabel={`${petName || 'Pet'} đang ${resting ? 'thư giãn' : 'đọc sách cùng bạn'}`}
      onPress={() => { if (reduce) return; greeting.stopAnimation(); greeting.setValue(0); Animated.sequence([
        Animated.timing(greeting, { toValue: -7, duration: 180, useNativeDriver: true }),
        Animated.timing(greeting, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]).start(); }}>
      <Animated.View style={{ transform: [{ translateY: greeting }, { rotate: resting ? '-7deg' : '0deg' }] }}><PetArt pet={petId} size={size} stage={petLevel} studying={drawnStudy} /></Animated.View>
      {drawnStudy ? null : <View pointerEvents="none" style={s.book}>
        <Svg width={92} height={37} viewBox="0 0 120 48"><Path d={resting ? 'M13 24h92v19H13Z' : 'M7 13q24-11 53 3 28-14 53-3l-5 30q-23-8-48 0-27-8-48 0Z'} fill={resting ? '#A7B7B0' : '#FFF8E6'} stroke="#CBB699" strokeWidth="2" /><Path d={resting ? 'M20 30h78m-78 5h78' : 'M60 16v26M21 22l26 4m-26 4 26 4m27-8 25-4m-25 12 25-4'} stroke="#C6B8A5" strokeWidth="1.5" /></Svg>
        {!resting ? <Animated.View testID="study-pencil" style={[s.pencil, { transform: [{ translateX: writing.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }) }, { rotate: '-30deg' }] }]} /> : null}
      </View>}
      {resting ? <View style={s.restIcon}><Ionicons name="moon-outline" color="#8B8EA6" size={17} /></View> : null}
    </Pressable>
    <View style={s.caption}><View style={s.dot} /><Text style={s.captionText}>{`${petName || 'Pet'} ${resting ? 'đang nghỉ ngơi bên bạn' : 'đang học cùng bạn'}`}</Text></View>
  </View>;
});

const s = StyleSheet.create({
  room: { width: '100%', aspectRatio: 800 / 520, position: 'relative', minWidth: 0 },
  pet: { position: 'absolute', left: '52.5%', bottom: '34%', marginLeft: -62, justifyContent: 'flex-end' },
  book: { position: 'absolute', bottom: -7, left: 17 }, pencil: { width: 4, height: 24, backgroundColor: '#B9967B', borderRadius: 2, position: 'absolute', bottom: 13, right: 27 },
  restIcon: { position: 'absolute', right: 0, top: 5 },
  caption: { position: 'absolute', bottom: '2%', alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { height: 5, width: 5, borderRadius: 3, backgroundColor: '#879F91' }, captionText: { color: '#63736E', fontSize: 11, fontWeight: '600' },
});
