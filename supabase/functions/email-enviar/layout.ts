// Layout do e-mail da DANOVA-AI (tabelas e estilos inline para funcionar em Gmail, Outlook e Apple Mail).
export const LOGO = "https://danova-ai.com/img/danova-logo-email.png";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function emailValido(e: string) {
  return /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i.test(String(e || "").trim()) && String(e).length <= 200;
}

/** Troca {{variavel}}. Em HTML, o valor entra escapado; dentro de href só vale URL http(s)/mailto. */
export function substituir(texto: string, vars: Record<string, string>, html: boolean) {
  return texto.replace(/(href\s*=\s*["'])?\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, href, nome) => {
    const v = vars[nome.toLowerCase()] ?? "";
    if (href) return href + (/^(https?:\/\/|mailto:)/i.test(v) ? esc(v) : "#");
    return html ? esc(v) : v;
  });
}

/** Mantém só formatação simples; remove scripts, estilos, eventos e links perigosos. */
export function limparHtml(h: string) {
  let s = String(h || "");
  s = s.replace(/<(script|style|iframe|object|embed|form|button|textarea|select|svg|math|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  s = s.replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|svg|math|meta|link|base|noscript|template)\b[^>]*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/\s(style|class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/(href|src)\s*=\s*(["'])\s*(javascript|data|vbscript):[^"']*\2/gi, '$1="#"');
  // só estas tags ficam
  s = s.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag, attrs) => {
    const t = tag.toLowerCase();
    const ok = ["p", "br", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li", "h2", "h3", "small", "img", "div", "span", "blockquote", "hr"];
    if (!ok.includes(t)) return "";
    if (m.startsWith("</")) return "</" + t + ">";
    if (t === "a") { const href = (attrs.match(/href\s*=\s*["']([^"']*)["']/i) || [])[1] || "#"; return '<a href="' + href.replace(/"/g, "") + '" target="_blank" style="color:#8C6D35;font-weight:600">'; }
    if (t === "img") { const src = (attrs.match(/src\s*=\s*["']([^"']*)["']/i) || [])[1] || ""; if (!/^https:\/\//i.test(src)) return ""; const alt = (attrs.match(/alt\s*=\s*["']([^"']*)["']/i) || [])[1] || ""; return '<img src="' + src.replace(/"/g, "") + '" alt="' + alt.replace(/"/g, "") + '" style="max-width:100%;height:auto;border:0;display:block;margin:12px 0">'; }
    return "<" + t + ">";
  });
  return s;
}

const ESTILO: Record<string, string> = {
  p: "margin:0 0 14px;font-size:15px;line-height:1.65;color:#24313A",
  li: "margin:0 0 6px;font-size:15px;line-height:1.6;color:#24313A",
  ul: "margin:0 0 16px;padding-left:20px", ol: "margin:0 0 16px;padding-left:20px",
  h2: "margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#142B3C;font-weight:600",
  h3: "margin:0 0 10px;font-size:17px;color:#142B3C", small: "font-size:12px;color:#6b7680",
  blockquote: "margin:0 0 14px;padding:10px 14px;border-left:3px solid #C6A66B;background:#F7F4EE;color:#24313A",
  hr: "border:0;border-top:1px solid #E9E3D8;margin:18px 0",
};
function estilizar(h: string) {
  return h.replace(/<(p|li|ul|ol|h2|h3|small|blockquote|hr)>/g, (_m, t) => "<" + t + ' style="' + ESTILO[t] + '">');
}

export function montarEmail(o: { corpoHtml: string; assinante: { nome?: string; email?: string; telefone?: string }; descadastro: string; previa?: boolean }) {
  const corpo = estilizar(limparHtml(o.corpoHtml));
  const a = o.assinante || {};
  const assinatura = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid #E9E3D8;padding-top:16px;width:100%"><tr><td style="font-size:14px;line-height:1.55;color:#24313A">
    <strong style="color:#142B3C">${esc(a.nome || "Equipe DANOVA-AI")}</strong><br>
    <span style="color:#8C6D35">DANOVA-AI · Real Estate Intelligence</span><br>
    ${a.telefone ? esc(a.telefone) + " · " : ""}WhatsApp +1 (786) 382-6782<br>
    <a href="mailto:${esc(a.email || "danova-ai@danova-ai.com")}" style="color:#8C6D35">${esc(a.email || "danova-ai@danova-ai.com")}</a> · <a href="https://danova-ai.com/" style="color:#8C6D35">danova-ai.com</a>
  </td></tr></table>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>DANOVA-AI</title></head>
<body style="margin:0;padding:0;background:#F2EFEA">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2EFEA;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
  <tr><td style="background:#142B3C;padding:22px 28px" align="left"><img src="${LOGO}" width="180" alt="DANOVA-AI" style="display:block;border:0;width:180px;height:auto"></td></tr>
  <tr><td style="height:3px;background:#C6A66B;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td style="padding:30px 28px 26px">${corpo}${assinatura}</td></tr>
  <tr><td style="background:#F7F7F5;padding:16px 28px;font-size:11.5px;line-height:1.6;color:#6b7680">
    Você recebeu este e-mail porque teve contato com a DANOVA-AI. Se não quiser receber mais comunicações comerciais,
    <a href="${esc(o.descadastro)}" style="color:#6b7680">clique aqui para se descadastrar</a>.<br>DANOVA-AI · Miami, Flórida
  </td></tr>
</table></td></tr></table></body></html>`;
}
