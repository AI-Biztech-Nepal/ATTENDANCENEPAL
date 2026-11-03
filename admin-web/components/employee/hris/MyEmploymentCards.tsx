'use client';

import Badge from '@/components/Badge';
import { Fact, FactGrid } from '@/components/profile/ProfileParts';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { EMPLOYMENT_STATUS_LABEL, STATUS_TONE, effectiveStatus, employmentTypeLabel, formatAddress } from '@/lib/employeeProfile';
import type { Employee } from '@/lib/types';
import { Card } from './ui';

const capitalize = (v: string | null | undefined) => (v ? <span className="capitalize">{v}</span> : null);

/** What HR keeps about you beyond the basics My Profile already shows: employment,
 * personal details, contact & address and family. The same facts as the admin's
 * employee page, read only — HR changes them. */
export default function MyEmploymentCards({ employee, managerName }: { employee: Employee; managerName: string | null }) {
  const { system } = useCalendarSystem();
  const date = (d: string | null | undefined) => (d ? formatAdDate(d, system) : null);
  const status = effectiveStatus(employee);
  const permanentAddress = formatAddress(employee, 'permanent');
  const temporaryAddress = formatAddress(employee, 'temporary');

  return (
    <>
      <Card title="Employment">
        <FactGrid>
          <Fact label="Employee code">{employee.employee_code}</Fact>
          <Fact label="Employment type">{employmentTypeLabel(employee.employment_type)}</Fact>
          <Fact label="Status">
            <Badge tone={STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</Badge>
          </Fact>
          <Fact label="Reporting to">{managerName}</Fact>
          {employee.employment_type === 'contract' && (
            <>
              <Fact label="Contract start">{date(employee.contract_start)}</Fact>
              <Fact label="Contract end">{date(employee.contract_end)}</Fact>
            </>
          )}
          {employee.resigned_at && <Fact label="Last working date">{date(employee.resigned_at)}</Fact>}
        </FactGrid>
      </Card>

      <Card title="Personal details">
        <FactGrid>
          <Fact label="Gender">{capitalize(employee.gender)}</Fact>
          <Fact label="Date of birth">{date(employee.date_of_birth)}</Fact>
          <Fact label="Nationality">{employee.nationality}</Fact>
          <Fact label="Marital status">{capitalize(employee.marital_status)}</Fact>
          <Fact label="Blood group">{employee.blood_group}</Fact>
          <Fact label="Citizenship no.">{employee.citizenship_no}</Fact>
          <Fact label="Citizenship issued district">{employee.citizenship_issued_district}</Fact>
          <Fact label="Citizenship issue date">{date(employee.citizenship_issue_date)}</Fact>
        </FactGrid>
      </Card>

      <Card title="Contact & address">
        <FactGrid min={220}>
          <Fact label="Phone (official)">{employee.official_phone}</Fact>
          <Fact label="Email (personal)">{employee.personal_email}</Fact>
          <Fact label="Permanent address" wide>
            {permanentAddress}
          </Fact>
          <Fact label="Temporary address" wide>
            {temporaryAddress}
          </Fact>
          {employee.emergency_contact_address && (
            <Fact label="Emergency contact's address" wide>
              {employee.emergency_contact_address}
            </Fact>
          )}
        </FactGrid>
      </Card>

      <Card title="Family">
        <FactGrid>
          <Fact label="Father's name">{employee.father_name}</Fact>
          <Fact label="Mother's name">{employee.mother_name}</Fact>
          <Fact label="Grandfather's name">{employee.grandfather_name}</Fact>
          <Fact label="Spouse's name">{employee.spouse_name}</Fact>
        </FactGrid>
      </Card>
    </>
  );
}
