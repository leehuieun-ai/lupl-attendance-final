import { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getDeviceFingerprint } from "./lib/device";
import { getCurrentPositionFast, getPublicIp, distanceMeters } from "./lib/geo";
import {
  calculateAdjustmentDays, calculateLeaveEntitlement, calculateUsedDays,
  LEAVE_TYPE_META, calcInsurance, calcAbsenceDeduction,
} from "./lib/leave";
import { exportRowsToExcel } from "./lib/exportExcel";

type Tab = "attendance" | "leave" | "overtime" | "admin-dashboard" | "approvals" | "employees" | "workplaces" | "schedule" | "payroll" | "reports" | "consents";

const DAY_LABELS: Record<string, string> = { mon:"월", tue:"화", wed:"수", thu:"목", fri:"금", sat:"토", sun:"일" };
const ALL_DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const CONTRACT_LABELS: Record<string,string> = { daily:"상시(매일)", weekly_n:"주 N일 고정", fixed_term:"기간제" };
const SCHEDULE_EVENT_META: Record<string,{label:string;icon:string}> = {
  work:{label:"근무 예정",icon:"ti-briefcase"},
  am_only:{label:"오전만 가능",icon:"ti-sun"},
  pm_only:{label:"오후만 가능",icon:"ti-moon"},
  unavailable:{label:"출근 불가",icon:"ti-ban"},
  info:{label:"교육·학기·기타",icon:"ti-book"},
};
const EMPLOYEE_COLORS = ["#2563eb","#059669","#ea580c","#dc2626","#7c3aed","#0891b2","#b45309","#4f46e5","#65a30d","#be185d"];

const workplaceTypeLabels: Record<string,string> = { office:"사무실", special_school:"특수학교", external_education:"외부 교육장", remote:"재택", other_field:"기타 외근지" };
const requestTypeLabels: Record<string,string> = { annual:"연차", half_am:"오전 반차", half_pm:"오후 반차", hourly:"시간차", sick:"병가", official:"공가", remote:"재택", field:"외근", special:"특별휴가", substitute:"대체휴가", compensatory:"보상휴가", time_fix:"근무시간 수정", comp_leave_use:"대체휴가 시간 사용" };
const REQUEST_TYPES_UI = ["annual","half_am","half_pm","hourly","sick","official","special","substitute","compensatory"];
const SINGLE_DAY_TYPES = ["half_am","half_pm","hourly","comp_leave_use"];

function internalEmail(no: string) { return `${no.trim().toLowerCase()}@lupl.local`; }
function won(n: number) { return Math.round(n).toLocaleString("ko-KR") + "원"; }
function escapeHtml(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* 휴대폰 자동 하이픈 */
function formatPhone(v: string) {
  const d = v.replace(/[^0-9]/g, "").slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 7) return `${d.slice(0,3)}-${d.slice(3)}`;
  if (d.length < 11) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
}

/* KST 기준 날짜/시간 (Supabase UTC 저장값 표시 보정) */
function kstDate(d: Date | string = new Date()) {
  const base = typeof d === "string" ? new Date(d) : d;
  return new Date(base.getTime() + 9 * 3600000);
}
function localDateStr(d: Date | string = new Date()) {
  const kst = kstDate(d);
  return kst.toISOString().slice(0, 10);
}
function isToday(iso?: string | null) { return !!iso && localDateStr(iso) === todayIso(); }
function todayIso() { return localDateStr(); }
function monthDay(iso?: string | null) {
  if (!iso) return "-";
  return localDateStr(iso).slice(5, 10);
}
function isWeekendDate(iso?: string | null) {
  if (!iso) return false;
  const day = kstDate(iso).getUTCDay();
  return day === 0 || day === 6;
}

function formatDateTime(v?: string | null) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(v));
}
function timeOnly(v?: string | null) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Seoul" }).format(new Date(v));
}
function clockText(d: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(d);
}
function byCheckInDesc(a:any,b:any) {
  return new Date(b?.check_in_time ?? b?.created_at ?? 0).getTime() - new Date(a?.check_in_time ?? a?.created_at ?? 0).getTime();
}
function uniqueLogs(list:any[]) {
  const seen = new Set<string>();
  return list.filter((l:any)=>{ if(!l?.id || seen.has(l.id)) return false; seen.add(l.id); return true; });
}
function calculateApprovedCompDays(compRequests:any[]) {
  return uniqueCompRequests(compRequests)
    .reduce((sum:number,r:any)=>sum+Number(r.converted_days||0),0);
}
function compRequestKey(r:any) {
  return [
    r.employee_id ?? "",
    r.work_date ?? "",
    r.start_time ?? "",
    r.end_time ?? "",
    Number(r.hours || 0).toFixed(2),
  ].join("|");
}
function uniqueCompRequests(list:any[]) {
  const seen = new Set<string>();
  return list.filter((r:any)=>{
    if(r.status!=="approved") return false;
    const key=compRequestKey(r);
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function badgeClass(s?: string | null) {
  if (!s) return "";
  if (["approved","정상출근","시차출근","외근","재택","active"].includes(s)) return "good";
  if (["rejected","반려","inactive","지각","결근"].includes(s)) return "bad";
  return "warn";
}
function workedMinutes(inT?: string | null, outT?: string | null) {
  if (!inT || !outT) return null;
  const a = new Date(inT).getTime(), b = new Date(outT).getTime();
  if (b <= a) return 0;
  let min = Math.round((b - a) / 60000);
  const ls = new Date(inT); ls.setHours(12,0,0,0);
  const le = new Date(inT); le.setHours(13,0,0,0);
  min -= Math.round(Math.max(0, Math.min(b, le.getTime()) - Math.max(a, ls.getTime())) / 60000);
  return Math.max(0, min);
}
function fmtMin(m: number | null) {
  if (m == null) return "-";
  const h = Math.floor(m/60), mm = m%60;
  return `${h}시간${mm>0?" "+mm+"분":""}`;
}
function timeDiffHours(start: string, end: string) {
  const [sh,sm] = start.split(":").map(Number);
  const [eh,em] = end.split(":").map(Number);
  const diff = (eh*60+em) - (sh*60+sm);
  return diff > 0 ? Math.round(diff/6)/10 : 0;
}
function numberValue(v:any){return Number(String(v??"").replace(/[^0-9.]/g,""))||0;}
function moneyInput(v:any){return (Number(String(v??"").replace(/[^0-9]/g,""))||0).toLocaleString("ko-KR");}
function scheduleHours(start?:string|null,end?:string|null){return start&&end?timeDiffHours(String(start).slice(0,5),String(end).slice(0,5)):8;}
function isFullTimeEmployee(employee:any){
  const days=Array.isArray(employee?.work_days)?employee.work_days.length:Number(employee?.weekly_work_days||0);
  const hours=scheduleHours(employee?.work_start,employee?.work_end);
  return employee?.contract_type==="daily"&&days>=5&&hours>=8;
}
function timeToMinutes(time?: string | null) {
  if (!time) return null;
  const [h, m] = String(time).slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}
function kstDateTime(dateIso: string, time?: string | null) {
  const hhmm = String(time || "18:00").slice(0, 5);
  return new Date(`${dateIso}T${hhmm}:00+09:00`);
}
function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60000);
}
function approvedOrPendingCompRequests(list:any[]) {
  return list.filter((r:any)=>["approved","pending"].includes(r.status));
}
function latestCompEndForDate(compRequests:any[], dateIso:string) {
  return approvedOrPendingCompRequests(compRequests)
    .filter((r:any)=>r.work_date===dateIso&&r.end_time)
    .reduce((latest:Date|null,r:any)=>{
      let end=kstDateTime(dateIso,r.end_time);
      const startMin=timeToMinutes(r.start_time);
      const endMin=timeToMinutes(r.end_time);
      if(startMin!=null&&endMin!=null&&endMin<=startMin) end=addMinutes(end,24*60);
      return !latest||end.getTime()>latest.getTime()?end:latest;
    },null);
}
function checkoutReminderTarget(log:any, employee:any, overrides:any[], compRequests:any[]) {
  if(!log?.check_in_time||log?.check_out_time) return null;
  const dateIso=localDateStr(log.check_in_time);
  const sched=getScheduleForDate(employee,dateIso,overrides);
  const startMin=timeToMinutes(sched.work_start) ?? 9*60;
  const endMin=timeToMinutes(sched.work_end) ?? 18*60;
  const shiftSpanMinutes=endMin>startMin ? endMin-startMin : (24*60-startMin)+endMin;
  const checkIn=new Date(log.check_in_time);
  let target=addMinutes(checkIn,shiftSpanMinutes);
  const compEnd=latestCompEndForDate(compRequests,dateIso);
  return compEnd&&compEnd.getTime()>target.getTime()?compEnd:target;
}
function readSentReminderKeys() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem("lupl_checkout_reminders_sent") || "[]"));
  } catch {
    return new Set<string>();
  }
}
function isIosLike() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalonePwa() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || (navigator as any).standalone === true;
}
async function showBrowserNotification(title: string, options: NotificationOptions = {}) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
      return true;
    }
  } catch {/**/}
  try {
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch {
    return false;
  }
}

function dateFromIso(iso: string) { return new Date(`${iso}T00:00:00`); }
function addLocalDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function isoDate(d: Date) { const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,"0"); const dd=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${dd}`; }
function dayKeyFromDate(d: Date) { return ["sun","mon","tue","wed","thu","fri","sat"][d.getDay()]; }
function weekStartIso(dateIso: string) { const d=dateFromIso(dateIso); const offset=(d.getDay()+6)%7; return isoDate(addLocalDays(d,-offset)); }
function weekOfMonthLabel(dateIso: string) { const d=dateFromIso(dateIso); const first=new Date(d.getFullYear(), d.getMonth(), 1); const offset=(first.getDay()+6)%7; const nth=Math.ceil((d.getDate()+offset)/7); return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${nth}째주`; }
function dateInRange(dateIso:string, start?:string|null, end?:string|null) { if(!start) return true; if(dateIso<start) return false; if(end&&dateIso>end) return false; return true; }
function countDaysInclusive(start:string, end:string) { const s=dateFromIso(start), e=dateFromIso(end); return Math.max(0, Math.round((e.getTime()-s.getTime())/86400000)+1); }
function addIsoDays(iso:string,days:number){return isoDate(addLocalDays(dateFromIso(iso),days));}
function employeeScheduleColor(employeeId:string){
  let hash=0;
  for(let i=0;i<employeeId.length;i++) hash=(hash*31+employeeId.charCodeAt(i))>>>0;
  return EMPLOYEE_COLORS[hash%EMPLOYEE_COLORS.length];
}
function employeeColorFromList(employees:any[],employeeId:string){
  const ordered=[...employees].sort((a,b)=>String(a.employee_no??a.id).localeCompare(String(b.employee_no??b.id)));
  const index=ordered.findIndex(e=>e.id===employeeId);
  return index>=0?EMPLOYEE_COLORS[index%EMPLOYEE_COLORS.length]:employeeScheduleColor(employeeId);
}
function monthDates(anchor:string){
  const d=dateFromIso(anchor);
  const start=new Date(d.getFullYear(),d.getMonth(),1);
  const end=new Date(d.getFullYear(),d.getMonth()+1,0);
  return Array.from({length:end.getDate()},(_,i)=>isoDate(addLocalDays(start,i)));
}
function scheduleEventLanes(events:any[]){
  const laneEnds:string[]=[];
  return [...events].sort((a,b)=>a.start_date.localeCompare(b.start_date)||a.end_date.localeCompare(b.end_date)).map(event=>{
    let lane=laneEnds.findIndex(end=>end<event.start_date);
    if(lane<0){lane=laneEnds.length;laneEnds.push(event.end_date);}else laneEnds[lane]=event.end_date;
    return {...event,lane};
  });
}
function getScheduleForDate(emp:any, dateIso:string, overrides:any[]=[]) {
  if(!emp) return {work_days:["mon","tue","wed","thu","fri"], work_start:"09:00", work_end:"18:00"};
  const weekStart=weekStartIso(dateIso);
  const ov=overrides.find((o:any)=>o.employee_id===emp.id && o.week_start===weekStart);
  return {
    work_days: ov?.work_days ?? emp.work_days ?? ["mon","tue","wed","thu","fri"],
    work_start: ov?.work_start ?? emp.work_start ?? "09:00",
    work_end: ov?.work_end ?? emp.work_end ?? "18:00",
  };
}
function attendanceDisplay(emp:any,log:any,overrides:any[]){
  if(!log) return {primary:"미출근",primaryClass:"",workType:null,lateMinutes:0,scheduleStart:null};
  const reviewStatuses=["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음","확인 완료","관리자 강제퇴근"];
  const dateIso=localDateStr(log.check_in_time);
  const schedule=getScheduleForDate(emp,dateIso,overrides);
  const scheduledStart=timeToMinutes(schedule.work_start);
  const checkedIn=kstDate(log.check_in_time);
  const actualMinutes=checkedIn.getUTCHours()*60+checkedIn.getUTCMinutes();
  const lateMinutes=scheduledStart==null?0:Math.max(0,actualMinutes-scheduledStart);
  const workplaceType=log.workplaces?.type;
  const workType=workplaceType==="remote"||log.status==="재택"?"재택":["special_school","external_education","other_field"].includes(workplaceType)||log.status==="외근"?"외근":null;
  if(reviewStatuses.includes(log.status)||["지각","결근"].includes(log.status)) return {primary:log.status,primaryClass:badgeClass(log.status),workType,lateMinutes,scheduleStart:schedule.work_start};
  return {primary:lateMinutes>=1?"지각":"정상출근",primaryClass:lateMinutes>=1?"bad":"good",workType,lateMinutes,scheduleStart:schedule.work_start};
}
function countScheduledWorkdays(emp:any, startIso:string, endIso:string, overrides:any[]=[]) {
  let count=0; let d=dateFromIso(startIso); const end=dateFromIso(endIso);
  while(d<=end){ const iso=isoDate(d); const sched=getScheduleForDate(emp, iso, overrides); if((sched.work_days??[]).includes(dayKeyFromDate(d))) count++; d=addLocalDays(d,1); }
  return count;
}
function countUnpaidAbsenceWorkdays(emp:any, absences:any[], startIso:string, endIso:string, overrides:any[]=[]) {
  let count=0;
  absences.filter((a:any)=>a.employee_id===emp?.id && a.unpaid).forEach((a:any)=>{
    let d=dateFromIso(a.start_date); const e=dateFromIso(a.end_date);
    while(d<=e){ const iso=isoDate(d); if(iso>=startIso&&iso<=endIso){ const sched=getScheduleForDate(emp, iso, overrides); if((sched.work_days??[]).includes(dayKeyFromDate(d))) count++; } d=addLocalDays(d,1); }
  });
  return count;
}
function currentMonthRange() { const now=new Date(); const start=new Date(now.getFullYear(), now.getMonth(), 1); const end=new Date(now.getFullYear(), now.getMonth()+1, 0); return {start:isoDate(start), end:isoDate(end)}; }


async function fetchCurrentEmployee() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { session: null, employee: null };
  const { data } = await supabase.from("employees").select("*").eq("user_id", session.user.id).maybeSingle();
  return { session, employee: data };
}


// ── 토글 섹션 ─────────────────────────────────────────────────
function CollapsibleSection({ title, icon, children, defaultOpen=false }: { title:string; icon:string; children:React.ReactNode; defaultOpen?: boolean }) {
  const [open,setOpen]=useState(defaultOpen);
  return (
    <div style={{marginTop:16}}>
      <button className="collapsible-btn" onClick={()=>setOpen(o=>!o)}>
        <i className={`ti ${icon}`} aria-hidden="true"></i>
        {title}
        <i className={`ti ${open?"ti-chevron-up":"ti-chevron-down"}`} style={{marginLeft:"auto"}} aria-hidden="true"></i>
      </button>
      {open&&<div style={{marginTop:12}}>{children}</div>}
    </div>
  );
}

// ── 오늘 근무형태 선택 (출퇴근 탭) ──────────────────────────────
function WorkTypeToggle({ employee, todayLog, onChanged }: { employee:any; todayLog:any|null; onChanged:()=>void }) {
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState("");
  async function setWorkType(type:string) {
    if(!todayLog?.id) return setMsg("오늘 출근 기록이 없습니다. 출근 후 선택해주세요.");
    setBusy(true);
    const {error}=await supabase.rpc("update_my_attendance_status",{p_log_id:todayLog.id,p_status:type});
    if(error) setMsg(error.message); else { setMsg(`근무형태가 '${type}'(으)로 설정되었습니다.`); onChanged(); setOpen(false); }
    setBusy(false);
  }
  const current=todayLog?.status??"기록 없음";
  const isSpecial=["외근","재택"].includes(current);
  return (
    <div style={{marginTop:8}}>
      <button className="collapsible-btn" onClick={()=>setOpen(o=>!o)} style={{background:isSpecial?"#eef3fe":undefined}}>
        <i className="ti ti-map-pin-check" aria-hidden="true"></i>
        오늘 근무형태{isSpecial?<span style={{marginLeft:6,color:"var(--blue)",fontWeight:700}}>· {current}</span>:null}
        <i className={`ti ${open?"ti-chevron-up":"ti-chevron-down"}`} style={{marginLeft:"auto"}} aria-hidden="true"></i>
      </button>
      {open&&(
        <div className="work-type-grid">
          {["외근","재택","정상출근"].map(t=>(
            <button key={t} className={`work-type-btn ${current===t?"active":""}`} disabled={busy} onClick={()=>setWorkType(t)}>{t}</button>
          ))}
        </div>
      )}
      {msg&&<p className="subtle" style={{marginTop:6,textAlign:"center"}}>{msg}</p>}
    </div>
  );
}

