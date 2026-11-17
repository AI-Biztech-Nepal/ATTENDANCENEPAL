import AppShellLayout from '@/components/AppShellLayout';
import BodyFontClass from '@/components/BodyFontClass';
import { manrope } from '@/lib/fonts';

// Owner/HR pages use Manrope, matching the mobile app. The wrapper (display:
// contents, so it adds no box) styles the first paint; BodyFontClass covers
// what portals to <body>.
export default function AdminGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${manrope.className} contents`}>
      <BodyFontClass className={manrope.className} />
      <AppShellLayout>{children}</AppShellLayout>
    </div>
  );
}
