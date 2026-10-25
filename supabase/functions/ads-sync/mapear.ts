// Conversão das respostas das APIs do Google Ads e do Meta Ads para linhas de campanhas_metricas.
// Sem tipos TypeScript de propósito: o mesmo arquivo é testado no Node.

export function gaqlConsulta(desde, ate) {
  return "SELECT segments.date, campaign.name, customer.currency_code, metrics.impressions, metrics.clicks, metrics.cost_micros, " +
    "metrics.conversions, metrics.conversions_value, metrics.video_views, metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, " +
    "metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate FROM campaign " +
    "WHERE segments.date BETWEEN '" + desde + "' AND '" + ate + "' AND metrics.impressions > 0";
}

// resposta do googleAds:searchStream = lista de lotes { results: [...] }
export function mapearGoogle(lotes, contaExterna) {
  const linhas = [];
  for (const lote of lotes || []) {
    for (const r of lote.results || []) {
      const m = r.metrics || {}, imp = Number(m.impressions || 0);
      const q = (k) => Math.round(Number(m[k] || 0) * imp);
      linhas.push({
        data: r.segments && r.segments.date, plataforma: "google", conta_anuncio: contaExterna,
        campanha: (r.campaign && r.campaign.name || "Sem nome").slice(0, 300), conjunto: "",
        impressoes: imp, cliques: Number(m.clicks || 0), custo: Math.round(Number(m.costMicros || 0) / 10000) / 100,
        moeda: (r.customer && r.customer.currencyCode) === "USD" ? "USD" : "BRL",
        conversoes: Math.round(Number(m.conversions || 0) * 100) / 100, valor_conversoes: Math.round(Number(m.conversionsValue || 0) * 100) / 100,
        visualizacoes: Number(m.videoViews || 0),
        video_p25: q("videoQuartileP25Rate"), video_p50: q("videoQuartileP50Rate"), video_p75: q("videoQuartileP75Rate"), video_p100: q("videoQuartileP100Rate"),
        alcance: null, origem: "api",
      });
    }
  }
  return linhas;
}

const TIPOS_LEAD = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "onsite_conversion.messaging_conversation_started_7d", "offsite_conversion.fb_pixel_complete_registration"];
function somaAcoes(lista, tipos) {
  let total = 0;
  for (const a of lista || []) if (!tipos || tipos.includes(a.action_type)) total += Number(a.value || 0);
  return total;
}
function primeiroTipo(lista) { // evita contar o mesmo lead duas vezes (lead e lead_grouped)
  for (const t of TIPOS_LEAD) { const v = somaAcoes(lista, [t]); if (v) return v; }
  return 0;
}

export function camposMeta() {
  return "campaign_name,impressions,reach,clicks,inline_link_clicks,spend,actions,action_values,video_play_actions," +
    "video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions";
}

export function mapearMeta(dados, contaExterna, moeda) {
  return (dados || []).map((r) => ({
    data: r.date_start, plataforma: "meta", conta_anuncio: contaExterna,
    campanha: String(r.campaign_name || "Sem nome").slice(0, 300), conjunto: "",
    impressoes: Number(r.impressions || 0), cliques: Number(r.inline_link_clicks || r.clicks || 0),
    custo: Math.round(Number(r.spend || 0) * 100) / 100, moeda: moeda === "USD" ? "USD" : "BRL",
    conversoes: primeiroTipo(r.actions), valor_conversoes: Math.round(somaAcoes(r.action_values, ["offsite_conversion.fb_pixel_purchase", "purchase"]) * 100) / 100,
    visualizacoes: somaAcoes(r.video_play_actions),
    video_p25: somaAcoes(r.video_p25_watched_actions), video_p50: somaAcoes(r.video_p50_watched_actions),
    video_p75: somaAcoes(r.video_p75_watched_actions), video_p100: somaAcoes(r.video_p100_watched_actions),
    alcance: r.reach ? Number(r.reach) : null, origem: "api",
  }));
}

export function limparId(plataforma, id) {
  id = String(id || "").trim();
  if (plataforma === "google") return id.replace(/\D/g, "");
  return id.replace(/^act_/, "").replace(/\D/g, "");
}
