-- Branch latitude/longitude no longer serve any enforcement purpose:
-- 20260803130000_remove_geofence_radius_limit.sql already dropped the
-- distance check, and enforce_geofence() only requires an employee to have
-- *an* assigned branch, never checks that branch's coordinates. Keeping
-- them NOT NULL just forced every "Add Branch" admin through a location
-- prompt for a value nothing reads anymore.
alter table branches alter column latitude drop not null;
alter table branches alter column longitude drop not null;
