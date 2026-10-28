export type MemoryCategory = 'all' | 'pet' | 'study' | 'friends';
export type MemoryTemplate = 'auto' | 'hatch' | 'evolve' | 'study' | 'together' | 'walk';
export type MemoryPalette = 'sky' | 'lilac' | 'peach';

export type MemorySnapshot = {
  pet_name: string; pet_id: string; level: number; element: string;
  accessory?: string | null; background: string; result?: string | null;
  /** Room photos: the room and where the pet stood when the photo was taken (the room's layout format changed over
   * time; the stored image is what is shown). */
  pose?: 'rug' | 'study' | 'rest'; room?: { name: string; layout: unknown; version: number };
};

export type Memory = {
  id: number; pet_id: string; event_type: string; title: string; message?: string | null;
  event_text: string; event_at: string; created_at: string; favorite: boolean; featured?: boolean;
  status: string; snapshot: MemorySnapshot; thumbnail_svg: string; image_svg?: string;
  template_key?: MemoryTemplate; palette_key?: MemoryPalette; include_message?: boolean;
};

export type MemoryPage = { items: Memory[]; next_cursor?: number | null; featured_id?: number | null; companion_days?: number | null };
