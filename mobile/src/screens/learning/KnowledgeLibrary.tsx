import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { PetArt } from '../../components/PetArt';
import { Text } from '../../components/Typography';
import type { KnowledgeEntry, Note } from '../../learning/education';
import { AppModal } from '../../ui/AppModal';
import { useWorldMotion } from '../../world/budget';
import { BEAT, ContactShadow, hashOf, Hit, Paper, Plate, Tiles, useSize } from '../../world/diorama';
import { EASE } from '../../world/motion';

/**
 * Sổ tay kiến thức as a personal library. Lessons studied this year and the owner's notes become books on the shelf of
 * their subject, so the library grows with what has really been learned. Reading only: the texts come from the server as
 * they are; writing and editing notes stays in "Ghi chú của tôi". A bookmark is kept on this device only.
 */

export type Page = { heading: string; lines: string[]; note?: Note };
export type Book = { id: string; kind: 'lesson' | 'notes'; title: string; subject: string; subjectName: string; chapter: string; pages: Page[]; lessonKey?: string; text: string };
export type Shelf = { subject: string; name: string; books: Book[] };

const LINES_PER_PAGE = 7;
const pageSplit = (heading: string, lines: string[]): Page[] => {
  const pages: Page[] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push({ heading, lines: lines.slice(i, i + LINES_PER_PAGE) });
  return pages;
};
const notePage = (n: Note): Page => ({ heading: n.title || 'Ghi chú của bạn', lines: n.body.split('\n').filter(Boolean), note: n });

/** The shelves: one per subject, lessons first in the order they came, then the book of the subject's other notes. */
export function buildShelves(entries: KnowledgeEntry[], notes: Note[]): Shelf[] {
  const shelves = new Map<string, Shelf>();
  const shelf = (subject: string, name: string | null) => {
    const found = shelves.get(subject);
    if (found) return found;
    const made: Shelf = { subject, name: name || subject, books: [] };
    shelves.set(subject, made);
    return made;
  };
  entries.forEach((e) => {
    const own = notes.filter((n) => n.lesson_key === e.key);
    const pages = [...pageSplit('Bạn đã học gì?', e.objectives), ...pageSplit('Kiến thức tóm tắt', e.summary),
      ...e.examples.flatMap((x) => pageSplit(x.title, x.lines)), ...own.map(notePage)];
    shelf(e.subject, e.subject_name).books.push({ id: `lesson:${e.key}`, kind: 'lesson', title: e.title, subject: e.subject, subjectName: e.subject_name ?? e.subject, chapter: e.chapter,
      pages: pages.length ? pages : [{ heading: e.title, lines: e.description ? [e.description] : ['Bài này chưa có phần tóm tắt.'] }], lessonKey: e.key,
      text: [e.title, e.chapter, ...e.objectives, ...e.summary, ...e.examples.flatMap((x) => [x.title, ...x.lines]), ...own.flatMap((n) => [n.title, n.body])].join(' ') });
  });
  const lessonKeys = new Set(entries.map((e) => e.key));
  const loose = new Map<string, Note[]>();
  notes.filter((n) => !n.lesson_key || !lessonKeys.has(n.lesson_key)).forEach((n) => loose.set(n.subject, [...(loose.get(n.subject) ?? []), n]));
  loose.forEach((list, subject) => {
    const name = list[0].subject_name;
    shelf(subject, name).books.push({ id: `notes:${subject}`, kind: 'notes', title: `Ghi chú ${name}`, subject, subjectName: name, chapter: `${list.length} ghi chú của bạn`,
      pages: list.map(notePage), text: list.flatMap((n) => [n.title, n.body, n.lesson_title ?? '']).join(' ') });
  });
  return [...shelves.values()];
}

const accentless = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
/** The shelves with only the books asked for. An empty search keeps everything; accents don't matter when searching. */
export function filterShelves(shelves: Shelf[], f: { query: string; subject: string | null; marked: Set<string> | null }) {
  const q = accentless(f.query.trim());
  return shelves.filter((s) => !f.subject || s.subject === f.subject)
    .map((s) => ({ ...s, books: s.books.filter((b) => (!f.marked || f.marked.has(b.id)) && (!q || accentless(b.text).includes(q))) }))
    .filter((s) => s.books.length);
}

