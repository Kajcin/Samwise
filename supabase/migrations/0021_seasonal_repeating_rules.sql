-- Repeating rules limited to some months: "harvest every 7 days, July to September".
--
-- A repeating rule ("every N days") can now hold the months it applies in:
-- * care_rules.months: months picked by hand (1-12), or
-- * care_rules.season: 'harvest' or 'flowering', the plant's harvest or flowering months,
--   followed when those change on the plant.
-- Neither set: all year, counted from the planting as before. With months, the count
-- restarts every year at the start of each season (each run of consecutive months):
-- every 7 days from 1 July gives 1, 8, 15 … July, and the same days next year. A season
-- linked to months the plant doesn't have gives no tasks.

alter table care_rules
  add column months smallint[] not null default '{}'
    constraint care_rules_months check (months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]),
  add column season text
    constraint care_rules_season check (season in ('harvest', 'flowering')),
  add constraint care_rules_months_only_recurring
    check (timing_type = 'recurring' or (months = '{}' and season is null)),
  add constraint care_rules_months_or_season
    check (season is null or months = '{}');

-- Months stored in calendar order without repeats (as plant seasons, 0016).
create function normalize_care_rule_months() returns trigger
language plpgsql as $$
begin
  new.months := array(select distinct m from unnest(new.months) m order by m);
  return new;
end $$;
revoke all on function normalize_care_rule_months() from public, anon, authenticated;

create trigger care_rules_normalize_months
  before insert or update of months on care_rules
  for each row execute function normalize_care_rule_months();

-- The months a rule applies in: its own, or the plant's season it follows.
-- Empty: all year (or, for a season the plant has no months for, none).
create function care_rule_months(p_rule care_rules) returns smallint[]
language sql stable set search_path = public as $$
  select case p_rule.season
           when 'harvest' then (select harvest_months from plants_catalog where id = p_rule.plant_id)
           when 'flowering' then (select flowering_months from plants_catalog where id = p_rule.plant_id)
           else p_rule.months
         end
$$;

-- Every p_every days within the given months, restarting on the 1st of each season (a
-- run of consecutive months, also over the new year), between p_from and p_to.
create function seasonal_repeat_dates(p_months smallint[], p_every int, p_from date, p_to date)
returns setof date
language plpgsql immutable as $$
declare
  start_month int;
  run_length int;
  y int;
  season_start date;
  season_end date;
begin
  for start_month in select m from unnest(p_months) m loop
    -- Only the first month of a run starts a season; all twelve are one season from January.
    if cardinality(p_months) = 12 then
      continue when start_month <> 1;
    else
      continue when ((start_month + 10) % 12 + 1) = any(p_months);
    end if;
    run_length := 1;
    while run_length < 12 and ((start_month + run_length - 1) % 12 + 1) = any(p_months) loop
      run_length := run_length + 1;
    end loop;
    for y in extract(year from p_from)::int - 1 .. extract(year from p_to)::int loop
      season_start := make_date(y, start_month, 1);
      season_end := (season_start + make_interval(months => run_length) - interval '1 day')::date;
      return query
        select d::date from generate_series(season_start, season_end, make_interval(days => p_every)) d
         where d::date between p_from and p_to;
    end loop;
  end loop;
end $$;

-- As in 0013, with repeating rules limited to their months.
create or replace function care_rule_periods(p_rule care_rules, p_planted_date date, p_from date)
returns table (due_date date, due_until date)
language sql stable set search_path = public
as $$
  -- Offset rules, and repeating rules all year: from the planting, as before.
  select due, null::date
  from care_rule_due_dates(p_rule, p_planted_date, p_from, task_window_end()) as due
  where p_rule.timing_type = 'offset_from_planting'
     or (p_rule.timing_type = 'recurring' and p_rule.season is null and p_rule.months = '{}')
  union all
  -- Repeating rules within months: from each season's 1st, not before the planting.
  select due, null::date
  from seasonal_repeat_dates(care_rule_months(p_rule), p_rule.recurrence_days,
                             greatest(p_from, p_planted_date), task_window_end()) as due
  where p_rule.timing_type = 'recurring' and (p_rule.season is not null or p_rule.months <> '{}')
  union all
  select period.due_date, period.due_until
  from yearly_rule_months(p_rule, p_planted_date, p_from, yearly_window_end()) as m,
       lateral (
         select
           case when p_rule.month_part = 'late' then m + 15 else m end as due_date,
           case when p_rule.month_part = 'early' then m + 14
                else (m + interval '1 month' - interval '1 day')::date end as due_until
       ) as period
  where period.due_until >= greatest(p_from, p_planted_date)
$$;

-- A plant's changed harvest or flowering months move the tasks of rules that follow them
-- (as changing a rule does, 0020).
create function sync_tasks_on_plant_seasons_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  grower record;
begin
  if new.harvest_months is not distinct from old.harvest_months
     and new.flowering_months is not distinct from old.flowering_months then
    return null;
  end if;
  if not exists (select 1 from care_rules where plant_id = new.id and season is not null) then
    return null;
  end if;
  for grower in
    select distinct user_id from plantings where plant_id = new.id and status = 'active'
  loop
    perform sync_plant_tasks(grower.user_id, new.id, true);
  end loop;
  return null;
end $$;

create trigger plants_catalog_after_seasons_change_sync_tasks
  after update of harvest_months, flowering_months on plants_catalog
  for each row execute function sync_tasks_on_plant_seasons_change();
