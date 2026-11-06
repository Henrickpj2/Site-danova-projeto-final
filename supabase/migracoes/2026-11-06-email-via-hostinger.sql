-- Central de E-mails: envio pelo próprio e-mail da Hostinger (sem provedor externo).
-- Novo status "enviando" (reservado pela função antes de o servidor do site disparar o e-mail).
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'public.email_sends'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%';
  if c is not null then execute 'alter table public.email_sends drop constraint ' || quote_ident(c); end if;
end $$;
alter table public.email_sends add constraint email_sends_status_check
  check (status in ('pendente','enviando','enviado','entregue','aberto','clicado','atrasado','rejeitado','reclamacao','falhou'));
alter table public.email_sends alter column provedor set default 'hostinger';
