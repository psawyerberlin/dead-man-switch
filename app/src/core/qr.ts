// QR codes for the paper backup (SPEC.md §3.7): error correction M, SVG drawn with `currentColor`.
import qrcode from 'qrcode-generator';
import { utf8 } from './bytes';

export const QR_QUIET_ZONE = 4;

function make(text: string) {
  const qr = qrcode(0, 'M');
  // byte mode over UTF-8 (the library's default maps each UTF-16 unit to one byte)
  const bytes = utf8(text);
  qr.addData(String.fromCharCode(...bytes), 'Byte');
  qr.make();
  return qr;
}

export function qrInfo(text: string): { version: number; moduleCount: number } {
  const n = make(text).getModuleCount();
  return { version: (n - 17) / 4, moduleCount: n };
}

/** A scalable SVG (one path of unit squares), dark modules in `currentColor`, 4-module quiet zone. */
export function qrSvg(text: string): string {
  const qr = make(text);
  const n = qr.getModuleCount();
  const q = QR_QUIET_ZONE;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      const start = c;
      while (c < n && qr.isDark(r, c)) c++;
      d += `M${start + q} ${r + q}h${c - start}v1h-${c - start}z`;
    }
  }
  const size = n + 2 * q;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img">` +
    `<path fill="currentColor" d="${d}"/></svg>`;
}
