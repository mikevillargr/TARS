export const MOCK_CHATS = [
  {
    id: 'c1',
    title: 'Q3 Strategy Planning',
    messages: [
      { id: 'm1', role: 'user', content: 'Summarize the key decisions from our Q3 strategy meeting and what I need to do before Monday.' },
      {
        id: 'm2', role: 'assistant', model: 'Qwen3 32B',
        toolCalls: ['Queried Second Brain', 'Retrieved Meeting: Weekly Sync'],
        content: `Here's the summary from the Q3 strategy meeting:\n\n**Decisions made:**\n1. Dashboard rollout moved from Q4 → Q3. This is now the top engineering priority.\n2. Analytics revamp paused until the new engineering lead is hired.\n3. Weekly sync moved to Tuesdays at 10am.\n\n**Your actions before Monday:**\n- Review and approve Charlie's engineering lead shortlist\n- Update the Q3 strategy doc with the new dashboard priority\n- Reply to Client X confirming the revised timeline`,
      },
      { id: 'm3', role: 'user', content: 'Create tasks for all three of those action items and assign them to me.' },
      {
        id: 'm4', role: 'assistant', model: 'Qwen3 32B',
        toolCalls: ['Created Task: Review engineering lead shortlist', 'Created Task: Update Q3 strategy doc', 'Created Task: Reply to Client X'],
        content: 'Done. Three tasks created and assigned to you, all due Monday May 30:\n\n1. Review engineering lead shortlist (High priority)\n2. Update Q3 strategy doc (High priority)\n3. Reply to Client X re: timeline (Normal priority)\n\nThey\'re in your Tasks inbox now.',
      },
    ],
  },
  {
    id: 'c2',
    title: 'Fix JWT refresh bug',
    messages: [
      { id: 'm5', role: 'user', content: 'The JWT refresh is breaking on mobile. Token expires mid-session and the user gets logged out. Check the auth module.' },
      {
        id: 'm6', role: 'assistant', model: 'Qwen3 32B',
        toolCalls: ['Queried Second Brain: JWT auth'],
        content: 'The issue is likely a race condition in the token refresh logic. When multiple requests fire simultaneously near expiry, each triggers a refresh — only one succeeds and the rest get 401s.\n\nFix: implement a refresh mutex so only one refresh runs at a time, and queue the others to wait for it. I can write the implementation if you want.',
      },
      { id: 'm7', role: 'user', content: 'Yes, write it. Use the existing pattern in src/auth/context.tsx.' },
      {
        id: 'm8', role: 'assistant', model: 'Claude Sonnet',
        toolCalls: ['Read: src/auth/context.tsx'],
        content: '```typescript\n// src/auth/refresh-mutex.ts\nlet refreshPromise: Promise<string> | null = null\n\nexport async function refreshWithMutex(\n  refreshFn: () => Promise<string>\n): Promise<string> {\n  if (refreshPromise) return refreshPromise\n  refreshPromise = refreshFn().finally(() => {\n    refreshPromise = null\n  })\n  return refreshPromise\n}\n```\n\nThen in context.tsx, replace the direct `refreshToken()` call with `refreshWithMutex(refreshToken)`. This ensures only one refresh runs at a time — concurrent callers share the same promise.',
      },
    ],
  },
  {
    id: 'c3',
    title: 'Acme Corp proposal review',
    messages: [
      { id: 'm9', role: 'user', content: 'Pull up the Acme Corp context and tell me where we are with the proposal.' },
      {
        id: 'm10', role: 'assistant', model: 'Qwen3 32B',
        toolCalls: ['Queried Second Brain: Acme Corp', 'Retrieved Memory: Acme Corp'],
        content: 'Here\'s the current Acme Corp status:\n\n**Proposal:** SOW v3 sent on May 23. Client confirmed Phase 1 scope and approved the timeline in Monday\'s kickoff meeting.\n\n**Open items:**\n- Signed SOW needs to go to Acme legal (due May 27 — today)\n- First security review session to be scheduled (Marcus Tan owns this, due May 28)\n\n**Hard constraint:** All deploys are gated on Acme\'s security review. This is a legal requirement, not negotiable.',
      },
    ],
  },
  {
    id: 'c4',
    title: 'Morning brief',
    messages: [
      { id: 'm11', role: 'user', content: 'Morning. What do I have today?' },
      {
        id: 'm12', role: 'assistant', model: 'Qwen3 8B',
        toolCalls: ['Queried Calendar', 'Queried Tasks', 'Retrieved Email Digest'],
        content: 'Good morning. Here\'s your day:\n\n**Meetings (2):**\n- 10:00 AM — Weekly Sync: Product Team (45 min, Fireflies recording)\n- 3:30 PM — 1:1 with Sarah (30 min)\n\n**Tasks due today (3):**\n- Send signed SOW to Acme legal (High)\n- Fix JWT refresh bug (Urgent)\n- Review Q3 strategy draft (High)\n\n**Email:** 42 threads overnight. 3 action items flagged — Client X approved the proposal. I\'ve queued the digest for your review.',
      },
    ],
  },
]

