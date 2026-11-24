-- Execute uma vez no SQL Editor de um projeto Supabase novo.
-- Todas as regras de matrícula são aplicadas no PostgreSQL, além da interface.
create extension if not exists pgcrypto;

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 120),
  credits integer not null check (credits > 0)
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  email text not null,
  role text not null default 'aluno' check (role in ('aluno','professor','secretaria')),
  course_id uuid references public.courses(id)
);
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  code text not null unique check (length(trim(code)) between 2 and 20),
  name text not null check (length(trim(name)) between 2 and 120),
  credits integer not null check (credits > 0)
);
create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 2 and 40),
  enrollment_start timestamptz not null,
  enrollment_end timestamptz not null,
  closed boolean not null default false,
  check (enrollment_end > enrollment_start)
);
create table public.offerings (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id),
  semester_id uuid not null references public.semesters(id),
  professor_id uuid references public.profiles(id),
  status text not null default 'aberta' check (status in ('aberta','ativa','cancelada')),
  capacity integer not null default 60 check (capacity between 3 and 60),
  unique (subject_id,semester_id)
);
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  offering_id uuid not null references public.offerings(id),
  kind text not null check (kind in ('obrigatoria','optativa')),
  status text not null default 'matriculada' check (status in ('matriculada','cancelada')),
  created_at timestamptz not null default now(),
  unique (student_id,offering_id)
);
create index enrollments_offering_status_idx on public.enrollments(offering_id,status);
create index offerings_semester_idx on public.offerings(semester_id);
create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  semester_id uuid not null references public.semesters(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente','enviado')),
  sent_at timestamptz
);

-- Papéis vêm de profiles, nunca de metadados editáveis pelo próprio usuário.
create function public.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;
create function public.handle_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.profiles(id,name,email)
    values (new.id, left(case when length(trim(coalesce(new.raw_user_meta_data->>'name',''))) >= 2 then trim(new.raw_user_meta_data->>'name') else 'Aluno' end,120), coalesce(new.email,''));
  else
    update public.profiles set email = coalesce(new.email,'') where id = new.id;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_auth_user();
create trigger on_auth_user_email_updated after update of email on auth.users
for each row execute function public.handle_auth_user();

-- Evita alterações administrativas que invalidem uma matrícula já existente.
create function public.guard_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role='professor' and new.role<>'professor' and exists(select 1 from public.offerings o join public.semesters s on s.id=o.semester_id where o.professor_id=old.id and not s.closed) then
    raise exception 'Remova as atribuições em semestres não encerrados antes de alterar o perfil do professor.';
  end if;
  if new.course_id is distinct from old.course_id and exists(select 1 from public.enrollments e join public.offerings o on o.id=e.offering_id join public.semesters s on s.id=o.semester_id where e.student_id=old.id and e.status='matriculada' and not s.closed) then
    raise exception 'Cancele as matrículas em semestres não encerrados antes de transferir o aluno de curso.';
  end if;
  return new;
end $$;
create trigger validate_profile before update on public.profiles
for each row execute function public.guard_profile();

create function public.guard_subject() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.course_id is distinct from old.course_id then
    -- Serializa a mudança com novas matrículas em qualquer oferta desta disciplina.
    perform 1 from public.semesters s where exists(select 1 from public.offerings o where o.semester_id=s.id and o.subject_id=old.id) order by s.id for update;
    if exists(select 1 from public.enrollments e join public.offerings o on o.id=e.offering_id where o.subject_id=old.id) then
      raise exception 'Uma disciplina com histórico de matrículas não pode mudar de curso.';
    end if;
  end if;
  return new;
end $$;
create trigger validate_subject before update on public.subjects
for each row execute function public.guard_subject();

