import {
  Nunito_400Regular, Nunito_500Medium, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black,
} from '@expo-google-fonts/nunito';
import type { TextStyle } from 'react-native';

/** Font files loaded at startup (see App.tsx). */
export const NUNITO = { Nunito_400Regular, Nunito_500Medium, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black };

// Custom fonts ship one file per weight, and Android won't pick a weight from `fontWeight`, so map it to a family.
const BY_WEIGHT: Record<string, keyof typeof NUNITO> = {
  normal: 'Nunito_400Regular', '100': 'Nunito_400Regular', '200': 'Nunito_400Regular', '300': 'Nunito_400Regular', '400': 'Nunito_400Regular',
  '500': 'Nunito_500Medium', '600': 'Nunito_600SemiBold', bold: 'Nunito_700Bold', '700': 'Nunito_700Bold',
  '800': 'Nunito_800ExtraBold', '900': 'Nunito_900Black',
};

export const nunito = (weight?: TextStyle['fontWeight']) => BY_WEIGHT[String(weight ?? '400')] ?? 'Nunito_400Regular';