export const MOCK_MEETINGS = [
  { id: 'm1', title: 'Weekly Sync: Product Team', date: '2026-05-26T10:00:00Z', duration: '45m', source: 'Fireflies', summary: 'The team agreed to prioritize the new dashboard rollout for Q3. Charlie will finalize the engineering lead hire by Friday.', attendees: ['Alice Chen', 'Bob Patel', 'Charlie Wu'] },
  { id: 'm2', title: 'Client Kickoff: Acme Corp', date: '2026-05-25T14:00:00Z', duration: '60m', source: 'Fathom', summary: 'Acme Corp confirmed Phase 1 scope and approved the proposed timeline. Hard dependency on security review flagged.', attendees: ['David Reyes', 'Eve Larsson', 'Marcus Tan'] },
  { id: 'm3', title: '1:1 with Sarah', date: '2026-05-26T15:30:00Z', duration: '30m', source: 'Fireflies', summary: 'Processing transcript and summary…', attendees: ['Sarah Kim'] },
]

export const MOCK_TASKS = [
  { id: 't1', title: 'Review Q3 Strategy Draft', status: 'todo', source: 'Chat', priority: 'High', dueDate: '2026-05-27', assignee: 'Me', connector: null },
  { id: 't2', title: 'Follow up with Sarah on design assets', status: 'in-progress', source: 'Meeting', priority: 'Normal', dueDate: '2026-05-26', assignee: 'Me', connector: null },
  { id: 't3', title: 'Fix JWT refresh bug', status: 'in-progress', source: 'Manual', priority: 'Urgent', dueDate: '2026-05-26', assignee: 'Me', connector: 'Linear' },
  { id: 't4', title: 'Read "The Design of Everyday Things"', status: 'snoozed', source: 'Second Brain', priority: 'Low', dueDate: null, assignee: 'Me', connector: null },
  { id: 't5', title: 'Approve AWS invoice', status: 'done', source: 'Email', priority: 'High', dueDate: '2026-05-25', assignee: 'Me', connector: null },
]

export const MOCK_AGENT_JOBS = [
  { id: 'aj1', instruction: 'Refactor the authentication module to use the new context provider.', context: 'frontend-repo', status: 'Running', duration: '2m 14s', created: '2026-05-26T09:00:00Z' },
  { id: 'aj2', instruction: 'Scrape competitor pricing pages and generate a comparison CSV.', context: 'Web', status: 'Needs Input', duration: '5m 30s', created: '2026-05-26T08:30:00Z' },
  { id: 'aj3', instruction: 'Update dependencies in package.json and run tests.', context: 'backend-repo', status: 'Done', duration: '1m 45s', created: '2026-05-25T16:00:00Z' },
  { id: 'aj4', instruction: 'Deploy staging environment.', context: 'infra-repo', status: 'Failed', duration: '45s', created: '2026-05-25T15:00:00Z' },
]

