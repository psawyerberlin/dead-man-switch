// The five original line drawings of SPEC.md §8.
import { calendar } from './calendar';
import { envelope } from './envelope';
import { keys } from './keys';
import { letter } from './letter';
import { people } from './people';

export { calendar, envelope, keys, letter, people };
export const ILLUSTRATIONS = { letter, envelope, keys, people, calendar } as const;
export type IllustrationName = keyof typeof ILLUSTRATIONS;
