import EmployeeShell from '@/components/EmployeeShell';

// One shell for all the employee pages (Check In/Out, Calendar, Payroll, My Tasks,
// Profile). It lives here, not in each page, so it stays mounted while you move
// between them — same idea as app/(admin)/layout.tsx.
export default function EmployeeGroupLayout({ children }: { children: React.ReactNode }) {
  return <EmployeeShell>{children}</EmployeeShell>;
}
