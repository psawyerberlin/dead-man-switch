// `import openerScript from 'virtual:dms-opener'` (vite.config.ts `dmsOpenerPlugin`): the built opener bundle as a
// string, for `setOpenerScript` in the app.
declare module 'virtual:dms-opener' {
  const script: string;
  export default script;
}

// `import vaults from 'virtual:dms-practice'` (vite.config.ts `dmsPracticePlugin`): the practice vaults of
// `#/open/demo`, built at build time, by language.
declare module 'virtual:dms-practice' {
  const vaults: Record<'en' | 'fr' | 'de', string>;
  export default vaults;
}
