'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavChild = { href: string; label: string; icon: (props: IconProps) => JSX.Element; adminOnly: boolean };
// A grouped item's own page is no longer reached by clicking the group row —
// the row only opens/closes the group. `selfLabel` is the name that landing
// page gets as the first entry inside the dropdown (its own page header).
type NavItem = {
  href: string;
  label: string;
  icon: (props: IconProps) => JSX.Element;
  adminOnly: boolean;
  selfLabel?: string;
  children?: NavChild[];
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: HomeIcon, adminOnly: false },
  {
    href: '/attendance',
    label: 'Attendance',
    icon: ClockIcon,
    adminOnly: false,
    selfLabel: 'Attendance Report',
    children: [
      { href: '/calendar', label: 'Calendar', icon: CalendarViewIcon, adminOnly: false },
      { href: '/leave', label: 'Leave', icon: LeaveIcon, adminOnly: false },
      { href: '/corrections', label: 'Corrections', icon: CorrectionIcon, adminOnly: false },
      { href: '/week-off', label: 'Holidays', icon: CalendarViewIcon, adminOnly: true },
    ],
  },
  {
    href: '/employees',
    label: 'Employees',
    icon: UsersIcon,
    adminOnly: false,
    selfLabel: 'Employee Directory',
    children: [
      { href: '/shifts', label: 'Shifts', icon: CalendarIcon, adminOnly: true },
      { href: '/branches', label: 'Branch/Depart', icon: BranchIcon, adminOnly: true },
      { href: '/employees?filter=Resigned', label: 'Resigned', icon: ResignedIcon, adminOnly: true },
    ],
  },
  {
    href: '/payroll',
    label: 'Payroll',
    icon: CardIcon,
    adminOnly: false,
    selfLabel: 'Payroll Report',
    children: [
      { href: '/salary-structure', label: 'Salary Structure', icon: StructureIcon, adminOnly: true },
    ],
  },
  { href: '/tasks', label: 'Tasks', icon: TaskIcon, adminOnly: false },
  { href: '/devices', label: 'Devices', icon: DeviceIcon, adminOnly: true },
];

type Props = {
  role: 'admin' | 'hr';
  drawerOpen: boolean;
  onCloseDrawer: () => void;
};

