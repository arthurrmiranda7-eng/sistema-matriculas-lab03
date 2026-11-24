-- Currículo fictício para apresentação. Não cria usuários ou senhas.
-- Pode ser executado novamente: os IDs fixos preservam os vínculos existentes.
insert into public.courses(id,name,credits) values
('10000000-0000-0000-0000-000000000001','Engenharia de Software',240)
on conflict(id) do nothing;

insert into public.subjects(id,course_id,code,name,credits) values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','ES101','Desenvolvimento de Interfaces Web',4),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','ES102','Algoritmos e Estruturas de Dados',4),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','ES103','Engenharia de Requisitos',4),
('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','ES104','Banco de Dados',4),
('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','ES105','Interação Humano-Computador',4),
('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','ES106','Arquitetura de Computadores',4),
('20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','ES107','Matemática Discreta',4),
('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','ES108','Fundamentos de Redes',4)
on conflict(id) do nothing;

insert into public.semesters(id,name,enrollment_start,enrollment_end) values
('30000000-0000-0000-0000-000000000001','2027.1',now()-interval '1 day',now()+interval '30 days')
on conflict(id) do nothing;

insert into public.offerings(id,subject_id,semester_id)
select ('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
       ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
       '30000000-0000-0000-0000-000000000001'::uuid
from generate_series(1,8) n
where not exists(select 1 from public.offerings o where o.id=('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid)
on conflict(id) do nothing;

-- Após criar usuários com e-mail e senha via Authentication > Users,
-- ajuste os e-mails abaixo e execute somente as linhas necessárias:
-- update public.profiles set role='secretaria' where email='secretaria@universidade.edu.br';
-- update public.profiles set role='professor' where email='professor@universidade.edu.br';
-- update public.profiles set course_id='10000000-0000-0000-0000-000000000001'
--   where email='aluno@universidade.edu.br';
-- update public.offerings set professor_id=(select id from public.profiles where email='professor@universidade.edu.br')
--   where semester_id='30000000-0000-0000-0000-000000000001';
