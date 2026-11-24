import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const code = readFileSync(new URL('../apps-script/Validation.js', import.meta.url), 'utf8');
const api: any = {};
runInNewContext(`${code}\nthis.api = { validateRace, safeCell, aggregateResults, verifyClaims };`, api);
const { validateRace, safeCell, aggregateResults, verifyClaims } = api.api;
const ticket = { uid: 'player-1', issuedAt: 100000, expiresAt: 1300000 };
const result = { uid:'player-1', name:'Ada', raceTime:90, bestLap:28, penalty:5, position:1, participants:4, finishedAt:190000 };
const proof = { laps:[28,34,28], checkpoints:Array.from({length:3}, () => Array.from({length:12}, (_,i) => i)) };

describe('ranking server validation', () => {
  it('accepts plausible complete laps but never trusts client victory or player count', () => {
    expect(validateRace(result, proof, ticket, 'player-1', 190000)).toMatchObject({ participants:1, position:1, victories:0, score:0, mode:'time-trial', raceTime:90 });
  });
  it('rejects another identity, expired tickets and a race submitted too soon', () => {
    expect(() => validateRace(result, proof, ticket, 'player-2', 190000)).toThrow();
    expect(() => validateRace(result, proof, ticket, 'player-1', 1400000)).toThrow();
    expect(() => validateRace(result, proof, ticket, 'player-1', 105000)).toThrow();
  });
  it('rejects incomplete, skipped or reordered checkpoints and forged lap totals', () => {
    expect(() => validateRace(result, { ...proof, checkpoints:[[0,2], ...proof.checkpoints.slice(1)] }, ticket, 'player-1', 190000)).toThrow();
    expect(() => validateRace(result, { ...proof, laps:[2,2,81] }, ticket, 'player-1', 190000)).toThrow();
    expect(() => validateRace(result, { ...proof, laps:[28,28,28] }, ticket, 'player-1', 190000)).toThrow();
  });
  it('rejects invalid numeric inputs and sanitizes spreadsheet formulas', () => {
    expect(() => validateRace({...result,raceTime:Infinity}, proof, ticket, 'player-1', 190000)).toThrow();
    expect(() => validateRace({...result,penalty:-5}, proof, ticket, 'player-1', 190000)).toThrow();
    expect(safeCell(' =IMPORTXML("x")')).toBe("'=IMPORTXML(\"x\")");
    expect(safeCell('\t+SUM(1)')).toBe("'+SUM(1)");
  });
  it('derives public best times from attempts and counts a ticket only once', () => {
    const rows = [
      { ticket:'one', uid:'a', name:'Ada', bestLap:30,raceTime:95, finishedAt:100 },
      { ticket:'two', uid:'a', name:'Ada', bestLap:28,raceTime:90, finishedAt:200 },
      { ticket:'two', uid:'a', name:'Ada', bestLap:28,raceTime:90, finishedAt:200 },
      { ticket:'three', uid:'b', name:'Bob', bestLap:29,raceTime:92, finishedAt:300 }
    ];
    expect(aggregateResults(rows)).toEqual([
      {uid:'a',name:'Ada',bestLap:28,bestRace:90,races:2,victories:0,score:0,updatedAt:200,mode:'time-trial'},
      {uid:'b',name:'Bob',bestLap:29,bestRace:92,races:1,victories:0,score:0,updatedAt:300,mode:'time-trial'}
    ]);
  });
  it('requires the configured Firebase project, anonymous identity and nonexpired claims', () => {
    const claims={aud:'my-project',iss:'https://securetoken.google.com/my-project',sub:'player-1',exp:2000,iat:1000,firebase:{sign_in_provider:'anonymous'}};
    expect(verifyClaims(claims,'my-project','player-1',1500000)).toBe('player-1');
    expect(() => verifyClaims({...claims,aud:'elsewhere'},'my-project','player-1',1500000)).toThrow();
    expect(() => verifyClaims(claims,'my-project','someone-else',1500000)).toThrow();
    expect(() => verifyClaims(claims,'my-project','player-1',2500000)).toThrow();
  });
  it('awards server-computed points once all start-roster tickets have validated results', () => {
    const first={ticket:'one',uid:'a',name:'Ada',raceTime:90,bestLap:28,finishedAt:100,roomKey:'ABCDEF:10',roster:['a','b']};
    const second={...first,ticket:'two',uid:'b',name:'Bob',raceTime:92};
    expect(aggregateResults([first])[0]).toMatchObject({score:0,victories:0,mode:'time-trial'});
    expect(aggregateResults([first,second,second])).toMatchObject([
      {uid:'a',score:100,victories:1,mode:'multiplayer'},
      {uid:'b',score:60,victories:0,mode:'multiplayer'}
    ]);
  });
});
