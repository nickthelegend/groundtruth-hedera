-- Claim hardening — make the worker path robust.
--
-- Two fixes vs the original claim_task:
--  1. Do NOT collapse the task's expires_at on claim. The original set
--     expires_at = least(expires_at, claim_deadline), which destroyed a task's
--     real deadline (e.g. a long-lived task dropped to +30 min the moment it was
--     claimed). Claim tracking belongs in claimed_at, not the task deadline.
--  2. Let an abandoned claim free up. A task claimed but not submitted within a
--     grace window can be re-claimed by anyone, so a worker who drops off never
--     locks a task forever. Submitted/verified/failed tasks are untouched.
--
-- Signature is unchanged (p_expires_at is kept for call-site compatibility and
-- is now ignored), so no application code changes are required.

create or replace function claim_task(
  p_task_id     uuid,
  p_worker      text,
  p_expires_at  timestamptz
)
returns tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks;
begin
  update tasks
  set
    status        = 'claimed',
    worker_wallet = p_worker,
    claimed_at    = now()
  where id = p_task_id
    and expires_at > now()
    and (
      status = 'pending'
      or (status = 'claimed' and claimed_at < now() - interval '30 minutes')
    )
  returning * into v_task;

  return v_task;
end;
$$;
