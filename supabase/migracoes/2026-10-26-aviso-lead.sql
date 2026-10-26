-- danova AI — aviso ao corretor por e-mail quando um lead chega ou muda de corretor
create table if not exists public.avisos_lead (
  id bigint generated always as identity primary key,
  lead_id uuid references public.leads(id) on delete cascade,
  membro_id uuid references public.membros(id) on delete set null,
  canal text not null default 'email',
  destino text,
  motivo text,
  status text not null,            -- enviado | erro | sem_chave
  erro text,
  criado_em timestamptz not null default now()
);
alter table public.avisos_lead enable row level security;
drop policy if exists "admin le avisos" on public.avisos_lead;
create policy "admin le avisos" on public.avisos_lead for select to authenticated using ((select privado.eh_admin()));

-- token interno: o texto fica no Vault (criptografado); o hash, em privado.tokens_internos
do $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not exists (select 1 from vault.secrets where name = 'aviso_lead_token') then
    perform vault.create_secret(tok, 'aviso_lead_token', 'Token da função avisar-lead');
    insert into privado.tokens_internos(nome, hash) values ('avisar-lead', encode(extensions.digest(tok, 'sha256'), 'hex'))
    on conflict (nome) do update set hash = excluded.hash, criado_em = now();
  end if;
end $$;

create or replace function privado.avisar_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tok text;
begin
  if new.corretor_id is null and tg_op = 'UPDATE' then return new; end if;
  if tg_op = 'UPDATE' and new.corretor_id is not distinct from old.corretor_id then return new; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'aviso_lead_token';
  if tok is null then return new; end if;
  perform net.http_post(
    url := 'https://oeylfwasqvbnybzrwtgf.supabase.co/functions/v1/avisar-lead',
    body := jsonb_build_object('lead_id', new.id, 'motivo', case when tg_op = 'INSERT' then 'novo' else 'atribuido' end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-token-interno', tok),
    timeout_milliseconds := 20000);
  return new;
exception when others then
  return new; -- aviso nunca impede o lead de entrar
end $$;
revoke all on function privado.avisar_lead() from public, anon, authenticated;

drop trigger if exists e_lead_avisar on public.leads;
create trigger e_lead_avisar after insert or update of corretor_id on public.leads
  for each row execute function privado.avisar_lead();
