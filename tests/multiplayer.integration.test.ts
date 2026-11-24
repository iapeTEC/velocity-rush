import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Multiplayer } from '../src/network';
import { Simulation } from '../src/simulation';
import { Track } from '../src/track';
import type { PlayerState, Profile, Trap } from '../src/types';

// Runs real Multiplayer clients (Auth + Realtime Database emulators) against the production rules.
const dbHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST, authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const enabled = Boolean(dbHost && authHost);
const ns = 'demo-velocity-rush-e2e';
const track = new Track();
const profile = (name: string, color = '#62f5dd'): Profile => ({ name, vehicle: 'vortex', color });
const until = async (what: string, check: () => boolean, ms = 10000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error(`Tempo esgotado: ${what}`); await new Promise(r => setTimeout(r, 40)); }
};

describe.skipIf(!enabled)('Multiplayer de ponta a ponta no emulador', () => {
  const clients: Multiplayer[] = [];
  const errors: string[] = [];
  const states = new Map<Multiplayer, PlayerState[]>();
  const traps = new Map<Multiplayer, Trap[]>();
  const connect = async () => {
    const [host, port] = dbHost!.split(':');
    const client = await Multiplayer.connect({ apiKey: 'demo-key', projectId: 'demo-velocity-rush', databaseURL: `http://${host}:${port}?ns=${ns}`, emulator: { host, databasePort: Number(port), authPort: Number(authHost!.split(':')[1]) } });
    client.onError = message => errors.push(message);
    client.onStates = list => states.set(client, list);
    client.onTrap = trap => traps.set(client, [...(traps.get(client) ?? []), trap]);
    clients.push(client);
    await until('conexão', () => client.connected);
    return client;
  };

  beforeAll(async () => {
    const response = await fetch(`http://${dbHost}/.settings/rules.json?ns=${ns}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: readFileSync('firebase/database.rules.json', 'utf8') });
    expect(response.ok).toBe(true);
  });
  afterAll(async () => { await Promise.allSettled(clients.map(client => client.leave())); });

  it('sala de 4: entrar, lotar, largar, sincronizar, usar item, chegar e trocar de anfitrião', async () => {
    const [ana, bia, caio, duda, eva] = await Promise.all([connect(), connect(), connect(), connect(), connect()]);
    const code = await ana.create(profile('Ana'));
    expect(code).toMatch(/^[A-Z]{6}$/);

    // Three concurrent joins compete for slots 1–3; the fifth pilot must be refused.
    await Promise.all([bia.join(code, profile('Bia', '#ff39ba')), caio.join(code, profile('Caio', '#ffd34a')), duda.join(code, profile('Duda', '#70ffa8'))]);
    await until('4 pilotos no lobby', () => Object.keys(ana.room?.players ?? {}).length === 4);
    await expect(eva.join(code, profile('Eva'))).rejects.toThrow(/cheia/);
    await expect(eva.join('abc', profile('Eva'))).rejects.toThrow(/seis letras/);

    await expect(ana.start()).rejects.toThrow(/prontos/);
    await Promise.all([ana, bia, caio, duda].map(client => client.setReady(true)));
    await until('todos prontos', () => Object.values(ana.room!.players).every(p => p.ready));
    await expect(bia.start()).rejects.toThrow(/anfitrião/);
    await ana.start();
    await until('contagem em todos', () => [ana, bia, caio, duda].every(c => c.room?.status === 'countdown'));
    const startAt = ana.room!.startAt;
    expect([bia, caio, duda].every(c => c.room!.startAt === startAt)).toBe(true);
    await expect(eva.join(code, profile('Eva'))).rejects.toThrow(/começou/);

    await until('largada', () => ana.room?.status === 'racing', 9000);
    expect(ana.now()).toBeGreaterThanOrEqual(startAt);

    // Each client simulates and publishes its own car; everyone else receives interpolated snapshots.
    const sims = new Map([ana, bia, caio, duda].map(client => [client, new Simulation(track, profile(client === ana ? 'Ana' : 'Rival'), client.uid)]));
    const drive = async (ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        for (const [client, sim] of sims) { if (!sim.state.finished) sim.step(1 / 60, { throttle: 1, steer: 0, brake: false, drift: false, nitro: false }, client.now()); client.publish(sim.state); }
        await new Promise(r => setTimeout(r, 16));
      }
    };
    await drive(900);
    await until('estados remotos', () => [ana, bia, caio, duda].every(c => (states.get(c)?.length ?? 0) === 3));
    const seenByAna = states.get(ana)!.find(s => s.id === bia.uid)!;
    expect(seenByAna.name).toBe('Rival');
    expect(seenByAna.s).toBeGreaterThan(0);

    const biaSim = sims.get(bia)!;
    biaSim.state.item = 'oil';
    const trap = biaSim.useItem(bia.now())!;
    await bia.sendTrap(trap);
    await until('armadilha recebida', () => (traps.get(caio) ?? []).some(t => t.id === trap.id && t.owner === bia.uid));
    await expect(bia.sendTrap({ ...trap, id: `${trap.id}x` })).rejects.toThrow(/Aguarde/);

    // Arrival receipts are immutable copies of the final published state.
    for (const [client, sim] of sims) {
      Object.assign(sim.state, { finished: true, lap: 3, raceTime: 70 + clients.indexOf(client), bestLap: 23, speed: 0 });
      await client.finish(sim.state);
      expect((client as unknown as { receiptSent: boolean }).receiptSent).toBe(true);
    }
    await until('chegadas visíveis', () => (states.get(ana) ?? []).filter(s => s.finished).length === 3);

    // The host disconnects: the earliest remaining pilot takes over.
    const hostUid = ana.uid;
    await ana.leave();
    await until('novo anfitrião', () => !!bia.room && bia.room.host !== hostUid);
    expect([bia.uid, caio.uid, duda.uid]).toContain(bia.room!.host);
    expect(errors).toEqual([]);
  }, 40000);
});
