import type { Ambience, Mood, RelaxActivity } from '../../life/types';

/** The Healing Room's scenes: the faint light over the room (`tint`), and the sound each offers (played only after
 * the user turns sound on in this visit). The windows' sky and weather and the lamps' glow are RoomAmbience's. */
export const AMBIENCES: Record<Ambience, {
  label: string; emoji: string; tint: readonly [string, string]; sound: number; soundLabel: string;
}> = {
  cozy_night: { label: 'Đêm ấm áp', emoji: '🕯️', tint: ['rgba(255,190,120,0.10)', 'rgba(70,50,110,0.08)'],
    sound: require('../../../assets/audio/lofi.wav'), soundLabel: 'Nhạc nhẹ' },
  rainy_day: { label: 'Ngày mưa', emoji: '🌧️', tint: ['rgba(110,135,165,0.12)', 'rgba(150,175,200,0.06)'],
    sound: require('../../../assets/audio/rain.wav'), soundLabel: 'Tiếng mưa' },
  morning_calm: { label: 'Sáng bình yên', emoji: '🌤️', tint: ['rgba(255,236,190,0.12)', 'rgba(255,255,255,0)'],
    sound: require('../../../assets/audio/stream.wav'), soundLabel: 'Suối chảy' },
  forest_retreat: { label: 'Rừng xanh', emoji: '🌲', tint: ['rgba(120,190,130,0.10)', 'rgba(220,245,210,0.04)'],
    sound: require('../../../assets/audio/forest.wav'), soundLabel: 'Rừng chim hót' },
  starry_night: { label: 'Trời sao', emoji: '✨', tint: ['rgba(40,50,110,0.14)', 'rgba(110,100,180,0.06)'],
    sound: require('../../../assets/audio/white-noise.wav'), soundLabel: 'Gió đêm' },
};
export const AMBIENCE_ORDER: Ambience[] = ['cozy_night', 'rainy_day', 'morning_calm', 'forest_retreat', 'starry_night'];

export const MOODS: { id: Mood; label: string; emoji: string; color: string }[] = [
  { id: 'happy', label: 'Vui vẻ', emoji: '😊', color: '#FFE08A' },
  { id: 'neutral', label: 'Bình thường', emoji: '😐', color: '#DDE7EF' },
  { id: 'tired', label: 'Mệt mỏi', emoji: '😪', color: '#D9D2F2' },
  { id: 'stressed', label: 'Căng thẳng', emoji: '😣', color: '#FFD3C2' },
  { id: 'sad', label: 'Buồn', emoji: '😢', color: '#C9E2F7' },
  { id: 'excited', label: 'Hào hứng', emoji: '🤩', color: '#FFC9E0' },
];
export const moodOf = (id: Mood) => MOODS.find((m) => m.id === id) ?? MOODS[1];

export const ACTIVITY_LABEL: Record<RelaxActivity, string> = {
  breathing: 'Hít thở', nature_sound: 'Âm thanh thiên nhiên', journal: 'Viết nhật ký', gratitude: '3 điều tích cực',
  rest: 'Nghỉ ngơi', pet: 'Vuốt ve pet',
};

/** Guided breathing: in, hold, out (seconds). */
export const BREATH_STEPS: { label: string; seconds: number; scale: number }[] = [
  { label: 'Hít vào', seconds: 4, scale: 1 },
  { label: 'Giữ hơi', seconds: 4, scale: 1 },
  { label: 'Thở ra', seconds: 6, scale: 0.55 },
];
export const BREATH_CYCLE = BREATH_STEPS.reduce((sum, s) => sum + s.seconds, 0);
