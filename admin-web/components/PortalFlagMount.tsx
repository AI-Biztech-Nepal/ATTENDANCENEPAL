'use client';

import { useEffect } from 'react';
import { rememberPortal } from './PortalFlag';

export default function PortalFlagMount() {
  useEffect(() => {
    rememberPortal();
  }, []);
  return null;
}
