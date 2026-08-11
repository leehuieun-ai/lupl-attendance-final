export type CurrentPosition={lat:number;lng:number;accuracy:number|null};
function positionErrorMessage(error?:GeolocationPositionError){
  if(error?.code===1) return "위치 권한이 차단되어 있습니다. 브라우저 설정에서 위치 권한을 허용한 뒤 다시 시도해 주세요.";
  if(error?.code===2) return "현재 위치를 확인하지 못했습니다. GPS 또는 Wi-Fi를 켠 뒤 다시 시도해 주세요.";
  if(error?.code===3) return "위치 확인 시간이 초과되었습니다. 잠시 기다렸다가 다시 시도해 주세요.";
  return "위치 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
function requestPosition(options:PositionOptions):Promise<CurrentPosition>{return new Promise((resolve,reject)=>{if(!navigator.geolocation){reject(new Error("이 브라우저는 위치 확인을 지원하지 않습니다."));return}navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy??null}),error=>reject(new Error(positionErrorMessage(error))),options)})}
export async function getCurrentPositionFast(){
  const attempts:PositionOptions[]=[
    {enableHighAccuracy:true,timeout:15000,maximumAge:0},
    {enableHighAccuracy:false,timeout:18000,maximumAge:60000},
    {enableHighAccuracy:true,timeout:30000,maximumAge:0},
  ];
  let lastError:unknown=null;
  for(const options of attempts){
    try{return await requestPosition(options);}catch(error){lastError=error;}
  }
  throw lastError instanceof Error ? lastError : new Error("위치 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
export function distanceMeters(lat1:number,lng1:number,lat2:number,lng2:number){const r=6371000;const toRad=(v:number)=>v*Math.PI/180;const p1=toRad(lat1),p2=toRad(lat2),dp=toRad(lat2-lat1),dl=toRad(lng2-lng1);const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return r*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
export async function getPublicIp(){try{const r=await fetch("https://api.ipify.org?format=json");const j=await r.json();return j.ip??null}catch{return null}}
