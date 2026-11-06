import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Dictionary, type TranslationKey, vi } from './vi';

export type { TranslationKey };
export type LanguageCode = 'vi' | 'en';
/** What the user chose: a language, or null to follow the device. */
export type LanguageChoice = 'vi' | null;

/**
 * The languages Mirabi knows of. Only a `ready` one can be chosen: English is listed as coming, because most screens
 * are still written straight in Vietnamese and have not moved into the dictionary yet. Names are in their own language.
 */
export const LANGUAGES: { code: LanguageCode; name: string; dictionary: Dictionary | null; ready: boolean }[] = [
  { code: 'vi', name: 'Tiếng Việt', dictionary: vi, ready: true },
  { code: 'en', name: 'English', dictionary: null, ready: false },
];
export const FALLBACK: LanguageCode = 'vi';
const ready = (code: string | null | undefined): code is LanguageCode => LANGUAGES.some((l) => l.code === code && l.ready);
export const languageName = (code: LanguageCode) => LANGUAGES.find((l) => l.code === code)?.name ?? code;

/** The device's language as a two-letter code ("vi-VN" -> "vi"), or null when it can't be read. */
export function deviceLanguage(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale ? locale.slice(0, 2).toLowerCase() : null;
  } catch { return null; }
}

/** The user's choice, else the device's language, else Vietnamese: whichever first is a language Mirabi speaks. */
export function resolveLanguage(choice: LanguageChoice, device: string | null): LanguageCode {
  if (ready(choice)) return choice;
  if (ready(device)) return device;
  return FALLBACK;
}

function lookup(dictionary: Dictionary, key: string): string | undefined {
  let node: any = dictionary;
  for (const part of key.split('.')) node = node?.[part];
  return typeof node === 'string' ? node : undefined;
}

/** The text of `key` in `language` with `{name}` filled in. A key missing there falls back to Vietnamese, then the key. */
export function translate(language: LanguageCode, key: TranslationKey, params?: Record<string, string | number>): string {
  const dictionary = LANGUAGES.find((l) => l.code === language)?.dictionary ?? vi;
  const text = lookup(dictionary, key) ?? lookup(vi, key) ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text;
}

export type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;
type Language = { language: LanguageCode; choice: LanguageChoice; device: string | null; setChoice: (choice: LanguageChoice) => void; t: Translate };

/** This device's copy of the choice, so the language is right before sign-in and offline. */
export const LANGUAGE_KEY = 'mirabi.language.v1';

const fallback: Language = { language: FALLBACK, choice: null, device: null, setChoice: () => {}, t: (key, params) => translate(FALLBACK, key, params) };
const LanguageContext = createContext<Language>(fallback);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<LanguageChoice>(null);
  const [device, setDevice] = useState(deviceLanguage);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(LANGUAGE_KEY).then((raw) => { if (active && ready(raw)) setChoiceState(raw as LanguageChoice); }).catch(() => {});
    // The device's language may have changed while Mirabi was in the background.
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') setDevice(deviceLanguage()); });
    return () => { active = false; sub.remove(); };
  }, []);
  const setChoice = useCallback((next: LanguageChoice) => {
    const value: LanguageChoice = ready(next) ? next : null;
    setChoiceState(value);
    void (value ? AsyncStorage.setItem(LANGUAGE_KEY, value) : AsyncStorage.removeItem(LANGUAGE_KEY)).catch(() => {});
  }, []);
  const language = resolveLanguage(choice, device);
  const value = useMemo<Language>(() => ({ language, choice, device, setChoice, t: (key, params) => translate(language, key, params) }),
    [language, choice, device, setChoice]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** `t` for the current language, and the choice behind it. */
export function useLanguage() {
  return useContext(LanguageContext);
}
export const useT = () => useContext(LanguageContext).t;
