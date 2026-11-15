// What the owner's screens (My switches, phone check-in, drill report) get, and the repaint helper they share.
import type { Network } from '../../core/config';
import type { WriteIO } from '../files';
import type { WriteSession } from '../write/session';
import type { MineService } from './service';

export interface MineApp {
  service: MineService;
  network: () => Network;
  io: WriteIO;
  walletConnected: () => boolean;
  connectWallet?: () => Promise<void>;
  /** the Write sessions of this page (real and drill): "download the vaults again" in the same session */
  sessions?: () => WriteSession[];
  /** a fire drill is offered (testnet with a drill configuration) */
  drillAvailable: () => boolean;
  /** the open dialog's parent (default: document.body) */
  dialogParent?: () => HTMLElement;
  navigate?: (hash: string) => void;
}

/**
 * A screen repainted on every change of the service while it is in the document (it unsubscribes once it has been
 * attached and then removed). The control with the focus is found again by its `data-k`.
 */
export function live(root: HTMLElement, service: { onChange(fn: () => void): () => void }, paint: () => void): HTMLElement {
  let seen = false;
  const run = (): void => {
    if (root.isConnected) seen = true;
    else if (seen) { unsubscribe(); return; }
    const active = root.ownerDocument.activeElement;
    const key = active && root.contains(active) ? active.getAttribute('data-k') : null;
    paint();
    if (key) root.querySelector<HTMLElement>(`[data-k="${key.replace(/["\\]/g, '\\$&')}"]`)?.focus();
  };
  const unsubscribe = service.onChange(run);
  run();
  return root;
}
