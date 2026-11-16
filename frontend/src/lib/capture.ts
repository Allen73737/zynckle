// Natural-language task capture: "Ship onboarding fri !high @ada #northstar ~review"
export type Parsed = { title: string; date: string | null; dateLabel: string | null; priority: string | null; assignee: { id: string; name: string } | null; project: { id: string; name: string } | null; status: string | null };

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
export const friendlyDate = (value: string) => {
  const today = iso(new Date());
  if (value === today) return 'Today';
  if (value === iso(addDays(1))) return 'Tomorrow';
  return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`));
};

const DATE_PATTERNS: [RegExp, (m: RegExpMatchArray) => Date | null][] = [
  [/\b(today|tonight|eod)\b/i, () => addDays(0)],
  [/\b(tomorrow|tmrw|tmr)\b/i, () => addDays(1)],
  [/\bnext week\b/i, () => addDays(7)],
  [/\bin (\d{1,3}) (day|days|week|weeks)\b/i, m => addDays(Number(m[1]) * (m[2].startsWith('week') ? 7 : 1))],
  [/\b(\d{4})-(\d{2})-(\d{2})\b/, m => new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)],
  [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})\b/i, m => {
    const d = new Date(new Date().getFullYear(), MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2]), 12);
    if (d < addDays(-1)) d.setFullYear(d.getFullYear() + 1);
    return d;
  }],
  [/\b(?:next |on )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?\b/i, m => {
    const target = DAYS.findIndex(day => day.startsWith(m[1].toLowerCase().slice(0, 3)));
    // "fri" / "next fri" both mean the upcoming Friday; the same weekday means a week from today.
    const delta = (target - new Date().getDay() + 7) % 7 || 7;
    return addDays(delta);
  }],
];

const PRIORITY: Record<string, string> = { '!urgent': 'Urgent', '!!!': 'Urgent', p1: 'Urgent', '!high': 'High', '!!': 'High', p2: 'High', '!normal': 'Normal', p3: 'Normal', '!low': 'Low', p4: 'Low' };
const STATUS: Record<string, string> = { '~backlog': 'Backlog', '~todo': 'To do', '~progress': 'In progress', '~doing': 'In progress', '~review': 'In review', '~done': 'Done' };

/** Parse a capture string against the workspace's members and projects. */
export function parseCapture(input: string, members: { id: string; name: string; email?: string }[], projects: { id: string | number; name: string }[]): Parsed {
  let text = ` ${input} `;
  const take = (match: string) => { text = text.replace(match, ' '); };
  let priority: string | null = null;
  for (const token of Object.keys(PRIORITY)) {
    const re = new RegExp(`(^|\\s)${token.replace(/[!]/g, '\\!')}(?=\\s)`, 'i');
    const m = text.match(re);
    if (m) { priority = PRIORITY[token]; take(m[0]); break; }
  }
  let status: string | null = null;
  const sm = text.match(/(^|\s)(~\w+)(?=\s)/);
  if (sm && STATUS[sm[2].toLowerCase()]) { status = STATUS[sm[2].toLowerCase()]; take(sm[0]); }
  let assignee: Parsed['assignee'] = null;
  const am = text.match(/(^|\s)@([\w.-]+)(?=\s)/);
  if (am) {
    const needle = am[2].toLowerCase();
    const found = members.find(m => m.name.toLowerCase().split(/\s+/)[0] === needle || m.name.toLowerCase().replace(/\s+/g, '') === needle || m.email?.split('@')[0].toLowerCase() === needle)
      || members.find(m => m.name.toLowerCase().startsWith(needle));
    if (found) { assignee = { id: found.id, name: found.name }; take(am[0]); }
  }
  let project: Parsed['project'] = null;
  const pm = text.match(/(^|\s)#([\w.-]+)(?=\s)/);
  if (pm) {
    const needle = pm[2].toLowerCase().replace(/[-_.]/g, '');
    const found = projects.find(p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === needle) || projects.find(p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(needle));
    if (found) { project = { id: String(found.id), name: found.name }; take(pm[0]); }
  }
  let date: string | null = null;
  for (const [re, toDate] of DATE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const d = toDate(m);
    if (d && !Number.isNaN(d.getTime())) { date = iso(d); take(m[0]); break; }
  }
  return { title: text.replace(/\s+/g, ' ').trim(), date, dateLabel: date ? friendlyDate(date) : null, priority, assignee, project, status };
}
