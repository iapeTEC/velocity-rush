import type { Item, PlayerState, Profile, Q4, RoomPlayer, Trap, V3 } from './types';

const ITEMS:Item[]=['oil','emp','ice','block','shockwave','slow','orb','switch'];
export function normalizeCode(code:string):string {
  const value=code.trim().toUpperCase();
  if(!/^[A-Z]{6}$/.test(value)) throw new Error('Use o código de seis letras da sala.');
  return value;
}
export function sanitizeProfile(profile:Profile):Profile {
  const name=String(profile.name??'').replace(/\s+/g,' ').trim().slice(0,20);
  if(!name || !['vortex','phantom','titan'].includes(profile.vehicle) || !/^#[0-9a-fA-F]{6}$/.test(profile.color)) throw new Error('Nome, veículo ou cor inválidos.');
  return {name,vehicle:profile.vehicle,color:profile.color};
}
export function claimSlot(current:RoomPlayer|null,uid:string,profile:Profile,now:number):RoomPlayer|undefined {
  if(current?.connected && current.uid!==uid) return undefined;
  return {uid,profile:sanitizeProfile(profile),joinedAt:current?.uid===uid?current.joinedAt:now,connected:true,ready:current?.uid===uid?current.ready:false};
}
export function electHost(players:Record<string,RoomPlayer>):string|null {
  return Object.values(players).filter(p=>p.connected).sort((a,b)=>a.joinedAt-b.joinedAt||a.uid.localeCompare(b.uid))[0]?.uid??null;
}
function bounded(value:number,min:number,max:number):number {
  if(!Number.isFinite(value)||value<min||value>max) throw new Error('Estado de corrida inválido.');
  return value;
}
function vec(value:number[],size:number,limit:number):number[] {
  if(!Array.isArray(value)||value.length!==size) throw new Error('Vetor de corrida inválido.');
  return value.map(n=>bounded(n,-limit,limit));
}
export function sanitizeState(state:PlayerState,uid:string,now:number):PlayerState {
  const profile=sanitizeProfile(state);
  const item=state.item??null;
  if(item!==null&&!ITEMS.includes(item)) throw new Error('Item inválido.');
  return {id:uid,...profile,position:vec(state.position,3,100000) as V3,rotation:vec(state.rotation,4,1.01) as Q4,velocity:vec(state.velocity,3,1000) as V3,
    s:bounded(state.s,-100000,100000),speed:bounded(state.speed,-1000,1000),lap:bounded(state.lap,0,3),progress:bounded(state.progress,0,100000),nitro:bounded(state.nitro,0,100),item,
    drifting:!!state.drifting,boosting:!!state.boosting,shield:!!state.shield,grip:!!state.grip,finished:!!state.finished,
    raceTime:bounded(state.raceTime,0,86400),bestLap:bounded(state.bestLap,0,86400),penalty:bounded(state.penalty,0,86400),checkpoint:bounded(state.checkpoint,0,10000),connected:true,timestamp:bounded(now,0,1e15)};
}
export function sanitizeTrap(trap:Trap,uid:string,now:number):Trap {
  if(!ITEMS.includes(trap.kind)||!/^[-\w]{1,80}$/.test(trap.id)) throw new Error('Armadilha inválida.');
  const lifetime=bounded(trap.expiresAt-trap.createdAt,1,15000);
  const result:Trap={id:trap.id,owner:uid,kind:trap.kind,position:vec(trap.position,3,100000) as V3,s:bounded(trap.s,-100000,100000),lateral:bounded(trap.lateral,-1000,1000),createdAt:now,expiresAt:now+lifetime};
  if(trap.target) result.target=trap.target;
  return result;
}
export class PublishGate {
  private last=-Infinity;
  take(now:number):boolean {if(now-this.last<100)return false;this.last=now;return true;}
}
export function interpolateState(a:PlayerState,b:PlayerState,time:number):PlayerState {
  const t=Math.min(1,Math.max(0,(time-a.timestamp)/Math.max(1,b.timestamp-a.timestamp)));
  const mix=(x:number,y:number)=>x+(y-x)*t;
  const sign=a.rotation.reduce((sum,n,i)=>sum+n*b.rotation[i],0)<0?-1:1;
  const q=a.rotation.map((n,i)=>mix(n,b.rotation[i]*sign)) as Q4;
  const length=Math.hypot(...q)||1;
  return {...(t<1?a:b),position:a.position.map((n,i)=>mix(n,b.position[i])) as V3,rotation:q.map(n=>n/length) as Q4,velocity:a.velocity.map((n,i)=>mix(n,b.velocity[i])) as V3,s:mix(a.s,b.s),speed:mix(a.speed,b.speed),timestamp:time};
}
export class SnapshotBuffer {
  private frames=new Map<string,PlayerState[]>();
  push(states:PlayerState[]):void {
    const present=new Set(states.map(s=>s.id));
    for(const id of this.frames.keys()) if(!present.has(id))this.frames.delete(id);
    for(const state of states){
      const frames=this.frames.get(state.id)??[];
      if(!frames.length||state.timestamp>frames[frames.length-1].timestamp){frames.push(state);while(frames.length>12)frames.shift();this.frames.set(state.id,frames);}
    }
  }
  sample(now:number,delay=100):PlayerState[] {
    const time=now-delay;
    return [...this.frames.values()].map(frames=>{
      if(time<=frames[0].timestamp)return frames[0];
      for(let i=1;i<frames.length;i++) if(time<=frames[i].timestamp)return interpolateState(frames[i-1],frames[i],time);
      return frames[frames.length-1]; // Hold the last confirmed pose instead of extrapolating off the track.
    });
  }
  clear():void {this.frames.clear();}
}
