// RAG da danova: divide textos em trechos, gera embeddings (gte-small, 384 dimensões, roda no próprio
// Edge Runtime do Supabase — sem chave externa) e busca os trechos mais parecidos com a pergunta.
// O mesmo arquivo é copiado em atendente/, agente-crm/ e conhecimento/ (cada função é publicada sozinha).

// deno-lint-ignore no-explicit-any
declare const Supabase: any;
let sessao: any = null;

export async function embedding(texto: string): Promise<number[]> {
  if (!sessao) sessao = new Supabase.ai.Session("gte-small");
  const v = await sessao.run(texto.slice(0, 2000), { mean_pool: true, normalize: true });
  return Array.from(v as ArrayLike<number>);
}

/** Divide por parágrafos em trechos de ~900 caracteres com ~150 de sobreposição; o título vai em cada trecho. */
export function dividir(titulo: string, texto: string, tamanho = 900, sobra = 150): string[] {
  const limpo = texto.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!limpo) return [];
  const partes: string[] = [];
  let atual = "";
  for (const par of limpo.split(/\n\s*\n|\n(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9][^\n]{0,80}:)/)) {
    const p = par.trim();
    if (!p) continue;
    if ((atual + "\n" + p).length <= tamanho) { atual = atual ? atual + "\n" + p : p; continue; }
    if (atual) partes.push(atual);
    if (p.length <= tamanho) { atual = (atual ? atual.slice(-sobra) + " … " : "") + p; continue; }
    // parágrafo gigante: corta por frases
    let resto = p;
    while (resto.length > tamanho) {
      let corte = resto.lastIndexOf(". ", tamanho);
      if (corte < tamanho * 0.5) corte = tamanho;
      partes.push(resto.slice(0, corte + 1).trim());
      resto = resto.slice(Math.max(0, corte + 1 - sobra));
    }
    atual = resto.trim();
  }
  if (atual) partes.push(atual);
  return partes.map((t) => `[${titulo}]\n${t}`);
}

export type Trecho = { doc_id: string; titulo: string; categoria: string; texto: string; distancia: number };

// deno-lint-ignore no-explicit-any
export async function buscar(db: any, pergunta: string, quantidade = 6): Promise<Trecho[]> {
  const q = pergunta.trim();
  if (!q) return [];
  try {
    const v = await embedding(q);
    const { data, error } = await db.rpc("buscar_conhecimento", { consulta: JSON.stringify(v), quantidade, distancia_max: 0.55 });
    if (error) { console.error("rag", error.message); return []; }
    return (data ?? []) as Trecho[];
  } catch (e) { console.error("rag", e); return []; }
}

export function formatar(trechos: Trecho[]): string {
  if (!trechos.length) return "";
  return "\n# Base de conhecimento — trechos recuperados para esta pergunta (use só estas informações; se faltar algo, diga que a equipe confirma)\n" +
    trechos.map((t, i) => `(${i + 1}) ${t.texto}`).join("\n\n");
}
