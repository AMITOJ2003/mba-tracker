// Default plan, loaded on first launch and on "Reset to default plan".
export const SECTIONS = ['Quant', 'Verbal', 'Data Insights', 'Mock', 'Review'];
export const TAGS = ['Confirmed', 'Expected', 'Personal'];
export const DATE_STATUSES = ['Upcoming', 'Done', 'Missed', 'Skipped'];
export const MOCK_SOURCES = [
  'Official Practice Exam 1', 'Official Practice Exam 2', 'Official Practice Exam 3',
  'Official Practice Exam 4', 'Official Practice Exam 5', 'Official Practice Exam 6',
  'GMAT Club', 'e-GMAT', 'Target Test Prep', 'Manhattan Prep', 'Kaplan', 'Other',
];
export const CP_STATUSES = ['Not started', 'In progress', 'Done', 'Missed'];

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

let seq = 0;
const phase = (name, start, end, exit, tasks) => ({
  id: `p${++seq}`,
  name,
  start,
  end,
  exit,
  open: false,
  tasks: tasks.map((text, i) => ({ id: `p${seq}t${i + 1}`, text, done: false })),
});

let dseq = 0;
const date = (d, title, tag, extra = {}) => ({
  id: `d${++dseq}`,
  date: d,
  title,
  tag,
  status: 'Upcoming',
  optional: false,
  note: '',
  ...extra,
});

export function defaultState() {
  seq = 0;
  dseq = 0;
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    lastBackup: null,
    updatedAt: 0,
    deleted: {},
    settings: {
      gmatTarget: 715,
      gmatMin: 695,
      weeklyHoursGoal: 15,
      weeklyHoursMin: 12,
      firstAttempt: '2027-06-05',
      finalScoreBy: '2027-08-31',
      program: 'ISB PGP Round 1 (Class of 2029)',
    },
    scoreCheckpoints: [
      { id: 'c1', date: '2027-03-31', score: 665 },
      { id: 'c2', date: '2027-05-15', score: 700 },
      { id: 'c3', date: '2027-06-05', score: 715 },
    ],
    phases: [
      phase('Diagnose', '2026-11-12', '2026-12-31', 'Baseline score + gap to 715', [
        'Take the free official GMAT Focus practice exam on mba.com',
        'Note section scores and gap to 715',
        'Buy one structured course + GMAT Official Guide',
        'Fix a 12–15 h weekly schedule',
        'Start an error log',
      ]),
      phase('Build concepts', '2027-01-01', '2027-03-31', '~665+ on an official practice exam by Mar 31', [
        'Book GMAT for early June by Jan 31',
        'Quant: speed and accuracy (no geometry)',
        'Verbal: critical reasoning first, then reading comprehension',
        'Data Insights: data sufficiency, tables/graphs, two-part, multi-source',
        'One timed section test per week from February',
      ]),
      phase('Full mocks', '2027-04-01', '2027-05-31', '700+ on official mocks by mid-May', [
        'One full timed mock per week, with a review longer than the test',
        'Save official exams for the last 6 weeks',
        'If under 700 by mid-May, move the exam 3–4 weeks',
      ]),
      phase('Test', '2027-06-01', '2027-08-31', 'Final score 695+, ideally 715+', [
        'First attempt early June',
        'If under 695, one targeted retake in July/Aug (16-day minimum gap)',
        'Send scores to ISB and SPJIMR',
      ]),
      phase('Applications', '2027-06-01', '2027-11-30', 'ISB Round 1 submitted', [
        'June – one-line post-MBA goal',
        'June – finish ARPL impact sheet',
        'July – brief recommender (outside the family) and draft ISB essays',
        'Aug – final essays and resume reviewed by 2 people',
        'Sep – submit ISB R1 3+ days early',
        'Oct–Nov – SPJIMR application, optional CAT registration',
      ]),
      phase('Interviews & decision', '2027-10-01', '2028-03-31', 'Offer accepted', [
        'Mock interviews on ARPL work, reason for leaving and goals',
        'Optional CAT on 2027-11-28',
        'Compare offers and decide by March 2028',
      ]),
    ],
    dates: [
      date('2026-11-22', 'Free official GMAT practice exam', 'Personal'),
      date('2027-01-31', 'Book GMAT test-centre slot', 'Personal'),
      date('2027-06-05', 'First GMAT attempt', 'Personal'),
      date('2027-07-15', 'ISB PGP R1 form opens', 'Expected'),
      date('2027-08-31', 'Final GMAT score deadline', 'Personal'),
      date('2027-09-15', 'SPJIMR PGDM 2028–30 form opens', 'Expected'),
      date('2027-09-15', 'CAT 2027 registration closes', 'Expected', { optional: true }),
      date('2027-09-20', 'ISB PGP Round 1 deadline (Class of 2029)', 'Expected'),
      date('2027-11-26', 'SPJIMR application deadline', 'Expected'),
      date('2027-11-28', 'CAT 2027 exam', 'Expected', { optional: true }),
      date('2027-12-06', 'ISB Round 2 deadline', 'Expected'),
      date('2027-12-31', 'ISB Round 1 decision', 'Expected'),
      date('2028-01-17', 'ISB Round 3 deadline', 'Expected'),
      date('2028-03-31', 'ISB work-experience cut-off (24+ months)', 'Confirmed', { note: 'Confirmed rule' }),
    ],
    sessions: [],
    scores: [],
    goals: [],
    checkpoints: [
      ['2026-11', 'Diagnostic done; baseline noted'],
      ['2026-12', 'Course + Official Guide bought; schedule running; error log started'],
      ['2027-01', 'GMAT booked; Quant and critical reasoning basics done'],
      ['2027-03', '665+ on an official practice exam; impact sheet started'],
      ['2027-05', '700+ on official mocks; exam date confirmed or moved'],
      ['2027-06', 'GMAT taken; impact sheet and post-MBA goal finished'],
      ['2027-08', 'Final GMAT score; essays final; recommender briefed'],
      ['2027-09', 'ISB Round 1 submitted'],
      ['2027-11', 'SPJIMR submitted; CAT (if chosen); interview prep under way'],
      ['2028-03', 'Offer accepted'],
    ].map(([month, text]) => ({ id: `m${month}`, month, text, status: 'Not started' })),
  };
}

// Fill in anything missing (older backups, partial imports).
export function normalizeState(s) {
  const d = defaultState();
  const arr = (v, fallback) => (Array.isArray(v) ? v : fallback);
  return {
    ...d,
    ...s,
    settings: { ...d.settings, ...(s.settings || {}) },
    scoreCheckpoints: arr(s.scoreCheckpoints, d.scoreCheckpoints),
    phases: arr(s.phases, d.phases).map((p) => ({ ...p, id: p.id || uid(), tasks: arr(p.tasks, []).map((t) => ({ ...t, id: t.id || uid() })) })),
    dates: arr(s.dates, d.dates).map((x) => ({ status: 'Upcoming', tag: 'Personal', optional: false, note: '', ...x, id: x.id || uid() })),
    sessions: arr(s.sessions, []).map((x) => ({ ...x, id: x.id || uid(), minutes: Number(x.minutes) || 0 })),
    scores: arr(s.scores, []).map((x) => ({ ...x, id: x.id || uid(), official: x.official ?? /^official/i.test(x.source || '') })),
    deleted: s.deleted && typeof s.deleted === 'object' ? s.deleted : {},
    goals: arr(s.goals, []).map((x) => ({ ...x, id: x.id || uid() })),
    checkpoints: arr(s.checkpoints, d.checkpoints).map((x) => ({ status: 'Not started', ...x, id: x.id || uid() })),
  };
}