create function public.guard_offering() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_closed boolean; v_professor_role text;
begin
  if TG_OP = 'UPDATE' and (new.semester_id <> old.semester_id or new.subject_id <> old.subject_id) then
    if exists(select 1 from public.enrollments where offering_id = old.id) then
      raise exception 'Uma oferta com histórico de matrícula não pode mudar de disciplina ou semestre.';
    end if;
  end if;
  select closed into v_closed from public.semesters where id = new.semester_id for update;
  if TG_OP = 'INSERT' and new.status <> 'aberta' then
    raise exception 'Novas ofertas devem iniciar abertas.';
  end if;
  if TG_OP = 'UPDATE' and new.status <> old.status and current_setting('app.closing_semester', true) is distinct from new.semester_id::text then
    raise exception 'O status da oferta é definido pelo encerramento do semestre.';
  end if;
  if v_closed and (TG_OP = 'INSERT' or new.status = 'aberta') then
    raise exception 'O semestre já foi encerrado.';
  end if;
  if new.professor_id is not null then
    -- Impede uma atribuição concorrente à remoção do perfil de professor.
    select role into v_professor_role from public.profiles where id=new.professor_id for share;
    if v_professor_role is distinct from 'professor' then
      raise exception 'Selecione um usuário com perfil de professor.';
    end if;
  end if;
  if new.capacity < (select count(*) from public.enrollments where offering_id = new.id and status = 'matriculada') then
    raise exception 'A capacidade não pode ser menor que o número de matriculados.';
  end if;
  return new;
end $$;
create trigger validate_offering before insert or update on public.offerings
for each row execute function public.guard_offering();

create function public.guard_semester() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.closed and (not new.closed or new.enrollment_start <> old.enrollment_start or new.enrollment_end <> old.enrollment_end) then
    raise exception 'Não é permitido reabrir ou alterar o período de um semestre encerrado.';
  end if;
  -- O fechamento precisa passar pelo procedimento que aplica mínimo e cancelamentos.
  if not old.closed and new.closed and current_setting('app.closing_semester', true) is distinct from old.id::text then
    raise exception 'Utilize a ação Encerrar semestre.';
  end if;
  return new;
end $$;
create trigger validate_semester before update on public.semesters
for each row execute function public.guard_semester();

