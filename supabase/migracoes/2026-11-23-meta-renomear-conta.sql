-- Renomear conta de anúncios (nome do cliente) pelo CRM: admin renomeia qualquer uma; cliente só as da própria empresa.
create or replace function public.meta_renomear_conta(p_id uuid, p_nome text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_nome text := left(trim(coalesce(p_nome, '')), 120); v_ret record;
begin
  if v_nome = '' then raise exception 'nome_vazio'; end if;
  update public.contas_anuncio set nome = v_nome
   where id = p_id and (privado.eh_admin() or (conta_id is not null and conta_id = privado.minha_conta()))
   returning id, nome into v_ret;
  if not found then raise exception 'sem_acesso'; end if;
  return jsonb_build_object('id', v_ret.id, 'nome', v_ret.nome);
end $$;
revoke all on function public.meta_renomear_conta(uuid, text) from public, anon;
grant execute on function public.meta_renomear_conta(uuid, text) to authenticated;
