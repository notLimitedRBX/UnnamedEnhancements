import type { DeviceModule } from "./Device";

export const AttackSharkX1: DeviceModule = { getInfo(){ return { id:"attack-shark-x1", name:"Attack Shark X1", type:"Mouse", connected:false }; } };