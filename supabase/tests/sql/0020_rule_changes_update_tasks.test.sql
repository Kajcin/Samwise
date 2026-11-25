-- Run with: npm run db:psql -- -f supabase/tests/sql/0020_rule_changes_update_tasks.test.sql
-- Adding, changing and deleting a care rule updates the plant's upcoming tasks right away;
-- completed tasks stay.
begin;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Lungwort', 'partial_shade');
insert into care_rules (id, plant_id, task_type, timing_type, offset_days, recurrence_days) values
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'fertilize', 'recurring', null, 30);
insert into beds (id, user_id, name, rows, cols) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Shade', 1, 1);
insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 0, 0,
   'e0000000-0000-0000-0000-000000000001', current_date);

-- The plant's unfinished tasks of a type, as days from today.
create function pg_temp.days(p_type text) returns text language sql as $$
  select coalesce(string_agg((due_date - current_date)::text, ' ' order by due_date), '-')
    from tasks where plant_id = 'e0000000-0000-0000-0000-000000000001' and task_type = p_type and completed_at is null
$$;
create function pg_temp.expect(p_actual text, p_expected text, p_what text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: %: expected "%", got "%"', p_what, p_expected, p_actual;
  end if;
end $$;

select pg_temp.expect(pg_temp.days('fertilize'), '30 60 90', 'to start with');

-- A new rule adds its tasks.
insert into care_rules (plant_id, task_type, timing_type, offset_days, recurrence_days) values
  ('e0000000-0000-0000-0000-000000000001', 'harvest', 'offset_from_planting', 20, null);
select pg_temp.expect(pg_temp.days('harvest'), '20', 'after adding a rule');

-- A changed rule moves its upcoming tasks; a completed one stays.
update tasks set completed_at = now()
 where plant_id = 'e0000000-0000-0000-0000-000000000001' and task_type = 'fertilize' and due_date = current_date + 30;
update care_rules set recurrence_days = 45 where id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.expect(pg_temp.days('fertilize'), '45 90', 'after changing the interval');
do $$
begin
  if not exists (select 1 from tasks where plant_id = 'e0000000-0000-0000-0000-000000000001'
                   and task_type = 'fertilize' and completed_at is not null) then
    raise exception 'TEST FAILED: the completed task should stay';
  end if;
end $$;

-- A deleted rule takes its upcoming tasks with it.
delete from care_rules where id = 'f0000000-0000-0000-0000-000000000001';
select pg_temp.expect(pg_temp.days('fertilize'), '-', 'after deleting the rule');
select pg_temp.expect(pg_temp.days('harvest'), '20', 'the other rule’s task stays');

rollback;
