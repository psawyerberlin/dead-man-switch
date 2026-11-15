// `import openerScript from 'virtual:dms-opener'` (vite.config.ts `dmsOpenerPlugin`): the built opener bundle as a
// string, for `setOpenerScript` in the app.
declare module 'virtual:dms-opener' {
  const script: string;
  export default script;
}
