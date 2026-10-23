-- Run once in the Supabase SQL Editor. Safe to re-run; existing totals are retained.
-- New tables deliberately do not import the earlier seeded pilot counters.
create table if not exists public.safar_live_counts (
  namespace text not null, epoch text not null,
  metric text not null check(metric in ('participants','observations','contributions','groups')),
  value bigint not null default 0 check(value>=0),
  primary key(namespace,epoch,metric)
);
create table if not exists public.safar_count_events (
  namespace text not null, epoch text not null, id uuid not null,
  metric text not null check(metric in ('participants','observations','contributions','groups')),
  n integer not null check(n between 1 and 5), created_at timestamptz not null default now(),
  primary key(namespace,epoch,id)
);
create table if not exists public.safar_submissions (
  namespace text not null, id uuid not null,
  kind text not null check(kind in ('image','story','wording')),
  payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=16000),
  status text not null default 'pending' check(status in ('pending','approved','declined')),
  review_note text not null default '' check(length(review_note)<=1000),
  version integer not null default 0 check(version>=0),
  created_at timestamptz not null default now(), reviewed_at timestamptz,
  primary key(namespace,id)
);
create index if not exists safar_submissions_inbox on public.safar_submissions(namespace,status,created_at desc,id desc);
alter table public.safar_live_counts enable row level security;
alter table public.safar_count_events enable row level security;
alter table public.safar_submissions enable row level security;
revoke all on public.safar_live_counts, public.safar_count_events, public.safar_submissions from public,anon,authenticated;
grant select,insert,update,delete on public.safar_live_counts, public.safar_count_events, public.safar_submissions to service_role;
create or replace function public.safar_record_pulse(p_namespace text,p_epoch text,p_id uuid,p_metric text,p_n integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare added uuid; prior_metric text; prior_n integer; result jsonb;
begin
  if length(p_namespace) not between 1 and 160 or length(p_epoch) not between 1 and 160 or p_metric not in ('participants','observations','contributions','groups') or p_n not between 1 and 5 then raise exception 'Invalid event'; end if;
  insert into public.safar_count_events(namespace,epoch,id,metric,n) values(p_namespace,p_epoch,p_id,p_metric,p_n)
  on conflict do nothing returning id into added;
  if added is not null then
    insert into public.safar_live_counts(namespace,epoch,metric,value) values(p_namespace,p_epoch,p_metric,p_n)
    on conflict(namespace,epoch,metric) do update set value=safar_live_counts.value+excluded.value;
  else
    select metric,n into prior_metric,prior_n from public.safar_count_events where namespace=p_namespace and epoch=p_epoch and id=p_id;
    if prior_metric<>p_metric or prior_n<>p_n then raise exception 'Event ID conflict'; end if;
  end if;
  select jsonb_object_agg(metric,value) into result from public.safar_live_counts where namespace=p_namespace and epoch=p_epoch;
  return '{"participants":0,"observations":0,"contributions":0,"groups":0}'::jsonb || coalesce(result,'{}'::jsonb);
end $$;
revoke all on function public.safar_record_pulse(text,text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.safar_record_pulse(text,text,uuid,text,integer) to service_role;
notify pgrst,'reload schema';
