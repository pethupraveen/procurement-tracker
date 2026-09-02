-- Secure STP report approval for the legacy PIN client.
-- Run once in Supabase SQL Editor after schema-pin-login-rollback.sql.
-- No browser role can read these tables; only Edge Functions use service_role.

begin;

create table if not exists public.report_approvals (
  id uuid primary key,
  code_hash text not null,
  request_ip_hash text not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  check (expires_at > requested_at)
);

create index if not exists report_approvals_ip_requested_at_idx
  on public.report_approvals (request_ip_hash, requested_at desc);

create table if not exists public.report_send_log (
  approval_id uuid primary key references public.report_approvals(id),
  status text not null check (status in ('sending', 'sent', 'failed')),
  recipient_count integer not null check (recipient_count > 0),
  resend_email_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.report_approvals enable row level security;
alter table public.report_send_log enable row level security;
revoke all on public.report_approvals from anon, authenticated;
revoke all on public.report_send_log from anon, authenticated;

create or replace function public.create_report_approval(
  p_id uuid, p_code_hash text, p_request_ip_hash text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.report_approvals
      where request_ip_hash = p_request_ip_hash
        and requested_at >= now() - interval '1 hour') >= 3 then
    return false;
  end if;

  insert into public.report_approvals (id, code_hash, request_ip_hash, expires_at)
  values (p_id, p_code_hash, p_request_ip_hash, now() + interval '10 minutes');
  return true;
end; $$;

create or replace function public.claim_report_approval(
  p_id uuid, p_code_hash text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare approval public.report_approvals%rowtype;
begin
  select * into approval from public.report_approvals where id = p_id for update;
  if not found or approval.consumed_at is not null or approval.expires_at <= now()
     or approval.attempts >= 5 then return false; end if;

  if approval.code_hash <> p_code_hash then
    update public.report_approvals set attempts = attempts + 1 where id = p_id;
    return false;
  end if;

  update public.report_approvals set consumed_at = now() where id = p_id;
  return true;
end; $$;

revoke all on function public.create_report_approval(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_report_approval(uuid, text) from public, anon, authenticated;
grant execute on function public.create_report_approval(uuid, text, text) to service_role;
grant execute on function public.claim_report_approval(uuid, text) to service_role;

commit;
