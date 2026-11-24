-- Regressão transacional para projeto Supabase de TESTE, após schema.sql.
-- Execute no SQL Editor como postgres. Tudo é revertido ao final.
-- Os usuários abaixo são fixtures internas, sem senha e sem login utilizável.
begin;
insert into public.courses(id,name,credits) values('91000000-0000-0000-0000-000000000001','Curso de teste LAB03',120),('91000000-0000-0000-0000-000000000002','Outro curso de teste LAB03',80);
insert into auth.users(id,email,raw_user_meta_data) values
('91000000-0000-0000-0000-000000000011','lab03-aluno1@test.invalid','{"name":"Aluno teste um","role":"secretaria"}'),
('91000000-0000-0000-0000-000000000012','lab03-aluno2@test.invalid','{"name":"Aluno teste dois"}'),
('91000000-0000-0000-0000-000000000013','lab03-aluno3@test.invalid','{"name":"Aluno teste tres"}'),
('91000000-0000-0000-0000-000000000014','lab03-secretaria@test.invalid','{"name":"Secretaria teste"}'),
('91000000-0000-0000-0000-000000000015','lab03-professor@test.invalid','{"name":"Professor teste"}');
update public.profiles set course_id='91000000-0000-0000-0000-000000000001' where id::text like '91000000-%';
update public.profiles set role='secretaria' where id='91000000-0000-0000-0000-000000000014';
update public.profiles set role='professor' where id='91000000-0000-0000-0000-000000000015';
insert into public.subjects(id,course_id,code,name,credits)
select ('92000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'91000000-0000-0000-0000-000000000001','LAB03TEST'||n,'Disciplina teste '||n,4 from generate_series(1,6) n;
insert into public.semesters(id,name,enrollment_start,enrollment_end)
values('93000000-0000-0000-0000-000000000001','LAB03-TESTE',now()-interval '2 days',now()+interval '1 day');
insert into public.offerings(id,subject_id,semester_id,professor_id)
select ('94000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('92000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'93000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000015' from generate_series(1,6) n;

-- Asserção sem dependências externas. Falhas abortam a transação.
create function pg_temp.assert_true(p_condition boolean,p_message text) returns void language plpgsql as $$
begin if p_condition is distinct from true then raise exception 'FALHOU: %',p_message; end if; end $$;
create function pg_temp.expect_failure(p_sql text,p_message text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then return;
  end;
  raise exception 'FALHOU (ação deveria ser recusada): %',p_message;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000011',true);
select pg_temp.assert_true(public.app_role()='aluno','metadata não promove papel');
update public.profiles set role='secretaria' where id=auth.uid();
select pg_temp.assert_true(public.app_role()='aluno','aluno não promove a si mesmo');
select pg_temp.expect_failure($q$insert into public.enrollments(student_id,offering_id,kind) values(auth.uid(),'94000000-0000-0000-0000-000000000001','obrigatoria')$q$,'escrita direta bloqueada');
select pg_temp.expect_failure($q$select public.get_roster('94000000-0000-0000-0000-000000000001')$q$,'aluno não vê lista nominal');
select pg_temp.expect_failure($q$select public.save_enrollment('93000000-0000-0000-0000-000000000001','{}','{}')$q$,'exige quatro obrigatórias');
select public.save_enrollment('93000000-0000-0000-0000-000000000001',array['94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000002','94000000-0000-0000-0000-000000000003','94000000-0000-0000-0000-000000000004']::uuid[],array['94000000-0000-0000-0000-000000000005','94000000-0000-0000-0000-000000000006']::uuid[]);
select pg_temp.assert_true((select count(*)=6 from public.enrollments where student_id=auth.uid() and status='matriculada'),'matrícula 4+2 persistida');
select pg_temp.assert_true((select count(*)=1 from public.billing_events where student_id=auth.uid()),'notificação transacional criada');
select public.save_enrollment('93000000-0000-0000-0000-000000000001',array['94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000002','94000000-0000-0000-0000-000000000003','94000000-0000-0000-0000-000000000004']::uuid[],array['94000000-0000-0000-0000-000000000005','94000000-0000-0000-0000-000000000006']::uuid[]);
select pg_temp.assert_true((select count(*)=1 from public.billing_events where student_id=auth.uid()),'repetição não duplica cobrança');
select public.cancel_enrollment((select id from public.enrollments where student_id=auth.uid() and offering_id='94000000-0000-0000-0000-000000000006'));
select pg_temp.assert_true((select count(*)=5 from public.enrollments where student_id=auth.uid() and status='matriculada'),'cancelamento individual permitido');
select pg_temp.expect_failure($q$select public.mark_billing_sent((select id from public.billing_events where student_id=auth.uid() limit 1))$q$,'aluno não confirma entrega');

select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000012',true);
select pg_temp.assert_true((select count(*)=0 from public.enrollments),'matrículas de outro aluno privadas');
select public.save_enrollment('93000000-0000-0000-0000-000000000001',array['94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000002','94000000-0000-0000-0000-000000000003','94000000-0000-0000-0000-000000000004']::uuid[],'{}');
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000013',true);
select public.save_enrollment('93000000-0000-0000-0000-000000000001',array['94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000002','94000000-0000-0000-0000-000000000003','94000000-0000-0000-0000-000000000004']::uuid[],'{}');
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000015',true);
select pg_temp.assert_true((select count(*)=3 from public.get_roster('94000000-0000-0000-0000-000000000001')),'professor consulta seus três alunos');
select pg_temp.expect_failure($q$select public.close_semester('93000000-0000-0000-0000-000000000001')$q$,'professor não encerra semestre');

-- Preenche a oferta até sessenta e tenta a inscrição de um 61º aluno.
reset role;
insert into auth.users(id,email,raw_user_meta_data)
select ('95000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'lab03-vaga'||n||'@test.invalid',jsonb_build_object('name','Aluno vaga '||n) from generate_series(1,58) n;
update public.profiles set course_id='91000000-0000-0000-0000-000000000001' where id::text like '95000000-%';
insert into public.enrollments(student_id,offering_id,kind)
select ('95000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'94000000-0000-0000-0000-000000000001','obrigatoria' from generate_series(1,57) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','95000000-0000-0000-0000-000000000058',true);
select pg_temp.expect_failure($q$select public.save_enrollment('93000000-0000-0000-0000-000000000001',array['94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-000000000002','94000000-0000-0000-0000-000000000003','94000000-0000-0000-0000-000000000004']::uuid[],'{}')$q$,'recusa o 61º aluno');
select pg_temp.assert_true((select count(*)=0 from public.enrollments where student_id=auth.uid()),'falha por lotação não cria matrículas parciais');
select pg_temp.assert_true((select enrolled=60 from public.offering_catalog('93000000-0000-0000-0000-000000000001') where id='94000000-0000-0000-0000-000000000001'),'catálogo informa lotação de sessenta');
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000014',true);
select pg_temp.expect_failure($q$select public.close_semester('93000000-0000-0000-0000-000000000001')$q$,'não encerra antes do prazo');
select pg_temp.expect_failure($q$update public.offerings set capacity=61 where id='94000000-0000-0000-0000-000000000001'$q$,'teto de sessenta');
select pg_temp.expect_failure($q$update public.offerings set status='ativa' where id='94000000-0000-0000-0000-000000000001'$q$,'status depende de fechamento');
select pg_temp.expect_failure($q$update public.subjects set course_id='91000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000001'$q$,'disciplina com histórico não muda de curso');
select pg_temp.expect_failure($q$update public.profiles set role='aluno' where id='91000000-0000-0000-0000-000000000015'$q$,'professor atribuído não perde perfil');
select pg_temp.expect_failure($q$update public.profiles set course_id='91000000-0000-0000-0000-000000000002' where id='91000000-0000-0000-0000-000000000011'$q$,'aluno com matrícula ativa não muda de curso');
update public.courses set name='Curso de teste LAB03 atualizado' where id='91000000-0000-0000-0000-000000000001';
select pg_temp.assert_true((select name='Curso de teste LAB03 atualizado' from public.courses where id='91000000-0000-0000-0000-000000000001'),'renomear curso preserva vínculos e continua permitido');
update public.semesters set enrollment_end=now()-interval '1 second' where id='93000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000011',true);
select pg_temp.expect_failure($q$select public.cancel_enrollment((select id from public.enrollments where student_id=auth.uid() limit 1))$q$,'cancelamento bloqueado fora do prazo');
select set_config('request.jwt.claim.sub','91000000-0000-0000-0000-000000000014',true);
select pg_temp.assert_true(public.close_semester('93000000-0000-0000-0000-000000000001')='{"ativas":4,"canceladas":2}'::jsonb,'mínimo três ativa quatro e cancela duas');
select pg_temp.assert_true(not exists(select 1 from public.enrollments e join public.offerings o on o.id=e.offering_id where o.semester_id='93000000-0000-0000-0000-000000000001' and o.status='cancelada' and e.status='matriculada'),'cancelamento ajusta matrículas');
select pg_temp.assert_true((select count(*)=1 from public.billing_events where semester_id='93000000-0000-0000-0000-000000000001' and payload->>'event'='semester.adjusted'),'ajuste de cobrança para aluno afetado');
select pg_temp.expect_failure($q$update public.subjects set course_id='91000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000005'$q$,'histórico cancelado também impede mover disciplina de curso');
update public.profiles set course_id='91000000-0000-0000-0000-000000000002' where id='91000000-0000-0000-0000-000000000011';
select pg_temp.assert_true((select course_id='91000000-0000-0000-0000-000000000002' from public.profiles where id='91000000-0000-0000-0000-000000000011'),'histórico de semestres encerrados permite transferência posterior do aluno');
update public.profiles set role='aluno' where id='91000000-0000-0000-0000-000000000015';
select pg_temp.assert_true((select role='aluno' from public.profiles where id='91000000-0000-0000-0000-000000000015'),'atribuições de semestres encerrados permitem mudar perfil do professor');
select pg_temp.expect_failure($q$update public.semesters set closed=false where id='93000000-0000-0000-0000-000000000001'$q$,'semestre encerrado não reabre');
select public.mark_billing_sent((select id from public.billing_events where semester_id='93000000-0000-0000-0000-000000000001' limit 1));
select pg_temp.assert_true(exists(select 1 from public.billing_events where semester_id='93000000-0000-0000-0000-000000000001' and status='enviado' and sent_at is not null),'confirmação de entrega tem timestamp');
reset role;
rollback;
-- Sem exceções: todas as asserções passaram e nenhuma fixture foi mantida.
