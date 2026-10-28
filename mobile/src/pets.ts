import { ELEMENTS, Element, ElementId } from './elements';

// Pets a user can adopt after their first sign-in. Ids must match PetId in backend/app/schemas.py.
export type PetMotion = 'float' | 'sway' | 'hop' | 'waddle' | 'swim' | 'stroll';
export type PetId = 'fox' | 'cat' | 'bunny' | 'penguin' | 'dolphin' | 'turtle';
/** `name` is the suggested name; the user picks the real one after adopting. Evolution art (Lv.0–6) lives in assets/pets/<element>/, see PetArt. */
export type Pet = { id: PetId; name: string; species: string; element: Element; motion: PetMotion; tagline: string };

const pet = (id: PetId, name: string, species: string, element: ElementId, motion: PetMotion, tagline: string): Pet =>
  ({ id, name, species, element: ELEMENTS[element], motion, tagline });

// One pet per element, in the order the picker shows them.
export const PETS: readonly Pet[] = [
  pet('dolphin', 'Sóng', 'cá heo nước', 'water', 'swim', 'Vui vẻ, thích kết bạn'),
  pet('fox', 'Hỏa', 'cáo lửa', 'fire', 'float', 'Nhiệt huyết, dám thử điều mới'),
  pet('turtle', 'Mầm', 'rùa cỏ', 'grass', 'stroll', 'Chậm mà chắc, lớn lên mỗi ngày'),
  pet('penguin', 'Tuyết', 'cánh cụt băng', 'ice', 'waddle', 'Bình tĩnh, kiên trì từng bước'),
  pet('bunny', 'Tia', 'thỏ điện', 'electric', 'hop', 'Nhanh nhẹn, tràn năng lượng'),
  pet('cat', 'Mây', 'mèo sương', 'mist', 'sway', 'Dịu dàng, hay lắng nghe'),
];

export const DEFAULT_PET: PetId = 'dolphin';

/** Unknown ids (e.g. an older server) fall back to the default pet rather than breaking the UI. */
export const petById = (id?: string | null): Pet => PETS.find((p) => p.id === id) ?? PETS.find((p) => p.id === DEFAULT_PET)!;
