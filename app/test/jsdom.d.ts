// Minimal types for the part of jsdom the opener tests use (`@types/jsdom` is not a dependency).
declare module 'jsdom' {
  export interface ConstructorOptions {
    runScripts?: 'dangerously' | 'outside-only';
    url?: string;
    pretendToBeVisual?: boolean;
    beforeParse?(window: Window & typeof globalThis): void;
  }
  export class JSDOM {
    constructor(html?: string, options?: ConstructorOptions);
    readonly window: Window & typeof globalThis;
  }
}
