import type { Metadata } from 'next';
import './globals.css';
import { CalendarSystemProvider } from '@/lib/calendarSystem';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import { ToastProvider } from '@/components/Toast';
import ChunkErrorReload from '@/components/ChunkErrorReload';
import PortalFlagMount from '@/components/PortalFlagMount';

export const metadata: Metadata = {
  title: 'Attendance Nepal Admin',
  description: 'Attendance, payroll, and biometric device console',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inside the AIBIZTECH portal (shown in a frame) the portal's own sidebar already lists these pages, so ours is hidden */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(window.self!==window.top)document.documentElement.setAttribute('data-framed','1')}catch(e){document.documentElement.setAttribute('data-framed','1')}" }} />
      </head>
      <body>
        <ChunkErrorReload />
        <PortalFlagMount />
        <CalendarSystemProvider>
          <ConfirmProvider>
            <ToastProvider>{children}</ToastProvider>
          </ConfirmProvider>
        </CalendarSystemProvider>
      </body>
    </html>
  );
}
