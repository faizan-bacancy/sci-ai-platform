-- Phase 4: Inventory optimization, supplier performance, and alerts

create table if not exists public.inventory_parameters (
  product_id uuid not null references public.products(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  service_level_percent numeric(5,2) not null default 95,
  ordering_cost numeric(12,2) not null default 50.00,
  holding_cost_rate numeric(6,4) not null default 0.25,
  calculation_window_days integer not null default 90,
  last_calculated_at timestamptz,
  calculated_safety_stock numeric(18,4) not null default 0,
  calculated_reorder_point numeric(18,4) not null default 0,
  calculated_eoq numeric(18,4) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (product_id, warehouse_id),
  constraint inventory_parameters_service_level_check check (service_level_percent > 0 and service_level_percent <= 100),
  constraint inventory_parameters_ordering_cost_check check (ordering_cost >= 0),
  constraint inventory_parameters_holding_cost_rate_check check (holding_cost_rate > 0 and holding_cost_rate <= 1),
  constraint inventory_parameters_calculation_window_days_check check (calculation_window_days >= 7 and calculation_window_days <= 365)
);

create table if not exists public.demand_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  date date not null,
  quantity_sold numeric(18,4) not null default 0,
  quantity_returned numeric(18,4) not null default 0,
  net_quantity numeric(18,4) generated always as (quantity_sold - quantity_returned) stored,
  source text not null default 'manual',
  created_at timestamptz not null default timezone('utc', now()),
  constraint demand_history_quantities_non_negative check (quantity_sold >= 0 and quantity_returned >= 0),
  constraint demand_history_source_check check (source in ('manual', 'import', 'api'))
);

create unique index if not exists demand_history_product_warehouse_date_unique
  on public.demand_history (product_id, warehouse_id, date);

create index if not exists demand_history_warehouse_date_idx
  on public.demand_history (warehouse_id, date desc);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null,
  product_id uuid references public.products(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  title text not null,
  message text not null,
  recommended_action text,
  is_acknowledged boolean not null default false,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  is_dismissed boolean not null default false,
  dismissed_by uuid references public.profiles(id) on delete set null,
  dismissed_at timestamptz,
  auto_resolves_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint alerts_type_check check (type in ('stockout_risk', 'reorder_required', 'overstock', 'po_overdue', 'supplier_performance', 'low_forecast_accuracy')),
  constraint alerts_severity_check check (severity in ('critical', 'warning', 'info'))
);

create index if not exists alerts_open_lookup_idx
  on public.alerts (severity, created_at desc)
  where auto_resolves_at is null and is_dismissed = false;

create index if not exists alerts_type_status_idx
  on public.alerts (type, is_acknowledged, is_dismissed, created_at desc);

