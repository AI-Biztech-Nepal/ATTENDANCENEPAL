import { useEffect, useState } from 'react';
import { fetchCompanyName } from './payrollFormat';

/** The signed-in person's company name: '' until it loads, and if it can't be
 * read. Not cached across screens — a different login must never see the
 * previous company's name. */
export function useCompanyName(): string {
  const [name, setName] = useState('');

  useEffect(() => {
    let active = true;
    fetchCompanyName()
      .then(value => {
        if (active) setName(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return name;
}