export default function Sidebar({ role, drawerOpen, onCloseDrawer }: Props) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter(item => !item.adminOnly || role === 'admin');

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // Desktop rest state is a 64px icon rail; clicking any icon expands it, and it
  // folds back when the pointer leaves. The mobile drawer is unaffected (the
  // rail classes are all lg:-prefixed).
  const [expanded, setExpanded] = useState(false);
  const rail = !expanded;
  const hideWhenRail = rail ? 'lg:hidden' : '';

  // Auto-expand whichever group contains the page currently being viewed —
  // including the group's own link, so a deep link straight into a page
  // (not clicked from the sidebar itself) still shows its section open.
  useEffect(() => {
    const group = NAV_ITEMS.find(i => i.href === pathname || i.children?.some(c => c.href === pathname));
    if (group) setOpenGroups(prev => (prev.has(group.href) ? prev : new Set(prev).add(group.href)));
  }, [pathname]);

  function toggleGroup(href: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  return (
    <>
      {drawerOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={onCloseDrawer} aria-hidden="true" />
      )}
      <aside
        onMouseLeave={() => setExpanded(false)}
        className={`fixed inset-y-0 left-0 z-30 flex h-screen w-60 shrink-0 -translate-x-full flex-col overflow-hidden bg-sidebar text-slate-300 transition-[transform,width] duration-200 lg:static lg:translate-x-0 ${
          rail ? 'lg:w-16' : 'lg:w-60'
        } ${drawerOpen ? 'translate-x-0' : ''}`}
      >
        <div className="flex flex-col items-center gap-0.5 px-3 pb-1 pt-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-mark.png"
            alt="Attendance Nepal"
            className={`h-28 w-28 shrink-0 object-contain transition-all duration-200 ${rail ? 'lg:h-[30px] lg:w-[30px]' : ''}`}
          />
          <span className={`whitespace-nowrap text-lg font-semibold text-white ${hideWhenRail}`}>Attendance Nepal</span>
        </div>

        {role === 'hr' && (
          <div className="px-3 pb-3">
            <Link
              href="/checkin"
              onClick={onCloseDrawer}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent/20 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/30"
            >
              My Check-In / Out
            </Link>
          </div>
        )}

        <nav className={`sidebar-scroll flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pb-4 ${rail ? 'px-3 lg:px-1.5' : 'px-3'}`}>
          {items.map(item => {
            // A grouped item's own landing page becomes the first child; the
            // group row itself no longer navigates anywhere.
            const ownChildren: NavChild[] = item.selfLabel
              ? [{ href: item.href, label: item.selfLabel, icon: ReportIcon, adminOnly: false }, ...(item.children ?? [])]
              : (item.children ?? []);
            const childItems = ownChildren.filter(c => !c.adminOnly || role === 'admin');
            const hasChildren = childItems.length > 0;
            const isOpen = openGroups.has(item.href);
            const active = pathname === item.href;
            const childActive = childItems.some(c => c.href === pathname);
            const Icon = item.icon;
            return (
              <div key={item.href}>
                <div className="flex items-center gap-1">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => {
                        setExpanded(true);
                        toggleGroup(item.href);
                      }}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? `Collapse ${item.label}` : `Expand ${item.label}`}
                      title={item.label}
                      className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${rail ? 'lg:justify-center lg:px-2' : ''} ${
                        active || childActive ? 'bg-sidebar-active font-medium text-accent' : 'hover:bg-sidebar-active/60 hover:text-white'
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" active={active || childActive} />
                      <span className={`flex-1 whitespace-nowrap text-left ${hideWhenRail}`}>{item.label}</span>
                      <ChevronIcon className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''} ${hideWhenRail}`} />
                    </button>
                  ) : (
                    <Link
                      href={item.href}
                      onClick={() => {
                        setExpanded(true);
                        onCloseDrawer();
                      }}
                      title={item.label}
                      className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${rail ? 'lg:justify-center lg:px-2' : ''} ${
                        active ? 'bg-sidebar-active font-medium text-accent' : 'hover:bg-sidebar-active/60 hover:text-white'
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" active={active} />
                      <span className={`whitespace-nowrap ${hideWhenRail}`}>{item.label}</span>
                    </Link>
                  )}
                </div>
                {hasChildren && (
                  <div
                    aria-hidden={!isOpen}
                    className={`grid transition-all duration-200 ease-out ${hideWhenRail} ${
                      isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-white/10 pl-3">
                        {childItems.map(c => {
                          const cActive = pathname === c.href;
                          const CIcon = c.icon;
                          return (
                            <Link
                              key={c.href}
                              href={c.href}
                              onClick={onCloseDrawer}
                              tabIndex={isOpen ? undefined : -1}
                              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                                cActive ? 'bg-sidebar-active font-medium text-accent' : 'text-slate-300 hover:bg-sidebar-active/60 hover:text-white'
                              }`}
                            >
                              <CIcon className="h-4 w-4" active={cActive} />
                              {c.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

type IconProps = { className?: string; active?: boolean };

function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5M5 10v10h14V10" />
    </svg>
  );
}
function UsersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 11a4 4 0 1 0-4-4M2 21v-1a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6v1M17 14a6 6 0 0 1 5 6v1" />
    </svg>
  );
}
function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </svg>
  );
}
function LeaveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h5l2-3h4l2 3h5M4 12l1.5 7h13L20 12" />
    </svg>
  );
}
function CorrectionIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20a8 8 0 1 0-6.93-4M4 15v5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5" />
    </svg>
  );
}
function TaskIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}
function BranchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function ResignedIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 19c1-3.2 3.6-5 6.5-5s5.5 1.8 6.5 5M15.5 9h6" />
    </svg>
  );
}
function CalendarViewIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      <circle cx="8.5" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function DeviceIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path strokeLinecap="round" d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}
function CardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path strokeLinecap="round" d="M2 10h20" />
    </svg>
  );
}
function StructureIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h18M9 9v11" />
    </svg>
  );
}
function ReportIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6M9 9h2" />
    </svg>
  );
}
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}
