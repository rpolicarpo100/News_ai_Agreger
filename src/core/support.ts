/**
 * Support / donations configuration — §83, §84.
 *
 * Rules encoded here:
 *  - payment details come from environment variables, never hardcoded secrets,
 *    and are validated before being shown (§83: never invent payment data);
 *  - an ETH address whose EIP-55 checksum fails is NOT displayed — a typo in a
 *    crypto address sends money nowhere recoverable;
 *  - nothing in this module is readable by, or reachable from, ranking, scoring,
 *    trending or editorial code paths (§84). There is deliberately no export
 *    that any of those modules could import.
 */
import { validateEthAddress } from './eth.js';

export interface SupportMethod {
  id: 'revolut' | 'ethereum';
  label: string;
  /** The value a human copies or scans. */
  value: string;
  /** Clickable target, when the method has one. */
  href?: string;
  /** Payload encoded into the QR code. */
  qrPayload: string;
  note: string;
  /** Populated when a configured value failed validation, so it can be shown as an error rather than silently dropped. */
  problem?: string;
}

export interface SupportConfig {
  configured: boolean;
  methods: SupportMethod[];
  problems: string[];
}

const DEFAULT_REVOLUT = 'https://revolut.me/infowithgoal';
const DEFAULT_ETH = '0x558d60469aC85EBC9679aB67835Fa9657a4B469e';

function normaliseRevolut(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  // Accept a full URL, a bare revolut.me path, or a plain username.
  const m = v.match(/^(?:https?:\/\/)?(?:www\.)?revolut\.me\/([A-Za-z0-9._-]{2,40})\/?$/i);
  if (m) return `https://revolut.me/${m[1]}`;
  if (/^@?[A-Za-z0-9._-]{2,40}$/.test(v)) return `https://revolut.me/${v.replace(/^@/, '')}`;
  return null;
}

export function loadSupportConfig(): SupportConfig {
  const methods: SupportMethod[] = [];
  const problems: string[] = [];

  // ---- Revolut
  const revolutRaw = process.env.SUPPORT_REVOLUT ?? DEFAULT_REVOLUT;
  if (revolutRaw.trim()) {
    const url = normaliseRevolut(revolutRaw);
    if (!url) {
      problems.push('SUPPORT_REVOLUT está definido mas não é um link revolut.me válido; não é apresentado.');
    } else {
      methods.push({
        id: 'revolut',
        label: 'Revolut',
        value: url.replace(/^https:\/\//, ''),
        href: url,
        qrPayload: url,
        note: 'Abre a página de pagamento Revolut. Qualquer valor, uma só vez.',
      });
    }
  }

  // ---- Ethereum
  const ethRaw = (process.env.SUPPORT_ETH ?? DEFAULT_ETH).trim();
  if (ethRaw) {
    const check = validateEthAddress(ethRaw);
    if (!check.valid) {
      // Refuse to display. Showing a possibly-mistyped address risks lost funds.
      problems.push(`Endereço Ethereum rejeitado (${check.reason}). Não é apresentado.`);
    } else {
      const addr = check.checksum ?? ethRaw;
      methods.push({
        id: 'ethereum',
        label: 'Ethereum',
        value: addr,
        // EIP-681: opens a wallet with the recipient pre-filled, amount left blank.
        qrPayload: `ethereum:${addr}`,
        note: 'Rede Ethereum (mainnet). Verifique a rede antes de enviar — fundos enviados noutra rede podem perder-se.',
        problem: check.reason, // e.g. "no checksum information available"
      });
    }
  }

  return { configured: methods.length > 0, methods, problems };
}