export const MOCK_EMAIL_DIGESTS = [
  {
    id: 'ed1',
    date: '2026-05-26',
    threadCount: 42,
    actionItems: 3,
    summary: 'Mostly newsletters and automated alerts. Client X approved the proposal. Team needs your review on the latest PR.',
    actions: [
      { id: 'a1', text: 'Review latest PR from engineering team' },
      { id: 'a2', text: 'Reply to Client X with next steps' },
      { id: 'a3', text: 'Approve AWS invoice' },
    ],
    keyThreads: [
      { id: 'th1', from: 'Client X', subject: 'Proposal Approved - Next Steps', preview: "Looks great, let's move forward with the timeline proposed...", time: '10:42 AM' },
      { id: 'th2', from: 'GitHub', subject: 'PR #402: Auth Refactor', preview: 'Charlie Wu requested your review on this pull request.', time: '09:15 AM' },
    ],
  },
  {
    id: 'ed2',
    date: '2026-05-25',
    threadCount: 38,
    actionItems: 1,
    summary: 'Quiet day. AWS billing alert received and Sarah sent over the Q3 design assets.',
    actions: [{ id: 'a4', text: 'Review Q3 design assets from Sarah' }],
    keyThreads: [],
  },
  {
    id: 'ed3',
    date: '2026-05-24',
    threadCount: 51,
    actionItems: 2,
    summary: 'Heavy traffic on the Acme Corp thread. Security review forms need to be filled out.',
    actions: [
      { id: 'a5', text: 'Complete Acme Corp security questionnaire' },
      { id: 'a6', text: 'Schedule sync with Marcus regarding Acme' },
    ],
    keyThreads: [],
  },
]

export const MOCK_CRON_JOBS = [
  {
    id: 'cj1',
    name: 'Sync Linear Issues',
    schedule: 'Every hour',
    status: 'Active',
    enabled: true,
    lastRun: 'Success',
    nextRun: '10:00 AM',
    runHistory: [
      { timestamp: 'Today, 09:00 AM', status: 'Success', duration: '1.2s', output: 'Synced 14 issues. 2 new, 1 closed.' },
      { timestamp: 'Today, 08:00 AM', status: 'Success', duration: '1.1s', output: 'No changes.' },
    ],
  },
  {
    id: 'cj2',
    name: 'Daily Email Digest',
    schedule: 'Every day at 8:00 AM',
    status: 'Active',
    enabled: true,
    lastRun: 'Success',
    nextRun: 'Tomorrow 8:00 AM',
    runHistory: [
      { timestamp: 'Today, 08:00 AM', status: 'Success', duration: '4.5s', output: 'Processed 42 threads. Extracted 3 action items.' },
    ],
  },
  {
    id: 'cj3',
    name: 'Backup Second Brain',
    schedule: 'Every Sunday at 2:00 AM',
    status: 'Active',
    enabled: true,
    lastRun: 'Success',
    nextRun: 'Sunday 2:00 AM',
    runHistory: [
      { timestamp: 'May 24, 02:00 AM', status: 'Success', duration: '12.4s', output: 'Archived 1,402 items to S3 bucket.' },
    ],
  },
  {
    id: 'cj4',
    name: 'Scrape News Feeds',
    schedule: 'Every 4 hours',
    status: 'Failed',
    enabled: true,
    lastRun: 'Failed',
    nextRun: '12:00 PM',
    runHistory: [
      { timestamp: 'Today, 08:00 AM', status: 'Failed', duration: '30.1s', output: 'ERROR: Connection timed out after 30s.' },
    ],
  },
]

