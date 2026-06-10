// 公告内容白名单过滤：后台富文本编辑器产出的 HTML 会在前台用 innerHTML
// 渲染，保存前必须过滤掉脚本、事件属性和危险链接，否则等于开放存储型 XSS。
// 前台渲染前还会再过滤一次（apps/frontend/lib/announcement-html.ts，同一套规则）。

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'u',
  'i',
  'em',
  's',
  'span',
  'a',
  'font',
  'div',
  'ul',
  'ol',
  'li',
]);

const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'font-weight',
  'font-size',
  'text-decoration',
  'text-align',
]);

function escapeAttr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function sanitizeStyle(style: string) {
  return style
    .split(';')
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx < 0) return null;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1).trim();
      if (!ALLOWED_STYLE_PROPS.has(prop)) return null;
      if (/url\s*\(|expression|javascript|@import/i.test(value)) return null;
      return `${prop}: ${value}`;
    })
    .filter(Boolean)
    .join('; ');
}

function sanitizeHref(href: string) {
  const trimmed = href.trim();
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return trimmed;
  }
  return null;
}

export function sanitizeAnnouncementContent(html: string) {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|textarea|title)\b[\s\S]*?<\/\1\s*>/gi, '');

  out = out.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g,
    (match, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (match.startsWith('</')) return `</${tag}>`;

      const attrs: string[] = [];
      const attrRe = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(rawAttrs))) {
        const name = m[1].toLowerCase();
        const value = m[2] ?? m[3] ?? m[4] ?? '';
        if (name === 'style') {
          const cleaned = sanitizeStyle(value);
          if (cleaned) attrs.push(`style="${escapeAttr(cleaned)}"`);
        } else if (name === 'color' && tag === 'font') {
          if (/^#?[a-zA-Z0-9(),.%\s-]+$/.test(value)) attrs.push(`color="${escapeAttr(value)}"`);
        } else if (name === 'href' && tag === 'a') {
          const safe = sanitizeHref(value);
          if (safe) {
            attrs.push(`href="${escapeAttr(safe)}"`);
            if (!safe.startsWith('/') && !safe.startsWith('#')) {
              attrs.push('target="_blank"', 'rel="noopener noreferrer"');
            }
          }
        }
      }
      return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
    },
  );

  return out;
}
