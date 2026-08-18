export interface Device { id:string; name:string; type:string; connected:boolean; }
export interface DeviceModule { getInfo():Device; }