-- Yearly rules can name half of their month: "every year in early May" (1st-15th) or
-- "late May" (16th-last day). Without it, the rule covers the whole month, as in 0012.
alter table care_rules
  add column month_part text constraint care_rules_month_part check (month_part in ('early', 'late')),
  add constraint month_part_only_yearly check (month_part is null or timing_type = 'yearly');

-- As in 0012, with the half of the month a yearly rule may name. A period (whole month or
-- half) that ends before p_from or before the planting date is skipped; one under way counts.
create or replace function care_rule_periods(p_rule care_rules, p_planted_date date, p_from date)
returns table (due_date date, due_until date)
language sql stable
as $$
  select due, null::date
  from care_rule_due_dates(p_rule, p_planted_date, p_from, task_window_end()) as due
  where p_rule.timing_type <> 'yearly'
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
