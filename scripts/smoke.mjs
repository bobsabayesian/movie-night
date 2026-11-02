// End-to-end smoke test against a local worker started with the mock Gemini:
//   cd worker && npx wrangler dev --var DEV_ADMIN:1 --var GEMINI_API_KEY:mock
//   node scripts/smoke.mjs
import config from '../shared/config.json' with { type: 'json' };

const HOST = process.env.HOST ?? 'localhost:8787';
const { id } = await (await fetch(`http://${HOST}/api/admin/lobby`, { method: 'POST' })).json();
const C = config.colors.map((c) => c.hex);

function client(path, name, color, token) {
  const c = { state: null, me: null, token: null, errors: [] };
  c.ws = new WebSocket(`ws://${HOST}${path}`);
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'joined') { c.me = m.playerId; c.token = m.token; }
    if (m.type === 'state') c.state = m.state;
    if (m.type === 'error') c.errors.push(m.message);
  };
  c.ready = new Promise((r) => (c.ws.onopen = () => { c.send({ type: 'join', name, color, token }); r(); }));
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, msg) => { if (!c) { console.error('FAIL', msg); process.exit(1); } console.log('ok  ', msg); };
const pl = (c, pid) => c.state.players.find((p) => p.id === pid);
const info = async () => (await fetch(`http://${HOST}/api/lobby/${id}/info`)).json();

const admin = client(`/api/admin/lobby/${id}/ws`, 'Host', C[0]);
let bob = client(`/api/lobby/${id}/ws`, 'Bob', C[1]);
await Promise.all([admin.ready, bob.ready]); await wait(300);
const adminId = admin.me, bobId = bob.me;
ok(pl(admin, bobId).color === C[1], 'player gets the color they picked');
ok((await info()).taken.length === 2, 'info endpoint lists taken colors');

const dupe = client(`/api/lobby/${id}/ws`, 'Cat', C[1]); await dupe.ready; await wait(300);
ok(dupe.me === null && /color/i.test(dupe.errors[0] ?? ''), 'taken color rejected');
const bad = client(`/api/lobby/${id}/ws`, 'Cat', '#000000'); await bad.ready; await wait(300);
ok(bad.me === null, 'color outside config rejected');
dupe.ws.close(); bad.ws.close();

// admin toggles
bob.send({ type: 'setEnabled', kind: 'style', value: 'Pirates', enabled: false }); await wait(200);
ok(!bob.state.disabledStyles.includes('Pirates'), 'non-admin cannot toggle styles');
admin.send({ type: 'setEnabled', kind: 'style', value: 'Pirates', enabled: false }); await wait(200);
ok(bob.state.disabledStyles.includes('Pirates'), 'admin disables a style');
admin.send({ type: 'setEnabled', kind: 'genre', value: 'Song', enabled: false }); await wait(200);
ok(bob.state.disabledGenres.includes('Song'), 'admin disables a genre');
admin.send({ type: 'setEnabled', kind: 'style', value: 'Nonsense', enabled: false }); await wait(200);
ok(admin.errors.at(-1) === 'Unknown option', 'unknown option rejected');

admin.send({ type: 'start', prompterId: bobId }); await wait(200);
bob.send({ type: 'submitPrompt', scene: 'x', style: 'y', difficulty: 'easy', genre: 'Song', parts: 2 }); await wait(300);
ok(bob.errors.at(-1) === 'That genre is not available' && bob.state.status === 'lobby', 'disabled genre rejected');

bob.send({ type: 'submitPrompt', scene: 'diner', style: 'Noir', difficulty: 'hard', genre: 'Movie', parts: 3 }); await wait(800);
ok(bob.state.status === 'acting', 'script generated');
ok(new Set(bob.state.current_script.map((l) => l.speaker)).size === 3, 'script has the requested 3 parts');
ok(bob.state.promptData.genre === 'Movie' && bob.state.promptData.parts === 3, 'genre and parts stored');

bob.send({ type: 'assignRoles', roles: { 'Character 1': adminId } }); await wait(200);
ok(!bob.state.rolesAssigned, 'incomplete casting rejected');
bob.send({ type: 'assignRoles', roles: { 'Character 1': adminId, 'Character 2': bobId, 'Character 3': bobId } }); await wait(200);
ok(bob.state.rolesAssigned, 'full casting accepted');
bob.send({ type: 'finishActing' }); await wait(200);

// nobody wins -> pass to admin, no points
bob.send({ type: 'skipRound', nextPrompterId: adminId }); await wait(400);
ok(bob.state.prompterId === adminId && bob.state.status === 'lobby', 'skipRound hands over to chosen player');
ok(bob.state.players.every((p) => p.score === 0), 'no points awarded on skip');
bob.send({ type: 'skipRound', nextPrompterId: bobId }); await wait(200);
ok(bob.state.prompterId === adminId, 'only the prompter can skip');

// round 2: admin prompts, bob wins (easy, 1 point)
admin.send({ type: 'submitPrompt', scene: 'diner', style: 'Western', difficulty: 'easy', genre: 'TV show', parts: 2 }); await wait(800);
admin.send({ type: 'assignRoles', roles: { 'Character 1': adminId, 'Character 2': bobId } }); await wait(200);
admin.send({ type: 'finishActing' }); await wait(200);
admin.send({ type: 'awardPoint', playerId: bobId }); await wait(500);
ok(pl(admin, bobId).score === 1 && admin.state.prompterId === bobId, 'win awards points and passes chooser');

// round 3: abandoned by admin reassigning the prompter
bob.send({ type: 'submitPrompt', scene: 'cafe', style: 'Musical', difficulty: 'easy', genre: 'Movie', parts: 2 }); await wait(800);
admin.send({ type: 'setPrompter', playerId: adminId }); await wait(400);

// running log in R2
const log = await (await fetch(`http://${HOST}/api/admin/log`)).json();
const mine = log.filter((r) => r.session === id).sort((a, b) => a.round - b.round);
ok(mine.length === 3, `3 rounds logged (got ${mine.length})`);
ok(mine[0].outcome === 'nobody' && mine[0].chooser === 'Bob' && mine[0].parts === '3', 'round 1: nobody won, chooser recorded');
ok(mine[1].outcome === 'won' && mine[1].winner === 'Bob' && mine[1].chooser === 'Host' && mine[1].points === '1', 'round 2: won, points recorded');
ok(mine[2].outcome === 'abandoned', 'round 3: abandoned');
ok(mine[0].key.startsWith('movie-night/rounds/'), 'log lives under movie-night/');

// rejoin keeps color and seat
const t = bob.token; bob.ws.close(); await wait(300);
bob = client(`/api/lobby/${id}/ws`, 'Bob', C[5], t); await bob.ready; await wait(300);
ok(bob.me === bobId && pl(bob, bobId).color === C[1], 'rejoin keeps seat and original color');
process.exit(0);
