import { describe, expect, it } from 'vitest';
import { claimSlot, electHost, interpolateState, normalizeCode, sanitizeProfile, sanitizeState, sanitizeTrap, SnapshotBuffer, PublishGate } from '../src/network-utils';
import type { PlayerState, RoomPlayer } from '../src/types';

const profile = {name:'Pilot',vehicle:'vortex' as const,color:'#12abEF'};
const player = (uid:string, joinedAt:number, connected=true):RoomPlayer => ({uid,profile,joinedAt,connected,ready:false});
const state = (timestamp=1000,x=0):PlayerState => ({id:'pilot',...profile,position:[x,0,0],rotation:[0,0,0,1],velocity:[10,0,0],s:0,speed:10,lap:0,progress:0,nitro:50,item:null,drifting:false,boosting:false,shield:false,grip:false,finished:false,raceTime:0,bestLap:0,penalty:0,checkpoint:0,connected:true,timestamp});

describe('private lobby and identity', () => {
  it('normalizes an invitation but rejects paths and nonletter codes', () => {
    expect(normalizeCode(' abcdef ')).toBe('ABCDEF');
    for (const code of ['ABCDE','ABC/EF','ABC12F','ABCDEFG']) expect(()=>normalizeCode(code)).toThrow();
  });
  it('does not overwrite an occupied slot during a concurrent claim', () => {
    expect(claimSlot(player('alice',1),'bob',profile,2)).toBeUndefined();
    expect(claimSlot(null,'bob',profile,2)?.uid).toBe('bob');
    expect(claimSlot(player('alice',1,false),'bob',profile,2)?.uid).toBe('bob');
  });
  it('elects the earliest remaining connected driver after the host leaves', () => {
    expect(electHost({a:player('alice',1,false),b:player('bob',3),c:player('carol',2)})).toBe('carol');
    expect(electHost({a:player('alice',1,false)})).toBeNull();
  });
  it('cleans displayed names and rejects invalid vehicle/color data', () => {
    expect(sanitizeProfile({...profile,name:'  Pilot\n One  '}).name).toBe('Pilot One');
    expect(()=>sanitizeProfile({...profile,color:'url(evil)'})).toThrow();
    expect(()=>sanitizeProfile({...profile,vehicle:'unknown'} as never)).toThrow();
  });
});

describe('bounded snapshots and interpolation', () => {
  it('overwrites identity and time and rejects non-finite physics values', () => {
    const result=sanitizeState(state(),'real',2000);
    expect(result.id).toBe('real'); expect(result.timestamp).toBe(2000);
    expect(()=>sanitizeState({...state(),position:[NaN,0,0]},'real',2000)).toThrow();
    expect(()=>sanitizeState({...state(),speed:Infinity},'real',2000)).toThrow();
  });
  it('limits sends to ten per second even if render rate is much higher', () => {
    const gate=new PublishGate();
    const accepted=[];
    for(let time=0;time<1000;time+=5) if(gate.take(time)) accepted.push(time);
    expect(accepted).toEqual([0,100,200,300,400,500,600,700,800,900]);
  });
  it('interpolates positions and uses the short quaternion arc', () => {
    const a=state(1000,0),b={...state(1100,10),rotation:[0,0,0,-1] as [number,number,number,number]};
    const middle=interpolateState(a,b,1050);
    expect(middle.position[0]).toBe(5); expect(Math.abs(middle.rotation[3])).toBe(1);
    expect(interpolateState(a,b,900).position[0]).toBe(0);
    expect(interpolateState(a,b,1300).position[0]).toBe(10);
  });
  it('drops out of order snapshots, removes absent peers, and samples a delayed timeline', () => {
    const buffer=new SnapshotBuffer();
    buffer.push([state(1000,0)]); buffer.push([state(1100,10)]); buffer.push([state(1050,99)]);
    expect(buffer.sample(1150)[0].position[0]).toBe(5);
    buffer.push([]); expect(buffer.sample(1200)).toEqual([]);
  });
  it('validates trap duration and binds the owner to the authenticated driver', () => {
    const trap={id:'trap-one',owner:'fake',kind:'oil' as const,position:[0,0,0] as [number,number,number],s:10,lateral:0,createdAt:1,expiresAt:5001};
    expect(sanitizeTrap(trap,'real',1000)).toMatchObject({owner:'real',createdAt:1000,expiresAt:6000});
    expect(()=>sanitizeTrap({...trap,position:[Infinity,0,0]},'real',1000)).toThrow();
  });
});