/** Bookmarks, per person, on this device. */
export function useBookmarks(userId: number | undefined) {
  const key = `mirabi.library.bookmarks:${userId ?? 'anonymous'}`;
  const [marked, setMarked] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    void AsyncStorage.getItem(key).then((raw) => { if (live && raw) try { setMarked(new Set(JSON.parse(raw))); } catch { /* a broken list is an empty one */ } }).catch(() => {});
    return () => { live = false; };
  }, [key]);
  const toggle = useCallback((id: string) => setMarked((old) => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id); else next.add(id);
    void AsyncStorage.setItem(key, JSON.stringify([...next])).catch(() => {});
    return next;
  }), [key]);
  return [marked, toggle] as const;
}

const WALL = require('../../../assets/world/library/wall.jpg');
const NICHE = require('../../../assets/world/library/niche.jpg');
const TOP = { plant: require('../../../assets/world/library/top-plant.webp'), globe: require('../../../assets/world/library/top-globe.webp'), cup: require('../../../assets/world/library/top-cup.webp') };
const COVERS = [
  require('../../../assets/world/library/book-0.webp'), require('../../../assets/world/library/book-1.webp'), require('../../../assets/world/library/book-2.webp'), require('../../../assets/world/library/book-3.webp'),
  require('../../../assets/world/library/book-4.webp'), require('../../../assets/world/library/book-5.webp'), require('../../../assets/world/library/book-6.webp'),
];
/** The cream cover of a book of the owner's own notes. */
const NOTES_COVER = require('../../../assets/world/library/book-7.webp');
const BOOK = { width: 104, height: 144 };

/** One book facing out on the shelf, its name on the label of its cover, so it reads without turning your head. Its colour
 * follows its subject. */
const BookCover = memo(function BookCover({ book, marked, hue, onPress }: { book: Book; marked: boolean; hue: number; onPress: () => void }) {
  const notes = book.kind === 'notes';
  return (
    <Hit onPress={onPress} sink={0.97} accessibilityRole="button" accessibilityLabel={`Mở sách ${book.title}${marked ? ', đã đánh dấu' : ''}`} testID={`book-${book.id}`} style={l.bookSlot}>
      <Plate source={notes ? NOTES_COVER : COVERS[hue % COVERS.length]} width={BOOK.width} height={BOOK.height} />
      <View style={l.label}><Text style={l.bookName} numberOfLines={4}>{book.title}</Text></View>
      {marked ? <View style={l.ribbon} testID={`ribbon-${book.id}`} /> : null}
    </Hit>
  );
});

