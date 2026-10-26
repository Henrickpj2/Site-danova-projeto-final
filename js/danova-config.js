/* ÚNICO lugar para configurar a medição do site (Google e Meta).
 * Use UMA das duas formas:
 *   A) Só o Google Tag Manager: preencha GTM_ID e configure GA4 e Pixel dentro do GTM.
 *   B) Direto, sem GTM: preencha GA4_ID e/ou META_PIXEL_ID e deixe GTM_ID vazio.
 * Campo vazio = nada daquele serviço é carregado. Tudo respeita o banner de cookies (LGPD). */
window.DANOVA_CONFIG = {
  GTM_ID: '',          // ex.: 'GTM-ABC1234'
  GA4_ID: '',          // ex.: 'G-ABC123XYZ9'
  META_PIXEL_ID: ''    // ex.: '123456789012345'
};
