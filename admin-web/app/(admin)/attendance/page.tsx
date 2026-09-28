'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePageTitle } from '@/lib/pageTitle';
import AttendanceReportTable from '@/components/AttendanceReportTable';

export default function AttendancePage() {
  usePageTitle('Attendance Report');
  return (
    <Suspense fallback={null}>
      <AttendanceView />
    </Suspense>
  );
}

function AttendanceView() {
  const searchParams = useSearchParams();
  const initialEmployeeId = searchParams.get('employee');
  return (
    <>
      <AttendanceReportTable initialEmployeeId={initialEmployeeId} />
    </>
  );
}