/** Things that come to stand on top of the shelves as the library grows; never before the books are really there. */
const ShelfTop = memo(function ShelfTop({ books }: { books: number }) {
  return (
    <View style={l.tops}>
      <Image source={TOP.plant} style={l.top} resizeMode="contain" accessibilityIgnoresInvertColors />
      {books >= 4 ? <Image source={TOP.globe} style={l.top} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      {books >= 10 ? <Image source={TOP.cup} style={l.top} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
    </View>
  );
});

/** One shelf of the wall, its board and sides from the picture. */
function ShelfBay({ children }: { children: React.ReactNode }) {
  const [size, onLayout] = useSize({ width: 378, height: 176 });
  return (
    <View style={l.niche} onLayout={onLayout}>
      <Plate source={NICHE} width={size.width} height={size.height} />
      {children}
    </View>
  );
}

/** The wall of shelves. */
export function ShelfWall({ shelves, marked, onOpen, pet, total }: { shelves: Shelf[]; marked: Set<string>; onOpen: (book: Book) => void; pet?: { id: string; level: number } | null; total: number }) {
  const [size, onLayout] = useSize({ width: 390, height: 500 });
  return (
    <View style={l.wall} onLayout={onLayout}>
      <Tiles source={WALL} width={size.width} height={size.height} />
      <View style={l.topRow}>
        <ShelfTop books={total} />
        <Text style={l.count}>{total} cuốn trong thư viện</Text>
      </View>
      {shelves.map((sh, i) => (
        <View key={sh.subject} style={l.shelf} testID={`shelf-${sh.subject}`}>
          <View style={l.plate}><Text style={l.plateText} numberOfLines={1} accessibilityRole="header">{sh.name}</Text><Text style={l.plateCount}>{sh.books.length}</Text></View>
          <ShelfBay>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={l.bookRow} contentContainerStyle={l.books}>
              {sh.books.map((b) => <BookCover key={b.id} book={b} marked={marked.has(b.id)} hue={hashOf(sh.subject) + i} onPress={() => onOpen(b)} />)}
              {/* The room still left on this shelf. */}
              {Array.from({ length: Math.max(1, 2 - sh.books.length) }, (_, n) => <View key={n} style={l.ghost} />)}
            </ScrollView>
          </ShelfBay>
        </View>
      ))}
      {pet ? (
        <View style={l.corner} pointerEvents="none">
          <ContactShadow width={92} height={16} opacity={0.4} style={l.petShadow} />
          <PetArt pet={pet.id} stage={pet.level} size={92} studying />
        </View>
      ) : null}
    </View>
  );
}

/** A book open in the hands: the cover swings away, pages turn from the left edge, and it closes before it goes. */
export function BookReader({ book, marked, onToggleMark, onClose, onOpenLesson, onEditNotes }: {
  book: Book | null; marked: boolean; onToggleMark: () => void; onClose: () => void; onOpenLesson: (key: string) => void; onEditNotes: () => void;
}) {
  const { level } = useWorldMotion();
  const still = level === 'still';
  const open = useRef(new Animated.Value(still ? 1 : 0)).current;
  const turn = useRef(new Animated.Value(0)).current;
  const [index, setIndex] = useState(0);
  const turning = useRef(false);
  useEffect(() => {
    if (!book) return;
    setIndex(0);
    turning.current = false;
    turn.setValue(0);
    if (still) { open.setValue(1); return; }
    open.setValue(0);
    Animated.timing(open, { toValue: 1, duration: BEAT.open + 70, easing: EASE.ui, useNativeDriver: true }).start();
  }, [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    if (still) { onClose(); return; }
    Animated.timing(open, { toValue: 0, duration: BEAT.open, easing: EASE.ui, useNativeDriver: true }).start(() => onClose());
  };
  const flip = (to: number) => {
    if (!book || to < 0 || to >= book.pages.length || turning.current) return;
    if (still) { setIndex(to); return; }
    turning.current = true;
    const forward = to > index;
    Animated.timing(turn, { toValue: forward ? -1 : 1, duration: 170, easing: EASE.fall, useNativeDriver: true }).start(() => {
      setIndex(to);
      turn.setValue(forward ? 1 : -1);
      Animated.timing(turn, { toValue: 0, duration: 170, easing: EASE.rise, useNativeDriver: true }).start(() => { turning.current = false; });
    });
  };
  if (!book) return null;
  const page = book.pages[Math.min(index, book.pages.length - 1)];
  return (
    <AppModal visible transparent animationType="none" onRequestClose={close}>
      <View style={l.reader} testID="book-reader" accessibilityViewIsModal>
        <Animated.View style={[StyleSheet.absoluteFill, l.readerDim, { opacity: open }]}><Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Đóng sách" /></Animated.View>
        <Animated.View style={[l.book, { opacity: open.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }), transform: [{ translateY: open.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }, { scale: open.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
          <View style={l.cover} />
          <View style={l.leavesEdge} />
          <Animated.View style={[l.page, { transformOrigin: '0% 50%', transform: [{ perspective: 1100 }, { rotateY: turn.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-82deg', '0deg', '82deg'] }) }], opacity: turn.interpolate({ inputRange: [-1, -0.8, 0, 0.8, 1], outputRange: [0.4, 1, 1, 1, 0.4] }) }]} testID="book-page">
            <View style={l.gutter} pointerEvents="none" />
            <View style={l.pageHead}>
              <View style={l.flex}><Text style={l.bookTitle} numberOfLines={2} accessibilityRole="header">{book.title}</Text><Text style={l.bookMeta} numberOfLines={1}>{book.subjectName} · {book.chapter}</Text></View>
              <Pressable onPress={onToggleMark} hitSlop={8} style={l.markBtn} accessibilityRole="button" accessibilityLabel={marked ? 'Bỏ đánh dấu sách' : 'Đánh dấu sách'} accessibilityState={{ selected: marked }}>
                <Ionicons name={marked ? 'bookmark' : 'bookmark-outline'} size={24} color={marked ? '#C8323F' : '#6B5740'} />
              </Pressable>
              <Pressable onPress={close} hitSlop={8} style={l.markBtn} accessibilityRole="button" accessibilityLabel="Đóng sách"><Ionicons name="close" size={24} color="#4F6C86" /></Pressable>
            </View>
            <ScrollView style={l.pageScroll} contentContainerStyle={l.pageBody}>
              <Text style={l.pageHeading}>{page.heading}</Text>
              {page.lines.map((line, i) => <Text key={i} style={l.pageLine}>{line}</Text>)}
              {page.note ? <Text style={l.pageNoteMeta}>{[page.note.lesson_title, page.note.academic_year_label ? `${page.note.grade_label} · ${page.note.academic_year_label}` : null].filter(Boolean).join(' · ')}</Text> : null}
            </ScrollView>
            {book.lessonKey ? <Pressable onPress={() => { const key = book.lessonKey!; close(); onOpenLesson(key); }} style={l.pageLink} accessibilityRole="button" accessibilityLabel="Mở bài học"><Ionicons name="arrow-forward" size={16} color="#136FA8" /><Text style={l.pageLinkText}>Mở bài học</Text></Pressable> : null}
            {page.note ? <Pressable onPress={() => { close(); onEditNotes(); }} style={l.pageLink} accessibilityRole="button" accessibilityLabel="Sửa trong Ghi chú của tôi"><Ionicons name="create-outline" size={16} color="#136FA8" /><Text style={l.pageLinkText}>Sửa trong Ghi chú của tôi</Text></Pressable> : null}
            <View style={l.pageFoot}>
              <Pressable disabled={index === 0} onPress={() => flip(index - 1)} style={[l.turn, index === 0 && l.turnOff]} accessibilityRole="button" accessibilityLabel="Trang trước" accessibilityState={{ disabled: index === 0 }}><Ionicons name="chevron-back" size={22} color="#4F6C86" /></Pressable>
              <Text style={l.pageNumber} accessibilityLabel={`Trang ${index + 1} trên ${book.pages.length}`}>{index + 1} / {book.pages.length}</Text>
              <Pressable disabled={index >= book.pages.length - 1} onPress={() => flip(index + 1)} style={[l.turn, index >= book.pages.length - 1 && l.turnOff]} accessibilityRole="button" accessibilityLabel="Trang sau" accessibilityState={{ disabled: index >= book.pages.length - 1 }}><Ionicons name="chevron-forward" size={22} color="#4F6C86" /></Pressable>
            </View>
          </Animated.View>
          {/* The front cover swings open over the first page, once. */}
          {still ? null : (
            <Animated.View pointerEvents="none" style={[l.frontCover, { transformOrigin: '0% 50%', opacity: open.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 0.85, 0] }), transform: [{ perspective: 1100 }, { rotateY: open.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-110deg'] }) }] }]}>
              <Text style={l.frontTitle} numberOfLines={3}>{book.title}</Text>
            </Animated.View>
          )}
        </Animated.View>
      </View>
    </AppModal>
  );
}

/** Nothing on the shelves yet. */
export function EmptyLibrary({ message }: { message: string }) {
  return (
    <Paper style={l.emptyPaper}>
      <Ionicons name="library-outline" size={30} color="#136FA8" />
      <Text style={l.emptyText}>{message}</Text>
    </Paper>
  );
}

const l = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  wall: { paddingTop: 8, paddingBottom: 18, overflow: 'hidden' },
  topRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 14, marginBottom: 4 },
  tops: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  top: { width: 54, height: 54 },
  count: { fontSize: 13, lineHeight: 18, fontWeight: '900', color: '#123B5C', paddingBottom: 6 },
  shelf: { marginBottom: 14 },
  plate: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 8, maxWidth: '84%', backgroundColor: '#FFFFFF', borderRadius: 4, borderWidth: 1, borderColor: '#C5E2F2', paddingHorizontal: 10, paddingVertical: 2, marginBottom: 5,
    shadowColor: '#1F6E9E', shadowOpacity: 0.45, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  plateText: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '900', color: '#123B5C' },
  plateCount: { fontSize: 11, fontWeight: '900', color: '#123B5C' },
  niche: { marginHorizontal: 6, height: 176, justifyContent: 'flex-end' },
  bookRow: { flexGrow: 0, marginHorizontal: '6%', marginBottom: 13 },
  books: { alignItems: 'flex-end', gap: 6 },
  bookSlot: { width: BOOK.width, height: BOOK.height },
  label: { position: 'absolute', left: '24%', right: '13%', top: '27%', height: '41%', alignItems: 'center', justifyContent: 'center' },
  bookName: { fontSize: 11, lineHeight: 14, fontWeight: '800', color: '#123B5C', textAlign: 'center' },
  ghost: { width: BOOK.width - 14, height: BOOK.height - 12, marginLeft: 4, marginBottom: 4, borderRadius: 5, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(110,74,40,0.34)' },
  ribbon: { position: 'absolute', top: 0, right: 16, width: 9, height: 26, backgroundColor: '#C8323F', borderBottomLeftRadius: 1, borderBottomRightRadius: 1 },
  corner: { alignSelf: 'flex-end', marginRight: 14, marginTop: 2 },
  petShadow: { position: 'absolute', bottom: 0, alignSelf: 'center' },
  reader: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  readerDim: { backgroundColor: 'rgba(10,36,56,0.62)' },
  book: { width: '100%', maxWidth: 420, height: '78%', maxHeight: 620 },
  cover: { position: 'absolute', left: -5, right: -8, top: -7, bottom: -9, borderRadius: 9, backgroundColor: '#136FA8', borderWidth: 2, borderColor: '#C5E2F2', shadowColor: '#000000', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 12 }, elevation: 18 },
  leavesEdge: { position: 'absolute', left: 3, right: -4, top: -2, bottom: -4, borderRadius: 5, backgroundColor: '#E8EFF4', borderWidth: 1, borderColor: '#C5E2F2' },
  page: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 5, padding: 16, paddingLeft: 22, overflow: 'hidden' },
  gutter: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, backgroundColor: 'rgba(120,84,48,0.13)' },
  pageHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 2, borderBottomWidth: 1, borderBottomColor: '#C5E2F2', paddingBottom: 8 },
  bookTitle: { fontSize: 17, lineHeight: 23, fontWeight: '900', color: '#123B5C' },
  bookMeta: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#4F6C86' },
  markBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pageScroll: { flex: 1 },
  pageBody: { paddingVertical: 12, gap: 8 },
  pageHeading: { fontSize: 15, lineHeight: 21, fontWeight: '900', color: '#136FA8' },
  pageLine: { fontSize: 15, lineHeight: 24, color: '#123B5C' },
  pageNoteMeta: { fontSize: 12, lineHeight: 16, fontWeight: '700', color: '#4F6C86', marginTop: 6 },
  pageLink: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  pageLinkText: { fontSize: 13, fontWeight: '900', color: '#136FA8' },
  pageFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#C5E2F2', paddingTop: 6 },
  turn: { width: 48, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDF0FA' },
  turnOff: { opacity: 0.35 },
  pageNumber: { fontSize: 13, fontWeight: '800', color: '#4F6C86', fontVariant: ['tabular-nums'] },
  frontCover: { position: 'absolute', left: -5, right: -8, top: -7, bottom: -9, borderRadius: 9, backgroundColor: '#136FA8', borderWidth: 3, borderColor: '#C5E2F2', alignItems: 'center', justifyContent: 'center', padding: 30 },
  frontTitle: { fontSize: 22, lineHeight: 30, fontWeight: '900', color: '#FFFFFF', textAlign: 'center' },
  emptyPaper: { margin: 14, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#123B5C', textAlign: 'center' },
});
