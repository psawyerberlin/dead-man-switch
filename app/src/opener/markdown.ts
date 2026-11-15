// Safe Markdown for letters (SPEC.md §3.3.4): `marked` renders, raw HTML is shown as text, images become their
// alt text (nothing is loaded from the network), and DOMPurify keeps only a fixed set of tags; links keep `http(s)`
// and `mailto` only and get `rel="noopener noreferrer"`.
import createDOMPurify, { type DOMPurify } from 'dompurify';
import { Marked } from 'marked';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    // raw HTML in a letter is text, never markup
    html: ({ text }) => escapeHtml(text),
    // no images from the network: show the alt text
    image: ({ text }) => escapeHtml(text),
  },
});

export const ALLOWED_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'em', 'strong', 'del', 's', 'ul', 'ol', 'li',
  'a', 'code', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'];
export const ALLOWED_ATTR = ['href', 'title', 'start', 'align', 'type', 'checked', 'disabled'];
export const ALLOWED_URI = /^(?:https?:|mailto:)/i;

const instances = new WeakMap<object, DOMPurify>();

function purifier(win: Window): DOMPurify {
  let p = instances.get(win);
  if (!p) {
    p = createDOMPurify(win as unknown as Parameters<typeof createDOMPurify>[0]);
    p.addHook('afterSanitizeAttributes', (node) => {
      const el = node as Element;
      if (el.nodeName === 'A') {
        if (el.hasAttribute('href')) { el.setAttribute('rel', 'noopener noreferrer'); el.setAttribute('target', '_blank'); }
      } else if (el.nodeName === 'INPUT') {
        // only the disabled check boxes of task lists
        if ((el.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') el.remove();
        else el.setAttribute('disabled', '');
      }
    });
    instances.set(win, p);
  }
  return p;
}

/** Markdown → sanitised HTML string. */
export function markdownToSafeHtml(markdown: string, win: Window): string {
  const html = marked.parse(markdown) as string;
  return purifier(win).sanitize(html, {
    ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP: ALLOWED_URI, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true, RETURN_TRUSTED_TYPE: false,
  }) as string;
}

/** Renders `markdown` into `target` (replacing its content). */
export function renderMarkdown(markdown: string, target: Element, win: Window): void {
  target.innerHTML = markdownToSafeHtml(markdown, win);
}
