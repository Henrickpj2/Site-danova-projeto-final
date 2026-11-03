-- API de Conversões (leads de CRM): evento inicial "Lead" ao entrar no CRM + etapas. Aplicada em 03/11/2026.
create or replace function public.lead_enfileirar_conversao()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.conversoes(lead_id, evento) values (new.id, 'lead');
  elsif new.etapa is distinct from old.etapa and new.etapa in ('qualificado','visita','proposta','contrato','fechado') then
    insert into public.conversoes(lead_id, evento, valor, moeda)
    values (new.id, new.etapa::text, case when new.etapa = 'fechado' then new.valor_estimado end, case when new.etapa = 'fechado' then 'USD' end);
  end if;
  return new;
end $function$;
drop trigger if exists e_lead_conversao_inicial on public.leads;
create trigger e_lead_conversao_inicial after insert on public.leads for each row execute function public.lead_enfileirar_conversao();
update public.conversoes set status = 'ignorado', erro = 'teste anterior à integração com o Meta' where status = 'pendente';