export const MOCK_CONNECTORS = [
  {
    id: 'con1',
    name: 'Gmail',
    status: 'Connected',
    lastSynced: 'Just now',
    capabilities: ['Read inbox', 'Send drafts', 'Apply labels', 'Watch threads'],
    recentWebhooks: [{ method: 'POST', path: '/webhook/gmail/push', status: 200, time: 'Just now' }],
  },
  {
    id: 'con2',
    name: 'Google Calendar',
    status: 'Connected',
    lastSynced: '2 mins ago',
    capabilities: ['Read events', 'Create events', 'Update events'],
    recentWebhooks: [],
  },
  {
    id: 'con3',
    name: 'Fireflies',
    status: 'Connected',
    lastSynced: '1 hour ago',
    capabilities: ['Read transcripts', 'Meeting webhook'],
    recentWebhooks: [{ method: 'POST', path: '/webhook/fireflies/meeting', status: 200, time: '1 hour ago' }],
  },
  {
    id: 'con4',
    name: 'Linear',
    status: 'Disconnected',
    lastSynced: 'Never',
    capabilities: ['Read issues', 'Create issues', 'Update status'],
    recentWebhooks: [],
  },
]

export const MOCK_ARTIFACTS = [
  {
    id: 'art1',
    name: 'Q3 Strategy Draft v0.4.md',
    type: 'Document',
    source: 'Chat',
    sourceLabel: 'Drafting Q3 Strategy',
    date: '2026-05-26T09:30:00Z',
    size: '14.2 KB',
    project: 'Internal',
    tags: ['strategy', 'q3'],
    preview: '# Q3 Strategy Draft v0.4\n\n## Product Expansion\nAccelerate the rollout of the new dashboard.\n\n## Client Retention\nImplement the proactive check-in system.',
    versions: [
      { label: 'v0.4', date: '2026-05-26T09:30:00Z', note: 'Reordered priorities' },
      { label: 'v0.3', date: '2026-05-24T15:10:00Z', note: 'Added hiring section' },
    ],
  },
  {
    id: 'art2',
    name: 'auth-refactor.diff',
    type: 'Code',
    source: 'Agent Job',
    sourceLabel: 'Refactor authentication module',
    date: '2026-05-26T09:14:00Z',
    size: '8.4 KB',
    project: 'frontend-repo',
    tags: ['auth', 'refactor'],
    preview: 'diff --git a/src/auth/context.tsx...\n@@ -12,7 +12,11 @@\n-  const [token, setToken] = useState(null)\n+  const [token, setToken] = useState(() => loadToken())',
    versions: [
      { label: 'v2', date: '2026-05-26T09:14:00Z', note: 'Added queue for concurrent refreshes' },
    ],
  },
  {
    id: 'art3',
    name: 'competitor-pricing.csv',
    type: 'Spreadsheet',
    source: 'Agent Job',
    sourceLabel: 'Scrape competitor pricing',
    date: '2026-05-26T08:45:00Z',
    size: '3.1 KB',
    project: 'Market Research',
    tags: ['pricing', 'research'],
    preview: 'Competitor,Tier,Monthly\nAcme,Starter,29\nAcme,Pro,79',
    versions: [
      { label: 'v1', date: '2026-05-26T08:45:00Z', note: 'Initial scrape' },
    ],
  },
  {
    id: 'art4',
    name: 'Weekly Sync Transcript — May 26.txt',
    type: 'Transcript',
    source: 'Meeting',
    sourceLabel: 'Weekly Sync: Product Team',
    date: '2026-05-26T10:48:00Z',
    size: '22.7 KB',
    project: 'Internal',
    tags: ['meeting', 'transcript'],
    preview: "[00:00] Alice Chen: Let's get started.\n[00:45] Bob Patel: We need to accelerate the dashboard rollout.",
    versions: [
      { label: 'v1', date: '2026-05-26T10:48:00Z', note: 'Auto-generated from Fireflies' },
    ],
  },
  {
    id: 'art5',
    name: 'Daily Digest — May 26.md',
    type: 'Report',
    source: 'Cron',
    sourceLabel: 'Daily Email Digest',
    date: '2026-05-26T08:00:30Z',
    size: '4.8 KB',
    project: 'Internal',
    tags: ['digest', 'email'],
    preview: '# Daily Digest — May 26\n\n42 threads · 3 action items',
    versions: [
      { label: 'v1', date: '2026-05-26T08:00:30Z', note: 'Auto-generated' },
    ],
  },
]

