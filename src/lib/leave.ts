export type LeaveRequest={request_type:string;start_date:string;end_date:string;status:string;amount_days?:number|null;amount_hours?:number|null};export type LeaveAdjustment={adjustment_type:string;adjustment_days:number;source_type?:string|null};
function toDateOnly(v:string|Date){const d=v instanceof Date?v:new Date(`${v}T00:00:00`);return new Date(d.getFullYear(),d.getMonth(),d.getDate())}
function completedMonths(j:Date,a:Date){let m=(a.getFullYear()-j.getFullYear())*12+(a.getMonth()-j.getMonth());if(a.getDate()<j.getDate())m-=1;return Math.max(0,m)}
function completedYears(j:Date,a:Date){let y=a.getFullYear()-j.getFullYear();const an=new Date(a.getFullYear(),j.getMonth(),j.getDate());if(a<an)y-=1;return Math.max(0,y)}
function addYears(d:Date,y:number){const r=new Date(d);r.setFullYear(r.getFullYear()+y);return r}
export function calculateLeaveEntitlement(joinedAtValue:string|null,asOfValue=new Date()){if(!joinedAtValue)return{baseGrantedDays:0,months:0,years:0,periodStart:null as string|null,periodEnd:null as string|null,description:"입사일 미등록"};const j=toDateOnly(joinedAtValue),a=toDateOnly(asOfValue),months=completedMonths(j,a),years=completedYears(j,a);const baseGrantedDays=years<1?Math.min(months,11):Math.min(25,15+Math.floor((years-1)/2));const s=addYears(j,years),e=addYears(s,1);e.setDate(e.getDate()-1);return{baseGrantedDays,months,years,periodStart:s.toISOString().slice(0,10),periodEnd:e.toISOString().slice(0,10),description:years<1?"1년 미만: 1개월 개근 시 1일":"1년 이상: 15일 + 장기근속 가산"}}
function countWeekdays(start:string,end:string){let d=toDateOnly(start);const last=toDateOnly(end);let c=0;while(d<=last){const day=d.getDay();if(day!==0&&day!==6)c++;d.setDate(d.getDate()+1)}return c}
export function requestToDays(req:LeaveRequest){if(req.request_type==="hourly")return 0;if(req.amount_days!=null)return Number(req.amount_days);if(req.amount_hours!=null)return Number(req.amount_hours)/8;if(req.request_type==="half_am"||req.request_type==="half_pm")return .5;return countWeekdays(req.start_date,req.end_date)}
export function calculateUsedDays(reqs:LeaveRequest[],includePending:boolean){const statuses=includePending?new Set(["approved","pending"]):new Set(["approved"]);const useTypes=new Set(["annual","half_am","half_pm","hourly","special","substitute","compensatory"]);return reqs.filter(r=>useTypes.has(r.request_type)).filter(r=>statuses.has(r.status)).reduce((s,r)=>s+requestToDays(r),0)}
export function calculateAdjustmentDays(adjs:LeaveAdjustment[]){return adjs.reduce((s,i)=>s+Number(i.adjustment_days||0),0)}
export function calculateCompTimeEarnedDays(adjs:LeaveAdjustment[]){return adjs.filter(i=>i.adjustment_type==="comp_time_earned").reduce((s,i)=>s+Number(i.adjustment_days||0),0)}


// ── 휴가 유형 메타 (시간/설명) ──────────────────────────────
export type LeaveTypeMeta = { label: string; time?: string; desc: string; usesLeave: boolean; fixedDays?: number };
export const LEAVE_TYPE_META: Record<string, LeaveTypeMeta> = {
  annual:      { label: "연차",       desc: "법정 연차 유급휴가입니다. 잔여 연차에서 차감됩니다.", usesLeave: true },
  half_am:     { label: "오전 반차",   time: "09:00 ~ 14:00", desc: "오전 근무를 쉽니다. 연차 0.5일이 차감됩니다.", usesLeave: true, fixedDays: 0.5 },
  half_pm:     { label: "오후 반차",   time: "14:00 ~ 18:00", desc: "오후 근무를 쉽니다. 연차 0.5일이 차감됩니다.", usesLeave: true, fixedDays: 0.5 },
  hourly:      { label: "시간차",     desc: "시간 단위로 사용하는 휴가입니다. 회사 휴가 기준에 따라 차감됩니다.", usesLeave: true },
  sick:        { label: "병가",       desc: "질병·부상으로 인한 휴가입니다. 회사 규정에 따릅니다(연차 미차감).", usesLeave: false },
  official:    { label: "공가",       desc: "예비군·법정 의무 등 공적 사유 휴가입니다(연차 미차감).", usesLeave: false },
  remote:      { label: "재택",       desc: "재택근무로 처리됩니다(휴가 아님, 연차 미차감).", usesLeave: false },
  field:       { label: "외근",       desc: "외부 근무로 처리됩니다(휴가 아님, 연차 미차감).", usesLeave: false },
  special:     { label: "특별휴가",   desc: "경조사 등 관리자가 부여한 특별휴가입니다. 부여된 잔여 내에서 사용합니다.", usesLeave: true },
  substitute:  { label: "대체휴가",   desc: "휴일근무 등에 대한 대체휴가입니다. 적립된 잔여 내에서 사용합니다.", usesLeave: true },
  compensatory:{ label: "보상휴가",   desc: "추가근무 보상휴가입니다. 적립된 잔여 내에서 사용합니다.", usesLeave: true },
};

// ── 4대보험 (2024~2025 기준 근로자/사업주 요율) ──────────────
// 국민연금 4.5/4.5, 건강보험 3.545/3.545, 장기요양 = 건강보험료 × 12.95%(노사 동일),
// 고용보험 0.9/0.9(+사업주 고용안정 0.25 등은 규모별이라 0.9 기준 단순화)
export function calcInsurance(monthly: number) {
  const pension_e = Math.floor(monthly * 0.045);
  const pension_c = Math.floor(monthly * 0.045);
  const health_e = Math.floor(monthly * 0.03545);
  const health_c = Math.floor(monthly * 0.03545);
  const care_e = Math.floor(health_e * 0.1295);
  const care_c = Math.floor(health_c * 0.1295);
  const emp_e = Math.floor(monthly * 0.009);
  const emp_c = Math.floor(monthly * 0.009);
  const employee = pension_e + health_e + care_e + emp_e;
  const company = pension_c + health_c + care_c + emp_c;
  return {
    pension_e, pension_c, health_e, health_c, care_e, care_c, emp_e, emp_c,
    employee, company,
    breakdown: [
      { name: "국민연금", e: pension_e, c: pension_c },
      { name: "건강보험", e: health_e, c: health_c },
      { name: "장기요양", e: care_e, c: care_c },
      { name: "고용보험", e: emp_e, c: emp_c },
    ],
  };
}

// 결근 공제 (월급 ÷ 30 × 결근일수)
export function calcAbsenceDeduction(monthly: number, absentDays: number) {
  return Math.floor((monthly / 30) * absentDays);
}
