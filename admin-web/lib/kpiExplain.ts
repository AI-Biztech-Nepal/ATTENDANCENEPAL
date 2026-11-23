// What each KPI means, in plain words, for the person it is about ("How is this worked out?" on their own KPI page). The numbers in it
// are the company's own settings (hours in a day, forms needed, days to come back), so what an employee reads is what really
// decides their number. Plain code with no network, so it can be tested on its own.

import { PEER_MIN } from './colleagueKpi';
import { wordsFor, type KpiSettings } from './kpiSettings';
import { hoursText } from './utilisationKpi';

export type Explained = 'attendance' | 'services' | 'rebooking' | 'utilisation' | 'feedback' | 'nps' | 'colleagues' | 'own';

export function explanations(settings: KpiSettings): Record<Explained, string> {
  const words = wordsFor(settings.word);
  const t = words.t;
  const forms = `${settings.minResponses} ${settings.minResponses === 1 ? 'form' : 'forms'}`;
  return {
    attendance:
      'Present is the working days you checked in, out of the working days so far. On time is the days you checked in before your shift\'s grace period ended. Week-offs, holidays and approved leave are not counted.',
    services: 'How many services your company\'s booking file lists under your name in the month.',
    rebooking: t(`Of the customers you served in the month, the share who came back, to anyone, within ${settings.repeatDays} ${settings.repeatDays === 1 ? 'day' : 'days'} of their first visit with you. A customer who has not come back yet may still return.`),
    utilisation: t(`The time you spent with customers each day, out of a working day of ${hoursText(settings.hoursPerDay)} ${settings.hoursPerDay === 1 ? 'hour' : 'hours'}, averaged over the days you worked.`),
    feedback: t(`The average of the 1 to 5 ratings customers gave you on their feedback forms. It shows once there are ${forms} in the month, so one or two forms do not stand for a whole month.`),
    nps: t(`The share of customers who would recommend you (a 9 or 10) minus the share who would not (0 to 6), from the same forms. It shows once there are ${forms} with a recommend number.`),
    colleagues: `The average rating colleagues gave you, by kind of colleague: peers, your manager, C-level, and training and compliance. Peers count once ${PEER_MIN} have given feedback; the others once one has. You never see who gave it.`,
    own: 'A number your admin types in for you each month. It is shown just as it was typed.',
  };
}
