/**
 * Ethereum address validation — EIP-55 checksum.
 *
 * Why this exists: a payment address is the one string in this system where a
 * silent typo costs real money and cannot be undone. §83 says never invent
 * payment data; the corollary is never to *display* payment data that has not
 * been verified. So the address is checked at boot and at render time, and the
 * support page refuses to show an address that fails its checksum.
 *
 * Keccak-256 is implemented here (~70 lines) rather than pulled from npm: it
 * removes a supply-chain dependency from the one code path that handles money.
 */

// ---------------------------------------------------------------- keccak-256
const RC = [
  0x00000001n, 0x00008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39,
  41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];
const MASK = (1n << 64n) - 1n;

const rotl = (x: bigint, n: number): bigint =>
  n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

function keccakF(s: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    // theta
    const c = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) c[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
    }
    // rho + pi
    const b = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + ((2 * x + 3 * y) % 5) * 5] = rotl(s[x + y * 5], ROT[x + y * 5]);
      }
    }
    // chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) s[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & b[((x + 2) % 5) + y] & MASK);
    }
    // iota
    s[0] ^= RC[round];
  }
}

/** Keccak-256 (the pre-NIST padding used by Ethereum, 0x01 not 0x06). */
export function keccak256(input: Uint8Array): Uint8Array {
  const rate = 136; // 1088 bits
  const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + j]);
      state[i] ^= lane;
    }
    keccakF(state);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = state[i];
    for (let j = 0; j < 8; j++) { out[i * 8 + j] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}

function toHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- EIP-55
/** Apply the EIP-55 mixed-case checksum to a lowercase (unprefixed) address. */
export function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, '');
  const hash = toHex(keccak256(new TextEncoder().encode(addr)));
  let out = '0x';
  for (let i = 0; i < addr.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}

export interface EthValidation {
  valid: boolean;
  reason?: string;
  checksum?: string;
}

/**
 * Validates shape and, when the address is mixed-case, its EIP-55 checksum.
 * An all-lowercase or all-uppercase address carries no checksum information —
 * it is accepted as well-formed, but reported as unverifiable so the operator
 * knows a typo could not have been detected.
 */
export function validateEthAddress(address: string): EthValidation {
  const a = address.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
    return { valid: false, reason: 'não tem o formato 0x seguido de 40 dígitos hexadecimais' };
  }
  const body = a.slice(2);
  const mixed = /[a-f]/.test(body) && /[A-F]/.test(body);
  const checksum = toChecksumAddress(a);
  if (!mixed) {
    return { valid: true, checksum, reason: 'endereço sem maiúsculas/minúsculas mistas: não contém checksum EIP-55 verificável' };
  }
  if (a !== checksum) {
    return { valid: false, checksum, reason: 'checksum EIP-55 inválido — o endereço pode conter um erro de transcrição' };
  }
  return { valid: true, checksum };
}
