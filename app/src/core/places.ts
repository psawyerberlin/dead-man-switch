// Handover places (SPEC.md §3.3.2): the ten places a vault can go, each with a short tutorial of three to six steps
// in the i18n files (`guide.<place>.step<N>`, `guide.<place>.name`). The app never connects to any of them.
import type { Language } from './bundle';
import { MESSAGES, translate } from './i18n';

export const PLACES = ['google_drive', 'onedrive', 'dropbox', 'icloud', 'synology', 'nextcloud', 'gmx_webde', 'proton_drive', 'own_server',
  'usb_paper'] as const;
export type PlaceId = (typeof PLACES)[number];

export const MIN_GUIDE_STEPS = 3;
export const MAX_GUIDE_STEPS = 6;

export const isPlace = (v: unknown): v is PlaceId => typeof v === 'string' && (PLACES as readonly string[]).includes(v);

/** The steps of a place's tutorial in `language`, in order (keys `guide.<place>.step1` … without gaps). */
export function guideSteps(place: PlaceId, language: Language): string[] {
  if (!isPlace(place)) throw new RangeError(`unknown place ${String(place)}`);
  const steps: string[] = [];
  for (let i = 1; i <= MAX_GUIDE_STEPS; i++) {
    const key = `guide.${place}.step${i}`;
    if (!(key in MESSAGES[language])) break;
    steps.push(translate(language, key));
  }
  return steps;
}

export const placeName = (place: PlaceId, language: Language): string => translate(language, `guide.${place}.name`);
