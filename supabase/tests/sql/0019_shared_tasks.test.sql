-- Run with: npm run db:psql -- -f supabase/tests/sql/0019_shared_tasks.test.sql
-- One task per plant: plantings of the same plant share tasks that fall together and one
-- repeating schedule; taking one out detaches it; the calendar hears about it.
begin;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into calendar_credentials (user_id, refresh_token, calendar_id)
values ('11111111-1111-1111-1111-111111111111', 'refresh-1', 'cal-1');
insert into plants_catalog (id, user_id, name, sun_requirements) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Lungwort', 'partial_shade');
-- Fertilize every 10 days, harvest 30 days after planting.
insert into care_rules (plant_id, task_type, timing_type, offset_days, recurrence_days) values
  ('e0000000-0000-0000-0000-000000000001', 'fertilize', 'recurring', null, 10),
  ('e0000000-0000-0000-0000-000000000001', 'harvest', 'offset_from_planting', 30, null);
insert into beds (id, user_id, name, rows, cols) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Shade', 1, 3);

delete from vault.secrets where name in ('calendar_sync_url', 'calendar_sync_webhook_secret');
select vault.create_secret('http://sync.test/functions/v1/calendar-sync', 'calendar_sync_url');
select vault.create_secret('test-webhook-secret', 'calendar_sync_webhook_secret');

create function pg_temp.plant(p_id text, p_col int, p_planted date) returns void language sql as $$
  insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
    (p_id::uuid, '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 0, p_col,
     'e0000000-0000-0000-0000-000000000001', p_planted)
$$;
-- The plant's unfinished tasks of a type, as "date:number of plantings" (dates relative to today).
create function pg_temp.tasks_of(p_type text) returns text language sql as $$
  select coalesce(string_agg((t.due_date - current_date) || ':' ||
           (select count(*) from task_plantings tp where tp.task_id = t.id), ' ' order by t.due_date), '-')
    from tasks t
   where t.plant_id = 'e0000000-0000-0000-0000-000000000001' and t.task_type = p_type and t.completed_at is null
$$;
create function pg_temp.expect(p_actual text, p_expected text, p_what text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: %: expected "%", got "%"', p_what, p_expected, p_actual;
  end if;
end $$;

-- 1. The first planting gets its tasks, each covering it. (Planted in a subtransaction, so
--    its tasks count as older ones later on: a task created in the same transaction as a
--    change to its plantings isn't re-synced, its own insert already syncs it.)
do $$
begin
  perform pg_temp.plant('c0000000-0000-0000-0000-000000000001', 0, current_date);
exception when others then raise;
end $$;
select pg_temp.expect(pg_temp.tasks_of('fertilize'), '10:1 20:1 30:1 40:1 50:1 60:1 70:1 80:1 90:1', 'fertilizing after one planting');
select pg_temp.expect(pg_temp.tasks_of('harvest'), '30:1', 'harvest after one planting');

-- 2. A second one planted the same day shares every task: none more, each now covers two.
select pg_temp.plant('c0000000-0000-0000-0000-000000000002', 1, current_date);
select pg_temp.expect(pg_temp.tasks_of('fertilize'), '10:2 20:2 30:2 40:2 50:2 60:2 70:2 80:2 90:2', 'fertilizing shared');
select pg_temp.expect(pg_temp.tasks_of('harvest'), '30:2', 'harvest shared');

-- 3. A third, planted 3 days ago: fertilizing follows the earliest planting, for all three;
--    its harvest falls on its own day.
select pg_temp.plant('c0000000-0000-0000-0000-000000000003', 2, current_date - 3);
select pg_temp.expect(pg_temp.tasks_of('fertilize'), '7:3 17:3 27:3 37:3 47:3 57:3 67:3 77:3 87:3', 'one schedule from the earliest planting');
select pg_temp.expect(pg_temp.tasks_of('harvest'), '27:1 30:2', 'harvests on their own days');

-- 4. One task per plant, type and day.
do $$
begin
  insert into tasks (user_id, plant_id, task_type, due_date) values
    ('11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-000000000001', 'harvest', current_date + 30);
  raise exception 'TEST FAILED: a second task for the same plant, type and day was accepted';
exception when unique_violation then null;
end $$;

-- 5. Taking out the earliest planting: its own harvest goes, the schedule moves back to
--    the others' start, and a task it completed stays with it as history.
update tasks set completed_at = now()
 where plant_id = 'e0000000-0000-0000-0000-000000000001' and task_type = 'fertilize' and due_date = current_date + 7;
create temp table baseline as select coalesce(max(id), 0) as id from net.http_request_queue;
update plantings set status = 'removed' where id = 'c0000000-0000-0000-0000-000000000003';
select pg_temp.expect(pg_temp.tasks_of('harvest'), '30:2', 'the taken-out planting’s harvest went');
select pg_temp.expect(pg_temp.tasks_of('fertilize'), '10:2 20:2 30:2 40:2 50:2 60:2 70:2 80:2 90:2', 'schedule from the remaining plantings');
do $$
begin
  if (select count(*) from task_plantings tp join tasks t on t.id = tp.task_id
       where t.completed_at is not null and tp.planting_id = 'c0000000-0000-0000-0000-000000000003') <> 1 then
    raise exception 'TEST FAILED: the completed task should keep the taken-out planting as history';
  end if;
end $$;
-- The calendar heard about it: deleted events for the gone tasks.
do $$
begin
  if not exists (select 1 from net.http_request_queue
                  where id > (select id from baseline) and convert_from(body, 'utf8')::jsonb ->> 'type' = 'DELETE') then
    raise exception 'TEST FAILED: removing tasks should delete their events';
  end if;
end $$;

-- 6. A shared task losing a planting stays (re-synced: its places changed); losing its last one, it goes.
truncate baseline;
insert into baseline select coalesce(max(id), 0) from net.http_request_queue;
update plantings set status = 'removed' where id = 'c0000000-0000-0000-0000-000000000002';
select pg_temp.expect(pg_temp.tasks_of('harvest'), '30:1', 'the shared harvest stays for the last planting');
do $$
begin
  if not exists (select 1 from net.http_request_queue
                  where id > (select id from baseline) and convert_from(body, 'utf8')::jsonb ->> 'type' = 'RESYNC') then
    raise exception 'TEST FAILED: a task whose places changed should be re-synced';
  end if;
end $$;
update plantings set status = 'removed' where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.expect(pg_temp.tasks_of('harvest'), '-', 'no planting left, no unfinished tasks');
select pg_temp.expect(pg_temp.tasks_of('fertilize'), '-', 'no planting left, no fertilizing');

-- 7. The nightly top-up adds what's missing, for every planting.
select pg_temp.plant('c0000000-0000-0000-0000-000000000004', 0, current_date);
delete from tasks where plant_id = 'e0000000-0000-0000-0000-000000000001' and task_type = 'fertilize' and due_date = current_date + 50;
select top_up_recurring_tasks();
select pg_temp.expect(pg_temp.tasks_of('fertilize'), '10:1 20:1 30:1 40:1 50:1 60:1 70:1 80:1 90:1', 'the top-up filled the gap');

-- 8. You see your tasks' plantings, but can't change them.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';
do $$
begin
  if (select count(*) from task_plantings) = 0 then
    raise exception 'TEST FAILED: you should see your own tasks'' plantings';
  end if;
  begin
    delete from task_plantings;
    raise exception 'TEST FAILED: task_plantings should not be writable';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
begin
  if exists (select 1 from task_plantings) then
    raise exception 'TEST FAILED: another user sees the task plantings';
  end if;
end $$;

rollback;