create unique index if not exists alerts_open_dedupe_idx
  on public.alerts (
    type,
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(purchase_order_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where auto_resolves_at is null and is_dismissed = false;

create table if not exists public.supplier_performance_scores (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  on_time_delivery_rate numeric(8,6) not null default 0,
  quality_rate numeric(8,6) not null default 1,
  fill_rate numeric(8,6) not null default 0,
  avg_lead_time_days numeric(10,4) not null default 0,
  total_orders integer not null default 0,
  total_order_value numeric(14,2) not null default 0,
  composite_score numeric(8,6) not null default 0,
  trend text not null default 'stable',
  created_at timestamptz not null default timezone('utc', now()),
  constraint supplier_performance_scores_period_check check (period_end >= period_start),
  constraint supplier_performance_scores_trend_check check (trend in ('improving', 'stable', 'declining'))
);

create unique index if not exists supplier_performance_scores_supplier_period_unique
  on public.supplier_performance_scores (supplier_id, period_start, period_end);

create index if not exists supplier_performance_scores_period_idx
  on public.supplier_performance_scores (period_start desc, period_end desc);

create or replace function public.z_score_for_service_level(p_service_level_percent numeric)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_service_level_percent >= 99 then 2.33
    when p_service_level_percent >= 95 then 1.65
    else 1.28
  end;
$function$;

create or replace function public.calculate_safety_stock(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_avg_demand numeric default null,
  p_stddev_demand numeric default null
)
returns table (
  safety_stock numeric,
  reorder_point numeric,
  eoq numeric,
  avg_daily_demand numeric,
  stddev_daily_demand numeric,
  avg_lead_time_days numeric,
  stddev_lead_time_days numeric
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_service_level numeric;
  v_ordering_cost numeric;
  v_holding_cost_rate numeric;
  v_window_days integer;
  v_z numeric;
  v_data_points integer;
  v_avg_demand numeric;
  v_stddev_demand numeric;
  v_annual_demand numeric;
  v_avg_lead_time numeric;
  v_stddev_lead_time numeric;
  v_lead_points integer;
  v_safety_stock numeric;
  v_reorder_point numeric;
  v_eoq numeric;
  v_unit_cost numeric;
  v_holding_cost_per_unit numeric;
begin
  insert into public.inventory_parameters (product_id, warehouse_id)
  values (p_product_id, p_warehouse_id)
  on conflict (product_id, warehouse_id) do nothing;

  select
    service_level_percent,
    ordering_cost,
    holding_cost_rate,
    calculation_window_days
  into
    v_service_level,
    v_ordering_cost,
    v_holding_cost_rate,
    v_window_days
  from public.inventory_parameters
  where product_id = p_product_id
    and warehouse_id = p_warehouse_id;

  select
    count(*),
    avg(net_quantity),
    coalesce(stddev_samp(net_quantity), 0),
    coalesce(sum(net_quantity) filter (where date >= current_date - interval '365 days'), 0)
  into
    v_data_points,
    v_avg_demand,
    v_stddev_demand,
    v_annual_demand
  from public.demand_history
  where product_id = p_product_id
    and warehouse_id = p_warehouse_id
    and date >= current_date - (v_window_days - 1);

  if p_avg_demand is not null then
    v_avg_demand := p_avg_demand;
  end if;

  if p_stddev_demand is not null then
    v_stddev_demand := p_stddev_demand;
  end if;

  v_avg_demand := greatest(coalesce(v_avg_demand, 0), 0);
  v_stddev_demand := greatest(coalesce(v_stddev_demand, 0), 0);

  select
    count(*),
    coalesce(avg(lead_time_days), 0),
    coalesce(stddev_samp(lead_time_days), 0)
  into
    v_lead_points,
    v_avg_lead_time,
    v_stddev_lead_time
  from (
    select
      greatest(extract(day from (po.actual_delivery_date - po.order_date)), 0)::numeric as lead_time_days
    from public.purchase_order_lines pol
    join public.purchase_orders po on po.id = pol.purchase_order_id
    where pol.product_id = p_product_id
      and po.warehouse_id = p_warehouse_id
      and po.order_date is not null
      and po.actual_delivery_date is not null
  ) lt;

  if v_avg_lead_time <= 0 then
    select greatest(coalesce(lead_time_days, 1), 1)
    into v_avg_lead_time
    from public.products
    where id = p_product_id;
    v_stddev_lead_time := 0;
  end if;

  v_z := public.z_score_for_service_level(v_service_level);

  if p_avg_demand is null and p_stddev_demand is null and coalesce(v_data_points, 0) < 10 then
    v_safety_stock := v_z * v_avg_demand * v_avg_lead_time * 0.5;
  else
    v_safety_stock := v_z * sqrt(
      (v_avg_lead_time * power(v_stddev_demand, 2))
      + power((v_avg_demand * v_stddev_lead_time), 2)
    );
  end if;

  v_safety_stock := greatest(coalesce(v_safety_stock, 0), 0);
  v_reorder_point := greatest((v_avg_demand * v_avg_lead_time) + v_safety_stock, 0);

  select coalesce(unit_cost, 0)
  into v_unit_cost
  from public.products
  where id = p_product_id;

  v_holding_cost_per_unit := v_unit_cost * v_holding_cost_rate;

  if v_annual_demand > 0 and v_ordering_cost > 0 and v_holding_cost_per_unit > 0 then
    v_eoq := sqrt((2 * v_annual_demand * v_ordering_cost) / v_holding_cost_per_unit);
  else
    v_eoq := 0;
  end if;

  update public.inventory_parameters
  set
    calculated_safety_stock = v_safety_stock,
    calculated_reorder_point = v_reorder_point,
    calculated_eoq = greatest(v_eoq, 0),
    last_calculated_at = timezone('utc', now())
  where product_id = p_product_id
    and warehouse_id = p_warehouse_id;

  return query
  select
    v_safety_stock,
    v_reorder_point,
    greatest(v_eoq, 0),
    v_avg_demand,
    v_stddev_demand,
    v_avg_lead_time,
    v_stddev_lead_time;
end;
$function$;

create or replace function public.calculate_all_safety_stocks()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in
    with combos as (
      select distinct i.product_id, i.warehouse_id
      from public.inventory i
      union
      select distinct dh.product_id, dh.warehouse_id
      from public.demand_history dh
      union
      select distinct pol.product_id, po.warehouse_id
      from public.purchase_order_lines pol
      join public.purchase_orders po on po.id = pol.purchase_order_id
      union
      select p.id as product_id, w.id as warehouse_id
      from public.products p
      cross join public.warehouses w
      where p.is_active = true
    )
    select c.product_id, c.warehouse_id
    from combos c
    join public.products p on p.id = c.product_id
    where p.is_active = true
  loop
    perform public.calculate_safety_stock(v_row.product_id, v_row.warehouse_id, null, null);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

create or replace function public.get_inventory_health(
  p_product_id uuid,
  p_warehouse_id uuid
)
returns table (
  days_of_stock_remaining numeric,
  stock_status text,
  quantity_available numeric,
  reorder_point numeric,
  safety_stock numeric,
  eoq numeric,
  avg_daily_demand numeric,
  recommended_action text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_qty_on_hand numeric := 0;
  v_qty_reserved numeric := 0;
  v_quantity_available numeric := 0;
  v_reorder_point numeric := 0;
  v_safety_stock numeric := 0;
  v_eoq numeric := 0;
  v_avg_demand numeric := 0;
  v_status text;
  v_days_of_stock numeric;
  v_action text;
begin
  select coalesce(i.qty_on_hand, 0), coalesce(i.qty_reserved, 0)
  into v_qty_on_hand, v_qty_reserved
  from public.inventory i
  where i.product_id = p_product_id
    and i.warehouse_id = p_warehouse_id;

  v_quantity_available := greatest(v_qty_on_hand - v_qty_reserved, 0);

  select
    ip.calculated_reorder_point,
    ip.calculated_safety_stock,
    ip.calculated_eoq,
    coalesce(avg(dh.net_quantity), 0)
  into
    v_reorder_point,
    v_safety_stock,
    v_eoq,
    v_avg_demand
  from public.inventory_parameters ip
  left join public.demand_history dh
    on dh.product_id = ip.product_id
   and dh.warehouse_id = ip.warehouse_id
   and dh.date >= current_date - (ip.calculation_window_days - 1)
  where ip.product_id = p_product_id
    and ip.warehouse_id = p_warehouse_id
  group by ip.calculated_reorder_point, ip.calculated_safety_stock, ip.calculated_eoq;

  if v_reorder_point is null then
    select calc.reorder_point, calc.safety_stock, calc.eoq, calc.avg_daily_demand
    into v_reorder_point, v_safety_stock, v_eoq, v_avg_demand
    from public.calculate_safety_stock(p_product_id, p_warehouse_id, null, null) as calc;
  end if;

  if coalesce(v_avg_demand, 0) > 0 then
    v_days_of_stock := v_quantity_available / v_avg_demand;
  else
    v_days_of_stock := null;
  end if;

  if v_quantity_available <= 0 then
    v_status := 'stockout';
    v_action := 'Create an urgent purchase order now.';
  elsif v_quantity_available <= coalesce(v_safety_stock, 0) then
    v_status := 'critical';
    v_action := 'Reorder immediately to avoid stockout.';
  elsif v_quantity_available <= coalesce(v_reorder_point, 0) then
    v_status := 'low';
    v_action := 'Plan replenishment now.';
  elsif v_quantity_available <= (coalesce(v_reorder_point, 0) * 2) then
    v_status := 'healthy';
    v_action := 'No action needed.';
  else
    v_status := 'overstock';
    v_action := 'Reduce purchasing or rebalance stock.';
  end if;

  return query
  select
    v_days_of_stock,
    v_status,
    v_quantity_available,
    coalesce(v_reorder_point, 0),
    coalesce(v_safety_stock, 0),
    coalesce(v_eoq, 0),
    coalesce(v_avg_demand, 0),
    v_action;
end;
$function$;

create or replace function public.calculate_supplier_performance(
  p_supplier_id uuid,
  p_period_start date,
  p_period_end date
)
returns public.supplier_performance_scores
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_total_orders integer := 0;
  v_total_order_value numeric := 0;
  v_on_time_rate numeric := 0;
  v_fill_rate numeric := 0;
  v_quality_rate numeric := 1;
  v_avg_lead_time numeric := 0;
  v_composite numeric := 0;
  v_previous_composite numeric := 0;
  v_trend text := 'stable';
  v_period_days integer := 0;
  v_prev_start date;
  v_prev_end date;
  v_row public.supplier_performance_scores;
begin
  if p_period_end < p_period_start then
    raise exception 'period_end must be >= period_start';
  end if;

  select
    count(*)::int,
    coalesce(sum(total_amount), 0)
  into
    v_total_orders,
    v_total_order_value
  from public.purchase_orders po
  where po.supplier_id = p_supplier_id
    and po.order_date >= p_period_start
    and po.order_date <= p_period_end;

  select
    coalesce(avg(case when po.actual_delivery_date is not null and po.expected_delivery_date is not null and po.actual_delivery_date <= po.expected_delivery_date then 1 else 0 end), 0),
    coalesce(avg(greatest(extract(day from (po.actual_delivery_date - po.order_date)), 0)), 0)
  into
    v_on_time_rate,
    v_avg_lead_time
  from public.purchase_orders po
  where po.supplier_id = p_supplier_id
    and po.order_date >= p_period_start
    and po.order_date <= p_period_end
    and po.actual_delivery_date is not null
    and po.order_date is not null;

  select
    coalesce(sum(pol.qty_received) / nullif(sum(pol.qty_ordered), 0), 0)
  into v_fill_rate
  from public.purchase_order_lines pol
  join public.purchase_orders po on po.id = pol.purchase_order_id
  where po.supplier_id = p_supplier_id
    and po.order_date >= p_period_start
    and po.order_date <= p_period_end;

  select
    coalesce(1 - (sum(dh.quantity_returned) / nullif(sum(dh.quantity_sold), 0)), 1)
  into v_quality_rate
  from public.demand_history dh
  where dh.date >= p_period_start
    and dh.date <= p_period_end
    and dh.product_id in (
      select sp.product_id
      from public.supplier_products sp
      where sp.supplier_id = p_supplier_id
        and sp.is_preferred = true
      union
      select sp2.product_id
      from public.supplier_products sp2
      where sp2.supplier_id = p_supplier_id
    );

  v_quality_rate := greatest(least(coalesce(v_quality_rate, 1), 1), 0);
  v_on_time_rate := greatest(least(coalesce(v_on_time_rate, 0), 1), 0);
  v_fill_rate := greatest(least(coalesce(v_fill_rate, 0), 1), 0);

  v_composite := (v_on_time_rate * 0.40) + (v_quality_rate * 0.30) + (v_fill_rate * 0.30);

  v_period_days := greatest((p_period_end - p_period_start) + 1, 1);
  v_prev_end := p_period_start - 1;
  v_prev_start := v_prev_end - (v_period_days - 1);

  select sps.composite_score
  into v_previous_composite
  from public.supplier_performance_scores sps
  where sps.supplier_id = p_supplier_id
    and sps.period_start = v_prev_start
    and sps.period_end = v_prev_end
  limit 1;

  if v_previous_composite is null then
    v_trend := 'stable';
  elsif v_composite > v_previous_composite + 0.03 then
    v_trend := 'improving';
  elsif v_composite < v_previous_composite - 0.03 then
    v_trend := 'declining';
  else
    v_trend := 'stable';
  end if;

  insert into public.supplier_performance_scores (
    supplier_id,
    period_start,
    period_end,
    on_time_delivery_rate,
    quality_rate,
    fill_rate,
    avg_lead_time_days,
    total_orders,
    total_order_value,
    composite_score,
    trend
  ) values (
    p_supplier_id,
    p_period_start,
    p_period_end,
    v_on_time_rate,
    v_quality_rate,
    v_fill_rate,
    coalesce(v_avg_lead_time, 0),
    v_total_orders,
    v_total_order_value,
    v_composite,
    v_trend
  )
  on conflict (supplier_id, period_start, period_end)
  do update set
    on_time_delivery_rate = excluded.on_time_delivery_rate,
    quality_rate = excluded.quality_rate,
    fill_rate = excluded.fill_rate,
    avg_lead_time_days = excluded.avg_lead_time_days,
    total_orders = excluded.total_orders,
    total_order_value = excluded.total_order_value,
    composite_score = excluded.composite_score,
    trend = excluded.trend,
    created_at = timezone('utc', now())
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.calculate_supplier_performance_for_all_active_suppliers(
  p_period_start date default (current_date - interval '7 days')::date,
  p_period_end date default current_date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_supplier record;
  v_count integer := 0;
begin
  for v_supplier in
    select id
    from public.suppliers
    where is_active = true
  loop
    perform public.calculate_supplier_performance(v_supplier.id, p_period_start, p_period_end);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

create or replace function public.generate_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changed integer := 0;
begin
  perform public.calculate_all_safety_stocks();

  create temporary table _alert_conditions (
    type text not null,
    severity text not null,
    product_id uuid,
    supplier_id uuid,
    warehouse_id uuid,
    purchase_order_id uuid,
    title text not null,
    message text not null,
    recommended_action text
  ) on commit drop;

  insert into _alert_conditions (type, severity, product_id, supplier_id, warehouse_id, purchase_order_id, title, message, recommended_action)
  select
    'stockout_risk',
    case when h.stock_status = 'stockout' then 'critical' else 'warning' end,
    i.product_id,
    null,
    i.warehouse_id,
    null,
    case when h.stock_status = 'stockout' then 'Stockout detected' else 'Critical stock risk' end,
    p.name || ' has ' || round(h.quantity_available::numeric, 3) || ' units available (safety stock ' || round(h.safety_stock::numeric, 3) || ').',
    'Create a purchase order using EOQ recommendation.'
  from public.inventory i
  join public.products p on p.id = i.product_id and p.is_active = true
  cross join lateral public.get_inventory_health(i.product_id, i.warehouse_id) h
  where h.stock_status in ('stockout', 'critical');

  insert into _alert_conditions (type, severity, product_id, supplier_id, warehouse_id, purchase_order_id, title, message, recommended_action)
  select
    'reorder_required',
    case when h.stock_status in ('stockout', 'critical') then 'critical' else 'warning' end,
    i.product_id,
    null,
    i.warehouse_id,
    null,
    'Reorder required',
    p.name || ' is at ' || round(h.quantity_available::numeric, 3) || ' units; reorder point is ' || round(h.reorder_point::numeric, 3) || '.',
    'Create replenishment PO for EOQ quantity.'
  from public.inventory i
  join public.products p on p.id = i.product_id and p.is_active = true
  cross join lateral public.get_inventory_health(i.product_id, i.warehouse_id) h
  where h.quantity_available <= h.reorder_point;

  insert into _alert_conditions (type, severity, product_id, supplier_id, warehouse_id, purchase_order_id, title, message, recommended_action)
  select
    'overstock',
    'info',
    i.product_id,
    null,
    i.warehouse_id,
    null,
    'Overstock detected',
    p.name || ' is above optimal stock levels.',
    'Slow purchasing cadence or rebalance stock.'
  from public.inventory i
  join public.products p on p.id = i.product_id and p.is_active = true
  cross join lateral public.get_inventory_health(i.product_id, i.warehouse_id) h
  where h.stock_status = 'overstock';

  insert into _alert_conditions (type, severity, product_id, supplier_id, warehouse_id, purchase_order_id, title, message, recommended_action)
  select
    'po_overdue',
    'warning',
    null,
    po.supplier_id,
    po.warehouse_id,
    po.id,
    'Purchase order overdue',
    'PO ' || po.po_number || ' expected on ' || po.expected_delivery_date || ' is overdue.',
    'Follow up with supplier and update expected delivery date.'
  from public.purchase_orders po
  where po.status in ('sent', 'confirmed', 'partially_received')
    and po.expected_delivery_date is not null
    and po.expected_delivery_date < current_date;

  insert into _alert_conditions (type, severity, product_id, supplier_id, warehouse_id, purchase_order_id, title, message, recommended_action)
  select
    'supplier_performance',
    case
      when sps.composite_score < 0.5 then 'critical'
      when sps.composite_score < 0.75 then 'warning'
      else 'info'
    end,
    null,
    sps.supplier_id,
    null,
    null,
    'Supplier performance changed',
    s.company_name || ' score is ' || round((sps.composite_score * 100)::numeric, 2) || '%.',
    'Review supplier metrics and consider alternate sourcing.'
  from public.supplier_performance_scores sps
  join public.suppliers s on s.id = sps.supplier_id
  where sps.period_end = (
    select max(period_end)
    from public.supplier_performance_scores latest
    where latest.supplier_id = sps.supplier_id
  )
    and sps.composite_score < 0.75;

  update public.alerts a
  set
    severity = c.severity,
    title = c.title,
    message = c.message,
    recommended_action = c.recommended_action
  from _alert_conditions c
  where a.type = c.type
    and a.product_id is not distinct from c.product_id
    and a.supplier_id is not distinct from c.supplier_id
    and a.warehouse_id is not distinct from c.warehouse_id
    and a.purchase_order_id is not distinct from c.purchase_order_id
    and a.auto_resolves_at is null
    and a.is_dismissed = false;

  get diagnostics v_changed = row_count;

  insert into public.alerts (
    type,
    severity,
    product_id,
    supplier_id,
    warehouse_id,
    purchase_order_id,
    title,
    message,
    recommended_action
  )
  select
    c.type,
    c.severity,
    c.product_id,
    c.supplier_id,
    c.warehouse_id,
    c.purchase_order_id,
    c.title,
    c.message,
    c.recommended_action
  from _alert_conditions c
  where not exists (
    select 1
    from public.alerts a
    where a.type = c.type
      and a.product_id is not distinct from c.product_id
      and a.supplier_id is not distinct from c.supplier_id
      and a.warehouse_id is not distinct from c.warehouse_id
      and a.purchase_order_id is not distinct from c.purchase_order_id
      and a.auto_resolves_at is null
      and a.is_dismissed = false
  );

  get diagnostics v_changed = v_changed + row_count;

  update public.alerts a
  set auto_resolves_at = timezone('utc', now())
  where a.auto_resolves_at is null
    and a.is_dismissed = false
    and a.type in ('stockout_risk', 'reorder_required', 'overstock', 'po_overdue', 'supplier_performance')
    and not exists (
      select 1
      from _alert_conditions c
      where c.type = a.type
        and c.product_id is not distinct from a.product_id
        and c.supplier_id is not distinct from a.supplier_id
        and c.warehouse_id is not distinct from a.warehouse_id
        and c.purchase_order_id is not distinct from a.purchase_order_id
    );

  get diagnostics v_changed = v_changed + row_count;

  return v_changed;
end;
$function$;

create or replace function public.enable_phase4_cron_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job record;
begin
  if to_regnamespace('cron') is null then
    raise exception 'pg_cron extension is not enabled. Run: create extension if not exists pg_cron;';
  end if;

  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'phase4_calculate_all_safety_stocks_daily',
      'phase4_generate_alerts_hourly',
      'phase4_supplier_performance_weekly'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'phase4_calculate_all_safety_stocks_daily',
    '0 2 * * *',
    'select public.calculate_all_safety_stocks();'
  );

  perform cron.schedule(
    'phase4_generate_alerts_hourly',
    '0 * * * *',
    'select public.generate_alerts();'
  );

  perform cron.schedule(
    'phase4_supplier_performance_weekly',
    '0 3 * * 1',
    'select public.calculate_supplier_performance_for_all_active_suppliers((current_date - interval ''7 days'')::date, current_date);'
  );

  return jsonb_build_object(
    'phase4_calculate_all_safety_stocks_daily', '0 2 * * *',
    'phase4_generate_alerts_hourly', '0 * * * *',
    'phase4_supplier_performance_weekly', '0 3 * * 1'
  );
end;
$function$;

create or replace function public.disable_phase4_cron_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job record;
  v_count integer := 0;
begin
  if to_regnamespace('cron') is null then
    return 0;
  end if;

  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'phase4_calculate_all_safety_stocks_daily',
      'phase4_generate_alerts_hourly',
      'phase4_supplier_performance_weekly'
    )
  loop
    perform cron.unschedule(v_job.jobid);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

alter table public.inventory_parameters enable row level security;
alter table public.demand_history enable row level security;
alter table public.alerts enable row level security;
alter table public.supplier_performance_scores enable row level security;

drop policy if exists "inventory_parameters_select_authenticated" on public.inventory_parameters;
create policy "inventory_parameters_select_authenticated"
  on public.inventory_parameters
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "inventory_parameters_insert_admin_manager" on public.inventory_parameters;
create policy "inventory_parameters_insert_admin_manager"
  on public.inventory_parameters
  for insert
  to authenticated
  with check (public.get_user_role() = any (array['admin'::public.user_role, 'manager'::public.user_role]));

drop policy if exists "inventory_parameters_update_admin_manager" on public.inventory_parameters;
create policy "inventory_parameters_update_admin_manager"
  on public.inventory_parameters
  for update
  to authenticated
  using (public.get_user_role() = any (array['admin'::public.user_role, 'manager'::public.user_role]))
  with check (public.get_user_role() = any (array['admin'::public.user_role, 'manager'::public.user_role]));

drop policy if exists "demand_history_select_authenticated" on public.demand_history;
create policy "demand_history_select_authenticated"
  on public.demand_history
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "demand_history_insert_admin_manager_planner" on public.demand_history;
create policy "demand_history_insert_admin_manager_planner"
  on public.demand_history
  for insert
  to authenticated
  with check (public.get_user_role() = any (array['admin'::public.user_role, 'manager'::public.user_role, 'planner'::public.user_role]));

drop policy if exists "demand_history_update_admin_manager_planner" on public.demand_history;
create policy "demand_history_update_admin_manager_planner"
  on public.demand_history
  for update
  to authenticated
  using (public.get_user_role() = any (array['admin'::public.user_role, 'manager'::public.user_role, 'planner'::public.user_role]))
  with check (public.get_user_role() = any (array['admin'::public.user_role, 'manager'::public.user_role, 'planner'::public.user_role]));

drop policy if exists "alerts_select_authenticated" on public.alerts;
create policy "alerts_select_authenticated"
  on public.alerts
  for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "alerts_update_admin_manager_planner" on public.alerts;
create policy "alerts_update_admin_manager_planner"
  on public.alerts
  for update
  to authenticated
  using (public.get_user_role() = any (array['admin'::public.user_role, 'manager'::public.user_role, 'planner'::public.user_role]))
  with check (public.get_user_role() = any (array['admin'::public.user_role, 'manager'::public.user_role, 'planner'::public.user_role]));

drop policy if exists "supplier_performance_scores_select_authenticated" on public.supplier_performance_scores;
create policy "supplier_performance_scores_select_authenticated"
  on public.supplier_performance_scores
  for select
  to authenticated
  using (auth.uid() is not null);

drop trigger if exists inventory_parameters_set_updated_at on public.inventory_parameters;
create trigger inventory_parameters_set_updated_at
before update on public.inventory_parameters
for each row execute function public.set_updated_at();

drop trigger if exists demand_history_audit_dml on public.demand_history;
create trigger demand_history_audit_dml
after insert or update or delete on public.demand_history
for each row execute function public.audit_log_dml();

drop trigger if exists alerts_audit_dml on public.alerts;
create trigger alerts_audit_dml
after insert or update or delete on public.alerts
for each row execute function public.audit_log_dml();

drop trigger if exists supplier_performance_scores_audit_dml on public.supplier_performance_scores;
create trigger supplier_performance_scores_audit_dml
after insert or update or delete on public.supplier_performance_scores
for each row execute function public.audit_log_dml();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.alerts;
    exception
      when duplicate_object then null;
    end;

    begin
      alter publication supabase_realtime add table public.inventory_parameters;
    exception
      when duplicate_object then null;
    end;

    begin
      alter publication supabase_realtime add table public.demand_history;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

-- Manual cron setup (single statement)
-- select public.enable_phase4_cron_jobs();
-- Optional teardown
-- select public.disable_phase4_cron_jobs();



