export type V3 = [number,number,number];
export type Q4 = [number,number,number,number];
export type Item = 'oil'|'emp'|'ice'|'block'|'shockwave'|'slow'|'orb'|'switch';
export type Booster = 'speed'|'nitro'|'super'|'shield'|'grip';
export interface Profile {name:string; vehicle:'vortex'|'phantom'|'titan'; color:string}
export interface Controls {throttle:number;steer:number;brake:boolean;drift:boolean;nitro:boolean}
export interface PlayerState {id:string;name:string;vehicle:Profile['vehicle'];color:string;position:V3;rotation:Q4;velocity:V3;s:number;speed:number;lap:number;progress:number;nitro:number;item:Item|null;drifting:boolean;boosting:boolean;shield:boolean;grip:boolean;finished:boolean;raceTime:number;bestLap:number;penalty:number;checkpoint:number;connected:boolean;timestamp:number}
export interface Trap {id:string;owner:string;kind:Item;position:V3;s:number;lateral:number;createdAt:number;expiresAt:number;target?:string}
export interface Pickup {id:string;s:number;lateral:number;kind:Booster|'item'}
export interface RaceResult {uid:string;name:string;raceTime:number;bestLap:number;position:number;participants:number;penalty:number;finishedAt:number}
export interface RoomPlayer {uid:string;profile:Profile;joinedAt:number;connected:boolean;ready:boolean}
export interface RoomData {code:string;host:string;status:'lobby'|'countdown'|'racing'|'finished';createdAt:number;startAt:number;players:Record<string,RoomPlayer>}
