-- Repeating rules limited to months (0021) plan a year ahead, like yearly rules (0012).
--
-- Repeating tasks are created 90 days ahead (task_window_end) and topped up nightly. For a
-- rule kept to May-August, added in November, that meant no tasks until the end of
-- January, as if the rule did nothing. Within months a rule gives a bounded number of
-- tasks a year, so it now looks 12 months ahead (yearly_window_end). All-year repeating
-- rules keep the 90 days.

create or replace function care_rule_periods(p_rule care_rules, p_planted_date date, p_from date)
returns table (due_date date, due_until date)
language sql stable set search_path = public
as $$
  -- Offset rules, and repeating rules all year: from the planting, 90 days ahead.
  select due, null::date
  from care_rule_due_dates(p_rule, p_planted_date, p_from, task_window_end()) as due
  where p_rule.timing_type = 'offset_from_planting'
     or (p_rule.timing_type = 'recurring' and p_rule.season is null and p_rule.months = '{}')
  union all
  -- Repeating rules within months: from each season's 1st, not before the planting, a year ahead.
  select due, null::date
  from seasonal_repeat_dates(care_rule_months(p_rule), p_rule.recurrence_days,
                             greatest(p_from, p_planted_date), yearly_window_end()) as due
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

-- Plants already growing with such rules get their tasks for the year now.
do $$
declare
  grown record;
begin
  for grown in
    select distinct pl.user_id, pl.plant_id
      from plantings pl
     where pl.status = 'active'
       and exists (select 1 from care_rules r
                    where r.plant_id = pl.plant_id and r.timing_type = 'recurring'
                      and (r.season is not null or r.months <> '{}'))
  loop
    perform sync_plant_tasks(grown.user_id, grown.plant_id, true);
  end loop;
end $$;
