// Stand-in for the Schuly API with made-up accounts, to look at the account pictures on Settings > Security & accounts.
// Usage: bun tools/account-pictures/fake-api.ts   (PORT=5157 by default), then in src/Schuly.Frontend:
//   bun run ng serve --port 4332 --proxy-config ../../tools/account-pictures/proxy.json
// Like the real API, every picture under /api/avatars needs the bearer token (401 without) and answers only the owner's ids (404).
const PORT = Number(process.env.PORT ?? 5157);
const TOKEN = 'test-token';

// Made-up people, drawn here so no photo of a real person is involved.
const person = (skin: string, hair: string, shirt: string, background: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background}"/>` +
  `<path d="M14 64c1-13 8-20 18-20s17 7 18 20z" fill="${shirt}"/><circle cx="32" cy="27" r="11" fill="${skin}"/>` +
  `<path d="M20 27c0-10 6-15 12-15s13 4 12 15c-2-5-6-8-12-8s-10 3-12 8z" fill="${hair}"/></svg>`;

const ids = { me: 'u1', schulnetz: '6f1c2b8e-1d2a-4c3b-9e8f-000000000001', microsoft: '6f1c2b8e-1d2a-4c3b-9e8f-000000000002', microsoftWork: '6f1c2b8e-1d2a-4c3b-9e8f-000000000003' };
const pictures: Record<string, string> = {
  [`/api/avatars/users/${ids.me}`]: person('#f2d0b5', '#4a3226', '#3d5a80', '#f6c28b'),
  [`/api/avatars/${ids.schulnetz}`]: person('#f2d0b5', '#4a3226', '#2a9d8f', '#e9f5db'),
  [`/api/avatars/accounts/${ids.microsoft}`]: person('#c68642', '#1b1b1b', '#e76f51', '#dbe9f6'),
};

const capability = (kind: string, label: string, basePath: string | null = null) => ({ kind, label, icon: null, basePath });
const accounts = [
  { providerId: 'schulnetz', providerName: 'Schulnetz', id: 'sn-1', title: 'Mia Muster', detail: 'schulnetz.example.ch', status: 'ok', linkedAt: '2026-09-01T08:00:00Z', capabilities: [capability('school_data', 'School data')], canReauth: true, pictureUrl: `/api/avatars/${ids.schulnetz}?v=1a2b3c` },
  { providerId: 'microsoft', providerName: 'Microsoft 365', id: ids.microsoft, title: 'Mia Muster', detail: 'mia.muster@school.example.ch', status: 'ok', linkedAt: '2026-09-02T08:00:00Z', capabilities: [capability('mail', 'Mail', '/api/plugins/microsoft/accounts')], canReauth: true, pictureUrl: `/api/avatars/accounts/${ids.microsoft}?v=4d5e6f` },
  { providerId: 'microsoft', providerName: 'Microsoft 365', id: ids.microsoftWork, title: 'Max Beispiel', detail: 'max.beispiel@lehrbetrieb.example.ch', status: 'expired', message: 'The sign-in expired. Link the account again.', linkedAt: '2026-09-03T08:00:00Z', capabilities: [capability('mail', 'Mail', '/api/plugins/microsoft/accounts')], canReauth: true, pictureUrl: null },
];
const providers = [
  { id: 'schulnetz', displayName: 'Schulnetz', description: 'Grades, absences and timetable.', icon: { lucide: 'graduation-cap' }, capabilities: [], flows: [{ id: 'password', label: 'Password' }], sortOrder: 1 },
  { id: 'microsoft', displayName: 'Microsoft 365', description: 'Mail, Teams, OneDrive, OneNote and calendar.', icon: { lucide: 'layout-grid' }, capabilities: [], flows: [{ id: 'password', label: 'Password' }], sortOrder: 2 },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(request) {
    const path = new URL(request.url).pathname.toLowerCase();
    if (path === '/auth/refresh') return json({ access_token: TOKEN, expires_in: 900, token_type: 'Bearer' });
    const signedIn = request.headers.get('authorization') === `Bearer ${TOKEN}`;
    if (path.startsWith('/api/') && !signedIn) return new Response(null, { status: 401 });
    if (path.startsWith('/api/avatars/')) {
      const svg = pictures[path];
      return svg ? new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=3600' } }) : new Response(null, { status: 404 });
    }
    if (path === '/api/auth/me') return json({ id: ids.me, externalId: ids.me, email: 'mia@example.org', displayName: 'Mia Muster', emailConfirmed: true, profilePictureUrl: `/api/avatars/users/${ids.me}?v=0a0b0c`, schoolUsers: [] });
    if (path === '/api/linking/accounts') return json(accounts);
    if (path === '/api/linking/providers') return json(providers);
    if (path === '/api/app') return json({ version: 'dev', registrationEnabled: true });
    return json([]);
  },
});
console.log(`fake account pictures api on ${PORT}`);
