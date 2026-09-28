import type { Metadata } from 'next';
import './globals.css';
import { CalendarSystemProvider } from '@/lib/calendarSystem';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import ChunkErrorReload from '@/components/ChunkErrorReload';

export const metadata: Metadata = {
  title: 'Attendance Nepal Admin',
  description: 'Attendance, payroll, and biometric device console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ChunkErrorReload />
        <CalendarSystemProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </CalendarSystemProvider>
      </body>
    </html>
  );
}
