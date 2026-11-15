/* Applies the remembered theme before the first paint (same key as src/ui/theme.ts). A file, not an inline
   script, so the CSP can forbid inline scripts. */
try { var th = localStorage.getItem('dms.theme'); if (th === 'light' || th === 'dark') document.documentElement.setAttribute('data-theme', th); } catch (e) { /* no storage */ }
