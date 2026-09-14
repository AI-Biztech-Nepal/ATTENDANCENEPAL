-- Removing a device from the Devices page failed with a foreign key
-- violation ("device_sync_events_device_id_fkey") because that table's
-- device_id (and device_command_queue's) was `references devices(id)` with
-- no ON DELETE clause, the Postgres default being to block the delete
-- outright rather than touch dependent rows.
--
-- Unlike payroll_summaries/attendance_correction_requests.device_id (which
-- correctly use `on delete set null` — that's real history that must survive
-- the device being removed), device_sync_events and device_command_queue are
-- pure operational logs of that device's own sync/command traffic. They're
-- meaningless once the device is gone, so cascading their deletion is the
-- right call, not a data-loss risk.

alter table device_sync_events
  drop constraint if exists device_sync_events_device_id_fkey,
  add constraint device_sync_events_device_id_fkey
    foreign key (device_id) references devices(id) on delete cascade;

alter table device_command_queue
  drop constraint if exists device_command_queue_device_id_fkey,
  add constraint device_command_queue_device_id_fkey
    foreign key (device_id) references devices(id) on delete cascade;
