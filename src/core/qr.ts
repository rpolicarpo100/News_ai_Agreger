/**
 * QR rendering for payment details — §83 ("permitir copiar endereço; QR code").
 *
 * Rendered locally to inline SVG. A payment QR must never be fetched from a
 * third-party image service: that would leak the recipient address and create a
 * tampering surface on the one code path that handles money. Inline SVG also
 * survives the sandboxed preview, which blocks external resources.
 *
 * Encoding uses `qrcode-generator` (zero transitive dependencies). A hand-rolled
 * encoder was written first and discarded: it produced correctly-sized matrices
 * whose modules disagreed with the reference implementation, and an unscannable
 * payment QR is worse than a dependency. The output is verified module-for-module
 * against Python's `qrcode` library in the test suite.
 */
import qrcodeGenerator from 'qrcode-generator';

export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

/** Returns the module matrix; true = dark. */
export function encodeQr(text: string, ec: ErrorCorrection = 'M'): boolean[][] {
  if (!text) throw new Error('QR payload must not be empty');
  // typeNumber 0 = auto-select the smallest version that fits.
  const qr = qrcodeGenerator(0, ec);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const grid: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    grid.push(row);
  }
  return grid;
}

export interface QrOpts {
  size?: number;
  ec?: ErrorCorrection;
  /** Accessible name. Omit for decorative codes accompanied by visible text. */
  label?: string;
}

export function qrSvg(text: string, opts: QrOpts = {}): string {
  const grid = encodeQr(text, opts.ec ?? 'M');
  const n = grid.length;
  const quiet = 4; // required quiet zone, in modules
  const total = n + quiet * 2;
  const px = opts.size ?? 200;

  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  const a11y = opts.label
    ? ` role="img" aria-label="${opts.label.replace(/[<>&"']/g, '')}"`
    : ' aria-hidden="true" focusable="false"';

  // White background is part of the code: QR readers need the quiet zone light
  // even when the surrounding page is dark.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" `
    + `width="${px}" height="${px}"${a11y} shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="#ffffff"/>`
    + `<path d="${path}" fill="#000000"/></svg>`;
}
