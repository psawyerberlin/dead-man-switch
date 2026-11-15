// Browser file I/O for the Write flow: save a file (object URL, nothing leaves the page), print a sheet in a hidden
// frame, copy to the clipboard. Tests replace these through `WriteIO`.

export interface WriteIO {
  save(name: string, data: string | Uint8Array, mime: string): void;
  /** prints `body` (a detached element) on its own page */
  print(title: string, body: HTMLElement): void;
  copy(text: string): Promise<boolean>;
  /** what `prefers-reduced-motion` is read from */
  motion?: { matchMedia?: (q: string) => { matches: boolean } };
}

export function saveFile(name: string, data: string | Uint8Array, mime: string, doc: Document = document): void {
  const URLs = doc.defaultView?.URL ?? globalThis.URL;
  if (typeof URLs?.createObjectURL !== 'function') return;
  const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data);
  const url = URLs.createObjectURL(new Blob([part], { type: mime }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URLs.revokeObjectURL(url), 60_000);
}

const PRINT_CSS = 'body{font:17px/1.5 Georgia,serif;color:#1C2333;margin:2cm;max-width:70ch}h1{font-size:1.6em}'
  + 'code{font-family:ui-monospace,monospace;word-break:break-all}svg{width:5cm;height:5cm}ol{padding-left:1.2em}';

export function printSheet(title: string, body: HTMLElement, doc: Document = document): void {
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  doc.body.append(frame);
  const fdoc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!fdoc || !win) { frame.remove(); return; }
  fdoc.open();
  fdoc.close();
  fdoc.title = title;
  const style = fdoc.createElement('style');
  style.textContent = PRINT_CSS;
  fdoc.head.append(style);
  fdoc.body.append(fdoc.importNode(body, true));
  try { win.focus(); win.print(); } catch { /* printing unavailable */ }
  setTimeout(() => frame.remove(), 60_000);
}

export async function copyText(text: string): Promise<boolean> {
  try { await globalThis.navigator?.clipboard?.writeText(text); return true; } catch { return false; }
}

export const browserIO = (): WriteIO => ({ save: (n, d, m) => saveFile(n, d, m), print: (t, b) => printSheet(t, b), copy: copyText, motion: globalThis as never });
