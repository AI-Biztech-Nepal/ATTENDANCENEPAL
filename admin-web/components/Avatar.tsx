const AVATAR_TONES = [
  'bg-accent/15 text-accent',
  'bg-info-bg text-info-text',
  'bg-warning-bg text-warning-text',
  'bg-purple-50 text-purple-700',
  'bg-critical-bg text-critical-text',
];

function avatarTone(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

/** A consistent color per name (hashed, not random) so the same person's
 * initials circle looks the same everywhere it appears — used as the
 * fallback whenever there's no profile photo to show instead. */
export default function Avatar({
  name,
  photoUrl,
  className = 'h-7 w-7 text-[11px]',
}: {
  name: string;
  photoUrl?: string | null;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join('');
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt={name} className={`shrink-0 rounded-full object-cover ${className}`} />;
  }
  return (
    // In the employee portal (.theme-employee) every initials circle is the theme green, not one of five hashed colours.
    <span className={`flex shrink-0 items-center justify-center rounded-full font-bold ${avatarTone(name)} [.theme-employee_&]:bg-accent/15 [.theme-employee_&]:text-accent ${className}`}>
      {initials || '?'}
    </span>
  );
}