export const MOCK_MEMORIES = [
  { id: 'mem1', domain: 'Work', source: 'Meeting', importance: 9, date: '2026-05-26', content: 'Dashboard rollout moved to Q3. Charlie leads engineering hire, Alice owns Q3 strategy doc update by Monday.' },
  { id: 'mem2', domain: 'Client', source: 'Meeting', importance: 8, date: '2026-05-25', content: 'Acme Corp Phase 1 is 10 weeks. All deploys gated on their security review. Hard deadline, no slip.' },
  { id: 'mem3', domain: 'Health', source: 'Chat', importance: 7, date: '2026-05-22', content: 'Mike has a standing desk setup and tracks HRV daily. Morning workouts preferred when schedule allows.' },
  { id: 'mem4', domain: 'Cycling', source: 'Chat', importance: 6, date: '2026-05-20', content: 'Training for PBP 2027. Current weekly volume around 250km. Uses Wahoo ELEMNT for navigation.' },
  { id: 'mem5', domain: 'Work', source: 'Email', importance: 8, date: '2026-05-19', content: 'Growth Rocket Q2 revenue target is ₱18M. Currently tracking at ₱14.2M with 6 weeks remaining.' },
  { id: 'mem6', domain: 'Personal', source: 'Chat', importance: 5, date: '2026-05-15', content: 'Prefers Lola\'s in BGC for team lunches. Allergic to shellfish.' },
  { id: 'mem7', domain: 'Work', source: 'Second Brain', importance: 9, date: '2026-05-10', content: 'NCH Inc SOW signed for 12-month retainer. Primary contact is Denise Tan, Marketing Director.' },
]

export const MOCK_SECOND_BRAIN = [
  { id: 'sb1', title: 'How to configure Wahoo ELEMNT for randonneuring', type: 'url', domain: 'Cycling', collection: 'Bike Builds', tags: ['wahoo', 'navigation', 'randonneuring'], date: '2026-05-24', url: 'https://example.com/wahoo-elemnt-randonneuring', excerpt: 'Step-by-step guide to configuring screen layouts, routing fallbacks, and battery modes for 200km+ brevets.' },
  { id: 'sb2', title: 'The Design of Everyday Things — Notes', type: 'note', domain: 'Personal', collection: 'Dev Resources', tags: ['design', 'ux', 'books'], date: '2026-05-22', url: null, excerpt: 'Affordances are the perceived and actual properties of a thing, primarily those fundamental properties that determine how it can possibly be used.' },
  { id: 'sb3', title: 'Acme Corp Security Review Checklist v2', type: 'file', domain: 'Client', collection: 'Client Research', tags: ['acme', 'security', 'checklist'], date: '2026-05-20', url: null, excerpt: 'Pre-deployment security checklist provided by Acme Corp legal. SOC2 compliance required for all data processing endpoints.' },
  { id: 'sb4', title: 'pgvector distance operators explained', type: 'url', domain: 'Work', collection: 'Dev Resources', tags: ['postgres', 'pgvector', 'embeddings'], date: '2026-05-18', url: 'https://example.com/pgvector-operators', excerpt: 'Covers <-> (L2 distance), <#> (inner product), and <=> (cosine distance). Use cosine for normalized embeddings.' },
  { id: 'sb5', title: 'HRV training zones guide', type: 'url', domain: 'Health', collection: 'Health & Rehab', tags: ['hrv', 'training', 'recovery'], date: '2026-05-15', url: 'https://example.com/hrv-zones', excerpt: 'When HRV is more than 5ms below your 7-day average, reduce intensity. Green zone: proceed as planned.' },
  { id: 'sb6', title: 'OpenRice PH competitive analysis', type: 'file', domain: 'Client', collection: 'Client Research', tags: ['openrice', 'competitive', 'analysis'], date: '2026-05-12', url: null, excerpt: 'Zomato holds 38% share in Metro Manila restaurant discovery. OpenRice strength is in transaction volume and Cantonese cuisine niche.' },
]