// ── 추가근무 승인 내역 직원별 + 삭제 ────────────────────────────
function ApprovedCompCard({ compRequests, empMap, onChanged }: { compRequests:any[]; empMap:Record<string,any>; onChanged:()=>void }) {
  const [filterEmpId,setFilterEmpId]=useState("");
  const [msg,setMsg]=useState("");
  const approved=uniqueCompRequests(compRequests);
  const shown=filterEmpId?approved.filter(r=>r.employee_id===filterEmpId):approved;
  const shownHours=shown.reduce((sum,r)=>sum+Number(r.hours||0),0);
  const shownDays=shown.reduce((sum,r)=>sum+Number(r.converted_days||0),0);
  async function deleteComp(id:string) {
    if(!window.confirm("이 추가근무 적립을 삭제할까요? 해당 직원의 대체휴가 잔여가 줄어듭니다.")) return;
    await supabase.from("leave_adjustments").delete().eq("source_type","comp_time_requests").eq("source_id",id);
    const {error}=await supabase.from("comp_time_requests").delete().eq("id",id);
    if(error) setMsg(error.message); else onChanged();
  }
  if(approved.length===0) return null;
  const activeEmps=Array.from(new Set(approved.map(r=>r.employee_id))).map(id=>empMap[id]).filter(Boolean);
  return (
    <section className="card">
      <h2 className="card-title"><i className="ti ti-clock-check" aria-hidden="true"></i>추가근무 적립 내역</h2>
      <div className="form-row" style={{marginBottom:12}}>
        <select className="select" value={filterEmpId} onChange={e=>setFilterEmpId(e.target.value)}>
          <option value="">전체 직원</option>
          {activeEmps.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      {msg&&<div className="alert error">{msg}</div>}
      <div className="table-wrap">
        <table>
          <caption className="table-summary">합계 {shownHours.toFixed(1)}시간 · {shownDays.toFixed(2)}일</caption>
          <thead><tr><th>직원</th><th>날짜</th><th>시간</th><th>적립일수</th><th>사유</th><th></th></tr></thead>
          <tbody>
            {shown.map(r=>(
              <tr key={r.id}>
                <td><b>{empMap[r.employee_id]?.name??"-"}</b></td>
                <td>{r.work_date}</td>
                <td>{r.hours}시간</td>
                <td>{r.converted_days}일</td>
                <td className="subtle">{r.reason??"-"}</td>
                <td><button className="button danger" onClick={()=>deleteComp(r.id)}>삭제</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [pw1, setPw1] = useState(""); const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState(""); const [ok, setOk] = useState(false);
  async function save() {
    setMsg("");
    if (pw1.length < 6) return setMsg("비밀번호는 6자 이상이어야 합니다.");
    if (pw1 !== pw2) return setMsg("두 비밀번호가 일치하지 않습니다.");
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    if (error) setMsg(error.message); else setOk(true);
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="card-title" style={{ margin: 0 }}><i className="ti ti-lock" aria-hidden="true"></i>비밀번호 변경</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {ok ? (
          <div><div className="alert success">비밀번호가 변경되었습니다.</div><button className="button full" onClick={onClose}>닫기</button></div>
        ) : (
          <div>
            <div className="form-row"><label className="label">새 비밀번호</label><input className="input" type="password" value={pw1} onChange={e => setPw1(e.target.value)} placeholder="6자 이상" /></div>
            <div className="form-row"><label className="label">새 비밀번호 확인</label><input className="input" type="password" value={pw2} onChange={e => setPw2(e.target.value)} /></div>
            {msg && <div className="alert error">{msg}</div>}
            <button className="button full" onClick={save}>변경</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmModal({ title, children, confirmText, cancelText="취소", onConfirm, onCancel, busy=false }: { title:string; children:React.ReactNode; confirmText:string; cancelText?:string; onConfirm:()=>void|Promise<void>; onCancel:()=>void; busy?:boolean }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="card-title" style={{margin:0}}>{title}</h2>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="body-text" style={{marginBottom:16}}>{children}</div>
        <div className="modal-actions">
          <button className="button ghost" disabled={busy} onClick={onCancel}>{cancelText}</button>
          <button className="button" disabled={busy} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [employee, setEmployee] = useState<any | null>(null);
  const [consent, setConsent] = useState<any | null>(null);
  const [tab, setTab] = useState<Tab>("attendance");
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [showPwModal, setShowPwModal] = useState(false);
  const [mobileNavOpen,setMobileNavOpen]=useState(false);

  async function load() {
    const r = await fetchCurrentEmployee();
    setSession(r.session); setEmployee(r.employee);
    if (r.employee) {
      const { data } = await supabase.from("privacy_consents").select("*").eq("employee_id", r.employee.id).eq("is_active", true).maybeSingle();
      setConsent(data);
      if (r.employee.role === "admin") {
        const [w, rq, c, d, lg] = await Promise.all([
          supabase.from("workplaces").select("id, approval_status"),
          supabase.from("attendance_requests").select("id, status"),
          supabase.from("comp_time_requests").select("id, status"),
          supabase.from("registered_devices").select("id, status"),
          supabase.from("attendance_logs").select("id, status, check_in_time, check_out_time"),
        ]);
        setPendingCount(
          (w.data??[]).filter((x:any)=>x.approval_status==="pending").length +
          (rq.data??[]).filter((x:any)=>x.status==="pending").length +
          (c.data??[]).filter((x:any)=>x.status==="pending").length +
          (d.data??[]).filter((x:any)=>x.status==="pending").length +
          (lg.data??[]).filter((x:any)=>{
            const openToday=!x.check_out_time&&isToday(x.check_in_time);
            if(x.status==="확인 완료"||openToday) return false;
            return !x.check_out_time||["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음"].includes(x.status);
          }).length
        );
      } else setPendingCount(0);
    } else setConsent(null);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const { data } = supabase.auth.onAuthStateChange(() => setTimeout(load, 0));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signOut() { await supabase.auth.signOut(); setSession(null); setEmployee(null); setConsent(null); }

  if (loading) return <div className="container" style={{ paddingTop: 48, textAlign: "center", color: "#8b94a6" }}>불러오는 중…</div>;
  if (!session) return <LoginPage />;
  if (!employee) return <div className="container"><section className="card auth-card"><h1 className="card-title">직원 정보가 없습니다</h1><p className="subtle">관리자 계정의 employees.user_id 연결을 확인해주세요.</p><button className="button full" onClick={signOut}>로그아웃</button></section></div>;
  if (!employee.is_active || employee.employment_status !== "active") return <InactivePage signOut={signOut} />;
  if (!consent) return <ConsentGate employee={employee} onDone={load} signOut={signOut} />;
  const isAdmin = employee.role === "admin";
  const pageTitles:Record<Tab,string>={
    attendance:"출퇴근",
    leave:"휴가",
    overtime:"추가근무",
    "admin-dashboard":"직원 현황",
    approvals:"승인 관리",
    employees:"직원 관리",
    workplaces:"근무지 관리",
    schedule:"근무 일정",
    payroll:"급여 계산",
    reports:"근태 보고서",
    consents:"직원 동의서",
  };
  const personalMenus:{id:Tab;label:string;icon:string}[]=[
    {id:"attendance",label:"출퇴근",icon:"ti-clock"},
    {id:"leave",label:"휴가",icon:"ti-calendar"},
    {id:"overtime",label:"추가근무",icon:"ti-clock-plus"},
  ];
  const adminMenus:{id:Tab;label:string;icon:string;badge?:number}[]=[
    {id:"admin-dashboard",label:"직원 현황",icon:"ti-layout-dashboard"},
    {id:"approvals",label:"승인 관리",icon:"ti-shield-check",badge:pendingCount},
    {id:"employees",label:"직원 관리",icon:"ti-users"},
    {id:"workplaces",label:"근무지 관리",icon:"ti-map-pin"},
    {id:"schedule",label:"근무 일정",icon:"ti-calendar-time"},
    {id:"payroll",label:"급여 계산",icon:"ti-coin"},
  ];
  function go(next:Tab){setTab(next);setMobileNavOpen(false);}
  function menuButton(item:{id:Tab;label:string;icon:string;badge?:number}){
    return <button key={item.id} className={`side-nav-item ${tab===item.id?"active":""}`} onClick={()=>go(item.id)}><i className={`ti ${item.icon}`} aria-hidden="true"></i><span>{item.label}</span>{!!item.badge&&<b className="count-badge">{item.badge}</b>}</button>;
  }

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${mobileNavOpen?"open":""}`}>
        <div className="sidebar-brand">
          <div className="logo"><span>근태</span></div>
          <div><h1>러플 근태관리</h1><p>{isAdmin?"관리자 시스템":"직원 근태"}</p></div>
          <button className="sidebar-close" title="메뉴 닫기" onClick={()=>setMobileNavOpen(false)}><i className="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <nav className="side-nav">
          <p className="side-nav-label">내 근무</p>
          {personalMenus.map(menuButton)}
          {isAdmin&&<><p className="side-nav-label">관리자</p>{adminMenus.map(menuButton)}<p className="side-nav-label">리포트</p>{menuButton({id:"reports",label:"보고서",icon:"ti-chart-bar"})}{menuButton({id:"consents",label:"직원 동의서",icon:"ti-file-signature"})}</>}
        </nav>
        <div className="sidebar-account">
          <div className="sidebar-user"><span><i className="ti ti-user" aria-hidden="true"></i></span><div><b>{employee.name}</b><small>{isAdmin?"관리자":"직원"}</small></div></div>
          <button title="비밀번호 변경" onClick={()=>setShowPwModal(true)}><i className="ti ti-lock" aria-hidden="true"></i></button>
          <button title="로그아웃" onClick={signOut}><i className="ti ti-logout" aria-hidden="true"></i></button>
        </div>
      </aside>
      {mobileNavOpen&&<button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={()=>setMobileNavOpen(false)} />}
      <div className="app-workspace">
        <header className="topbar">
          <div className="topbar-inner">
            <button className="mobile-menu-button" title="메뉴 열기" onClick={()=>setMobileNavOpen(true)}><i className="ti ti-menu-2" aria-hidden="true"></i></button>
            <div className="page-heading"><span>{["reports","consents"].includes(tab)?"리포트":isAdmin&&adminMenus.some(m=>m.id===tab)?"관리자":"내 근무"}</span><h1>{pageTitles[tab]}</h1></div>
            <div className="topbar-user"><span>{employee.name}</span><b>{isAdmin?"관리자":"직원"}</b></div>
          </div>
        </header>
        <main className="container">
          {tab==="attendance" && <HomePage employee={employee} />}
          {tab==="leave" && <LeavePage employee={employee} mode="leave" />}
          {tab==="overtime" && <LeavePage employee={employee} mode="overtime" />}
          {tab==="admin-dashboard" && isAdmin && <AdminPage currentEmployee={employee} onChanged={load} view="dashboard" />}
          {tab==="approvals" && isAdmin && <AdminPage currentEmployee={employee} onChanged={load} view="approvals" />}
          {tab==="employees" && isAdmin && <AdminPage currentEmployee={employee} onChanged={load} view="employees" />}
          {tab==="workplaces" && isAdmin && <WorkplacePage employee={employee} />}
          {tab==="schedule" && isAdmin && <SettingsPage currentEmployee={employee} section="schedule" />}
          {tab==="payroll" && isAdmin && <SettingsPage currentEmployee={employee} section="payroll" />}
          {tab==="reports" && isAdmin && <ReportsPage />}
          {tab==="consents" && isAdmin && <ConsentReportPage />}
        </main>
      </div>
      {showPwModal && <PasswordModal onClose={()=>setShowPwModal(false)} />}
    </div>
  );
}

function LoginPage() {
  const [employeeNo, setEmployeeNo] = useState(""); const [password, setPassword] = useState(""); const [message, setMessage] = useState("");
  async function login() { setMessage(""); const { error } = await supabase.auth.signInWithPassword({ email: internalEmail(employeeNo), password }); if (error) setMessage("사번 또는 비밀번호를 확인해주세요."); }
  return (
    <div className="container"><section className="card auth-card">
      <div className="logo logo-lg"><span>근태</span></div>
      <h1 className="card-title" style={{ marginTop: 16, display: "block" }}>러플 근태관리 로그인</h1>
      <p className="subtle">관리자가 생성한 사번으로 로그인합니다. 초기 비밀번호는 lupl + 휴대폰 뒷번호 4자리입니다.</p>
      {message && <div className="alert error">{message}</div>}
      <div className="form-row"><label className="label">사번</label><input className="input" value={employeeNo} onChange={e=>setEmployeeNo(e.target.value)} placeholder="예: 22061201" onKeyDown={e=>e.key==="Enter"&&login()} /></div>
      <div className="form-row"><label className="label">비밀번호</label><input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} /></div>
      <button className="button full" onClick={login}>로그인</button>
    </section></div>
  );
}

function InactivePage({ signOut }: { signOut: () => void }) {
  return <div className="container"><section className="card auth-card"><h1 className="card-title">비활성 계정입니다</h1><p className="subtle">관리자에게 계정 활성화를 요청해주세요.</p><button className="button full" onClick={signOut}>로그아웃</button></section></div>;
}

function ConsentGate({ employee, onDone, signOut }: { employee: any; onDone: () => void; signOut: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const [agree1,setAgree1] = useState(false); const [agree2,setAgree2] = useState(false); const [agree3,setAgree3] = useState(false);
  const [drawing,setDrawing] = useState(false); const [msg,setMsg] = useState("");
  function ctx() { const c=canvasRef.current; if(!c) return null; const x=c.getContext("2d"); if(!x) return null; x.lineWidth=2.4; x.lineCap="round"; x.strokeStyle="#161b26"; return x; }
  function point(e:any) { const c=canvasRef.current!; const r=c.getBoundingClientRect(); const p=e.touches?.[0]??e; return {x:p.clientX-r.left,y:p.clientY-r.top}; }
  function start(e:any) { setDrawing(true); const c=ctx(); const p=point(e); c?.beginPath(); c?.moveTo(p.x,p.y); }
  function move(e:any) { if(!drawing) return; e.preventDefault(); const c=ctx(); const p=point(e); c?.lineTo(p.x,p.y); c?.stroke(); }
  function end() { setDrawing(false); }
  function clear() { const c=canvasRef.current; const x=ctx(); if(c&&x) x.clearRect(0,0,c.width,c.height); }
  async function submit() {
    setMsg("");
    if(!agree1||!agree2||!agree3) return setMsg("동의 항목을 모두 체크해주세요.");
    const signature=canvasRef.current?.toDataURL("image/png");
    if(!signature||signature.length<1200) return setMsg("서명을 입력해주세요.");
    const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
    const {error}=await supabase.from("privacy_consents").insert({employee_id:employee.id,consent_location:true,consent_device:true,consent_version:"2026-02",signature_data:signature,device_fingerprint_hash:fingerprintHash,device_info:deviceInfo,is_active:true});
    if(error) setMsg(error.message); else onDone();
  }
  return (
    <div className="container"><section className="card" style={{maxWidth:760,margin:"28px auto"}}>
      <h1 className="card-title" style={{display:"block"}}>개인정보 수집·이용 및 위치정보 동의서</h1>
      <p className="subtle">주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를 수집·이용합니다.</p>
      <div className="alert" style={{marginTop:16}}>위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다.</div>
      {msg&&<div className="alert error">{msg}</div>}
      <label className="checkbox"><input type="checkbox" checked={agree1} onChange={e=>setAgree1(e.target.checked)} /> 개인정보 및 위치정보 수집·이용에 동의합니다.</label>
      <label className="checkbox"><input type="checkbox" checked={agree2} onChange={e=>setAgree2(e.target.checked)} /> 위치·기기 정보는 근태 확인 목적 외로 사용하지 않는다는 설명을 확인했습니다.</label>
      <label className="checkbox"><input type="checkbox" checked={agree3} onChange={e=>setAgree3(e.target.checked)} /> 추가근무는 별도 수당이 아니라 대체휴가로 적립되며, 관리자 승인 후 사용 가능하다는 점에 동의합니다.</label>
      <div style={{marginTop:18}}><label className="label">서명</label><canvas ref={canvasRef} width={700} height={170} className="signature-pad" onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end} /></div>
      <div className="actions" style={{marginTop:16}}>
        <button className="button" onClick={submit}>동의하고 시작</button>
        <button className="button secondary" onClick={clear}>서명 다시 쓰기</button>
        <button className="button ghost" onClick={signOut}>로그아웃</button>
      </div>
    </section></div>
  );
}

function HomePage({ employee }: { employee: any }) {
  const [now,setNow] = useState(new Date());
  const [workplaces,setWorkplaces] = useState<any[]>([]);
  const [selectedWorkplaceId,setSelectedWorkplaceId] = useState("");
  const [todayLog,setTodayLog] = useState<any|null>(null);
  const [recentLogs,setRecentLogs] = useState<any[]>([]);
  const [openLogRows,setOpenLogRows] = useState<any[]>([]);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [detectedPlace,setDetectedPlace] = useState<any|null>(null);
  const [unknownPlaceName,setUnknownPlaceName] = useState("");
  const [myDevices,setMyDevices] = useState<any[]>([]);
  const [thisFp,setThisFp] = useState<string|null>(null);
  const [weekendAsk,setWeekendAsk] = useState<any|null>(null);
  const [expandedLogId,setExpandedLogId] = useState<string|null>(null);
  const [recheckAsk,setRecheckAsk] = useState<any|null>(null);
  const [recheckMode,setRecheckMode] = useState(false);
  const [compTimeRows,setCompTimeRows] = useState<any[]>([]);
  const [todayOverrides,setTodayOverrides] = useState<any[]>([]);
  const [notificationPermission,setNotificationPermission] = useState<NotificationPermission|"unsupported">("unsupported");
  const [lastReminderMessage,setLastReminderMessage] = useState("");
  const sentReminderKeys = useRef<Set<string>>(new Set());

  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);
  useEffect(()=>{
    sentReminderKeys.current=readSentReminderKeys();
    setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
  },[]);

  async function loadDevices() {
    const {data}=await supabase.from("registered_devices").select("*").eq("employee_id",employee.id).order("created_at",{ascending:false});
    const latestByDevice=new Map<string,any>();
    for(const device of data??[]){
      const info=device.device_info??{};
      const key=[
        info.platform??"",
        info.screen??"",
        info.hardwareConcurrency??"",
        info.language??"",
        info.timezone??"",
      ].join("|")||device.fingerprint_hash;
      const current=latestByDevice.get(key);
      if(!current||new Date(device.last_seen_at).getTime()>new Date(current.last_seen_at).getTime()){
        latestByDevice.set(key,device);
      }
    }
    setMyDevices(Array.from(latestByDevice.values()).sort((a,b)=>new Date(b.last_seen_at).getTime()-new Date(a.last_seen_at).getTime()));
    try { const {fingerprintHash}=await getDeviceFingerprint(); setThisFp(fingerprintHash); } catch {/**/}
  }
  async function load() {
    const today=todayIso();
    const [{data:places},{data:logs},{data:openLogs},{data:compRows},{data:overrides}]=await Promise.all([
      supabase.from("workplaces").select("*").neq("approval_status","rejected").eq("is_active",true).order("name"),
      supabase.from("attendance_logs").select("*, workplaces(name,type)").eq("employee_id",employee.id).order("check_in_time",{ascending:false}).limit(10),
      supabase.from("attendance_logs").select("*, workplaces(name,type)").eq("employee_id",employee.id).is("check_out_time",null).order("check_in_time",{ascending:false}),
      supabase.from("comp_time_requests").select("*").eq("employee_id",employee.id).eq("work_date",today).in("status",["pending","approved"]).order("start_time"),
      supabase.from("weekly_schedule_overrides").select("*").eq("employee_id",employee.id).eq("week_start",weekStartIso(today)).limit(1),
    ]);
    setWorkplaces(places??[]);
    setCompTimeRows(compRows??[]);
    setTodayOverrides(overrides??[]);
    const merged=uniqueLogs([...(openLogs??[]), ...(logs??[])]).sort(byCheckInDesc);
    setOpenLogRows(openLogs??[]);
    setTodayLog(merged.find((l:any)=>isToday(l.check_in_time))??null);
    setRecentLogs(merged.filter((l:any)=>!isToday(l.check_in_time)).slice(0,5));
    await loadDevices();
  }
  useEffect(()=>{ load(); },[]);

  function rememberSentReminder(key:string) {
    sentReminderKeys.current.add(key);
    try {
      localStorage.setItem("lupl_checkout_reminders_sent", JSON.stringify(Array.from(sentReminderKeys.current).slice(-200)));
    } catch {/**/}
  }
  async function enableCheckoutReminders() {
    if(!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setMessage(isIosLike()&&!isStandalonePwa()
        ? "iPhone Safari에서는 먼저 공유 버튼 → 홈 화면에 추가 후, 홈 화면 앱으로 열어야 알림을 켤 수 있습니다."
        : "이 브라우저는 알림을 지원하지 않습니다.");
      return;
    }
    if(Notification.permission==="granted") {
      setNotificationPermission("granted");
      setMessage("퇴근 알림이 켜져 있습니다.");
      return;
    }
    const permission=await Notification.requestPermission();
    setNotificationPermission(permission);
    setMessage(permission==="granted"?"퇴근 알림이 켜졌습니다.":"브라우저 알림 권한이 허용되지 않았습니다.");
  }
  async function sendTestCheckoutNotification() {
    if(!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setMessage(isIosLike()&&!isStandalonePwa()
        ? "iPhone Safari에서는 먼저 공유 버튼 → 홈 화면에 추가 후, 홈 화면 앱으로 열어야 알림을 켤 수 있습니다."
        : "이 브라우저는 알림을 지원하지 않습니다.");
      return;
    }
    if(Notification.permission!=="granted") {
      await enableCheckoutReminders();
      return;
    }
    const ok=await showBrowserNotification("퇴근 알림 테스트",{
      body:"이 알림이 보이면 이 컴퓨터에서도 퇴근 알림을 받을 수 있습니다.",
      icon:"/wave-192-transparent.png",
      tag:"checkout-test",
    });
    setLastReminderMessage("테스트 알림을 보냈습니다.");
    setMessage(ok?"테스트 알림을 보냈습니다.":"알림 전송을 시도했지만 브라우저가 표시하지 않았습니다. OS 알림 설정을 확인해주세요.");
  }

  async function registerThisDevice() {
    setMessage("");
    try {
      const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
      const {data,error}=await supabase.rpc("register_device",{p_fingerprint_hash:fingerprintHash,p_device_info:deviceInfo});
      if(error) throw error;
      setMessage(data?.device_status==="approved"?"이 기기가 등록·승인되었습니다.":"이 기기 등록을 신청했습니다. 관리자 승인 후 사용됩니다.");
      await loadDevices();
    } catch(e:any){setMessage(e.message);}
  }
  function detectPlace(lat:number,lng:number,ip:string|null) {
    const approved=workplaces.filter(w=>w.approval_status==="approved"&&w.lat!=null&&w.lng!=null);
    const withDist=approved.map(w=>({...w,distance:distanceMeters(lat,lng,w.lat,w.lng)}));
    const gps=withDist.sort((a,b)=>a.distance-b.distance).find(w=>w.distance<=(w.radius_m??100));
    if(gps) return gps;
    if(ip) return approved.find(w=>w.ip_hint&&w.ip_hint===ip)||null;
    return null;
  }
  async function submitCheckIn(workplaceId:string, place:any, isRecheck:boolean) {
    const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
    const rpcName=isRecheck&&todayLog?.id?"recheck_in":"check_in";
    const rpcArgs:any=isRecheck&&todayLog?.id
      ? {p_log_id:todayLog.id,p_workplace_id:workplaceId,p_lat:place?.currentLat??null,p_lng:place?.currentLng??null,p_accuracy_m:place?.accuracy??null,p_ip_address:place?.ip??null,p_device_fingerprint_hash:fingerprintHash,p_device_info:deviceInfo}
      : {p_workplace_id:workplaceId,p_lat:place?.currentLat??null,p_lng:place?.currentLng??null,p_accuracy_m:place?.accuracy??null,p_ip_address:place?.ip??null,p_device_fingerprint_hash:fingerprintHash,p_device_info:deviceInfo};
    const {data,error}=await supabase.rpc(rpcName,rpcArgs);
    if(error) throw error;
    return data;
  }
  async function startCheckIn(isRecheck=false) {
    const blockingOpen=openLogRows.some((l:any)=>l.id!==todayLog?.id);
    if(blockingOpen){
      setMessage("이전 출근 기록이 아직 퇴근 처리되지 않았습니다. 아래 미퇴근 기록을 먼저 마감해주세요.");
      return;
    }
    setRecheckMode(isRecheck);
    setBusy(true); setMessage("현재 위치를 확인하는 중입니다."); setDetectedPlace(null);
    try {
      const p=await getCurrentPositionFast(); const ip=await getPublicIp(); const d=detectPlace(p.lat,p.lng,ip);
      if(d){
        const place={...d,currentLat:p.lat,currentLng:p.lng,accuracy:p.accuracy,ip};
        setDetectedPlace(place);setSelectedWorkplaceId(d.id);setMessage(`${d.name} GPS가 확인되어 ${isRecheck?"재출근":"출근"} 처리 중입니다.`);
        const data=await submitCheckIn(d.id,place,isRecheck);
        setMessage(`${d.name} ${isRecheck?"재출근":"출근"} 완료: ${data?.attendance_status??"처리 완료"}`);
        setDetectedPlace(null); setUnknownPlaceName(""); setRecheckMode(false); await load();
      }
      else{setDetectedPlace({currentLat:p.lat,currentLng:p.lng,accuracy:p.accuracy,ip});setSelectedWorkplaceId("");setMessage("등록된 근무지 반경 안이 아닙니다. 현재 장소명을 입력하면 관리자 승인 대기 근무지로 저장됩니다.");}
    } catch(e:any){setMessage(e.message);setRecheckMode(false);} finally{setBusy(false);}
  }
  function handleCheckInClick() {
    if(todayLog?.check_in_time) { setRecheckAsk(todayLog); return; }
    startCheckIn(false);
  }
  async function confirmRecheck() {
    setRecheckAsk(null);
    await startCheckIn(true);
  }
  function cancelDetectedPlace() {
    setDetectedPlace(null);
    setRecheckMode(false);
    setUnknownPlaceName("");
  }
  async function confirmCheckIn() {
    setBusy(true); setMessage("");
    try {
      let workplaceId=selectedWorkplaceId;
      if(!workplaceId&&unknownPlaceName&&detectedPlace?.currentLat){
        const {data:newPlace,error:placeError}=await supabase.from("workplaces").insert({name:unknownPlaceName,type:"other_field",lat:detectedPlace.currentLat,lng:detectedPlace.currentLng,ip_hint:detectedPlace.ip,radius_m:100,approval_status:"pending",is_active:false,visibility:"public",requested_by:employee.id}).select().single();
        if(placeError) throw placeError; workplaceId=newPlace.id;
      }
      if(!workplaceId) throw new Error("근무지 선택 또는 현재 장소명 입력이 필요합니다.");
      const data=await submitCheckIn(workplaceId,detectedPlace,recheckMode);
      setMessage(recheckMode ? `출근 시간을 갱신했습니다: ${data?.attendance_status??"처리 완료"}` : `출근 처리 결과: ${data?.attendance_status??"처리 완료"}`); setDetectedPlace(null); setUnknownPlaceName(""); setRecheckMode(false); await load();
    } catch(e:any){setMessage(e.message);} finally{setBusy(false);}
  }
  async function checkOut() {
    setBusy(true); setMessage("퇴근 위치를 확인하는 중입니다.");
    try {
      const p=await getCurrentPositionFast(); const ip=await getPublicIp();
      const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
      const {data,error}=await supabase.rpc("check_out",{p_lat:p.lat,p_lng:p.lng,p_accuracy_m:p.accuracy,p_ip_address:ip,p_device_fingerprint_hash:fingerprintHash,p_device_info:deviceInfo});
      if(error) throw error; setMessage(`퇴근 처리 결과: ${data?.attendance_status??"저장 완료"}`);
      await load();
      // 주말 근무 → 대체휴가 적립 여부 묻기
      const ci = todayLog?.check_in_time;
      if (isWeekendDate(ci)) {
        const mins = workedMinutes(ci, new Date().toISOString());
        const hours = mins ? Math.round(mins/6)/10 : 0;
        if (hours > 0) setWeekendAsk({ work_date: localDateStr(new Date(ci)), hours });
      }
    } catch(e:any){setMessage(e.message);} finally{setBusy(false);}
  }
  async function grantWeekendComp() {
    if(!weekendAsk) return;
    const {error}=await supabase.from("comp_time_requests").insert({employee_id:employee.id,work_date:weekendAsk.work_date,start_time:null,end_time:null,hours:weekendAsk.hours,converted_days:Number((weekendAsk.hours/8).toFixed(2)),reason:"주말 근무 대체휴가",status:"pending"});
    if(error) setMessage(error.message); else setMessage("주말 근무 대체휴가 신청이 저장되었습니다. 관리자 승인 후 적립됩니다.");
    setWeekendAsk(null);
  }

  async function closeSpecificLog(log:any) {
    if(!log?.id) return;
    setBusy(true); setMessage("미퇴근 기록을 퇴근 처리하는 중입니다.");
    try {
      let fp:string|null=null; let info:any={};
      try { const d=await getDeviceFingerprint(); fp=d.fingerprintHash; info=d.deviceInfo; } catch {/**/}
      const {error}=await supabase.rpc("close_attendance_log",{p_log_id:log.id,p_status:null,p_device_fingerprint_hash:fp,p_device_info:info});
      if(error) throw error;
      setMessage(`${formatDateTime(log.check_in_time)} 출근 기록을 현재 시각으로 퇴근 처리했습니다.`);
      await load();
    } catch(e:any){ setMessage(e.message); } finally { setBusy(false); }
  }

  const allShownLogs=uniqueLogs([todayLog,...openLogRows,...recentLogs].filter(Boolean)).sort(byCheckInDesc);
  const openLogs=allShownLogs.filter((l:any)=>l?.check_in_time&&!l?.check_out_time);
  const overdueOpenLogs=openLogs.filter((l:any)=>!isToday(l.check_in_time));
  const hasBlockingOpenLog=overdueOpenLogs.length>0;
  const checkedIn=!!todayLog?.check_in_time; const checkedOut=!!todayLog?.check_out_time;
  const worked=workedMinutes(todayLog?.check_in_time,todayLog?.check_out_time);
  const thisDevice=thisFp?myDevices.find(d=>d.fingerprint_hash===thisFp):null;
  const approvedDevices=myDevices.filter(d=>d.status==="approved").sort((a,b)=>new Date(b.last_seen_at).getTime()-new Date(a.last_seen_at).getTime());
  const shownDevices=[...approvedDevices.slice(0,1),...myDevices.filter(d=>d.status!=="approved")];
  const reminderTarget=checkoutReminderTarget(todayLog,employee,todayOverrides,compTimeRows);
  const reminderTargetTime=reminderTarget?.getTime() ?? null;
  const activeCompRows=approvedOrPendingCompRequests(compTimeRows);
  const reminderOffsets=[-5,5,15,30];

  useEffect(()=>{
    if(!todayLog?.id||!todayLog?.check_in_time||todayLog?.check_out_time||!reminderTargetTime) return;
    let checking=false;
    const checkReminder=async()=>{
      if(checking||!("Notification" in window)||Notification.permission!=="granted") return;
      const nowMs=Date.now();
      const dueOffset=reminderOffsets.find(offset=>{
        const dueAt=reminderTargetTime+offset*60000;
        const key=`${todayLog.id}:${offset}`;
        if(sentReminderKeys.current.has(key)||nowMs<dueAt) return false;
        return offset<0 ? nowMs<reminderTargetTime : true;
      });
      if(!dueOffset) return;
      checking=true;
      try {
        const {data}=await supabase.from("attendance_logs").select("check_out_time").eq("id",todayLog.id).maybeSingle();
        if(data?.check_out_time) {
          await load();
          return;
        }
        const isBefore=dueOffset<0;
        const title=isBefore ? `퇴근 ${Math.abs(dueOffset)}분 전이에요` : `퇴근 처리 ${dueOffset}분 지났어요`;
        const body=isBefore
          ? `곧 퇴근 기준 시각입니다. 기준 시각: ${timeOnly(new Date(reminderTargetTime).toISOString())}`
          : `퇴근 버튼을 누르지 않았다면 지금 퇴근 처리해주세요. 기준 시각: ${timeOnly(new Date(reminderTargetTime).toISOString())}`;
        setLastReminderMessage(`${title} · ${body}`);
        setMessage(`${title} ${body}`);
        const ok=await showBrowserNotification(title,{body,icon:"/wave-192-transparent.png",tag:`checkout-${todayLog.id}-${dueOffset}`});
        if(ok) rememberSentReminder(`${todayLog.id}:${dueOffset}`);
      } finally {
        checking=false;
      }
    };
    checkReminder();
    const timer=window.setInterval(checkReminder,60000);
    return()=>window.clearInterval(timer);
  },[todayLog?.id,todayLog?.check_in_time,todayLog?.check_out_time,reminderTargetTime,notificationPermission]);

  let flexNote="";
  if(checkedIn&&!checkedOut&&todayLog?.check_in_time){
    const cinKst=new Date(new Date(todayLog.check_in_time).getTime()+9*3600000);
    const h=cinKst.getUTCHours(), m=cinKst.getUTCMinutes();
    if(h>=9&&(h<10||(h===10&&m===0))) flexNote=`시차출근 적용 중 · 퇴근 기준 ${String(h+9).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }

  return (
    <div className="home-layout">
      <section className="card">
        <p className="date-line">{now.toLocaleDateString("ko-KR",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
        <div className="clock">{clockText(now)}</div>
        <div className="today-times">
          <div className="today-time-item"><span className="today-time-label">출근</span><span className="today-time-val">{checkedIn?timeOnly(todayLog.check_in_time):"--:--"}</span></div>
          <div className="today-time-item"><span className="today-time-label">퇴근</span><span className="today-time-val">{checkedOut?timeOnly(todayLog.check_out_time):"--:--"}</span></div>
          {worked!=null&&<div className="today-time-item"><span className="today-time-label">실근무</span><span className="today-time-val" style={{fontSize:17}}>{fmtMin(worked)}</span></div>}
        </div>
        <div className="punch-grid">
          <button className="button punch" disabled={busy||hasBlockingOpenLog} onClick={handleCheckInClick}>출근하기</button>
          <button className="button secondary punch" disabled={busy||openLogs.length===0} onClick={()=>checkedIn?checkOut():closeSpecificLog(openLogs[0])}>퇴근하기</button>
        </div>
        {checkedIn&&!checkedOut&&reminderTarget&&(
          <div className="alert reminder-card" style={{marginTop:12}}>
            <div className="reminder-head">
              <span className="reminder-label">퇴근 알림 기준</span>
              <b className="reminder-time">{timeOnly(reminderTarget.toISOString())}</b>
            </div>
            <p className="reminder-desc">퇴근 5분 전, 퇴근 후 5분 · 15분 · 30분에 알려드립니다.{activeCompRows.length>0?" 추가근무 시간이 반영되었습니다.":""}</p>
            {lastReminderMessage&&<p className="subtle" style={{marginTop:6}}>최근 알림: {lastReminderMessage}</p>}
            {notificationPermission!=="granted"&&(
              <div style={{marginTop:10}}>
                <button className="button secondary" onClick={enableCheckoutReminders}>
                  <i className="ti ti-bell" aria-hidden="true"></i>
                  퇴근 알림 켜기
                </button>
                {notificationPermission==="denied"&&<p className="subtle" style={{marginTop:6}}>브라우저 설정에서 이 사이트의 알림을 허용해야 합니다.</p>}
                {notificationPermission==="unsupported"&&<p className="subtle" style={{marginTop:6}}>이 브라우저에서는 알림을 지원하지 않습니다.</p>}
              </div>
            )}
          </div>
        )}
        {flexNote&&<p className="subtle" style={{marginTop:8,textAlign:"center",color:"#0b9b6a"}}>{flexNote}</p>}
        <p className="subtle" style={{marginTop:6,textAlign:"center"}}>휴게 12:00–13:00 자동 · 10시까지 자유 시차출근</p>
        <WorkTypeToggle employee={employee} todayLog={todayLog} onChanged={load} />
        {message&&<div className="alert" style={{marginTop:14}}>{message}</div>}

        {overdueOpenLogs.length>0&&(
          <div className="card" style={{marginTop:14,boxShadow:"none",background:"#fff7ed",borderColor:"#fed7aa"}}>
            <h3 style={{marginTop:0}}>아직 퇴근 처리되지 않은 기록</h3>
            <p className="body-text" style={{color:"#8b5e00"}}>전날 이전 출근 기록이 남아 있어 새 출근이 막혀 있습니다. 퇴근 처리가 필요하면 해당 기록을 마감해주세요.</p>
            {overdueOpenLogs.map((l:any)=>(
              <div className="list-row" key={l.id} style={{marginTop:10}}>
                <div>
                  <b>{formatDateTime(l.check_in_time)}</b>
                  <div className="subtle">근무지 {l.workplaces?.name??"-"} · 상태 {l.status??"-"}</div>
                  {expandedLogId===l.id&&<div className="type-desc" style={{marginTop:8}}>출근 {formatDateTime(l.check_in_time)}<br/>퇴근 -<br/>실근무 -<br/>처리: 퇴근 처리 시 현재 시각으로 마감됩니다.</div>}
                </div>
                <div className="actions">
                  <button className="button ghost" onClick={()=>setExpandedLogId(expandedLogId===l.id?null:l.id)}>상세</button>
                  <button className="button secondary" disabled={busy} onClick={()=>closeSpecificLog(l)}>이 기록 퇴근 처리</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {weekendAsk&&(
          <div className="card" style={{marginTop:14,boxShadow:"none",background:"#eef3fe"}}>
            <h3 style={{marginTop:0}}>주말 근무 대체휴가</h3>
            <p className="body-text">오늘 주말 근무 {weekendAsk.hours}시간이 기록되었습니다. 근무시간만큼 대체휴가를 적립하시겠습니까?</p>
            <div className="actions" style={{marginTop:10}}>
              <button className="button" onClick={grantWeekendComp}>네, 적립 신청</button>
              <button className="button ghost" onClick={()=>setWeekendAsk(null)}>아니요</button>
            </div>
          </div>
        )}

        {detectedPlace&&(
          <div className="card" style={{marginTop:14,boxShadow:"none",background:"#f6f8fb"}}>
            {detectedPlace.id
              ?(<><h3 style={{marginTop:0}}>{detectedPlace.name} 맞나요?</h3><p className="subtle">GPS/IP 기준으로 가장 가까운 근무지를 찾았습니다.</p></>)
              :(<><h3 style={{marginTop:0}}>현재 장소를 입력해주세요</h3><p className="subtle">입력한 장소는 관리자 승인 대기 근무지로 저장됩니다.</p><input className="input" style={{marginTop:8}} value={unknownPlaceName} onChange={e=>setUnknownPlaceName(e.target.value)} placeholder="예: 대구○○학교, ○○교육장" /></>)}
            <div className="actions" style={{marginTop:10}}><button className="button" disabled={busy} onClick={confirmCheckIn}>{recheckMode?"재출근 확정":"출근 확정"}</button><button className="button ghost" onClick={cancelDetectedPlace}>취소</button></div>
          </div>
        )}

        {recentLogs.length>0&&(
          <div style={{marginTop:20}}>
            <p className="section-label">최근 기록</p>
            {recentLogs.map((l:any)=>(
              <div className="recent-row" key={l.id} onClick={()=>setExpandedLogId(expandedLogId===l.id?null:l.id)} style={{cursor:"pointer"}}>
                <span className="recent-date">{monthDay(l.check_in_time)}</span>
                <span className="recent-times">{timeOnly(l.check_in_time)} → {timeOnly(l.check_out_time)}</span>
                <span className="recent-worked">{fmtMin(workedMinutes(l.check_in_time,l.check_out_time))}</span>
                <span className={`badge ${badgeClass(l.status)}`}>{l.status}</span>
                {!l.check_out_time&&<button className="button secondary" onClick={(e)=>{e.stopPropagation();closeSpecificLog(l);}}>퇴근 처리</button>}
                {expandedLogId===l.id&&<div className="type-desc" style={{flexBasis:"100%",marginTop:6}}>출근 {formatDateTime(l.check_in_time)}<br/>퇴근 {formatDateTime(l.check_out_time)}<br/>근무지 {l.workplaces?.name??"-"}<br/>상태 {l.status??"-"}</div>}
              </div>
            ))}
          </div>
        )}

        {recheckAsk&&(<ConfirmModal title="이미 출근 처리된 기록이 있습니다" confirmText="재출근" cancelText="취소" busy={busy} onCancel={()=>setRecheckAsk(null)} onConfirm={confirmRecheck}>
          <p style={{margin:"0 0 8px"}}>오늘 <b>{timeOnly(recheckAsk.check_in_time)}</b>에 이미 출근 처리되었습니다.</p>
          <p style={{margin:0}}>재출근하면 현재 시각으로 출근 시간이 갱신되며, 지각 등 근태 상태가 다시 판정될 수 있습니다.</p>
        </ConfirmModal>)}
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-device-mobile" aria-hidden="true"></i>내 기기</h2>
        <p className="body-text" style={{marginBottom:14}}>등록 가능 기기 <b>{employee.device_limit??3}대</b>. 한도 내에서는 자동 승인되고, 초과 시 관리자 승인이 필요합니다.</p>
        <div className="alert browser-alert" style={{marginBottom:14}}>
          <div className="browser-alert-main">
            <span><b>브라우저 알림</b> {notificationPermission==="granted"?"허용됨":"허용 필요"}</span>
            <div className="browser-alert-actions">
              {notificationPermission!=="granted"&&<button className="button secondary compact" onClick={enableCheckoutReminders}><i className="ti ti-bell" aria-hidden="true"></i>알림 켜기</button>}
              <button className="button ghost compact" onClick={sendTestCheckoutNotification}><i className="ti ti-bell-ringing" aria-hidden="true"></i>테스트 알림</button>
            </div>
          </div>
          {isIosLike()&&!isStandalonePwa()&&<p className="subtle" style={{marginTop:6}}>iPhone은 Safari 탭이 아니라 홈 화면에 추가한 앱에서 알림을 켜주세요.</p>}
        </div>
        {shownDevices.length===0&&<p className="body-text" style={{color:"#8b94a6"}}>아직 등록된 기기가 없습니다.</p>}
        {approvedDevices.length>1&&<p className="subtle" style={{marginBottom:10}}>승인된 기기는 최근 접속한 1대만 표시합니다.</p>}
        {shownDevices.map(d=>(
          <div className="device-row" key={d.id}>
            <div>
              <p style={{margin:0,fontWeight:600,fontSize:15}}>{d.device_info?.platform||"알 수 없는 기기"}{thisFp&&d.fingerprint_hash===thisFp&&<span style={{marginLeft:6,fontSize:12,color:"#3a6df0",fontWeight:700}}>현재 기기</span>}</p>
              <p className="body-text" style={{color:"#8b94a6",marginTop:2}}>최근 접속 {formatDateTime(d.last_seen_at)}</p>
            </div>
            <span className={`badge ${badgeClass(d.status)}`}>{d.status==="approved"?"승인":d.status==="pending"?"승인 대기":"거절"}</span>
          </div>
        ))}
        {!thisDevice&&<button className="button secondary full" style={{marginTop:10}} onClick={registerThisDevice}><i className="ti ti-plus" aria-hidden="true"></i>이 기기 등록 신청</button>}
      </section>
    </div>
  );
}

function LeavePage({ employee, mode="leave" }: { employee: any; mode?:"leave"|"overtime" }) {
  const [requests,setRequests]=useState<any[]>([]);
  const [adjustments,setAdjustments]=useState<any[]>([]);
  const [compRequests,setCompRequests]=useState<any[]>([]);
  const [form,setForm]=useState({request_type:"annual",start_date:todayIso(),end_date:todayIso(),start_time:"09:00",end_time:"18:00",amount_hours:"",reason:""});
  const [compForm,setCompForm]=useState({work_date:todayIso(),start_time:"18:00",end_time:"20:00",hours:2,reason:""});
  const [message,setMessage]=useState(""); const [showCompAlert,setShowCompAlert]=useState(false);

  async function load() {
    const [r,a,c]=await Promise.all([
      supabase.from("attendance_requests").select("*").eq("employee_id",employee.id).order("created_at",{ascending:false}),
      supabase.from("leave_adjustments").select("*").eq("employee_id",employee.id).order("created_at",{ascending:false}),
      supabase.from("comp_time_requests").select("*").eq("employee_id",employee.id).order("created_at",{ascending:false}),
    ]);
    setRequests(r.data??[]); setAdjustments(a.data??[]); setCompRequests(c.data??[]);
  }
  useEffect(()=>{load();},[]);

  const ent=calculateLeaveEntitlement(employee.joined_at);
  const fullTime=isFullTimeEmployee(employee);
  const adj=calculateAdjustmentDays(adjustments);
  const compEarned=calculateApprovedCompDays(compRequests);
  const approvedUsed=calculateUsedDays(requests,false);
  const pendingUsed=calculateUsedDays(requests,true);
  const automaticAnnual=fullTime?ent.baseGrantedDays:0;
  const totalGranted=automaticAnnual+adj;
  const remaining=Math.max(0,totalGranted-approvedUsed);
  const expectedRemaining=Math.max(0,totalGranted-pendingUsed);
  const compEarnedHours=Math.round(compEarned*8*10)/10;
  const compUsedHours=requests.filter(r=>r.request_type==="comp_leave_use"&&r.status==="approved").reduce((s,r)=>s+(r.amount_hours??(r.amount_days??0)*8),0);
  const compRemainHours=Math.max(0,compEarnedHours-compUsedHours);
  const remainPct=totalGranted>0?Math.round((remaining/totalGranted)*100):0;
  const meta=LEAVE_TYPE_META[form.request_type];
  const isSingle=SINGLE_DAY_TYPES.includes(form.request_type);
  const isHourly=form.request_type==="hourly";
  const showLeave=mode==="leave";
  const showOvertime=mode==="overtime";

  function setType(t:string){
    const m=LEAVE_TYPE_META[t];
    setForm(f=>({...f,request_type:t,
      end_date:SINGLE_DAY_TYPES.includes(t)?f.start_date:f.end_date,
      start_time:t==="half_am"?"09:00":t==="half_pm"?"14:00":f.start_time,
      end_time:t==="half_am"?"14:00":t==="half_pm"?"18:00":f.end_time,
    }));
    setShowCompAlert(false);
  }

  async function submitLeave() {
    setMessage("");
    const m=LEAVE_TYPE_META[form.request_type];
    const requestedDays = m?.fixedDays ?? (isHourly ? Number(form.amount_hours||0)/8 : 1);
    // 잔여 검증 — 휴가 차감형 전체 (연차/반차/시간차/특별/대체/보상)
    if (m?.usesLeave) {
      if (isHourly && (!form.amount_hours || Number(form.amount_hours)<=0)) return setMessage("시간차 사용 시간을 입력해주세요.");
      if (requestedDays > expectedRemaining + 1e-9) return setMessage(`잔여 휴가(${expectedRemaining.toFixed(1)}일)가 부족하여 신청할 수 없습니다.`);
    }
    const single = SINGLE_DAY_TYPES.includes(form.request_type);
    const amountHours = isHourly && form.amount_hours ? Number(form.amount_hours) : null;
    const useTimes = ["half_am","half_pm","hourly"].includes(form.request_type);
    const {error}=await supabase.from("attendance_requests").insert({
      employee_id:employee.id, request_type:form.request_type,
      start_date:form.start_date, end_date:single?form.start_date:form.end_date,
      start_time: useTimes? form.start_time : null,
      end_time: useTimes? form.end_time : null,
      amount_hours:amountHours, amount_days: m?.fixedDays ?? (amountHours?amountHours/8:null),
      reason:form.reason, status:"pending",
    });
    if(error) setMessage(error.message); else{setMessage("휴가 신청이 저장되었습니다.");await load();}
  }

  async function useCompLeave() {
    setMessage(""); const hours=Number(form.amount_hours||0);
    if(!hours||hours<=0) return setMessage("사용할 시간을 입력해주세요.");
    if(hours>compRemainHours+1e-9) return setMessage(`대체휴가 잔여 시간(${compRemainHours}시간)이 부족합니다.`);
    const {error}=await supabase.from("attendance_requests").insert({employee_id:employee.id,request_type:"comp_leave_use",start_date:form.start_date,end_date:form.start_date,amount_hours:hours,amount_days:hours/8,reason:form.reason||"대체휴가 시간 사용",status:"pending"});
    if(error) setMessage(error.message); else{setMessage("대체휴가 시간 사용 신청이 저장되었습니다.");setShowCompAlert(false);await load();}
  }

  function handleCompTimeChange(field:"start_time"|"end_time",val:string){
    const next={...compForm,[field]:val};
    const h=timeDiffHours(next.start_time,next.end_time);
    setCompForm({...next,hours:h>0?h:compForm.hours});
  }
  async function submitCompTime() {
    setMessage("");
    if(!compForm.hours||compForm.hours<=0) return setMessage("추가 근무 시간을 입력해주세요.");
    const startAt=new Date(`${compForm.work_date}T${compForm.start_time}:00`);
    if(new Date().getTime()>=startAt.getTime()) return setMessage("추가근무 신청은 신청 시작 시간 전에만 가능합니다.");
    const duplicate=compRequests.find(r=>r.work_date===compForm.work_date&&r.start_time===compForm.start_time&&r.end_time===compForm.end_time&&["pending","approved"].includes(r.status));
    if(duplicate) return setMessage("이미 신청한 시간입니다. 관리자의 승인을 기다려주세요.");
    if(!window.confirm("추가근무를 신청하시겠습니까?\n신청 후 수정이 불가능합니다.")) return;
    const {error}=await supabase.from("comp_time_requests").insert({employee_id:employee.id,work_date:compForm.work_date,start_time:compForm.start_time,end_time:compForm.end_time,hours:compForm.hours,converted_days:Number((compForm.hours/8).toFixed(2)),reason:compForm.reason,status:"pending"});
    if(error) setMessage(error.message); else{setMessage("추가근무 신청이 저장되었습니다. 관리자 승인 후 대체휴가로 적립됩니다.");await load();}
  }

  async function cancelCompRequest(id:string) {
    if(!window.confirm("추가근무 신청을 취소할까요?")) return;
    const {error}=await supabase.from("comp_time_requests").delete().eq("id",id).eq("employee_id",employee.id).eq("status","pending");
    if(error) setMessage(error.message); else { setMessage("추가근무 신청이 취소되었습니다."); await load(); }
  }

  return (
    <div className="grid">
      {message&&<div className="alert">{message}</div>}
      {showLeave&&<section className="card leave-summary-card">
        <div className="leave-summary-header">
          <h2 className="card-title"><i className="ti ti-calendar-stats" aria-hidden="true"></i>연차 현황</h2>
          <span className="leave-summary-badge">잔여 {remaining.toFixed(1)}일</span>
        </div>
        <div className="leave-hero">
          <div className="leave-ring" style={{background:`conic-gradient(var(--blue) ${remainPct*3.6}deg, #e7ecf4 0deg)`}}>
            <div className="leave-ring-inner"><b>{remaining.toFixed(1)}</b><span>잔여일</span></div>
          </div>
          <div className="leave-info">
            <div className="leave-chips">
              <div className="leave-chip"><span>총 부여</span><b>{totalGranted.toFixed(1)}일</b></div>
              <div className="leave-chip"><span>기본 발생</span><b>{automaticAnnual}일</b></div>
              <div className="leave-chip"><span>조정</span><b>{adj>=0?"+":""}{adj.toFixed(1)}일</b></div>
              <div className="leave-chip"><span>사용(승인)</span><b>{approvedUsed.toFixed(1)}일</b></div>
              <div className="leave-chip"><span>잔여(예상)</span><b>{expectedRemaining.toFixed(1)}일</b></div>
              <div className="leave-chip leave-chip-highlight"><span>대체휴가 적립</span><b>{compEarned.toFixed(1)}일 ({compRemainHours}시간)</b></div>
            </div>
            <p className="subtle leave-period-text">근무 시작일 {employee.joined_at??"-"} · {fullTime?ent.description:"비풀타임: 자동 연차 미발생"}<br />{fullTime?`산정기간 ${ent.periodStart??"-"} ~ ${ent.periodEnd??"-"} (근로기준법 제60조)`:"관리자가 별도로 부여한 특별·대체휴가는 사용할 수 있습니다."}</p>
          </div>
        </div>
      </section>}

      <div className={`grid ${showLeave&&showOvertime?"two":""}`}>
        {showLeave&&<section className="card">
          <h2 className="card-title"><i className="ti ti-beach" aria-hidden="true"></i>휴가 신청</h2>
          <div className="form-row"><label className="label">신청 유형</label>
            <select className="select" value={form.request_type} onChange={e=>setType(e.target.value)}>
              {REQUEST_TYPES_UI.map(k=><option key={k} value={k}>{requestTypeLabels[k]}</option>)}
            </select>
          </div>
          {meta&&<div className="type-desc"><b>{meta.label}{meta.time?` · ${meta.time}`:""}</b><span>{meta.desc}</span></div>}

          {isHourly&&compRemainHours>0&&(
            <div className="alert" style={{cursor:"pointer"}} onClick={()=>setShowCompAlert(!showCompAlert)}>
              대체휴가 {compRemainHours}시간 있습니다. 이걸 시간휴가로 쓰시겠습니까? {showCompAlert?"▲":"▼"}
            </div>
          )}
          {isHourly&&showCompAlert&&(
            <div className="card" style={{boxShadow:"none",background:"#f6f8fb",marginBottom:12}}>
              <p className="body-text"><b>대체휴가 시간 사용</b> — 연차 잔여에서 차감되지 않습니다.</p>
              <div className="form-row" style={{marginTop:8}}><label className="label">사용 시간</label><input className="input" type="number" step="0.5" value={form.amount_hours} onChange={e=>setForm({...form,amount_hours:e.target.value})} placeholder="예: 2" /></div>
              <div className="form-row"><label className="label">사용일</label><input className="input" type="date" value={form.start_date} onChange={e=>setForm({...form,start_date:e.target.value})} /></div>
              <div className="form-row"><label className="label">사유</label><input className="input" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="사유 입력" /></div>
              <button className="button full" onClick={useCompLeave}>대체휴가 시간 사용 신청</button>
            </div>
          )}

          {isSingle ? (
            <div className="form-row"><label className="label">사용일</label><input className="input" type="date" value={form.start_date} onChange={e=>setForm({...form,start_date:e.target.value})} /></div>
          ) : (
            <div className="grid two">
              <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={form.start_date} onChange={e=>setForm({...form,start_date:e.target.value})} /></div>
              <div className="form-row"><label className="label">종료일</label><input className="input" type="date" value={form.end_date} onChange={e=>setForm({...form,end_date:e.target.value})} /></div>
            </div>
          )}

          {["half_am","half_pm","hourly"].includes(form.request_type)&&(
            <div className="grid two">
              <div className="form-row"><label className="label">시작 시각</label><input className="input" type="time" value={form.start_time} onChange={e=>setForm({...form,start_time:e.target.value})} /></div>
              <div className="form-row"><label className="label">종료 시각</label><input className="input" type="time" value={form.end_time} onChange={e=>setForm({...form,end_time:e.target.value})} /></div>
            </div>
          )}
          {isHourly&&<div className="form-row"><label className="label">사용 시간 (시간)</label><input className="input" type="number" step="0.5" value={form.amount_hours} onChange={e=>setForm({...form,amount_hours:e.target.value})} /></div>}
          <div className="form-row"><label className="label">사유</label><textarea className="textarea" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} /></div>
          <button className="button full" onClick={submitLeave}>휴가 신청</button>
        </section>}

        {showOvertime&&<section className="card">
          <h2 className="card-title"><i className="ti ti-clock-plus" aria-hidden="true"></i>추가근무 신청</h2>
          <div className="grid three" style={{marginBottom:14}}>
            <div className="metric"><div className="metric-value">{compEarned.toFixed(1)}일</div><div className="metric-label">승인 적립</div></div>
            <div className="metric"><div className="metric-value">{compRemainHours}시간</div><div className="metric-label">사용 가능</div></div>
            <div className="metric"><div className="metric-value">{compRequests.filter(r=>r.status==="pending").length}건</div><div className="metric-label">승인 대기</div></div>
          </div>
          <p className="body-text" style={{marginBottom:14}}>추가근무는 별도 수당이 아니라 대체휴가로 적립됩니다. 관리자 승인 후 휴가 잔여에 추가됩니다 (8시간 = 1일).</p>
          <div className="alert">※ 추가근무는 시작 시간 전에만 신청할 수 있습니다.<br/>※ 한 번 신청하면 수정이 불가능합니다. 수정이 필요하면 승인 전 취소 후 다시 신청해주세요.</div>
          <div className="form-row"><label className="label">추가근무일</label><input className="input" type="date" value={compForm.work_date} onChange={e=>setCompForm({...compForm,work_date:e.target.value})} /></div>
          <div className="comp-time-grid">
            <div className="form-row"><label className="label">시작</label><input className="input" type="time" value={compForm.start_time} onChange={e=>handleCompTimeChange("start_time",e.target.value)} /></div>
            <div className="form-row"><label className="label">종료</label><input className="input" type="time" value={compForm.end_time} onChange={e=>handleCompTimeChange("end_time",e.target.value)} /></div>
            <div className="form-row"><label className="label">시간(자동)</label><input className="input" type="number" step="0.5" value={compForm.hours} onChange={e=>setCompForm({...compForm,hours:Number(e.target.value)})} /></div>
          </div>
          <div className="form-row"><label className="label">사유</label><textarea className="textarea" value={compForm.reason} onChange={e=>setCompForm({...compForm,reason:e.target.value})} placeholder="예: 행사 운영, 외부 교육 연장 등" /></div>
          <button className="button full" onClick={submitCompTime}>추가근무 신청</button>
        </section>}
      </div>

      {showOvertime&&employee.role==="admin"&&<AdminCompGrantCard currentEmployee={employee} />}

      {showOvertime&&<section className="card">
        <h2 className="card-title"><i className="ti ti-clock-edit" aria-hidden="true"></i>추가근무 신청 내역</h2>
        {compRequests.length===0?<p className="subtle">신청 내역이 없습니다.</p>:(
          <div className="grid">
            {compRequests.map(r=>(
              <div className="list-row" key={r.id}>
                <div><b>{r.work_date} {r.start_time?.slice(0,5)}~{r.end_time?.slice(0,5)}</b><div className="subtle">{r.hours}시간 → {r.converted_days}일 · {r.reason??"-"}</div></div>
                <div className="actions"><span className={`badge ${badgeClass(r.status)}`}>{r.status}</span>{r.status==="pending"&&<button className="button ghost" onClick={()=>cancelCompRequest(r.id)}>취소</button>}</div>
              </div>
            ))}
          </div>
        )}
      </section>}

      {showLeave&&<section className="card">
        <h2 className="card-title"><i className="ti ti-list" aria-hidden="true"></i>신청 내역</h2>
        <DataTable rows={[
          ...requests.map(r=>({구분:requestTypeLabels[r.request_type]??r.request_type,기간:`${r.start_date}${r.end_date!==r.start_date?"~"+r.end_date:""}`,시간:r.start_time?`${r.start_time?.slice(0,5)}~${r.end_time?.slice(0,5)}`:"-",환산:r.amount_days!=null?r.amount_days+"일":r.amount_hours!=null?r.amount_hours+"시간":"-",상태:r.status,사유:r.reason??"-"})),
        ]} />
      </section>}
    </div>
  );
}

function AdminCompGrantCard({currentEmployee}:{currentEmployee:any}){
  const [employees,setEmployees]=useState<any[]>([]);
  const [form,setForm]=useState({employee_id:"",work_date:todayIso(),start_time:"18:00",end_time:"20:00",hours:2,reason:""});
  const [message,setMessage]=useState("");
  useEffect(()=>{supabase.from("employees").select("id,name,employee_no,employment_status").eq("employment_status","active").order("name").then(({data})=>setEmployees(data??[]));},[]);
  function empName(id:string){return employees.find(e=>e.id===id)?.name??"직원";}
  function updateTime(field:"start_time"|"end_time",value:string){
    const next={...form,[field]:value};
    const hours=timeDiffHours(next.start_time,next.end_time);
    setForm({...next,hours:hours>0?hours:form.hours});
  }
  async function grant(){
    setMessage("");
    if(!form.employee_id) return setMessage("추가근무를 등록할 직원을 선택해주세요.");
    if(form.hours<=0) return setMessage("추가근무 시간을 확인해주세요.");
    if(!form.reason.trim()) return setMessage("등록 사유를 입력해주세요.");
    if(!window.confirm(`${empName(form.employee_id)} 직원에게 ${form.hours}시간 추가근무를 승인 등록할까요?`)) return;
    const {error}=await supabase.rpc("admin_grant_comp_time",{
      p_employee_id:form.employee_id,
      p_work_date:form.work_date,
      p_start_time:form.start_time,
      p_end_time:form.end_time,
      p_hours:form.hours,
      p_reason:form.reason.trim(),
    });
    if(error) setMessage(`추가근무 등록 실패: ${error.message}`);
    else{setMessage(`${empName(form.employee_id)} 직원의 추가근무를 승인 등록하고 대체휴가를 적립했습니다.`);setForm({...form,reason:""});}
  }
  return <section className="card">
    <h2 className="card-title"><i className="ti ti-user-plus" aria-hidden="true"></i>직원 추가근무 직접 등록</h2>
    <p className="subtle" style={{marginBottom:14}}>대표 또는 관리자가 사후 확인한 추가근무를 직원별로 직접 등록합니다. 저장 즉시 승인되며 대체휴가가 함께 적립됩니다.</p>
    {message&&<div className={`alert ${message.includes("실패")?"error":"success"}`}>{message}</div>}
    <div className="grid four">
      <div className="form-row"><label className="label">직원</label><select className="select" value={form.employee_id} onChange={e=>setForm({...form,employee_id:e.target.value})}><option value="">직원 선택</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name} · {e.employee_no}</option>)}</select></div>
      <div className="form-row"><label className="label">근무일</label><input className="input" type="date" value={form.work_date} onChange={e=>setForm({...form,work_date:e.target.value})} /></div>
      <div className="form-row"><label className="label">시작</label><input className="input" type="time" value={form.start_time} onChange={e=>updateTime("start_time",e.target.value)} /></div>
      <div className="form-row"><label className="label">종료</label><input className="input" type="time" value={form.end_time} onChange={e=>updateTime("end_time",e.target.value)} /></div>
    </div>
    <div className="grid two">
      <div className="form-row"><label className="label">시간</label><input className="input" type="number" min="0.5" step="0.5" value={form.hours} onChange={e=>setForm({...form,hours:Number(e.target.value)})} /></div>
      <div className="form-row"><label className="label">대체휴가 환산</label><div className="readonly-field">{(form.hours/8).toFixed(2)}일</div></div>
    </div>
    <div className="form-row"><label className="label">등록 사유</label><textarea className="textarea" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="예: 행사 종료 후 정리, 사후 확인된 연장근무" /></div>
    <button className="button" onClick={grant}><i className="ti ti-check" aria-hidden="true"></i>승인 등록</button>
  </section>;
}

function WorkplacePage({ employee }: { employee: any }) {
  const [query,setQuery]=useState(""); const [places,setPlaces]=useState<any[]>([]); const [workplaces,setWorkplaces]=useState<any[]>([]); const [message,setMessage]=useState("");
  const [reqType,setReqType]=useState("special_school"); const [reqPrivate,setReqPrivate]=useState(false);
  const [editing,setEditing]=useState<any|null>(null);
  const isAdmin=employee.role==="admin";
  async function load() {
    const {data}=await supabase.from("workplaces").select("*").neq("approval_status","rejected").order("created_at",{ascending:false});
    setWorkplaces(data??[]);
  }
  useEffect(()=>{load();},[]);
  async function search() {
    setMessage(""); setPlaces([]);
    const trimmed=query.trim();
    if(!trimmed) return setMessage("검색어를 입력해주세요.");
    const {data,error}=await supabase.functions.invoke("kakao-place-search",{body:{query:trimmed}});
    if(error) return setMessage(error.message);
    if(data?.error) setMessage(data.error);
    const docs=data?.documents??[];
    setPlaces(docs);
    if(!data?.error&&docs.length===0) setMessage("검색 결과가 없습니다. 주소를 더 자세히 입력해주세요.");
  }
  async function requestPlace(p:any) {
    const existing=workplaces.find(w=>w.kakao_place_id&&String(w.kakao_place_id)===String(p.id));
    if(existing){
      setMessage(`이미 등록된 근무지입니다: ${existing.name} (${existing.approval_status==="approved"?"승인됨":"승인 대기"})`);
      return;
    }
    const approval_status=isAdmin?"approved":"pending";
    const {error}=await supabase.from("workplaces").insert({name:p.place_name,type:reqType,address:p.road_address_name||p.address_name,kakao_place_id:p.id,lat:Number(p.y),lng:Number(p.x),radius_m:100,approval_status,is_active:isAdmin,visibility:reqPrivate?"private":"public",requested_by:employee.id,approved_by:isAdmin?employee.id:null});
    if(error) setMessage(error.message); else{setMessage(isAdmin?`${p.place_name}이(가) 승인된 근무지로 바로 추가되었습니다.`:`${p.place_name} 근무지 승인 요청이 저장되었습니다.`);setPlaces([]);setQuery("");await load();}
  }
  async function saveWorkplace() {
    if(!editing?.id) return;
    const name=String(editing.name??"").trim();
    if(!name) return setMessage("근무지 이름을 입력해주세요.");
    const radius=Math.max(20,Math.min(1000,Number(editing.radius_m)||100));
    const type=/(집|자택|재택|home)/i.test(name)? "remote" : editing.type;
    const {error}=await supabase.from("workplaces").update({
      name,
      address:String(editing.address??"").trim()||null,
      type,
      radius_m:radius,
      visibility:editing.visibility==="private"?"private":"public",
      updated_at:new Date().toISOString(),
    }).eq("id",editing.id);
    if(error) setMessage(error.message);
    else {
      setMessage(`${name} 근무지 정보를 수정했습니다.${type==="remote"?" 이제 출근 시 자동으로 재택 처리됩니다.":""}`);
      setEditing(null);
      await load();
    }
  }
  async function archiveWorkplace(w:any) {
    if(!window.confirm(`${w.name} 근무지를 삭제할까요?\n과거 출근 기록은 유지되고 새 출근 위치에서는 제외됩니다.`)) return;
    const {error}=await supabase.from("workplaces").update({
      approval_status:"rejected",
      is_active:false,
      updated_at:new Date().toISOString(),
    }).eq("id",w.id);
    if(error) setMessage(error.message);
    else {
      setMessage(`${w.name} 근무지를 삭제했습니다.`);
      if(editing?.id===w.id) setEditing(null);
      await load();
    }
  }
  const approved=workplaces.filter(w=>w.approval_status==="approved");
  const pending=workplaces.filter(w=>w.approval_status==="pending");
  return (
    <div className="grid two">
      <section className="card">
        <h2 className="card-title"><i className="ti ti-search" aria-hidden="true"></i>근무지 검색·요청</h2>
        <p className="subtle" style={{marginBottom:12}}>{isAdmin?"카카오맵 검색으로 승인된 근무지를 바로 추가합니다.":"카카오맵 검색으로 근무지를 등록 요청합니다. 승인되면 다음 출근 시 자동 후보로 사용됩니다."}</p>
        {message&&<div className="alert">{message}</div>}
        <div className="grid two">
          <div className="form-row"><label className="label">유형</label>
            <select className="select" value={reqType} onChange={e=>setReqType(e.target.value)}>
              {Object.entries(workplaceTypeLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="form-row"><label className="label">공개 범위</label>
            <select className="select" value={reqPrivate?"private":"public"} onChange={e=>setReqPrivate(e.target.value==="private")}>
              <option value="public">전체 공개</option>
              <option value="private">나에게만 (집 등)</option>
            </select>
          </div>
        </div>
        <div className="form-row"><label className="label">근무지명</label><input className="input" value={query} onChange={e=>setQuery(e.target.value)} placeholder="예: 대구광명학교" onKeyDown={e=>e.key==="Enter"&&search()} /></div>
        <button className="button" onClick={search}><i className="ti ti-search" aria-hidden="true"></i>검색</button>
        <div className="grid" style={{marginTop:14}}>{places.map(p=>(<div className="list-row" key={p.id}><div><b>{p.place_name}</b><div className="subtle">{p.road_address_name||p.address_name}</div></div><button className="button secondary" onClick={()=>requestPlace(p)}>{isAdmin?"바로 추가":"승인 요청"}</button></div>))}</div>
      </section>
      <section className="card">
        <h2 className="card-title"><i className="ti ti-map" aria-hidden="true"></i>근무지 목록</h2>
        <div className="actions" style={{justifyContent:"space-between",marginBottom:8}}>
          <h3 style={{margin:0}}>승인된 근무지 {approved.length>0&&<span className="count-badge">{approved.length}</span>}</h3>
          <button className="button ghost" onClick={load}><i className="ti ti-refresh" aria-hidden="true"></i>새로고침</button>
        </div>
        {approved.length===0&&<p className="subtle">승인된 근무지가 없습니다.</p>}
        {approved.map(w=>(
          <div className="list-row" key={w.id}>
            <div>
              <b>{w.name}</b>
              <div className="subtle">{w.address??"주소 없음"} · {workplaceTypeLabels[w.type]??w.type} · 반경 {w.radius_m}m · {w.visibility==="private"?"나에게만":"전체 공개"}</div>
            </div>
            {isAdmin&&<div className="actions">
              <button className="button ghost" title="근무지 수정" onClick={()=>setEditing({...w})}><i className="ti ti-edit" aria-hidden="true"></i>수정</button>
              <button className="button danger" title="근무지 삭제" onClick={()=>archiveWorkplace(w)}><i className="ti ti-trash" aria-hidden="true"></i>삭제</button>
            </div>}
          </div>
        ))}
        <h3>승인 대기 {pending.length>0&&<span className="count-badge">{pending.length}</span>}</h3>
        {pending.length===0&&<p className="subtle">승인 대기 근무지가 없습니다.</p>}
        {pending.map(w=>(
          <div className="list-row" key={w.id}>
            <div><b>{w.name}</b><div className="subtle">{w.address??"주소 없음"} · {workplaceTypeLabels[w.type]??w.type} · 반경 {w.radius_m}m</div></div>
            {isAdmin&&<div className="actions">
              <button className="button ghost" title="근무지 수정" onClick={()=>setEditing({...w})}><i className="ti ti-edit" aria-hidden="true"></i>수정</button>
              <button className="button danger" title="근무지 삭제" onClick={()=>archiveWorkplace(w)}><i className="ti ti-trash" aria-hidden="true"></i>삭제</button>
            </div>}
          </div>
        ))}
      </section>
      {editing&&(
        <div className="modal-backdrop" onClick={()=>setEditing(null)}>
          <div className="modal-box" style={{maxWidth:520}} onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="card-title" style={{margin:0}}><i className="ti ti-map-pin-cog" aria-hidden="true"></i>근무지 수정</h2>
              <button className="modal-close" title="닫기" onClick={()=>setEditing(null)}><i className="ti ti-x" aria-hidden="true"></i></button>
            </div>
            <div className="form-row"><label className="label">이름</label><input className="input" value={editing.name??""} onChange={e=>setEditing({...editing,name:e.target.value})} /></div>
            <div className="form-row"><label className="label">주소</label><input className="input" value={editing.address??""} onChange={e=>setEditing({...editing,address:e.target.value})} /></div>
            <div className="grid two">
              <div className="form-row"><label className="label">유형</label><select className="select" value={editing.type} onChange={e=>setEditing({...editing,type:e.target.value})}>{Object.entries(workplaceTypeLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
              <div className="form-row"><label className="label">GPS 인식 반경(m)</label><input className="input" type="number" min="20" max="1000" value={editing.radius_m??100} onChange={e=>setEditing({...editing,radius_m:Number(e.target.value)})} /></div>
            </div>
            <div className="form-row"><label className="label">공개 범위</label><select className="select" value={editing.visibility??"public"} onChange={e=>setEditing({...editing,visibility:e.target.value})}><option value="public">전체 공개</option><option value="private">나에게만 (집 등)</option></select></div>
            <div className="alert">집 또는 자택은 유형을 <b>재택</b>으로 지정하면 GPS 확인 후 출근 상태가 자동으로 재택으로 기록됩니다.</div>
            <div className="modal-actions"><button className="button" onClick={saveWorkplace}><i className="ti ti-check" aria-hidden="true"></i>저장</button><button className="button ghost" onClick={()=>setEditing(null)}>취소</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function LeaveManageModal({ emp, requests, adjustments, compRequests, currentEmployee, onClose, onChanged }:
  { emp:any; requests:any[]; adjustments:any[]; compRequests:any[]; currentEmployee:any; onClose:()=>void; onChanged:()=>void }) {
  const [days,setDays]=useState(""); const [reason,setReason]=useState(""); const [adjType,setAdjType]=useState("add"); const [msg,setMsg]=useState("");
  const ent=calculateLeaveEntitlement(emp.joined_at);
  const fullTime=isFullTimeEmployee(emp);
  const adj=calculateAdjustmentDays(adjustments);
  const used=calculateUsedDays(requests,false);
  const total=(fullTime?ent.baseGrantedDays:0)+adj;
  const remain=Math.max(0,total-used);
  async function apply() {
    setMsg(""); const d=Number(days);
    if(!d||d<=0) return setMsg("일수를 입력해주세요.");
    if(!reason.trim()) return setMsg("사유를 입력해주세요.");
    const signed = adjType==="subtract" ? -Math.abs(d) : Math.abs(d);
    const {error}=await supabase.from("leave_adjustments").insert({employee_id:emp.id,adjustment_type:adjType==="subtract"?"subtract":"add",adjustment_days:signed,source_type:"manual_adjust",reason:reason.trim(),created_by:currentEmployee.id});
    if(error) setMsg(error.message); else { setMsg("반영되었습니다."); setDays(""); setReason(""); onChanged(); }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{maxWidth:460}} onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="card-title" style={{margin:0}}><i className="ti ti-calendar-stats" aria-hidden="true"></i>{emp.name} 연차 관리</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="leave-chips" style={{marginBottom:14}}>
          <div className="leave-chip"><span>총 부여</span><b>{total.toFixed(1)}일</b></div>
          <div className="leave-chip"><span>사용</span><b>{used.toFixed(1)}일</b></div>
          <div className="leave-chip"><span>잔여</span><b>{remain.toFixed(1)}일</b></div>
        </div>
        {msg&&<div className={`alert ${msg.includes("반영")?"success":"error"}`}>{msg}</div>}
        <div className="form-row"><label className="label">조정 유형</label>
          <select className="select" value={adjType} onChange={e=>setAdjType(e.target.value)}>
            <option value="add">추가 (특별휴가 부여 등)</option>
            <option value="subtract">차감 (조정)</option>
          </select>
        </div>
        <div className="form-row"><label className="label">일수</label><input className="input" type="number" step="0.5" value={days} onChange={e=>setDays(e.target.value)} placeholder="예: 1" /></div>
        <div className="form-row"><label className="label">사유</label><input className="input" value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 경조사 특별휴가" /></div>
        <button className="button full" onClick={apply}>반영</button>
      </div>
    </div>
  );
}

function AdminPage({ currentEmployee, onChanged, view="dashboard" }: { currentEmployee: any; onChanged: () => void; view?:"dashboard"|"approvals"|"employees" }) {
  const [employees,setEmployees]=useState<any[]>([]);
  const [empMap,setEmpMap]=useState<Record<string,any>>({});
  const [employeeFilter,setEmployeeFilter]=useState("active");
  const [devices,setDevices]=useState<any[]>([]);
  const [workplaces,setWorkplaces]=useState<any[]>([]);
  const [requests,setRequests]=useState<any[]>([]);
  const [compRequests,setCompRequests]=useState<any[]>([]);
  const [adjustments,setAdjustments]=useState<any[]>([]);
  const [overrides,setOverrides]=useState<any[]>([]);
  const [absences,setAbsences]=useState<any[]>([]);
  const [allLogs,setAllLogs]=useState<any[]>([]);
  const [message,setMessage]=useState("");
  const [newEmployee,setNewEmployee]=useState({name:"",employee_no:"",phone:"",joined_at:todayIso(),work_start_date:todayIso(),role:"employee",device_limit:3,work_days:["mon","tue","wed","thu","fri"]});
  const [scheduleEmpId,setScheduleEmpId]=useState("");
  const [scheduleMsg,setScheduleMsg]=useState("");
  const [leaveModalEmp,setLeaveModalEmp]=useState<any|null>(null);

  async function load() {
    const {data:emps}=await supabase.from("employees").select("*").order("created_at",{ascending:false});
    const list=emps??[]; const map:Record<string,any>={};
    list.forEach((e:any)=>{map[e.id]=e;});
    setEmployees(list); setEmpMap(map);
    const [d,w,r,c,a,ov,ab,lg]=await Promise.all([
      supabase.from("registered_devices").select("*").order("created_at",{ascending:false}),
      supabase.from("workplaces").select("*").order("created_at",{ascending:false}),
      supabase.from("attendance_requests").select("*").order("created_at",{ascending:false}),
      supabase.from("comp_time_requests").select("*").order("created_at",{ascending:false}),
      supabase.from("leave_adjustments").select("*").order("created_at",{ascending:false}),
      supabase.from("weekly_schedule_overrides").select("*").order("week_start",{ascending:false}).limit(50),
      supabase.from("employee_absences").select("*").order("start_date",{ascending:false}),
      supabase.from("attendance_logs").select("id, employee_id, workplace_id, check_in_time, check_out_time, original_check_out_time, scheduled_check_out_time, overtime_review_status, status, workplaces(name,type)").order("check_in_time",{ascending:false}).limit(300),
    ]);
    setDevices(d.data??[]); setWorkplaces(w.data??[]); setRequests(r.data??[]); setCompRequests(c.data??[]); setAdjustments(a.data??[]); setOverrides(ov.data??[]); setAbsences(ab.data??[]); setAllLogs(lg.data??[]);
  }
  useEffect(()=>{load();},[]);
  const empName=(id?:string|null)=>id?(empMap[id]?.name??"-"):"-";

  function leaveForEmployee(empId:string) {
    const emp=empMap[empId]; if(!emp) return null;
    const ent=calculateLeaveEntitlement(emp.joined_at);
    const fullTime=isFullTimeEmployee(emp);
    const adj=adjustments.filter(a=>a.employee_id===empId);
    const reqs=requests.filter(r=>r.employee_id===empId);
    const comps=compRequests.filter(c=>c.employee_id===empId);
    const adjDays=calculateAdjustmentDays(adj);
    const compEarned=calculateApprovedCompDays(comps);
    const used=calculateUsedDays(reqs,false);
    const total=(fullTime?ent.baseGrantedDays:0)+adjDays;
    const remain=Math.max(0,total-used);
    const compH=Math.round(compEarned*8*10)/10;
    const compUsedH=reqs.filter(r=>r.request_type==="comp_leave_use"&&r.status==="approved").reduce((s,r)=>s+(r.amount_hours??(r.amount_days??0)*8),0);
    const pendingComp=comps.filter(c=>c.status==="pending").reduce((s,c)=>s+Number(c.converted_days||0),0);
    return {total,used,remain,compEarned,compRemainH:Math.max(0,compH-compUsedH),pendingComp};
  }

  async function createEmployee() {
    setMessage(""); const {data,error}=await supabase.functions.invoke("admin-create-employee",{body:newEmployee});
    if(error) setMessage(error.message); else if(data?.error) setMessage(data.error);
    else{setMessage(`직원 계정이 생성되었습니다. 초기 비밀번호: ${data.initial_password}`);setNewEmployee({name:"",employee_no:"",phone:"",joined_at:todayIso(),work_start_date:todayIso(),role:"employee",device_limit:3,work_days:["mon","tue","wed","thu","fri"]});await load();onChanged();}
  }
  async function updateEmployee(id:string,patch:Record<string,any>){const {error}=await supabase.from("employees").update(patch).eq("id",id);if(error)setMessage(error.message);else{await load();onChanged();}}
  async function toggleEmployee(id:string,cur:string){const n=cur!=="active";await updateEmployee(id,{is_active:n,employment_status:n?"active":"inactive"});}
  async function resetEmployeeNo(emp:any){
    const nw=window.prompt(`${emp.name}의 새 사번(로그인 아이디)을 입력하세요.`, emp.employee_no);
    if(!nw||nw===emp.employee_no) return;
    const {data,error}=await supabase.functions.invoke("admin-create-employee",{body:{action:"reset_employee_no",employee_id:emp.id,new_employee_no:nw.trim()}});
    if(error) setMessage(error.message); else if(data?.error) setMessage(data.error); else { setMessage(`사번이 ${data.employee_no}(으)로 변경되었습니다. 새 로그인 아이디로 안내해주세요.`); await load(); }
  }
  async function resetPassword(emp:any){
    if(!window.confirm(`${emp.name}의 비밀번호를 초기화할까요? (lupl + 휴대폰 뒤4자리)`)) return;
    const {data,error}=await supabase.functions.invoke("admin-create-employee",{body:{action:"reset_password",employee_id:emp.id}});
    if(error) setMessage(error.message); else if(data?.error) setMessage(data.error); else setMessage(`${emp.name} 비밀번호가 초기화되었습니다. 초기 비밀번호: ${data.initial_password}`);
  }
  async function reviewWorkplace(id:string,status:string,type?:string){
    const patch:any={approval_status:status,is_active:status==="approved",updated_at:new Date().toISOString()};
    if(status==="approved") patch.approved_by=currentEmployee.id;
    if(type) patch.type=type;
    const {error}=await supabase.from("workplaces").update(patch).eq("id",id);if(error)setMessage(error.message);else{await load();onChanged();}
  }
  async function setWorkplaceType(id:string,type:string){const {error}=await supabase.from("workplaces").update({type}).eq("id",id);if(error)setMessage(error.message);else await load();}
  async function reviewRequest(id:string,status:string){const {error}=await supabase.rpc("review_attendance_request",{p_request_id:id,p_status:status,p_review_note:""});if(error)setMessage(error.message);else{await load();onChanged();}}
  function compAttendance(request:any){
    return allLogs.find((log:any)=>log.employee_id===request.employee_id&&localDateStr(log.check_in_time)===request.work_date&&!!log.check_out_time);
  }
  function compSchedule(request:any){
    return getScheduleForDate(empMap[request.employee_id],request.work_date,overrides);
  }
  function estimatedOvertime(request:any){
    const log=compAttendance(request);
    if(!log?.check_out_time) return null;
    const scheduledEnd=kstDateTime(request.work_date,compSchedule(request).work_end);
    return Math.max(0,Math.round(((new Date(log.check_out_time).getTime()-scheduledEnd.getTime())/3600000)*100)/100);
  }
  async function reviewCompRequest(request:any,status:string){
    const usesActualCheckout=request.work_date>="2026-06-24";
    const log=compAttendance(request);
    if(usesActualCheckout&&!log?.check_out_time) return setMessage("직원이 퇴근한 뒤 초과근무를 처리할 수 있습니다.");
    const schedule=compSchedule(request);
    const result=usesActualCheckout
      ? await supabase.rpc("review_comp_time_attendance",{p_request_id:request.id,p_status:status,p_scheduled_end:String(schedule.work_end??"18:00").slice(0,5),p_review_note:status==="approved"?"실제 퇴근시간 기준 승인":"초과근무 미인정 및 예정 퇴근시간 적용"})
      : await supabase.rpc("review_comp_time_request",{p_request_id:request.id,p_status:status,p_review_note:""});
    if(result.error) setMessage(result.error.message);
    else{
      setMessage(status==="approved"?"실제 초과근무가 승인되어 대체휴가로 적립되었습니다.":"초과근무를 인정하지 않고 예정 퇴근시간으로 근태를 마감했습니다.");
      await load();
      onChanged();
    }
  }
  async function reviewDevice(id:string,status:string){const {error}=await supabase.from("registered_devices").update({status}).eq("id",id);if(error)setMessage(error.message);else{await load();onChanged();}}
  async function confirmAttendanceLog(id:string){const {error}=await supabase.rpc("confirm_attendance_log",{p_log_id:id,p_status:"확인 완료"});if(error)setMessage(error.message);else{setMessage("근태 기록을 확인 완료 처리했습니다.");await load();onChanged();}}
  async function forceClockOut(id:string){if(!window.confirm("이 기록을 현재 시각으로 강제 퇴근 처리할까요?")) return; const {error}=await supabase.rpc("close_attendance_log",{p_log_id:id,p_status:"관리자 강제퇴근",p_device_fingerprint_hash:null,p_device_info:{}});if(error)setMessage(error.message);else{setMessage("강제 퇴근 처리했습니다.");await load();onChanged();}}

  const filtered=employees.filter(e=>employeeFilter==="all"?true:employeeFilter==="inactive"?e.employment_status!=="active":e.employment_status==="active");
  const activeEmployees=employees.filter(e=>e.employment_status==="active");
  const todayLogByEmployee:Record<string,any>={};
  allLogs
    .filter((l:any)=>isToday(l.check_in_time))
    .sort(byCheckInDesc)
    .forEach((l:any)=>{ if(!todayLogByEmployee[l.employee_id]) todayLogByEmployee[l.employee_id]=l; });
  const dailyRows=activeEmployees.map((e:any)=>({employee:e,log:todayLogByEmployee[e.id]}));
  const pW=workplaces.filter(w=>w.approval_status==="pending");
  const pC=compRequests.filter(r=>r.status==="pending");
  const pR=requests.filter(r=>r.status==="pending");
  const pD=devices.filter(d=>d.status==="pending");
  const reviewStatuses=["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음"];
  const pL=allLogs.filter((l:any)=>{
    const openToday=!l.check_out_time&&isToday(l.check_in_time);
    if(l.status==="확인 완료") return false;
    if(openToday) return false;
    return !l.check_out_time || reviewStatuses.includes(l.status);
  });
  const pendingTotal=pW.length+pC.length+pR.length+pD.length+pL.length;
  function toggleDay(arr:string[],day:string){return arr.includes(day)?arr.filter(d=>d!==day):[...arr,day];}

  return (
    <div className="grid">
      {message&&<div className="alert">{message}</div>}

      {view==="dashboard"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-users" aria-hidden="true"></i>일일 직원 근무 현황</h2>
        <div className="grid four" style={{marginBottom:16}}>
          <div className="metric"><div className="metric-value">{activeEmployees.length}</div><div className="metric-label">재직 직원</div></div>
          <div className="metric"><div className="metric-value">{dailyRows.filter(x=>x.log?.check_in_time).length}</div><div className="metric-label">오늘 출근</div></div>
          <div className="metric"><div className="metric-value">{dailyRows.filter(x=>x.log?.check_out_time).length}</div><div className="metric-label">오늘 퇴근</div></div>
          <div className="metric"><div className="metric-value">{pendingTotal}</div><div className="metric-label">확인 대기</div></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>직원</th><th>출근 위치</th><th>출근 시각</th><th>퇴근 시각</th><th>상태</th></tr></thead>
            <tbody>
              {dailyRows.map(({employee:e,log}:any)=>{
                const display=attendanceDisplay(e,log,overrides);
                return (
                <tr key={e.id}>
                  <td><b>{e.name}</b><br /><span className="subtle">{e.employee_no}</span></td>
                  <td>{log?.workplaces?.name ?? "-"}</td>
                  <td>{log ? formatDateTime(log.check_in_time) : "-"}</td>
                  <td>{log?.check_out_time ? formatDateTime(log.check_out_time) : "-"}</td>
                  <td><div className="status-badges"><span className={`badge ${display.primaryClass}`}>{display.primary}</span>{display.workType&&<span className="badge work-type">{display.workType}</span>}</div>{display.primary==="지각"&&<span className="late-detail">{display.lateMinutes}분 지각 · 기준 {String(display.scheduleStart).slice(0,5)}</span>}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>}

      {view==="approvals"&&<CollapsibleSection title={`승인 대기${pendingTotal>0?` (${pendingTotal})`:""}`} icon="ti-inbox" defaultOpen={true}>
        <div className="grid two">
          <div>
            <h3 style={{marginTop:0}}>근무지 {pW.length>0&&<span className="count-badge">{pW.length}</span>}</h3>
            {pW.length===0&&<p className="subtle">없음</p>}
            {pW.map(w=>(
              <div className="list-row" key={w.id} style={{flexDirection:"column",alignItems:"stretch"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:8}}>
                  <div><b>{w.name}</b><div className="subtle">요청 {empName(w.requested_by)} · 좌표 {w.lat??"-"}, {w.lng??"-"}</div></div>
                  <select className="select" style={{width:"auto"}} value={w.type} onChange={e=>setWorkplaceType(w.id,e.target.value)}>
                    {Object.entries(workplaceTypeLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="actions"><button className="button secondary" onClick={()=>reviewWorkplace(w.id,"approved")}>확정</button><button className="button danger" onClick={()=>reviewWorkplace(w.id,"rejected")}>반려</button></div>
              </div>
            ))}
          </div>
          <div>
            <h3 style={{marginTop:0}}>위치·미퇴근 확인 {pL.length>0&&<span className="count-badge">{pL.length}</span>}</h3>
            {pL.length===0&&<p className="subtle">없음</p>}
            {pL.map((l:any)=>(
              <div className="list-row" key={l.id} style={{flexDirection:"column",alignItems:"stretch"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                  <div><b>{empName(l.employee_id)}</b><div className="subtle">출근 {formatDateTime(l.check_in_time)} · 퇴근 {formatDateTime(l.check_out_time)} · {l.status??"-"}</div></div>
                  <span className={`badge ${!l.check_out_time?"warn":""}`}>{!l.check_out_time?"미퇴근":"확인 필요"}</span>
                </div>
                <div className="type-desc" style={{marginTop:8}}>상세: 출근 {formatDateTime(l.check_in_time)} / 퇴근 {formatDateTime(l.check_out_time)} / 상태 {l.status??"-"}</div>
                <div className="actions"><button className="button secondary" onClick={()=>confirmAttendanceLog(l.id)}>확인 완료</button>{!l.check_out_time&&<button className="button danger" onClick={()=>forceClockOut(l.id)}>강제 퇴근</button>}</div>
              </div>
            ))}
          </div>
          <div>
            <h3>추가근무 {pC.length>0&&<span className="count-badge">{pC.length}</span>}</h3>
            {pC.length===0&&<p className="subtle">없음</p>}
            {pC.map(r=>{
              const log=compAttendance(r);
              const actual=estimatedOvertime(r);
              const usesActualCheckout=r.work_date>="2026-06-24";
              return <div className="list-row" key={r.id}>
                <div>
                  <b>{empName(r.employee_id)}</b>
                  <div className="subtle">{r.work_date} · 신청 {r.start_time?.slice(0,5)}~{r.end_time?.slice(0,5)} · {r.hours}시간</div>
                  {usesActualCheckout&&<div className="type-desc" style={{marginTop:6}}>예정 퇴근 {String(compSchedule(r).work_end??"18:00").slice(0,5)} · 실제 퇴근 {log?.check_out_time?timeOnly(log.check_out_time):"아직 퇴근 전"} · 인정 예상 {actual==null?"-":`${actual}시간`}</div>}
                </div>
                <div className="actions">
                  <button className="button secondary" disabled={usesActualCheckout&&!log?.check_out_time} onClick={()=>reviewCompRequest(r,"approved")}>{usesActualCheckout?"초과근무 승인":"승인"}</button>
                  <button className="button danger" disabled={usesActualCheckout&&!log?.check_out_time} onClick={()=>reviewCompRequest(r,"rejected")}>{usesActualCheckout?"인정 안 함":"반려"}</button>
                </div>
              </div>;
            })}
          </div>
          <div>
            <h3>휴가 신청 {pR.length>0&&<span className="count-badge">{pR.length}</span>}</h3>
            {pR.length===0&&<p className="subtle">없음</p>}
            {pR.map(r=>(<div className="list-row" key={r.id}><div><b>{empName(r.employee_id)}</b><div className="subtle">{requestTypeLabels[r.request_type]??r.request_type} · {r.start_date}{r.end_date!==r.start_date?"~"+r.end_date:""}{r.start_time?` ${r.start_time.slice(0,5)}~${r.end_time?.slice(0,5)}`:""}</div></div><div className="actions"><button className="button secondary" onClick={()=>reviewRequest(r.id,"approved")}>승인</button><button className="button danger" onClick={()=>reviewRequest(r.id,"rejected")}>반려</button></div></div>))}
          </div>
          <div>
            <h3>기기 {pD.length>0&&<span className="count-badge">{pD.length}</span>}</h3>
            {pD.length===0&&<p className="subtle">없음</p>}
            {pD.map(d=>(<div className="list-row" key={d.id}><div><b>{empName(d.employee_id)}</b><div className="subtle">{d.device_info?.platform||"기기"}</div></div><div className="actions"><button className="button secondary" onClick={()=>reviewDevice(d.id,"approved")}>승인</button><button className="button danger" onClick={()=>reviewDevice(d.id,"rejected")}>반려</button></div></div>))}
          </div>
        </div>
      </CollapsibleSection>}

      {view==="approvals"&&<WeekendCompCard employees={employees} empMap={empMap} allLogs={allLogs} compRequests={compRequests} currentEmployee={currentEmployee} onChanged={load} />}

      {view==="approvals"&&<ApprovedCompCard compRequests={compRequests} empMap={empMap} onChanged={load} />}

      {view==="employees"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-chart-pie" aria-hidden="true"></i>직원 연차 현황</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>직원</th><th>총 부여</th><th>사용</th><th>잔여</th><th>대체휴가</th><th>관리</th></tr></thead>
            <tbody>
              {employees.filter(e=>e.employment_status==="active").map(e=>{
                const lv=leaveForEmployee(e.id); if(!lv) return null;
                return (<tr key={e.id}><td><b>{e.name}</b><br /><span className="subtle">{e.employee_no}</span></td><td>{lv.total.toFixed(1)}일</td><td>{lv.used.toFixed(1)}일</td><td><b style={{color:lv.remain<3?"var(--red)":"inherit"}}>{lv.remain.toFixed(1)}일</b></td><td>{lv.compEarned.toFixed(1)}일 ({lv.compRemainH}h)</td><td><button className="button secondary" onClick={()=>setLeaveModalEmp(e)}>연차 관리</button></td></tr>);
              })}
            </tbody>
          </table>
        </div>
      </section>}

      {view==="employees"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-user-plus" aria-hidden="true"></i>직원 계정 생성</h2>
        <div className="grid four">
          <div className="form-row"><label className="label">이름</label><input className="input" value={newEmployee.name} onChange={e=>setNewEmployee({...newEmployee,name:e.target.value})} /></div>
          <div className="form-row"><label className="label">사번</label><input className="input" value={newEmployee.employee_no} onChange={e=>setNewEmployee({...newEmployee,employee_no:e.target.value})} /></div>
          <div className="form-row"><label className="label">휴대폰</label><input className="input" value={newEmployee.phone} onChange={e=>setNewEmployee({...newEmployee,phone:formatPhone(e.target.value)})} placeholder="010-0000-0000" /></div>
          <div className="form-row"><label className="label">입사일</label><input className="input" type="date" value={newEmployee.joined_at} onChange={e=>setNewEmployee({...newEmployee,joined_at:e.target.value,work_start_date:newEmployee.work_start_date||e.target.value})} /></div>
        </div>
        <div className="form-row"><label className="label">출근 시작일</label><input className="input" type="date" value={newEmployee.work_start_date} onChange={e=>setNewEmployee({...newEmployee,work_start_date:e.target.value})} /></div>
        <div className="grid two">
          <div className="form-row"><label className="label">권한</label><select className="select" value={newEmployee.role} onChange={e=>setNewEmployee({...newEmployee,role:e.target.value})}><option value="employee">직원</option><option value="admin">관리자</option></select></div>
          <div className="form-row"><label className="label">기기 제한</label><select className="select" value={newEmployee.device_limit} onChange={e=>setNewEmployee({...newEmployee,device_limit:Number(e.target.value)})}><option value={1}>1대</option><option value={2}>2대</option><option value={3}>3대</option></select></div>
        </div>
        <div className="form-row"><label className="label">출근 요일</label>
          <div className="days-grid">{ALL_DAYS.map(d=><button key={d} className={`day-btn ${newEmployee.work_days.includes(d)?"active":""}`} onClick={()=>setNewEmployee({...newEmployee,work_days:toggleDay(newEmployee.work_days,d)})}>{DAY_LABELS[d]}</button>)}</div>
        </div>
        <button className="button" onClick={createEmployee}><i className="ti ti-plus" aria-hidden="true"></i>직원 생성</button>
      </section>}

      {view==="employees"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-users" aria-hidden="true"></i>직원 관리</h2>
        <div className="tabs">
          <button className={`tab ${employeeFilter==="active"?"active":""}`} onClick={()=>setEmployeeFilter("active")}>재직</button>
          <button className={`tab ${employeeFilter==="inactive"?"active":""}`} onClick={()=>setEmployeeFilter("inactive")}>비활성</button>
          <button className={`tab ${employeeFilter==="all"?"active":""}`} onClick={()=>setEmployeeFilter("all")}>전체</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>직원</th><th>권한</th><th>상태</th><th>입사일</th><th>출근 시작일</th><th>계정</th><th>처리</th></tr></thead>
            <tbody>
              {filtered.map(e=>(
                <tr key={e.id}>
                  <td>{e.name}<br /><span className="subtle">{e.employee_no} · {e.phone}</span></td>
                  <td><select className="select" value={e.role} onChange={ev=>updateEmployee(e.id,{role:ev.target.value})}><option value="admin">관리자</option><option value="employee">직원</option></select></td>
                  <td><span className={`badge ${badgeClass(e.employment_status)}`}>{e.employment_status==="active"?"재직":"비활성"}</span></td>
                  <td><input className="input" type="date" value={e.joined_at??""} onChange={ev=>updateEmployee(e.id,{joined_at:ev.target.value})} /></td>
                  <td><input className="input" type="date" value={e.work_start_date??e.joined_at??""} onChange={ev=>updateEmployee(e.id,{work_start_date:ev.target.value})} /></td>
                  <td><div className="actions"><button className="button ghost" onClick={()=>resetEmployeeNo(e)}>사번 변경</button><button className="button ghost" onClick={()=>resetPassword(e)}>비번 초기화</button></div></td>
                  <td><button className={e.employment_status==="active"?"button danger":"button secondary"} onClick={()=>toggleEmployee(e.id,e.employment_status)}>{e.employment_status==="active"?"비활성화":"활성화"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}

      {view==="employees"&&leaveModalEmp&&<LeaveManageModal emp={leaveModalEmp} requests={requests.filter(r=>r.employee_id===leaveModalEmp.id)} adjustments={adjustments.filter(a=>a.employee_id===leaveModalEmp.id)} compRequests={compRequests.filter(c=>c.employee_id===leaveModalEmp.id)} currentEmployee={currentEmployee} onClose={()=>setLeaveModalEmp(null)} onChanged={load} />}
    </div>
  );
}


function SettingsPage({ currentEmployee, section="schedule" }: { currentEmployee:any; section?:"schedule"|"payroll" }) {
  const [employees,setEmployees]=useState<any[]>([]);
  const [empMap,setEmpMap]=useState<Record<string,any>>({});
  const [overrides,setOverrides]=useState<any[]>([]);
  const [absences,setAbsences]=useState<any[]>([]);
  const [scheduleEvents,setScheduleEvents]=useState<any[]>([]);
  const [msg,setMsg]=useState("");
  async function load(){
    const [e,ov,ab,se]=await Promise.all([
      supabase.from("employees").select("*").order("created_at",{ascending:false}),
      supabase.from("weekly_schedule_overrides").select("*").order("week_start",{ascending:false}).limit(200),
      supabase.from("employee_absences").select("*").order("start_date",{ascending:false}),
      supabase.from("employee_schedule_events").select("*").order("start_date",{ascending:true}),
    ]);
    const list=e.data??[]; const map:Record<string,any>={}; list.forEach((x:any)=>{map[x.id]=x;});
    setEmployees(list); setEmpMap(map); setOverrides(ov.data??[]); setAbsences(ab.data??[]); setScheduleEvents(se.data??[]);
  }
  useEffect(()=>{load();},[]);
  function empName(id?:string|null){return id&&empMap[id]?empMap[id].name:"-";}
  return <div className="grid">
    {section==="schedule"&&<><TeamScheduleBoard employees={employees} events={scheduleEvents} overrides={overrides} currentEmployee={currentEmployee} onChanged={load} /><ScheduleCard employees={employees} empMap={empMap} overrides={overrides} absences={absences} currentEmployee={currentEmployee} empName={empName} onChanged={load} setMsg={setMsg} msg={msg} /></>}
    {section==="payroll"&&<PayrollCard employees={employees} absences={absences} overrides={overrides} />}
  </div>;
}

function TeamScheduleBoard({employees,events,overrides,currentEmployee,onChanged}:{employees:any[];events:any[];overrides:any[];currentEmployee:any;onChanged:()=>void}) {
  const activeEmployees=employees.filter(e=>e.employment_status==="active");
  const [weekAnchor,setWeekAnchor]=useState(todayIso());
  const [selectedEmpId,setSelectedEmpId]=useState("all");
  const [editing,setEditing]=useState<any|null>(null);
  const [message,setMessage]=useState("");
  const [draggingId,setDraggingId]=useState<string|null>(null);
  const weekStart=weekStartIso(weekAnchor);
  const dates=Array.from({length:5},(_,i)=>addIsoDays(weekStart,i));
  const weekEnd=dates[4];
  const isAll=selectedEmpId==="all";
  const selectedEmployee=isAll?null:(activeEmployees.find(e=>e.id===selectedEmpId)??activeEmployees[0]??null);
  const selectedEvents=events.filter(e=>(isAll||e.employee_id===selectedEmployee?.id)&&e.start_date<=weekEnd&&e.end_date>=weekStart);
  const allDayEvents=selectedEvents.filter(e=>e.event_type==="info"&&!e.start_time&&!e.end_time);
  const timedEvents=selectedEvents.filter(e=>!allDayEvents.includes(e));
  const hours=Array.from({length:11},(_,i)=>9+i);
  const selectedColor=selectedEmployee?employeeColorFromList(activeEmployees,selectedEmployee.id):EMPLOYEE_COLORS[0];
  useEffect(()=>{
    if(selectedEmpId!=="all"&&!activeEmployees.some(e=>e.id===selectedEmpId)) setSelectedEmpId("all");
  },[activeEmployees.length,selectedEmpId]);
  function emptyEvent(employeeId=selectedEmployee?.id??activeEmployees[0]?.id??"",date=todayIso()){
    return {employee_id:employeeId,title:"",event_type:"info",start_date:date,end_date:date,start_time:"",end_time:"",note:""};
  }
  function changeWeek(offset:number){setWeekAnchor(addIsoDays(weekStart,offset*7));}
  function eventTime(event:any,employee=selectedEmployee){
    const defaults:Record<string,[string,string]>={
      work:[String(employee?.work_start??"09:00").slice(0,5),String(employee?.work_end??"18:00").slice(0,5)],
      am_only:["09:00","12:00"],
      pm_only:["13:00","18:00"],
      unavailable:["09:00","19:00"],
      info:["09:00","18:00"],
    };
    const fallback=defaults[event.event_type]??defaults.info;
    return [String(event.start_time??fallback[0]).slice(0,5),String(event.end_time??fallback[1]).slice(0,5)];
  }
  function timeGridPosition(event:any,employee=selectedEmployee){
    const [start,end]=eventTime(event,employee);
    const startMin=Math.max(9*60,Math.min(19*60,timeToMinutes(start)??9*60));
    const endMin=Math.max(startMin+30,Math.min(19*60,timeToMinutes(end)??18*60));
    return {row:Math.floor((startMin-9*60)/30)+1,span:Math.max(1,Math.ceil((endMin-startMin)/30)),label:`${start}~${end}`};
  }
  async function saveEvent(){
    if(!editing?.employee_id) return setMessage("직원을 선택해주세요.");
    if(!String(editing.title??"").trim()) return setMessage("일정 이름을 입력해주세요.");
    if(!editing.start_date||!editing.end_date||editing.end_date<editing.start_date) return setMessage("일정 기간을 확인해주세요.");
    const payload={
      employee_id:editing.employee_id,
      title:String(editing.title).trim(),
      event_type:editing.event_type,
      start_date:editing.start_date,
      end_date:editing.end_date,
      start_time:editing.start_time||null,
      end_time:editing.end_time||null,
      note:String(editing.note??"").trim()||null,
      updated_at:new Date().toISOString(),
    };
    const result=editing.id
      ? await supabase.from("employee_schedule_events").update(payload).eq("id",editing.id)
      : await supabase.from("employee_schedule_events").insert({...payload,created_by:currentEmployee.id});
    if(result.error) setMessage(`저장 실패: ${result.error.message}`);
    else{setMessage("직원 일정이 저장되었습니다.");setEditing(null);await onChanged();}
  }
  async function deleteEvent(){
    if(!editing?.id||!window.confirm(`${editing.title} 일정을 삭제할까요?`)) return;
    const {error}=await supabase.from("employee_schedule_events").delete().eq("id",editing.id);
    if(error) setMessage(`삭제 실패: ${error.message}`); else{setMessage("일정을 삭제했습니다.");setEditing(null);await onChanged();}
  }
  async function moveEvent(targetEmployeeId:string,targetDate:string){
    if(!draggingId) return;
    const event=events.find(e=>e.id===draggingId);
    setDraggingId(null);
    if(!event) return;
    const duration=countDaysInclusive(event.start_date,event.end_date);
    const {error}=await supabase.from("employee_schedule_events").update({
      employee_id:targetEmployeeId||event.employee_id,
      start_date:targetDate,
      end_date:addIsoDays(targetDate,duration-1),
      updated_at:new Date().toISOString(),
    }).eq("id",event.id);
    if(error) setMessage(`이동 실패: ${error.message}`); else{setMessage(`${event.title} 일정을 이동했습니다.`);await onChanged();}
  }
  return (
    <section className="card schedule-board-card">
      <div className="schedule-board-toolbar">
        <div>
          <h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-calendar-week" aria-hidden="true"></i>직원 근무 일정</h2>
          <p className="subtle" style={{margin:0}}>월요일부터 금요일까지 실제 시간대로 확인합니다. 일정 막대를 다른 날짜로 드래그하면 기간을 유지한 채 이동합니다.</p>
        </div>
        <button className="button" onClick={()=>setEditing(emptyEvent(selectedEmployee?.id,dates[0]))}><i className="ti ti-plus" aria-hidden="true"></i>일정 추가</button>
      </div>
      {message&&<div className={`alert ${message.includes("실패")?"error":"success"}`} style={{marginTop:14}}>{message}</div>}
      <div className="schedule-employee-tabs">
        <span>직원 선택</span>
        <button className={isAll?"active":""} onClick={()=>setSelectedEmpId("all")}><i className="ti ti-users" aria-hidden="true"></i>전체</button>
        {activeEmployees.map(emp=><button key={emp.id} className={selectedEmployee?.id===emp.id?"active":""} onClick={()=>setSelectedEmpId(emp.id)}><i style={{background:employeeColorFromList(activeEmployees,emp.id)}}></i>{emp.name}</button>)}
      </div>
      <div className="schedule-month-nav">
        <button className="icon-button" title="이전 주" onClick={()=>changeWeek(-1)}><i className="ti ti-chevron-left" aria-hidden="true"></i></button>
        <button className="month-title" onClick={()=>setWeekAnchor(todayIso())}>{weekOfMonthLabel(weekStart)}</button>
        <button className="icon-button" title="다음 주" onClick={()=>changeWeek(1)}><i className="ti ti-chevron-right" aria-hidden="true"></i></button>
      </div>
      <div className="week-calendar-scroll">
        <div className={`week-calendar ${isAll?"team-view":""}`}>
          <div className="week-calendar-header">
            <div className="week-time-head">시간</div>
            {dates.map(date=>{const d=dateFromIso(date);return <div key={date} className={date===todayIso()?"today":""}><b>{["일","월","화","수","목","금","토"][d.getDay()]}</b><span>{d.getMonth()+1}/{d.getDate()}{isAll?` · ${activeEmployees.length}명`:""}</span></div>;})}
          </div>
          <div className="week-all-day">
            <div className="week-all-day-label">종일</div>
            <div className={`week-all-day-track ${isAll?"team-all-day-track":""}`} style={isAll?{"--employee-count":Math.max(1,activeEmployees.length)} as React.CSSProperties:undefined}>
              {dates.map(date=><div key={date} className="week-drop-column" onDragOver={e=>e.preventDefault()} onDrop={()=>moveEvent(selectedEmployee?.id??"",date)} onDoubleClick={()=>setEditing(emptyEvent(selectedEmployee?.id??activeEmployees[0]?.id,date))} />)}
              {allDayEvents.map(event=>{
                const visible=dates.map((date,index)=>({date,index})).filter(x=>x.date>=event.start_date&&x.date<=event.end_date);
                if(!visible.length) return null;
                const owner=activeEmployees.find(emp=>emp.id===event.employee_id);
                const ownerIndex=Math.max(0,activeEmployees.findIndex(emp=>emp.id===event.employee_id));
                const color=owner?employeeColorFromList(activeEmployees,owner.id):selectedColor;
                return <button key={event.id} draggable className={`week-all-day-event ${isAll?"team-all-day-event":""}`} style={{gridColumn:`${visible[0].index+1} / span ${visible.length}`,gridRow:isAll?ownerIndex+1:1,"--employee-color":color} as React.CSSProperties} onDragStart={e=>{setDraggingId(event.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>setDraggingId(null)} onClick={()=>setEditing({...event,start_time:event.start_time?.slice(0,5)??"",end_time:event.end_time?.slice(0,5)??""})}><b>{isAll&&owner?`${owner.name} · `:""}{event.title}</b><span>{event.note??`${event.start_date}~${event.end_date}`}</span></button>;
              })}
            </div>
          </div>
          <div className="week-time-grid">
            <div className="week-time-axis">{hours.map(hour=><div key={hour}>{String(hour).padStart(2,"0")}:00</div>)}</div>
            <div className="week-event-grid">
              {dates.map((date,index)=><div key={date} className={`week-day-column ${date===todayIso()?"today":""}`} style={{gridColumn:index+1}} onDragOver={e=>e.preventDefault()} onDrop={()=>moveEvent(selectedEmployee?.id??"",date)} onDoubleClick={()=>setEditing(emptyEvent(selectedEmployee?.id??activeEmployees[0]?.id,date))} />)}
              {dates.flatMap((date,index)=>{
                const shownEmployees=isAll?activeEmployees:(selectedEmployee?[selectedEmployee]:[]);
                return shownEmployees.flatMap((employee:any,employeeIndex:number)=>{
                  const dayEvents=timedEvents.filter(event=>event.employee_id===employee.id&&date>=event.start_date&&date<=event.end_date);
                  const unavailable=dayEvents.filter(event=>event.event_type==="unavailable");
                  const shown=unavailable.length?unavailable:dayEvents;
                  const schedule=getScheduleForDate(employee,date,overrides);
                  const isBaseWorkday=(schedule.work_days??[]).includes(dayKeyFromDate(dateFromIso(date)));
                  const baseWork=shown.length===0&&isBaseWorkday?{id:`base-${employee.id}-${date}`,employee_id:employee.id,title:"기본 근무",event_type:"work",start_time:schedule.work_start,end_time:schedule.work_end,note:"직원 기본 스케줄",base:true}:null;
                  const color=employeeColorFromList(activeEmployees,employee.id);
                  return [...shown,...(baseWork?[baseWork]:[])].map((event:any)=>{
                    const pos=timeGridPosition(event,employee);
                    const meta=SCHEDULE_EVENT_META[event.event_type]??SCHEDULE_EVENT_META.info;
                    const laneWidth=100/Math.max(1,activeEmployees.length);
                    const laneStyle=isAll?{width:`calc(${laneWidth}% - 4px)`,marginLeft:`calc(${laneWidth*employeeIndex}% + 2px)`} as React.CSSProperties:{};
                    return <button key={`${event.id}-${date}`} title={`${employee.name} · ${event.title} · ${pos.label}`} draggable={!event.base} className={`week-time-event event-${event.event_type} ${isAll?"team-lane-event":""}`} style={{gridColumn:index+1,gridRow:`${pos.row} / span ${pos.span}`,"--employee-color":color,...laneStyle} as React.CSSProperties} onDragStart={e=>{if(event.base)return;setDraggingId(event.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>setDraggingId(null)} onClick={()=>!event.base&&setEditing({...event,start_time:event.start_time?.slice(0,5)??"",end_time:event.end_time?.slice(0,5)??""})}><b>{!isAll&&<i className={`ti ${meta.icon}`} aria-hidden="true"></i>}{isAll?employee.name:event.title}</b><span>{pos.label}</span>{isAll?<small>{event.title}</small>:event.note&&<small>{event.note}</small>}</button>;
                  });
                });
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="team-color-legend">{isAll&&activeEmployees.map(emp=><span key={emp.id}><i style={{background:employeeColorFromList(activeEmployees,emp.id)}}></i>{emp.name}</span>)}</div>
      <p className="schedule-help"><i className="ti ti-info-circle" aria-hidden="true"></i>{isAll?"각 날짜 안에서 직원별 세로 레인으로 실제 근무시간을 표시합니다. 직원 이름을 누르면 개인 일정을 넓게 볼 수 있습니다.":"빈 시간대를 두 번 누르면 일정을 추가할 수 있습니다."} 토요일과 일요일은 표시하지 않습니다.</p>
      {!selectedEmployee&&<p className="subtle">표시할 재직 직원이 없습니다.</p>}
      {editing&&<div className="modal-backdrop" onClick={()=>setEditing(null)}>
        <div className="modal-box schedule-event-modal" onClick={e=>e.stopPropagation()}>
          <div className="modal-header"><h2 className="card-title" style={{margin:0}}><i className="ti ti-calendar-event" aria-hidden="true"></i>{editing.id?"일정 수정":"일정 추가"}</h2><button className="modal-close" title="닫기" onClick={()=>setEditing(null)}><i className="ti ti-x" aria-hidden="true"></i></button></div>
          <div className="grid two">
            <div className="form-row"><label className="label">직원</label><select className="select" value={editing.employee_id} onChange={e=>setEditing({...editing,employee_id:e.target.value})}>{activeEmployees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
            <div className="form-row"><label className="label">일정 종류</label><select className="select" value={editing.event_type} onChange={e=>setEditing({...editing,event_type:e.target.value})}>{Object.entries(SCHEDULE_EVENT_META).map(([key,value])=><option key={key} value={key}>{value.label}</option>)}</select></div>
          </div>
          <div className="form-row"><label className="label">일정 이름</label><input className="input" value={editing.title??""} onChange={e=>setEditing({...editing,title:e.target.value})} placeholder="예: 네이버교육, 계절학기 시험" /></div>
          <div className="grid two">
            <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={editing.start_date} onChange={e=>setEditing({...editing,start_date:e.target.value,end_date:editing.end_date<e.target.value?e.target.value:editing.end_date})} /></div>
            <div className="form-row"><label className="label">종료일</label><input className="input" type="date" value={editing.end_date} onChange={e=>setEditing({...editing,end_date:e.target.value})} /></div>
          </div>
          <div className="grid two">
            <div className="form-row"><label className="label">가능 시작 시간</label><input className="input" type="time" value={editing.start_time??""} onChange={e=>setEditing({...editing,start_time:e.target.value})} /></div>
            <div className="form-row"><label className="label">가능 종료 시간</label><input className="input" type="time" value={editing.end_time??""} onChange={e=>setEditing({...editing,end_time:e.target.value})} /></div>
          </div>
          <div className="form-row"><label className="label">메모</label><textarea className="textarea" value={editing.note??""} onChange={e=>setEditing({...editing,note:e.target.value})} placeholder="예: 교육 기간에는 오후 근무 불가능" /></div>
          <div className="schedule-modal-actions"><div>{editing.id&&<button className="button danger" onClick={deleteEvent}><i className="ti ti-trash" aria-hidden="true"></i>삭제</button>}</div><div className="actions"><button className="button ghost" onClick={()=>setEditing(null)}>취소</button><button className="button" onClick={saveEvent}><i className="ti ti-check" aria-hidden="true"></i>저장</button></div></div>
        </div>
      </div>}
    </section>
  );
}

function WeekendCompCard({ employees, empMap, allLogs, compRequests, currentEmployee, onChanged }:
  { employees:any[]; empMap:Record<string,any>; allLogs:any[]; compRequests:any[]; currentEmployee:any; onChanged:()=>void }) {
  const [sel,setSel]=useState<Record<string,boolean>>({});
  const [msg,setMsg]=useState("");
  // 주말 + 퇴근 있는 로그 중, 아직 대체휴가 신청 안 된 것
  const grantedDates=new Set(compRequests.map(c=>`${c.employee_id}|${c.work_date}`));
  const weekendLogs=allLogs.filter(l=>{
    if(!l.check_in_time||!l.check_out_time) return false;
    if(!isWeekendDate(l.check_in_time)) return false;
    const wd=localDateStr(new Date(l.check_in_time));
    return !grantedDates.has(`${l.employee_id}|${wd}`);
  });
  async function grantAll() {
    setMsg(""); const picked=weekendLogs.filter(l=>sel[l.id]);
    if(picked.length===0) return setMsg("부여할 항목을 선택해주세요.");
    for(const l of picked){
      const mins=workedMinutes(l.check_in_time,l.check_out_time);
      const hours=mins?Math.round(mins/6)/10:0;
      const wd=localDateStr(new Date(l.check_in_time));
      const {data:ins,error}=await supabase.from("comp_time_requests").insert({employee_id:l.employee_id,work_date:wd,hours,converted_days:Number((hours/8).toFixed(2)),reason:"주말 근무 대체휴가(관리자 일괄)",status:"pending"}).select().single();
      if(!error&&ins) await supabase.rpc("review_comp_time_request",{p_request_id:ins.id,p_status:"approved",p_review_note:"관리자 일괄 부여"});
    }
    setMsg(`${picked.length}건 대체휴가를 부여했습니다.`); setSel({}); onChanged();
  }
  if(weekendLogs.length===0) return null;
  return (
    <section className="card">
      <h2 className="card-title"><i className="ti ti-calendar-plus" aria-hidden="true"></i>주말 근무 대체휴가 일괄 부여</h2>
      <p className="subtle" style={{marginBottom:12}}>아직 대체휴가가 적립되지 않은 주말 근무 기록입니다. 선택 후 일괄 부여하면 즉시 적립됩니다.</p>
      {msg&&<div className={`alert ${msg.includes("부여")?"success":""}`}>{msg}</div>}
      {weekendLogs.map(l=>{
        const mins=workedMinutes(l.check_in_time,l.check_out_time); const hours=mins?Math.round(mins/6)/10:0;
        return (
          <label className="list-row" key={l.id} style={{cursor:"pointer"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="checkbox" checked={!!sel[l.id]} onChange={e=>setSel({...sel,[l.id]:e.target.checked})} style={{width:18,height:18,accentColor:"#3a6df0"}} />
              <div><b>{empMap[l.employee_id]?.name??"-"}</b><div className="subtle">{localDateStr(l.check_in_time)} · {hours}시간</div></div>
            </div>
            <span className="badge">{hours}시간 → {(hours/8).toFixed(1)}일</span>
          </label>
        );
      })}
      <button className="button" style={{marginTop:10}} onClick={grantAll}><i className="ti ti-check" aria-hidden="true"></i>선택 항목 일괄 부여</button>
    </section>
  );
}

function PayrollCard({ employees, absences, overrides }: { employees:any[]; absences:any[]; overrides:any[] }) {
  const [empId,setEmpId]=useState("");
  const [pay,setPay]=useState({monthly:"",hourly:"",annual:"",weeklyDays:"",dailyHours:"",monthlyHours:""});
  const [payMsg,setPayMsg]=useState("");
  const emp=empId?employees.find(e=>e.id===empId):null;
  function recalc(next:any, source:string) {
    const weeklyDays=numberValue(next.weeklyDays);
    const dailyHours=numberValue(next.dailyHours);
    const calculatedMonthlyHours=weeklyDays>0&&dailyHours>0?Math.round(weeklyDays*dailyHours*4.345*10)/10:0;
    const monthlyHours=source==="monthlyHours"?numberValue(next.monthlyHours):(calculatedMonthlyHours||numberValue(next.monthlyHours));
    let monthly=numberValue(next.monthly);
    let hourly=numberValue(next.hourly);
    let annual=numberValue(next.annual);
    if(["hourly","weeklyDays","dailyHours","monthlyHours"].includes(source)&&hourly>0&&monthlyHours>0){
      monthly=Math.round(hourly*monthlyHours);
      annual=monthly*12;
    } else if(source==="annual"&&annual>0){
      monthly=Math.round(annual/12);
      hourly=monthlyHours>0?Math.round(monthly/monthlyHours):hourly;
    } else if(monthly>0){
      annual=monthly*12;
      hourly=monthlyHours>0?Math.round(monthly/monthlyHours):hourly;
    }
    return {
      monthly: monthly?monthly.toLocaleString("ko-KR"):"",
      hourly: hourly?hourly.toLocaleString("ko-KR"):"",
      annual: annual?annual.toLocaleString("ko-KR"):"",
      weeklyDays: next.weeklyDays,
      dailyHours: next.dailyHours,
      monthlyHours: monthlyHours?String(monthlyHours):"",
    };
  }
  function setPayField(field:string, raw:string) {
    const value=["monthly","hourly","annual"].includes(field)?moneyInput(raw):raw.replace(/[^0-9.]/g,"");
    setPay(p=>recalc({...p,[field]:value},field));
  }
  useEffect(()=>{
    if(emp){
      const weeklyDays=Number(emp.weekly_work_days||emp.work_days?.length||5);
      const dailyHours=Number(emp.daily_work_hours||scheduleHours(emp.work_start,emp.work_end)||8);
      const monthlyHours=Number(emp.monthly_standard_hours||Math.round(weeklyDays*dailyHours*4.345*10)/10);
      const monthly=Number(emp.monthly_salary||0);
      const hourly=Number(emp.hourly_wage||(monthly&&monthlyHours?Math.round(monthly/monthlyHours):0));
      const annual=Number(emp.annual_salary||(monthly?monthly*12:0));
      setPay(recalc({
        monthly:monthly?monthly.toLocaleString("ko-KR"):"",
        hourly:hourly?hourly.toLocaleString("ko-KR"):"",
        annual:annual?annual.toLocaleString("ko-KR"):"",
        weeklyDays:String(weeklyDays),
        dailyHours:String(dailyHours),
        monthlyHours:String(monthlyHours),
      },"monthly"));
      setPayMsg("");
    }
  },[empId]);
  async function saveSalary() {
    setPayMsg("");
    if(!empId) return setPayMsg("직원을 선택해주세요.");
    const monthly=numberValue(pay.monthly);
    const hourly=numberValue(pay.hourly);
    const annual=numberValue(pay.annual)||monthly*12;
    const weeklyDays=numberValue(pay.weeklyDays);
    const dailyHours=numberValue(pay.dailyHours);
    const monthlyHours=numberValue(pay.monthlyHours);
    const {error}=await supabase.from("employees").update({
      monthly_salary:monthly,
      hourly_wage:hourly,
      annual_salary:annual,
      weekly_work_days:weeklyDays,
      daily_work_hours:dailyHours,
      monthly_standard_hours:monthlyHours,
    }).eq("id",empId);
    if(error) setPayMsg(`급여 설정 저장 실패: ${error.message}`); else setPayMsg("급여 설정이 저장되었습니다.");
  }
  const monthly=numberValue(pay.monthly);
  const hourly=numberValue(pay.hourly);
  const annual=numberValue(pay.annual)||monthly*12;
  const monthlyHours=numberValue(pay.monthlyHours);
  const empAbs=absences.filter(a=>a.employee_id===empId&&a.unpaid);
  const month=currentMonthRange();
  const scheduledDays=emp?countScheduledWorkdays(emp, month.start, month.end, overrides):0;
  const absentDays=emp?countUnpaidAbsenceWorkdays(emp, absences, month.start, month.end, overrides):0;
  const dayRate=scheduledDays>0?monthly/scheduledDays:0;
  const deduction=Math.round(dayRate*absentDays);
  const baseAfterDeduction=Math.max(0,monthly-deduction);
  const ins=calcInsurance(baseAfterDeduction);
  const netPay=baseAfterDeduction-ins.employee;
  return (
    <section className="card">
      <h2 className="card-title"><i className="ti ti-coin" aria-hidden="true"></i>급여 계산</h2>
      <p className="subtle" style={{marginBottom:12}}>시급, 월급, 연봉, 주 근무일, 일 근무시간, 월 소정근로시간 중 값을 바꾸면 나머지 기준값이 자동 계산됩니다. 4대보험은 정기분 추정치입니다.</p>
      <div className="grid two">
        <div className="form-row"><label className="label">직원</label>
          <select className="select" value={empId} onChange={e=>setEmpId(e.target.value)}>
            <option value="">직원 선택</option>
            {employees.filter(e=>e.employment_status==="active").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="form-row"><label className="label">월급 (원)</label><input className="input" value={pay.monthly} onChange={e=>setPayField("monthly",e.target.value)} placeholder="예: 2,500,000" /></div>
      </div>
      <div className="grid three">
        <div className="form-row"><label className="label">시급 (원)</label><input className="input" value={pay.hourly} onChange={e=>setPayField("hourly",e.target.value)} placeholder="예: 11,000" /></div>
        <div className="form-row"><label className="label">연봉 (원)</label><input className="input" value={pay.annual} onChange={e=>setPayField("annual",e.target.value)} placeholder="예: 30,000,000" /></div>
        <div className="form-row"><label className="label">월 소정근로시간</label><input className="input" value={pay.monthlyHours} onChange={e=>setPayField("monthlyHours",e.target.value)} placeholder="예: 209" /></div>
      </div>
      <div className="grid two">
        <div className="form-row"><label className="label">주 근무일</label><input className="input" value={pay.weeklyDays} onChange={e=>setPayField("weeklyDays",e.target.value)} placeholder="예: 5" /></div>
        <div className="form-row"><label className="label">일 근무시간</label><input className="input" value={pay.dailyHours} onChange={e=>setPayField("dailyHours",e.target.value)} placeholder="예: 8" /></div>
      </div>
      <div className="actions" style={{marginBottom:10}}><button className="button secondary" onClick={saveSalary}>급여 설정 저장</button>{payMsg&&<span className={`subtle ${payMsg.includes("실패")?"":""}`} style={{color:payMsg.includes("실패")?"var(--red)":"var(--green)"}}>{payMsg}</span>}</div>
      {empId&&monthly>0&&<div className="alert" style={{marginBottom:10}}>계산 기준: 시급 {won(hourly)} · 월 소정근로시간 {monthlyHours||0}시간 · 월급 {won(monthly)} · 연봉 {won(annual)}</div>}
      {empId&&monthly>0&&(
        <div className="table-wrap" style={{marginTop:8}}>
          <table>
            <thead><tr><th>항목</th><th>근로자 부담</th><th>회사 부담</th></tr></thead>
            <tbody>
              <tr><td>기본 월급</td><td colSpan={2}>{won(monthly)}</td></tr>
              {absentDays>0&&<tr><td>미출근 공제 ({absentDays}일 × 월 근무예정일 {scheduledDays}일 기준)</td><td colSpan={2} style={{color:"var(--red)"}}>− {won(deduction)}</td></tr>}
              <tr><td><b>공제 후 급여</b></td><td colSpan={2}><b>{won(baseAfterDeduction)}</b></td></tr>
              {ins.breakdown.map(b=>(<tr key={b.name}><td>{b.name}</td><td>{won(b.e)}</td><td>{won(b.c)}</td></tr>))}
              <tr style={{background:"#f7f9fc"}}><td><b>4대보험 합계</b></td><td><b>{won(ins.employee)}</b></td><td><b>{won(ins.company)}</b></td></tr>
              <tr style={{background:"#eef3fe"}}><td><b>예상 실수령액</b><br/><span style={{fontSize:11,color:"var(--muted)"}}>세전·소득세 미포함</span></td><td colSpan={2}><b style={{color:"var(--blue)",fontSize:17}}>{won(netPay)}</b></td></tr>
            </tbody>
          </table>
        </div>
      )}
      {empId&&<p className="subtle" style={{marginTop:8}}>이번 달 근무 예정일 {scheduledDays}일 · 무급 미출근 반영 {absentDays}일 · 주간 스케줄 변경 포함</p>}
    </section>
  );
}

function ScheduleCard({ employees, empMap, overrides, absences, currentEmployee, empName, onChanged, setMsg, msg }:
  { employees:any[]; empMap:Record<string,any>; overrides:any[]; absences:any[]; currentEmployee:any; empName:(id?:string|null)=>string; onChanged:()=>void; setMsg:(s:string)=>void; msg:string }) {
  const [scheduleEmpId,setScheduleEmpId]=useState("");
  const [editDays,setEditDays]=useState<string[]>(["mon","tue","wed","thu","fri"]);
  const [editStart,setEditStart]=useState("09:00"); const [editEnd,setEditEnd]=useState("18:00");
  const [contractType,setContractType]=useState("daily");
  const [contractStart,setContractStart]=useState(todayIso());
  const [contractEnd,setContractEnd]=useState(todayIso());
  const scheduleEmp=scheduleEmpId?empMap[scheduleEmpId]:null;
  useEffect(()=>{
    if(!scheduleEmp) return;
    setEditDays(scheduleEmp.work_days??["mon","tue","wed","thu","fri"]);
    setEditStart(scheduleEmp.work_start??"09:00"); setEditEnd(scheduleEmp.work_end??"18:00");
    setContractType(scheduleEmp.contract_type??"daily");
    setContractStart(scheduleEmp.contract_start??todayIso());
    setContractEnd(scheduleEmp.contract_end??todayIso());
  },[scheduleEmpId]);
  function toggleDay(arr:string[],day:string){return arr.includes(day)?arr.filter(d=>d!==day):[...arr,day];}
  async function saveSchedule() {
    setMsg("");
    if(!scheduleEmpId) return setMsg("직원을 선택해주세요.");
    if(contractType==="fixed_term" && (!contractStart || !contractEnd)) return setMsg("기간제는 계약 시작일과 종료일을 입력해주세요.");
    if(contractType==="fixed_term" && contractEnd < contractStart) return setMsg("계약 종료일은 시작일보다 뒤여야 합니다.");
    const {error}=await supabase.from("employees").update({
      work_days:editDays,
      work_start:editStart,
      work_end:editEnd,
      contract_type:contractType,
      contract_start:contractType==="fixed_term"?contractStart:null,
      contract_end:contractType==="fixed_term"?contractEnd:null,
    }).eq("id",scheduleEmpId);
    if(error) setMsg(`저장 실패: ${error.message}`); else { setMsg("스케줄이 저장되었습니다."); await onChanged(); }
  }

  // 주간 오버라이드
  const [ovEmpId,setOvEmpId]=useState(""); const [ovWeek,setOvWeek]=useState(todayIso());
  const [ovDays,setOvDays]=useState<string[]>(["mon","tue","wed","thu","fri"]);
  const [ovStart,setOvStart]=useState("09:00"); const [ovEnd,setOvEnd]=useState("18:00"); const [ovNote,setOvNote]=useState("");
  async function saveOverride() {
    setMsg(""); if(!ovEmpId) return setMsg("직원을 선택해주세요.");
    const monday=new Date(ovWeek); monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
    const weekStart=monday.toISOString().slice(0,10);
    const {error}=await supabase.from("weekly_schedule_overrides").upsert({employee_id:ovEmpId,week_start:weekStart,work_days:ovDays,work_start:ovStart,work_end:ovEnd,note:ovNote,created_by:currentEmployee.id},{onConflict:"employee_id,week_start"});
    if(error) setMsg(`저장 실패: ${error.message}`); else { setMsg(`${empName(ovEmpId)} ${weekStart} 주 스케줄이 저장되었습니다.`); await onChanged(); }
  }

  // 미출근 기간
  const [absEmpId,setAbsEmpId]=useState(""); const [absStart,setAbsStart]=useState(todayIso()); const [absEnd,setAbsEnd]=useState(todayIso());
  const [absReason,setAbsReason]=useState(""); const [absUnpaid,setAbsUnpaid]=useState(true);
  async function saveAbsence() {
    setMsg(""); if(!absEmpId) return setMsg("직원을 선택해주세요.");
    const {error}=await supabase.from("employee_absences").insert({employee_id:absEmpId,start_date:absStart,end_date:absEnd,reason:absReason,unpaid:absUnpaid,created_by:currentEmployee.id});
    if(error) setMsg(`저장 실패: ${error.message}`); else { setMsg("미출근 기간이 등록되었습니다."); await onChanged(); }
  }
  async function deleteAbsence(id:string){
    setMsg("");
    const {error}=await supabase.from("employee_absences").delete().eq("id",id);
    if(error) setMsg(`삭제 실패: ${error.message}`); else { setMsg("미출근 기간이 삭제되었습니다."); await onChanged(); }
  }

  return (
    <section className="card">
      <h2 className="card-title"><i className="ti ti-calendar-week" aria-hidden="true"></i>직원 출근 스케줄 설정</h2>
      <p className="subtle" style={{marginBottom:14}}>기본 출근 요일·시간·계약유형을 설정합니다. 이 기준으로 지각·결근이 판단됩니다.</p>
      {msg&&<div className={`alert ${msg.includes("저장")||msg.includes("등록")?"success":""}`}>{msg}</div>}

      <div className="form-row"><label className="label">직원 선택</label>
        <select className="select" value={scheduleEmpId} onChange={e=>setScheduleEmpId(e.target.value)}>
          <option value="">직원 선택</option>
          {employees.filter(e=>e.employment_status==="active").map(e=><option key={e.id} value={e.id}>{e.name} · {CONTRACT_LABELS[e.contract_type??"daily"]} · {(e.work_days??["mon","tue","wed","thu","fri"]).map((d:string)=>DAY_LABELS[d]).join("")}</option>)}
        </select>
      </div>
      {scheduleEmpId&&(<>
        <div className="form-row"><label className="label">계약 유형</label>
          <select className="select" value={contractType} onChange={e=>setContractType(e.target.value)}>
            {Object.entries(CONTRACT_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {contractType==="fixed_term"&&(
          <div className="grid two">
            <div className="form-row"><label className="label">계약 시작일</label><input className="input" type="date" value={contractStart} onChange={e=>setContractStart(e.target.value)} /></div>
            <div className="form-row"><label className="label">계약 종료일</label><input className="input" type="date" value={contractEnd} onChange={e=>setContractEnd(e.target.value)} /></div>
          </div>
        )}
        <div className="form-row"><label className="label">출근 요일</label>
          <div className="days-grid">{ALL_DAYS.map(d=><button key={d} className={`day-btn ${editDays.includes(d)?"active":""}`} onClick={()=>setEditDays(toggleDay(editDays,d))}>{DAY_LABELS[d]}</button>)}</div>
        </div>
        <div className="grid two">
          <div className="form-row"><label className="label">출근 시간</label><input className="input" type="time" value={editStart} onChange={e=>setEditStart(e.target.value)} /></div>
          <div className="form-row"><label className="label">퇴근 시간</label><input className="input" type="time" value={editEnd} onChange={e=>setEditEnd(e.target.value)} /></div>
        </div>
        <button className="button" onClick={saveSchedule}><i className="ti ti-device-floppy" aria-hidden="true"></i>저장</button>
      </>)}

      <CollapsibleSection title="특정 기간 미출근 설정" icon="ti-calendar-off">
      <p className="subtle" style={{marginBottom:10}}>특정 월·일부터 며칠간 출근하지 않는 경우 등록합니다. 결근 판단에서 제외되고, 무급이면 급여 계산에 반영됩니다.</p>
      <div className="grid four">
        <div className="form-row"><label className="label">직원</label><select className="select" value={absEmpId} onChange={e=>setAbsEmpId(e.target.value)}><option value="">선택</option>{employees.filter(e=>e.employment_status==="active").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={absStart} onChange={e=>setAbsStart(e.target.value)} /></div>
        <div className="form-row"><label className="label">종료일</label><input className="input" type="date" value={absEnd} onChange={e=>setAbsEnd(e.target.value)} /></div>
        <div className="form-row"><label className="label">급여</label><select className="select" value={absUnpaid?"unpaid":"paid"} onChange={e=>setAbsUnpaid(e.target.value==="unpaid")}><option value="unpaid">무급</option><option value="paid">유급</option></select></div>
      </div>
      <div className="form-row"><label className="label">사유</label><input className="input" value={absReason} onChange={e=>setAbsReason(e.target.value)} placeholder="예: 개인 사정 장기 미출근" /></div>
      <button className="button secondary" onClick={saveAbsence}><i className="ti ti-plus" aria-hidden="true"></i>미출근 기간 등록</button>
      {absences.length>0&&(<div style={{marginTop:12}}>
        {absences.map(a=>(<div className="list-row" key={a.id}><div><b>{empName(a.employee_id)}</b><div className="subtle">{a.start_date}~{a.end_date} · {a.unpaid?"무급":"유급"} · {a.reason??"-"}</div></div><button className="button danger" onClick={()=>deleteAbsence(a.id)}>삭제</button></div>))}
      </div>)}
      </CollapsibleSection>

      <CollapsibleSection title="주간 스케줄 변경" icon="ti-refresh">
      <p className="subtle" style={{marginBottom:10}}>특정 주에만 출근 요일·시간이 다를 때 사용합니다. 해당 주에만 기본 스케줄을 덮어씁니다.</p>
      <div className="grid two">
        <div className="form-row"><label className="label">직원</label><select className="select" value={ovEmpId} onChange={e=>{setOvEmpId(e.target.value);const emp=empMap[e.target.value];if(emp){setOvDays(emp.work_days??["mon","tue","wed","thu","fri"]);setOvStart(emp.work_start??"09:00");setOvEnd(emp.work_end??"18:00");}}}><option value="">직원 선택</option>{employees.filter(e=>e.employment_status==="active").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div className="form-row"><label className="label">해당 주 날짜 (아무 날)</label><input className="input" type="date" value={ovWeek} onChange={e=>setOvWeek(e.target.value)} /><p className="subtle" style={{marginTop:6}}>{weekOfMonthLabel(ovWeek)} · 주 시작일 {weekStartIso(ovWeek)}</p></div>
      </div>
      <div className="form-row"><label className="label">이 주 출근 요일</label><div className="days-grid">{ALL_DAYS.map(d=><button key={d} className={`day-btn ${ovDays.includes(d)?"active":""}`} onClick={()=>setOvDays(toggleDay(ovDays,d))}>{DAY_LABELS[d]}</button>)}</div></div>
      <div className="grid two" style={{marginBottom:14}}>
        <div className="form-row"><label className="label">출근 시간</label><input className="input" type="time" value={ovStart} onChange={e=>setOvStart(e.target.value)} /></div>
        <div className="form-row"><label className="label">퇴근 시간</label><input className="input" type="time" value={ovEnd} onChange={e=>setOvEnd(e.target.value)} /></div>
      </div>
      <div className="form-row"><label className="label">메모 (선택)</label><input className="input" value={ovNote} onChange={e=>setOvNote(e.target.value)} placeholder="예: 이번 주 목요일 행사로 변경" /></div>
      <button className="button" onClick={saveOverride}><i className="ti ti-device-floppy" aria-hidden="true"></i>저장</button>
      {overrides.length>0&&(<>
        <h3>최근 변경 내역</h3>
        <DataTable rows={overrides.slice(0,10).map(o=>({직원:empName(o.employee_id),주:o.week_start,요일:(o.work_days??[]).map((d:string)=>DAY_LABELS[d]).join(""),시간:`${o.work_start}~${o.work_end}`,메모:o.note??"-"}))} />
      </>)}
      </CollapsibleSection>
    </section>
  );
}

const CONSENT_TERMS = [
  "개인정보 및 위치정보 수집·이용에 동의합니다.",
  "위치·기기 정보는 근태 확인 목적 외로 사용하지 않는다는 설명을 확인했습니다.",
  "추가근무는 별도 수당이 아니라 대체휴가로 적립되며, 관리자 승인 후 사용 가능하다는 점에 동의합니다.",
];

function ConsentReportPage() {
  const [employees,setEmployees]=useState<any[]>([]);
  const [consents,setConsents]=useState<any[]>([]);
  const [selected,setSelected]=useState<{employee:any;consent:any}|null>(null);
  const [message,setMessage]=useState("");

  async function load(){
    const [employeeResult,consentResult]=await Promise.all([
      supabase.from("employees").select("id,name,employee_no,employment_status,is_active").order("employee_no",{ascending:true}),
      supabase.from("privacy_consents").select("*").order("created_at",{ascending:false}),
    ]);
    if(employeeResult.error||consentResult.error) setMessage(employeeResult.error?.message??consentResult.error?.message??"동의서를 불러오지 못했습니다.");
    setEmployees(employeeResult.data??[]);
    setConsents(consentResult.data??[]);
  }
  useEffect(()=>{load();},[]);

  const latestByEmployee:Record<string,any>={};
  consents.forEach(consent=>{if(!latestByEmployee[consent.employee_id]) latestByEmployee[consent.employee_id]=consent;});

  function printConsent(employee:any,consent:any){
    const popup=window.open("","_blank","width=860,height=1000");
    if(!popup) return setMessage("인쇄 창이 차단되었습니다. 브라우저의 팝업 차단을 해제해주세요.");
    popup.opener=null;
    const signature=String(consent.signature_data??"").startsWith("data:image/")?consent.signature_data:"";
    popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(employee.name)} 동의서</title><style>
      @page{size:A4;margin:18mm}body{font-family:Arial,"Malgun Gothic",sans-serif;color:#111827;line-height:1.65;margin:0}
      h1{font-size:24px;margin:0 0 8px}h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #d1d5db;padding-bottom:7px}
      .meta{width:100%;border-collapse:collapse;margin-top:24px}.meta th,.meta td{border:1px solid #d1d5db;padding:9px;text-align:left;font-size:13px}.meta th{width:100px;background:#f3f4f6}
      ol{padding-left:22px}.notice{padding:12px 14px;background:#f3f6fb;border:1px solid #dbe3ef;border-radius:6px}
      .signature{height:150px;border:1px solid #d1d5db;display:flex;align-items:center;justify-content:center}.signature img{max-width:95%;max-height:135px}
      .footer{margin-top:28px;text-align:right;font-size:13px}@media print{button{display:none}}
    </style></head><body>
      <h1>개인정보 수집·이용 및 위치정보 동의서</h1>
      <p>주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를 수집·이용합니다.</p>
      <div class="notice">위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다.</div>
      <table class="meta"><tr><th>직원명</th><td>${escapeHtml(employee.name)}</td><th>사번</th><td>${escapeHtml(employee.employee_no)}</td></tr>
      <tr><th>동의 일시</th><td colspan="3">${escapeHtml(formatDateTime(consent.created_at))}</td></tr>
      <tr><th>동의 버전</th><td>${escapeHtml(consent.consent_version)}</td><th>기기</th><td>${escapeHtml(consent.device_info?.platform??"-")}</td></tr></table>
      <h2>동의 내용</h2><ol>${CONSENT_TERMS.map(term=>`<li>${escapeHtml(term)}</li>`).join("")}</ol>
      <h2>전자 서명</h2><div class="signature">${signature?`<img src="${escapeHtml(signature)}" alt="전자 서명">`:"서명 이미지 없음"}</div>
      <p class="footer">${escapeHtml(employee.name)} (전자 동의)</p>
      <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));<\/script>
    </body></html>`);
    popup.document.close();
  }

  return <div className="grid">
    {message&&<div className="alert error">{message}</div>}
    <section className="card">
      <div className="schedule-board-toolbar">
        <div><h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-file-signature" aria-hidden="true"></i>직원 동의서</h2><p className="subtle" style={{margin:0}}>직원별 최신 전자 동의서를 화면에서 확인하고 PDF로 저장할 수 있습니다.</p></div>
        <span className="badge good">동의 {employees.filter(e=>latestByEmployee[e.id]).length}명</span>
      </div>
      <div className="table-wrap" style={{marginTop:18}}>
        <table>
          <thead><tr><th>직원</th><th>상태</th><th>동의 일시</th><th>버전</th><th>관리</th></tr></thead>
          <tbody>{employees.map(employee=>{
            const consent=latestByEmployee[employee.id];
            return <tr key={employee.id}>
              <td><b>{employee.name}</b><br/><span className="subtle">{employee.employee_no}</span></td>
              <td><span className={`badge ${consent?"good":"warn"}`}>{consent?"동의 완료":"미동의"}</span></td>
              <td>{consent?formatDateTime(consent.created_at):"-"}</td>
              <td>{consent?.consent_version??"-"}</td>
              <td><div className="actions"><button className="button secondary compact" disabled={!consent} onClick={()=>consent&&setSelected({employee,consent})}><i className="ti ti-eye" aria-hidden="true"></i>보기</button><button className="button ghost compact" disabled={!consent} onClick={()=>consent&&printConsent(employee,consent)}><i className="ti ti-file-type-pdf" aria-hidden="true"></i>PDF</button></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
    {selected&&<div className="modal-backdrop" onClick={()=>setSelected(null)}>
      <div className="modal-box consent-modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><h2 className="card-title" style={{margin:0}}><i className="ti ti-file-signature" aria-hidden="true"></i>{selected.employee.name} 동의서</h2><button className="modal-close" title="닫기" onClick={()=>setSelected(null)}><i className="ti ti-x" aria-hidden="true"></i></button></div>
        <div className="consent-preview">
          <p>주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를 수집·이용합니다.</p>
          <div className="alert">위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다.</div>
          <dl><div><dt>사번</dt><dd>{selected.employee.employee_no}</dd></div><div><dt>동의 일시</dt><dd>{formatDateTime(selected.consent.created_at)}</dd></div><div><dt>버전</dt><dd>{selected.consent.consent_version}</dd></div></dl>
          <ol>{CONSENT_TERMS.map(term=><li key={term}>{term}</li>)}</ol>
          <div className="consent-signature"><span>전자 서명</span>{selected.consent.signature_data?<img src={selected.consent.signature_data} alt={`${selected.employee.name} 전자 서명`} />:<p>서명 이미지가 없습니다.</p>}</div>
        </div>
        <div className="actions" style={{justifyContent:"flex-end",marginTop:16}}><button className="button ghost" onClick={()=>setSelected(null)}>닫기</button><button className="button" onClick={()=>printConsent(selected.employee,selected.consent)}><i className="ti ti-file-type-pdf" aria-hidden="true"></i>PDF 저장·인쇄</button></div>
      </div>
    </div>}
  </div>;
}

function ReportsPage() {
  const [logs,setLogs]=useState<any[]>([]);
  const [employees,setEmployees]=useState<any[]>([]);
  const [compRequests,setCompRequests]=useState<any[]>([]);

  async function load(){
    const [l,e,c]=await Promise.all([
      supabase.from("attendance_logs").select("*, employees(name, employee_no), workplaces(name,type)").order("check_in_time",{ascending:false}).limit(1000),
      supabase.from("employees").select("id, name, employee_no, role, employment_status, is_active, joined_at, created_at").order("created_at",{ascending:false}).limit(1000),
      supabase.from("comp_time_requests").select("*, employees(name, employee_no)").order("created_at",{ascending:false}).limit(1000)
    ]);
    setLogs(l.data??[]);
    setEmployees(e.data??[]);
    setCompRequests(c.data??[]);
  }

  useEffect(()=>{load();},[]);

  const allLogRows = logs.map(l=>({
    직원:l.employees?.name??"-",
    사번:l.employees?.employee_no??"-",
    근무지:l.workplaces?.name??"-",
    유형:workplaceTypeLabels[l.workplaces?.type]??"-",
    출근:formatDateTime(l.check_in_time),
    퇴근:formatDateTime(l.check_out_time),
    실제퇴근원본:formatDateTime(l.original_check_out_time),
    실근무:fmtMin(workedMinutes(l.check_in_time,l.check_out_time)),
    상태:l.status,
    초과근무심사:l.overtime_review_status==="approved"?"승인":l.overtime_review_status==="rejected"?"미인정":"-",
    기기:l.device_status??"-"
  }));

  function downloadAll(){
    exportRowsToExcel("lupl_attendance_report.xlsx","근태",allLogRows);
  }

  const fieldLogs=logs.filter(l=>["special_school","external_education","other_field"].includes(l.workplaces?.type));
  const exceptions=logs.filter(l=>["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음","지각","결근"].includes(l.status)||!l.check_out_time);

  return (
    <div className="grid">
      <section className="grid four">
        <div className="metric"><div className="metric-value">{logs.length}</div><div className="metric-label">전체 근태</div></div>
        <div className="metric"><div className="metric-value">{employees.length}</div><div className="metric-label">전체 직원</div></div>
        <div className="metric"><div className="metric-value">{exceptions.length}</div><div className="metric-label">예외</div></div>
        <div className="metric"><div className="metric-value">{compRequests.filter(r=>r.status==="approved").reduce((s,r)=>s+Number(r.converted_days||0),0).toFixed(1)}</div><div className="metric-label">대체휴가 적립</div></div>
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-download" aria-hidden="true"></i>보고서 다운로드</h2>
        <div className="actions"><button className="button" onClick={downloadAll}><i className="ti ti-file-spreadsheet" aria-hidden="true"></i>전체 근태 Excel</button></div>
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-users" aria-hidden="true"></i>직원 목록</h2>
        <DataTable rows={employees.map(e=>({
          이름:e.name,
          사번:e.employee_no,
          권한:e.role==="admin"?"관리자":"직원",
          상태:e.is_active&&e.employment_status==="active"?"활성":"비활성",
          입사일:e.joined_at??"-",
          등록일:formatDateTime(e.created_at)
        }))} />
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-list-check" aria-hidden="true"></i>전체 근태 기록</h2>
        <DataTable rows={allLogRows} />
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-alert-triangle" aria-hidden="true"></i>예외함</h2>
        <DataTable rows={exceptions.map(l=>({직원:l.employees?.name,근무지:l.workplaces?.name,출근:formatDateTime(l.check_in_time),퇴근:formatDateTime(l.check_out_time),상태:l.status}))} />
      </section>
    </div>
  );
}

function DataTable({ rows }: { rows: Record<string,any>[] }) {
  if(!rows.length) return <p className="subtle">표시할 데이터가 없습니다.</p>;
  const cols=Object.keys(rows[0]);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((row,i)=><tr key={i}>{cols.map(c=><td key={c} data-label={c}>{String(row[c]??"-")}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
