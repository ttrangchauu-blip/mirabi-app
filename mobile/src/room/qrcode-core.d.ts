// The encoder of the `qrcode` package, without its canvas/PNG renderers (FriendQr draws the modules with react-native-svg).
declare module 'qrcode/lib/core/qrcode' {
  export function create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'; margin?: number }): {
    modules: { size: number; get(row: number, col: number): number | boolean };
  };
}
