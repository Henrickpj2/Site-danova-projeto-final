-- Google Ads pelo integrador autorizado (Make · app Google Ads Reports), igual ao Meta:
-- CRM cadastra o ID da conta (123-456-7890) → banco chama o webhook do mesmo cenário Make com plataforma "google"
-- → Make lê o relatório de campanhas por dia → função meta-integrador grava em campanhas_metricas.

create or replace function public.google_registrar_conta(p_id text, p_nome text default null, p_cliente uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_dig text := regexp_replace(coalesce(p_id,''), '\D', '', 'g'); v_admin boolean := privado.eh_admin();
        v_conta uuid := case when privado.eh_admin() then p_cliente else privado.minha_conta() end; v_exist record; v_ret uuid; v_fmt text;
begin
  if not v_admin and v_conta is null then raise exception 'sem_conta_vinculada'; end if;
  if length(v_dig) <> 10 then raise exception 'id_invalido'; end if;
  v_fmt := substr(v_dig,1,3) || '-' || substr(v_dig,4,3) || '-' || substr(v_dig,7,4);
  select id, conta_id into v_exist from public.contas_anuncio where plataforma = 'google' and regexp_replace(coalesce(conta_externa,''), '\D', '', 'g') = v_dig;
  if found then
    if not v_admin and v_exist.conta_id is not null and v_exist.conta_id <> v_conta then raise exception 'conta_de_outro_cliente'; end if;
    update public.contas_anuncio set ativo = true, conta_id = coalesce(v_conta, conta_id), fonte_dados = 'integrador',
      situacao = case when ultima_sync is null then 'aguardando' else situacao end, nome = coalesce(nullif(trim(p_nome),''), nome)
      where id = v_exist.id returning id into v_ret;
  else
    insert into public.contas_anuncio(plataforma, conta_externa, nome, conta_id, nicho, fonte_dados, situacao, ativo, status)
    values ('google', v_fmt, coalesce(nullif(left(trim(p_nome),120),''), 'Google Ads ' || v_fmt), v_conta, 'outro', 'integrador', 'aguardando', true, 'ativa') returning id into v_ret;
  end if;
  return jsonb_build_object('id', v_ret, 'conta', v_fmt);
end $$;
revoke all on function public.google_registrar_conta(text, text, uuid) from public, anon;
grant execute on function public.google_registrar_conta(text, text, uuid) to authenticated;

create or replace function public.disparar_google_integrador(p_contas uuid[] default null, p_dias integer default 3)
returns bigint language plpgsql security definer set search_path to '' as $$
declare v_url text; v_contas jsonb; v_ate date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'make_meta_webhook';
  if v_url is null or v_url !~ '^https://hook\.[a-z0-9.]*make\.com/' then raise exception 'integrador_nao_configurado'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', regexp_replace(ca.conta_externa, '\D', '', 'g'), 'conta', ca.conta_externa)), '[]'::jsonb)
    into v_contas from public.contas_anuncio ca
   where ca.plataforma = 'google' and ca.ativo and ca.fonte_dados = 'integrador' and ca.conta_externa !~ '^000-000-'
     and (p_contas is null or ca.id = any(p_contas));
  if jsonb_array_length(v_contas) = 0 then return null; end if;
  return net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'plataforma', 'google',
      'token', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_integrador_token'),
      'retorno', 'https://oeylfwasqvbnybzrwtgf.supabase.co/functions/v1/meta-integrador',
      'desde', to_char(v_ate - (greatest(1, least(p_dias, 90)) - 1), 'YYYY-MM-DD'), 'ate', to_char(v_ate, 'YYYY-MM-DD'),
      'contas', v_contas),
    headers := jsonb_build_object('content-type', 'application/json'),
    timeout_milliseconds := 30000);
end $$;
revoke all on function public.disparar_google_integrador(uuid[], integer) from public, anon, authenticated;

-- atualização automática: 2x por dia (últimos 3 dias, inclui hoje) e domingo (últimos 30 dias).
-- Mais frequente que isso consome as operações do plano do Make; o botão "Atualizar agora" do CRM busca na hora.
select cron.unschedule(jobname) from cron.job where jobname in ('google-integrador-horario', 'google-integrador-diario', 'google-integrador-semanal');
select cron.schedule('google-integrador-diario', '40 9,21 * * *', $$select public.disparar_google_integrador(null, 3)$$);
select cron.schedule('google-integrador-semanal', '55 9 * * 0', $$select public.disparar_google_integrador(null, 30)$$);
