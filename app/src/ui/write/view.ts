// What every Write step gets: the session, navigation, a repaint of the step, browser I/O and the wallet.
import type { WriteIO } from '../files';
import type { WriteSession } from './session';

export interface WriteApp {
  session: WriteSession;
  io: WriteIO;
  /** opens the wallet's connect flow */
  connectWallet?: () => Promise<void>;
  walletConnected?: () => boolean;
  /** navigation (default: `location.hash`) */
  navigate?: (hash: string) => void;
}

export interface StepView {
  app: WriteApp;
  s: WriteSession;
  /** the number of this screen instance (changes on every route change or language change) */
  screen: number;
  go(step: string): void;
  repaint(): void;
}
