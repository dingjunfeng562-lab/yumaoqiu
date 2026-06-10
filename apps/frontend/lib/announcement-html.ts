// 公告富文本工具：后台编辑器产出的 HTML 在前台用 innerHTML 渲染，
// 渲染前必须经过这里的白名单过滤（后端保存时也有同样的过滤，双保险）。
// 纯字符串实现，客户端 / 服务端组件都能用。

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

/** 判断公告内容是否为富文本 HTML（旧公告是纯文本，按原样式渲染） */
export function isRichAnnouncementContent(content: string) {
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(content);
}

/** 标签 + 属性白名单过滤，产出可安全 innerHTML 的字符串 */
export function sanitizeAnnouncementHtml(html: string) {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|textarea|title)\b[\s\S]*?<\/\1\s*>/gi, '');

  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g, (match, rawTag: string, rawAttrs: string) => {
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
  });

  return out;
}

/** 富文本转纯文本，用于列表 / 表格里的内容预览 */
export function announcementPlainText(content: string) {
  if (!isRichAnnouncementContent(content)) return content;
  return sanitizeAnnouncementHtml(content)
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
