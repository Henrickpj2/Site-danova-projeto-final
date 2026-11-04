-- Leads importados de planilha (canal = 'importacao') não geram evento "Lead" na fila de conversões (Meta/Google)
create or replace function public.lead_enfileirar_conversao() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.canal, '') <> 'importacao' then
      insert into public.conversoes(lead_id, evento) values (new.id, 'lead');
    end if;
  elsif new.etapa is distinct from old.etapa and new.etapa in ('qualificado','visita','proposta','contrato','fechado') then
    insert into public.conversoes(lead_id, evento, valor, moeda)
    values (new.id, new.etapa::text, case when new.etapa = 'fechado' then new.valor_estimado end, case when new.etapa = 'fechado' then 'USD' end);
  end if;
  return new;
end $$;
