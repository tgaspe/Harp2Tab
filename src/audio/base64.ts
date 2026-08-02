// Manual base64 encoder — pure arithmetic, no platform API (Hermes on native doesn't
// ship `btoa`, only browsers/web do), so this works identically on every platform.
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    result += BASE64_CHARS[b1 >> 2];
    result += BASE64_CHARS[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < len ? BASE64_CHARS[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < len ? BASE64_CHARS[b3 & 63] : '=';
  }
  return result;
}

const BASE64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE64_CHARS.length; i++) BASE64_LOOKUP[BASE64_CHARS[i]] = i;

/** Inverse of `bytesToBase64` — needed since Phase 11 persists MIDI projects as base64 SMF
 *  and has to read them back. Same no-platform-API constraint as the encoder. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(len);

  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = BASE64_LOOKUP[clean[i]] ?? 0;
    const c2 = BASE64_LOOKUP[clean[i + 1]] ?? 0;
    const c3 = BASE64_LOOKUP[clean[i + 2]] ?? 0;
    const c4 = BASE64_LOOKUP[clean[i + 3]] ?? 0;

    if (byteIndex < len) bytes[byteIndex++] = (c1 << 2) | (c2 >> 4);
    if (byteIndex < len) bytes[byteIndex++] = ((c2 & 15) << 4) | (c3 >> 2);
    if (byteIndex < len) bytes[byteIndex++] = ((c3 & 3) << 6) | c4;
  }

  return bytes;
}
