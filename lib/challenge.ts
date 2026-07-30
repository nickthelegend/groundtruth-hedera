import { randomBytes } from 'crypto'

// Per-task freshness code. The worker must include it in their proof (written
// in-frame for a photo, or in a field for a form), which proves the proof was
// produced AFTER the task was issued — a stale or stock image can't contain a
// code that didn't exist when it was captured. This is the anti-replay guard.
//
// Alphabet excludes easily-confused characters (0/O, 1/I/L) so a human can copy
// it by hand without ambiguity.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateChallenge(length = 6): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}
