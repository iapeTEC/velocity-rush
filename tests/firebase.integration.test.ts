import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { get, ref, runTransaction, set, update } from 'firebase/database';

const enabled=Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
const profile={name:'Pilot',vehicle:'vortex',color:'#ff6600'};
const player=(uid:string)=>({uid,profile,joinedAt:Date.now(),connected:true,ready:false});
const lobby=(uid='alice')=>({code:'ABCDEF',host:uid,createdAt:Date.now(),race:{status:'lobby',startAt:0},slots:{'0':player(uid)}});
const snapshot=(uid='alice')=>({id:uid,...profile,position:[0,0,0],rotation:[0,0,0,1],velocity:[0,0,0],s:0,speed:0,lap:0,progress:0,nitro:100,drifting:false,boosting:false,shield:false,grip:false,finished:false,raceTime:0,bestLap:0,penalty:0,checkpoint:0,connected:true,timestamp:Date.now()});

describe.skipIf(!enabled)('Firebase Realtime Database security and concurrency',()=>{
  let env:RulesTestEnvironment;
  const db=(uid:string)=>env.authenticatedContext(uid).database();
  beforeAll(async()=>{
    const [host,port]=process.env.FIREBASE_DATABASE_EMULATOR_HOST!.split(':');
    env=await initializeTestEnvironment({projectId:'demo-velocity-rush',database:{host,port:Number(port),rules:readFileSync('firebase/database.rules.json','utf8')}});
  });
  beforeEach(async()=>{await env.clearDatabase();await assertSucceeds(set(ref(db('alice'),'lobbies/ABCDEF'),lobby()));});
  afterAll(async()=>{await env?.cleanup();});
  it('denies anonymous reads and enumeration, and prevents outsider access to live state',async()=>{
    await assertFails(get(ref(env.unauthenticatedContext().database(),'lobbies/ABCDEF')));
    await assertFails(get(ref(db('bob'),'lobbies')));
    await assertSucceeds(get(ref(db('bob'),'lobbies/ABCDEF')));
    await assertFails(get(ref(db('bob'),'states/ABCDEF')));
  });
  it('allows only one of concurrent fourth-slot claims and denies a fifth slot',async()=>{
    await assertSucceeds(set(ref(db('bob'),'lobbies/ABCDEF/slots/1'),player('bob')));
    await assertSucceeds(set(ref(db('carol'),'lobbies/ABCDEF/slots/2'),player('carol')));
    const results=await Promise.all(['dave','erin'].map(async uid=>{
      try{return (await runTransaction(ref(db(uid),'lobbies/ABCDEF/slots/3'),current=>current?undefined:player(uid))).committed;}catch{return false;}
    }));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await get(ref(db('alice'),'lobbies/ABCDEF/slots'))).size).toBe(4);
    await assertFails(set(ref(db('frank'),'lobbies/ABCDEF/slots/4'),player('frank')));
  });
  it('blocks impersonation, duplicate slots, invalid physics, and too-fast snapshots',async()=>{
    await assertFails(set(ref(db('bob'),'lobbies/ABCDEF/slots/1'),player('alice')));
    await assertFails(set(ref(db('alice'),'lobbies/ABCDEF/slots/1'),player('alice')));
    await assertSucceeds(set(ref(db('alice'),'states/ABCDEF/alice'),snapshot()));
    await assertFails(set(ref(db('bob'),'states/ABCDEF/alice'),snapshot()));
    await assertFails(set(ref(db('alice'),'states/ABCDEF/alice'),{...snapshot(),speed:1000000}));
    const old=(await get(ref(db('alice'),'states/ABCDEF/alice'))).val();
    await assertFails(set(ref(db('alice'),'states/ABCDEF/alice'),{...old,timestamp:old.timestamp+20}));
  });
  it('requires all drivers ready and preserves start time and roster after host failover',async()=>{
    await set(ref(db('bob'),'lobbies/ABCDEF/slots/1'),player('bob'));
    const race={status:'countdown',startAt:Date.now()+5000,roster:{'0':'alice','1':'bob'}};
    await assertFails(set(ref(db('alice'),'lobbies/ABCDEF/race'),race));
    await update(ref(db('alice'),'lobbies/ABCDEF/slots/0'),{ready:true});
    await update(ref(db('bob'),'lobbies/ABCDEF/slots/1'),{ready:true});
    await assertFails(set(ref(db('bob'),'lobbies/ABCDEF/race'),race));
    await assertSucceeds(set(ref(db('alice'),'lobbies/ABCDEF/race'),race));
    await update(ref(db('alice'),'lobbies/ABCDEF/slots/0'),{connected:false});
    await assertSucceeds(set(ref(db('bob'),'lobbies/ABCDEF/host'),'bob'));
    await assertFails(set(ref(db('bob'),'lobbies/ABCDEF/race'),{...race,startAt:Date.now()+6000}));
    const saved=(await get(ref(db('bob'),'lobbies/ABCDEF/race'))).val();
    expect(saved.startAt).toBe(race.startAt); expect(Object.assign({},saved.roster)).toEqual({'0':'alice','1':'bob'});
  });
  it('binds traps to owners, bounds expiry, and enforces event cooldown',async()=>{
    const trap={id:'trap1',owner:'alice',kind:'oil',position:[0,0,0],s:10,lateral:0,createdAt:Date.now(),expiresAt:Date.now()+5000};
    await assertFails(set(ref(db('alice'),'traps/ABCDEF/alice'),{...trap,owner:'bob'}));
    await assertFails(set(ref(db('alice'),'traps/ABCDEF/alice'),{...trap,expiresAt:trap.createdAt+999999}));
    await assertSucceeds(set(ref(db('alice'),'traps/ABCDEF/alice'),trap));
    await assertFails(set(ref(db('alice'),'traps/ABCDEF/alice'),{...trap,id:'trap2',createdAt:trap.createdAt+10}));
  });
});