-- Snapshot transacional: o consumidor de cobranças deve tratar id como chave de idempotência.
create function public.enqueue_billing(p_student_id uuid,p_semester_id uuid,p_event text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.billing_events(student_id,semester_id,payload)
  select p_student_id,p_semester_id,jsonb_build_object(
    'event',p_event,'student_id',p_student_id,'semester_id',p_semester_id,
    'offerings',coalesce(jsonb_agg(jsonb_build_object('offering_id',o.id,'subject',s.name,'code',s.code,'credits',s.credits,'kind',e.kind) order by s.code) filter(where e.id is not null),'[]'::jsonb),
    'total_credits',coalesce(sum(s.credits),0))
  from public.enrollments e
  join public.offerings o on o.id=e.offering_id
  join public.subjects s on s.id=o.subject_id
  where e.student_id=p_student_id and o.semester_id=p_semester_id and e.status='matriculada';
end $$;

create function public.save_enrollment(p_semester_id uuid,p_required uuid[],p_optional uuid[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_student uuid := auth.uid(); v_course uuid; v_sem public.semesters;
  v_all uuid[]; v_before jsonb; v_after jsonb; v_id uuid;
begin
  if public.app_role() is distinct from 'aluno' then raise exception 'Somente alunos podem realizar matrículas.'; end if;
  p_required := coalesce(p_required,'{}'); p_optional := coalesce(p_optional,'{}');
  if cardinality(p_required) <> 4 or cardinality(p_optional) > 2 then
    raise exception 'Selecione exatamente 4 disciplinas obrigatórias e até 2 optativas.';
  end if;
  v_all := p_required || p_optional;
  if cardinality(v_all) <> (select count(distinct x) from unnest(v_all) x) then
    raise exception 'Uma disciplina não pode aparecer mais de uma vez.';
  end if;
  -- Todas as mutações de matrícula bloqueiam primeiro o semestre: vagas, aluno e fechamento são atômicos.
  select * into v_sem from public.semesters where id=p_semester_id for update;
  if not found then raise exception 'Semestre não encontrado.'; end if;
  if v_sem.closed or now() < v_sem.enrollment_start or now() >= v_sem.enrollment_end then
    raise exception 'O período de matrículas está fechado.';
  end if;
  select course_id into v_course from public.profiles where id=v_student for update;
  if v_course is null then raise exception 'Solicite à secretaria a vinculação ao seu curso.'; end if;
  perform 1 from public.offerings where id=any(v_all) order by id for update;
  if (select count(*) from public.offerings o join public.subjects s on s.id=o.subject_id
      where o.id=any(v_all) and o.semester_id=p_semester_id and o.status='aberta' and s.course_id=v_course) <> cardinality(v_all) then
    raise exception 'Selecione apenas ofertas abertas do seu curso e deste semestre.';
  end if;
  if exists(select 1 from public.offerings o where o.id=any(v_all) and
      (select count(*) from public.enrollments e where e.offering_id=o.id and e.status='matriculada' and e.student_id<>v_student) >= o.capacity) then
    raise exception 'Uma das disciplinas ficou sem vagas. Atualize a lista e tente novamente.';
  end if;
  select coalesce(jsonb_object_agg(e.offering_id::text,e.kind),'{}'::jsonb) into v_before
  from public.enrollments e join public.offerings o on o.id=e.offering_id
  where e.student_id=v_student and o.semester_id=p_semester_id and e.status='matriculada';
  select jsonb_object_agg(x::text,case when x=any(p_required) then 'obrigatoria' else 'optativa' end) into v_after from unnest(v_all) x;
  if v_before = v_after then return jsonb_build_object('changed',false); end if;
  update public.enrollments e set status='cancelada' from public.offerings o
  where e.offering_id=o.id and o.semester_id=p_semester_id and e.student_id=v_student and e.status='matriculada';
  foreach v_id in array v_all loop
    insert into public.enrollments(student_id,offering_id,kind,status)
    values(v_student,v_id,case when v_id=any(p_required) then 'obrigatoria' else 'optativa' end,'matriculada')
    on conflict(student_id,offering_id) do update set kind=excluded.kind,status='matriculada';
  end loop;
  perform public.enqueue_billing(v_student,p_semester_id,'enrollment.updated');
  return jsonb_build_object('changed',true);
end $$;

create function public.cancel_enrollment(p_enrollment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sem public.semesters; v_en public.enrollments; v_sem_id uuid;
begin
  if public.app_role() is distinct from 'aluno' then raise exception 'Somente alunos podem cancelar suas matrículas.'; end if;
  select o.semester_id into v_sem_id from public.enrollments e join public.offerings o on o.id=e.offering_id
    where e.id=p_enrollment_id and e.student_id=auth.uid();
  if not found then raise exception 'Matrícula não encontrada.'; end if;
  select * into v_sem from public.semesters where id=v_sem_id for update;
  if v_sem.closed or now() < v_sem.enrollment_start or now() >= v_sem.enrollment_end then raise exception 'O período de matrículas está fechado.'; end if;
  select * into v_en from public.enrollments where id=p_enrollment_id and student_id=auth.uid() for update;
  if v_en.status='cancelada' then return; end if;
  update public.enrollments set status='cancelada' where id=p_enrollment_id;
  perform public.enqueue_billing(auth.uid(),v_sem_id,'enrollment.cancelled');
end $$;

create function public.close_semester(p_semester_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sem public.semesters; v_student uuid; v_cancelled uuid[]; v_active integer; v_cancel integer;
begin
  if public.app_role() is distinct from 'secretaria' then raise exception 'Apenas a secretaria pode encerrar o semestre.'; end if;
  select * into v_sem from public.semesters where id=p_semester_id for update;
  if not found then raise exception 'Semestre não encontrado.'; end if;
  if v_sem.closed then raise exception 'O semestre já foi encerrado.'; end if;
  if now() < v_sem.enrollment_end then raise exception 'Aguarde o término do período de matrículas.'; end if;
  perform 1 from public.offerings where semester_id=p_semester_id order by id for update;
  select coalesce(array_agg(o.id),'{}') into v_cancelled from public.offerings o
    where o.semester_id=p_semester_id and (select count(*) from public.enrollments e where e.offering_id=o.id and e.status='matriculada') < 3;
  perform set_config('app.closing_semester',p_semester_id::text,true);
  update public.offerings set status=case when id=any(v_cancelled) then 'cancelada' else 'ativa' end where semester_id=p_semester_id;
  -- Registra ajustes somente para alunos afetados por cancelamento de ofertas.
  for v_student in select distinct student_id from public.enrollments where offering_id=any(v_cancelled) and status='matriculada' loop
    update public.enrollments set status='cancelada' where student_id=v_student and offering_id=any(v_cancelled) and status='matriculada';
    perform public.enqueue_billing(v_student,p_semester_id,'semester.adjusted');
  end loop;
  perform set_config('app.closing_semester',p_semester_id::text,true);
  update public.semesters set closed=true where id=p_semester_id;
  select count(*) filter(where status='ativa'),count(*) filter(where status='cancelada') into v_active,v_cancel from public.offerings where semester_id=p_semester_id;
  return jsonb_build_object('ativas',v_active,'canceladas',v_cancel);
end $$;

create function public.offering_catalog(p_semester_id uuid)
returns table(id uuid,subject_id uuid,subject_name text,code text,credits integer,course_id uuid,professor_name text,professor_id uuid,status text,capacity integer,enrolled bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Faça login para consultar o currículo.'; end if;
  return query select o.id,s.id,s.name,s.code,s.credits,s.course_id,p.name,o.professor_id,o.status,o.capacity,
    (select count(*) from public.enrollments e where e.offering_id=o.id and e.status='matriculada')
  from public.offerings o join public.subjects s on s.id=o.subject_id left join public.profiles p on p.id=o.professor_id
  where o.semester_id=p_semester_id order by s.code;
end $$;

create function public.get_roster(p_offering_id uuid)
returns table(student_id uuid,name text,email text,kind text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.app_role() is distinct from 'secretaria' and not (public.app_role()='professor' and exists(select 1 from public.offerings where id=p_offering_id and professor_id=auth.uid())) then
    raise exception 'Você não tem acesso à lista desta disciplina.';
  end if;
  return query select p.id,p.name,p.email,e.kind from public.enrollments e join public.profiles p on p.id=e.student_id
    where e.offering_id=p_offering_id and e.status='matriculada' order by p.name;
end $$;

create function public.mark_billing_sent(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.app_role() is distinct from 'secretaria' then raise exception 'Apenas a secretaria pode registrar a entrega da notificação.'; end if;
  update public.billing_events set status='enviado',sent_at=coalesce(sent_at,now()) where id=p_event_id;
  if not found then raise exception 'Notificação não encontrada.'; end if;
end $$;

alter table public.courses enable row level security;
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.semesters enable row level security;
alter table public.offerings enable row level security;
alter table public.enrollments enable row level security;
alter table public.billing_events enable row level security;
create policy courses_read on public.courses for select to authenticated using(true);
create policy courses_admin on public.courses for all to authenticated using(public.app_role()='secretaria') with check(public.app_role()='secretaria');
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.app_role()='secretaria');
create policy profiles_admin_update on public.profiles for update to authenticated using(public.app_role()='secretaria') with check(public.app_role()='secretaria');
create policy subjects_read on public.subjects for select to authenticated using(true);
create policy subjects_admin on public.subjects for all to authenticated using(public.app_role()='secretaria') with check(public.app_role()='secretaria');
create policy semesters_read on public.semesters for select to authenticated using(true);
create policy semesters_admin on public.semesters for all to authenticated using(public.app_role()='secretaria') with check(public.app_role()='secretaria');
create policy offerings_read on public.offerings for select to authenticated using(true);
create policy offerings_admin on public.offerings for all to authenticated using(public.app_role()='secretaria') with check(public.app_role()='secretaria');
create policy enrollments_read on public.enrollments for select to authenticated using(student_id=auth.uid() or public.app_role()='secretaria');
create policy billing_events_read on public.billing_events for select to authenticated using(student_id=auth.uid() or public.app_role()='secretaria');

-- Escrita de matrículas e eventos existe somente pelos procedimentos acima.
revoke all on public.courses,public.profiles,public.subjects,public.semesters,public.offerings,public.enrollments,public.billing_events from anon,authenticated;
grant select on public.courses,public.profiles,public.subjects,public.semesters,public.offerings,public.enrollments,public.billing_events to authenticated;
grant insert,update,delete on public.courses,public.subjects,public.semesters,public.offerings to authenticated;
grant update(name,role,course_id) on public.profiles to authenticated;
revoke all on function public.app_role(),public.handle_auth_user(),public.guard_profile(),public.guard_subject(),public.guard_offering(),public.guard_semester(),public.enqueue_billing(uuid,uuid,text),public.save_enrollment(uuid,uuid[],uuid[]),public.cancel_enrollment(uuid),public.close_semester(uuid),public.offering_catalog(uuid),public.get_roster(uuid),public.mark_billing_sent(uuid) from public,anon,authenticated;
grant execute on function public.app_role(),public.save_enrollment(uuid,uuid[],uuid[]),public.cancel_enrollment(uuid),public.close_semester(uuid),public.offering_catalog(uuid),public.get_roster(uuid),public.mark_billing_sent(uuid) to authenticated;
