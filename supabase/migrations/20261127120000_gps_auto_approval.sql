-- Automatic approval of phone check-in / check-out, per company.
--
-- When companies.gps_auto_approve is on and the employee's branch has a saved
-- location, a punch the employee makes for themselves is:
--   * inside the branch radius  -> approved at once, no Admin/HR step;
--   * outside it                -> refused, nothing is saved.
-- A branch with no saved location keeps the normal Admin/HR approval queue, and
-- so does every company with the switch off. Both rules live here so a phone
-- (including an older app build) cannot skip them.

alter table companies add column if not exists gps_auto_approve boolean not null default false;

-- Metres between two points (haversine). strict: a missing coordinate gives
-- null, which least() below would otherwise swallow into half the globe.
create or replace function gps_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$ language sql immutable strict;

-- One row when automatic approval applies to this employee, none otherwise.
create or replace function attendance_zone(p_employee_id uuid, p_lat double precision, p_lng double precision)
returns table (branch_name text, radius_m integer, distance_m integer, inside boolean) as $$
  select b.name,
         b.radius_meters,
         round(d.metres)::integer,
         coalesce(d.metres <= b.radius_meters, false)
  from employees e
  join companies c on c.id = e.company_id and c.gps_auto_approve
  join branches b on b.id = e.branch_id and b.company_id = e.company_id
  cross join lateral (select gps_distance_m(p_lat, p_lng, b.latitude, b.longitude) as metres) d
  where e.id = p_employee_id and b.latitude is not null and b.longitude is not null;
$$ language sql stable security definer set search_path = public;

revoke execute on function attendance_zone(uuid, double precision, double precision) from public, anon, authenticated;

-- What the Check In screen asks: only ever about the signed-in person.
create or replace function my_attendance_zone(p_lat double precision default null, p_lng double precision default null)
returns table (branch_name text, radius_m integer, distance_m integer, inside boolean) as $$
  select * from attendance_zone((select employee_id from profiles where id = auth.uid()), p_lat, p_lng);
$$ language sql stable security definer set search_path = public;

revoke execute on function my_attendance_zone(double precision, double precision) from public, anon;
grant execute on function my_attendance_zone(double precision, double precision) to authenticated;

create or replace function enforce_attendance_zone()
returns trigger as $$
declare
  z record;
  last_punch timestamptz;
begin
  if new.employee_id is distinct from (select employee_id from profiles where id = auth.uid()) then
    return new;
  end if;

  select * into z from attendance_zone(new.employee_id, new.lat, new.lng);
  if not found then
    return new;
  end if;

  if z.distance_m is null then
    raise exception 'Your location is needed to record attendance. Turn on location access and try again.';
  end if;
  if not z.inside then
    raise exception 'You are outside the attendance approval zone. You are about % m from %, and attendance is accepted only within % m. Move closer and try again.',
      z.distance_m, z.branch_name, z.radius_m;
  end if;

  -- No one reviews this punch, so its time is the server's, not the phone's.
  new.punch_time := now();

  -- reject_rapid_duplicate_punch() would drop it silently, so say why instead.
  select max(punch_time) into last_punch from attendance_logs
  where employee_id = new.employee_id
    and abs(extract(epoch from (new.punch_time - punch_time))) < 15 * 60;
  if last_punch is not null then
    raise exception 'Your attendance was already recorded at %. Please wait 15 minutes before recording it again.',
      to_char(last_punch at time zone 'Asia/Kathmandu', 'FMHH12:MI AM');
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_enforce_attendance_zone on attendance_gps_requests;
create trigger trg_enforce_attendance_zone before insert on attendance_gps_requests
  for each row execute function enforce_attendance_zone();

-- Runs after the insert because the employee's insert policy only lets a row in
-- as 'pending'. reviewed_by stays empty: that marks an automatic approval.
create or replace function auto_approve_gps_request()
returns trigger as $$
declare
  v_inserted integer;
begin
  if new.status <> 'pending'
     or new.employee_id is distinct from (select employee_id from profiles where id = auth.uid())
     or not exists (select 1 from attendance_zone(new.employee_id, new.lat, new.lng) z where z.inside) then
    return null;
  end if;

  insert into attendance_logs (employee_id, punch_time, punch_type, method, lat, lng, accuracy_m)
  values (new.employee_id, new.punch_time, new.punch_type, 'gps', new.lat, new.lng, new.accuracy_m);
  get diagnostics v_inserted = row_count;

  -- No row means approved leave covers today: leave it pending for Admin/HR.
  if v_inserted > 0 then
    update attendance_gps_requests set status = 'approved', reviewed_at = now() where id = new.id;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_auto_approve_gps_request on attendance_gps_requests;
create trigger trg_auto_approve_gps_request after insert on attendance_gps_requests
  for each row execute function auto_approve_gps_request();

-- Everest Mart Store: switch it on with a 30 m zone around each branch. Guarded
-- so running this again never overwrites a radius an admin changed later.
with switched_on as (
  update companies set gps_auto_approve = true
  where id = '9add3858-5050-4ffb-b81e-2dd3135ca856' and not gps_auto_approve
  returning id
)
update branches set radius_meters = 30 where company_id in (select id from switched_on);
