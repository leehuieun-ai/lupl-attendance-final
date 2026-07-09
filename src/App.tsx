import { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getDeviceFingerprint } from "./lib/device";
import { getCurrentPositionFast, getPublicIp, distanceMeters } from "./lib/geo";
import {
  calculateAdjustmentDays, calculateLeaveEntitlement, calculateUsedDays,
  LEAVE_TYPE_META, requestToDays, calcInsurance, calcAbsenceDeduction,
} from "./lib/leave";
import { exportRowsToExcel } from "./lib/exportExcel";

type Tab = "attendance" | "leave" | "overtime" | "worktime" | "admin-dashboard" | "approvals" | "employees" | "rnr" | "workplaces" | "schedule" | "payroll" | "reports" | "consents" | "improvements";

const DAY_LABELS: Record<string, string> = { mon:"월", tue:"화", wed:"수", thu:"목", fri:"금", sat:"토", sun:"일" };
const ALL_DAYS = ["mon","tue","wed","thu","fri","sat","sun"];
const CONTRACT_LABELS: Record<string,string> = { daily:"상시(매일)", weekly_n:"주 N일 고정", fixed_term:"기간제" };
const SCHEDULE_EVENT_META: Record<string,{label:string;icon:string}> = {
  work:{label:"근무 변경",icon:"ti-briefcase"},
  am_only:{label:"오전만 가능",icon:"ti-sun"},
  pm_only:{label:"오후만 가능",icon:"ti-moon"},
  unavailable:{label:"출근 불가",icon:"ti-ban"},
  info:{label:"추가 일정",icon:"ti-book"},
  hidden:{label:"빈 칸",icon:"ti-square-off"},
  leave:{label:"승인 휴가",icon:"ti-calendar-off"},
  overtime:{label:"추가근무",icon:"ti-clock-plus"},
};
const EDITABLE_SCHEDULE_TYPES = ["info","work","am_only","pm_only","unavailable","hidden"];
const EMPLOYEE_COLORS = ["#2563eb","#059669","#ea580c","#dc2626","#7c3aed","#0891b2","#b45309","#4f46e5","#65a30d","#be185d"];
const WORK_TIME_CHANGE_CONSENT_VERSION = "2026-07-work-time-change-process";
const WORK_TIME_LEGAL_NOTICE_VERSION = "2026-07";
const OVERTIME_COMP_CONSENT_CHECK_TEXT = "추가근무는 사전 신청 또는 회사 확인 후 건별 승인된 경우에만 인정되며, 승인된 시간은 앱에서 대체휴가 적립·사용 내역으로 관리될 수 있다는 설명을 확인했습니다.";
const OVERTIME_COMP_DETAIL_MAIN_TEXT = "추가근무는 근무자 신청 또는 회사 확인 후 건별로 승인된 시간만 인정됩니다. 이 항목은 앱의 대체휴가 적립·사용 관리 방식에 대한 안내입니다.";
const OVERTIME_COMP_DETAIL_LEGAL_TEXT = "(관계 법령 근로기준법 제53조, 제56조, 제57조)";
const OVERTIME_COMP_DETAIL_SIGN_TEXT = "이 서명은 향후 모든 연장근로·야간근로·휴일근로에 대한 사전 포괄 동의가 아니며, 실제 추가근무는 건별 신청·승인 기록에 따라 처리됩니다.";
const OVERTIME_COMP_DETAIL_TEXT = `${OVERTIME_COMP_DETAIL_MAIN_TEXT}\n${OVERTIME_COMP_DETAIL_LEGAL_TEXT}\n${OVERTIME_COMP_DETAIL_SIGN_TEXT}`;
const WORK_TIME_CONSENT_TEXT = "앞으로 근무요일, 근무시간, 휴게시간이 변경되는 경우 앱에서 변경 내용을 확인하고 서명해 주세요. 변경 내용은 직원 요청과 회사 승인 후 적용되며, 서명한 기록은 자동으로 저장됩니다.";
const WORK_TIME_DETAIL_MAIN_TEXT = "근무요일, 근무시간, 휴게시간은 근로조건에 해당할 수 있어 변경 내용을 명확히 남겨야 합니다.";
const WORK_TIME_DETAIL_LEGAL_TEXT = "(관계 법령 근로기준법 제17조, 제53조 / 기간제 및 단시간근로자 보호 등에 관한 법률 제17조)";
const WORK_TIME_DETAIL_SIGN_TEXT = "이 서명은 위 변경 내용에만 적용되며, 연장근로·야간근로·휴일근로에 대한 포괄 동의가 아닙니다.";
const WORK_TIME_DETAIL_TEXT = `${WORK_TIME_DETAIL_MAIN_TEXT}\n${WORK_TIME_DETAIL_LEGAL_TEXT}\n${WORK_TIME_DETAIL_SIGN_TEXT}`;
const ATTENDANCE_CORRECTION_LEGAL_NOTICE_VERSION = "2026-07";
const ATTENDANCE_CORRECTION_DETAIL_TEXT = [
  "이 확인은 출퇴근 버튼 누락 또는 오입력으로 실제 근로 시작·종료 시각을 정정하기 위한 절차입니다.",
  "(관계 법령 근로기준법 제17조, 제50조, 제53조, 제54조, 제56조)",
  "이 서명은 근로계약상 소정근로시간 변경, 임금·연장근로수당·휴게시간·휴가 권리 포기, 향후 근로시간 변경에 대한 포괄 동의가 아닙니다.",
  "기재된 시각이 실제 근로시간과 다르면 이의제기할 수 있으며, 회사는 객관 자료 확인 후 다시 정정합니다.",
].join("\n");
const PRIVACY_CONSENT_VERSION = "2026-07";
const WORK_TIME_CONSENT_CHECK_TEXT = "근무요일, 근무시간, 휴게시간이 변경되는 경우 앱에서 변경 내용을 확인하고 전자서명할 수 있으며, 실제 변경은 건별 요청 및 회사 승인 후 적용된다는 설명을 확인했습니다.";
const ANNUAL_LEAVE_LEGAL_NOTE = "파트타임이라는 이유만으로 연차가 항상 없는 것은 아닙니다. 4주 평균 1주 소정근로시간이 15시간 미만이면 연차 규정 적용 제외가 가능하고, 15시간 이상 단시간근로자는 연차가 발생할 수 있습니다.";
const RNR_BASELINE_ROLES = [
  {department:"홍보마케팅부서", position:"선임", keywords:["홍보","마케팅","광고","SNS","콘텐츠","제휴"], duties:["홍보 콘텐츠 기획","SNS/광고 운영","제휴 제안 정리","성과 지표 확인","브랜드 메시지 관리"]},
  {department:"경영지원부서", position:"선임", keywords:["문서","서류","계약","인사","정산","운영"], duties:["문서/계약 자료 정리","인사·근태 자료 확인","정산 기초자료 취합","운영 일정 조율"]},
  {department:"경영지원부서", position:"매니저", keywords:["일정","비품","입력","응대","지원","사무"], duties:["사무 지원","데이터 입력","비품/소모품 확인","전화/방문 응대","부서 요청 접수"]},
  {department:"AI부서", position:"선임", keywords:["AI","자동화","데이터","프롬프트","모델","분석"], duties:["AI 자동화 기획","데이터 정리","프롬프트/결과 검수","업무 효율화 제안"]},
  {department:"개발부서", position:"매니저", keywords:["개발","버그","배포","시스템","앱","기능"], duties:["서비스 기능 개발","버그 확인 및 수정","배포 상태 점검","운영 기능 개선"]},
  {department:"디자인부서", position:"매니저", keywords:["디자인","브랜드","UI","이미지","콘텐츠","시안"], duties:["브랜드/콘텐츠 디자인","UI 화면 정리","홍보 이미지 제작","시안 관리"]},
];
const RNR_CATEGORY_RULES = [
  {label:"회계", keywords:["회계","정산","입금","출금","매출","비용","영수증","청구","결제"]},
  {label:"세무", keywords:["세무","세금","부가세","원천세","신고","세무사","증빙"]},
  {label:"서류", keywords:["서류","문서","계약서","제출","양식","파일","자료","공문"]},
  {label:"인사", keywords:["인사","채용","직원","근로계약","급여","근태","휴가"]},
  {label:"운영", keywords:["운영","일정","비품","재고","교육장","학교","준비","체크"]},
  {label:"홍보", keywords:["홍보","마케팅","광고","SNS","콘텐츠","블로그","인스타"]},
  {label:"고객응대", keywords:["문의","전화","응대","상담","고객","학부모","안내"]},
  {label:"개발", keywords:["개발","버그","앱","시스템","배포","기능"]},
  {label:"디자인", keywords:["디자인","시안","이미지","카드뉴스","브랜드"]},
  {label:"AI", keywords:["AI","자동화","프롬프트","데이터","모델"]},
];
const RNR_CATEGORY_OPTIONS = ["", ...RNR_CATEGORY_RULES.map(rule=>rule.label), "기타"];
const DEPARTMENT_OPTIONS = ["", ...Array.from(new Set(RNR_BASELINE_ROLES.map(role=>role.department)))];
const POSITION_OPTIONS = ["","대표","본부장","책임","선임","매니저"];
const WORK_TIME_CHANGE_MODE_LABELS:Record<string,string> = {
  work_time:"근무시간 변경",
  date_change:"근무일 변경",
  no_work:"근무 안 함",
};
const IMPROVEMENT_TYPES = [
  {value:"bug",label:"오류"},
  {value:"ux",label:"불편"},
  {value:"design",label:"디자인"},
  {value:"feature",label:"기능추가"},
  {value:"urgent",label:"긴급"},
];
const IMPROVEMENT_STATUS_LABELS:Record<string,string>={open:"대기",reviewing:"검토",planned:"수정 예정",done:"개선완료",dismissed:"보류"};
const IMPROVEMENT_SUBMENU_OPTIONS:Record<string,string[]> = {
  attendance:["오늘의 할일","출근하기","퇴근하기","내 기기","최근 기록","브라우저 알림"],
  leave:["휴가 신청","연차 현황","신청 내역","대체휴가 시간 사용"],
  overtime:["추가근무 신청","추가근무 내역","대체휴가 적립"],
  worktime:["한 문장 입력","기존 근무조건","변경 후 근무조건","서명","요청 내역"],
  "admin-dashboard":["승인 대기","일일 직원 근무 현황","강제 퇴근","확인 완료"],
  employees:["추가근무 적립 내역","근무시간 변경 요청","근무시간 변경 기록","직원 연차 소진내용","직원 연차 현황","직원 계정 생성","직원 관리"],
  workplaces:["근무지 등록","승인된 근무지","근무지 승인"],
  schedule:["직원별 주간 캘린더","일정 한 줄 변경","주간 스케줄 변경","특정 기간 미출근 설정"],
  payroll:["급여 계산","직원별 급여·근무 기준","공제 내역"],
  reports:["근태 요약","근태 기록","엑셀 내보내기"],
  consents:["직원 서명 리포트","개인정보 동의","근무시간 변경 요청 서명"],
  rnr:["업무 메모","AI 정리","R&R 스택","담당자별 보드"],
  improvements:["개선 요청 목록","상태 관리"],
};

const workplaceTypeLabels: Record<string,string> = { office:"사무실", special_school:"특수학교", external_education:"외부 교육장", remote:"재택", other_field:"기타 외근지" };
const requestTypeLabels: Record<string,string> = { annual:"연차", half_am:"오전 반차", half_pm:"오후 반차", hourly:"시간차", sick:"병가", official:"공가", remote:"재택", field:"외근", special:"특별휴가", substitute:"대체휴가", compensatory:"보상휴가", time_fix:"근무시간 수정", comp_leave_use:"대체휴가 시간 사용" };
const REQUEST_TYPES_UI = ["annual","half_am","half_pm","hourly","sick","official","special","substitute","compensatory"];
const SINGLE_DAY_TYPES = ["half_am","half_pm","hourly","comp_leave_use"];
const LOGIN_EMAIL_ALIASES: Record<string,string[]> = {
  "leehuieun@lupl.kr": ["ADMIN001","22061201"],
};

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
function monthLabel(iso: string) {
  const d = dateFromIso(iso);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월`;
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
function timeOnly(v?: string | Date | null) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Seoul" }).format(new Date(v));
}
function kstHHMM(v: Date | string) {
  const d = kstDate(v);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
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
function statusLabel(status?: string | null) {
  return ({pending:"승인 대기",approved:"승인",rejected:"반려",denied:"반려"} as Record<string,string>)[String(status??"")] ?? (status || "-");
}
function attendanceCorrectionStatusLabel(status?: string | null) {
  return ({pending:"서명 대기",signed:"서명 완료",objected:"이의제기",cancelled:"취소"} as Record<string,string>)[String(status??"")] ?? (status || "-");
}
function attendanceCorrectionTypeLabel(type?: string | null) {
  return ({check_in:"출근 정정",check_out:"퇴근 정정",both:"출퇴근 정정"} as Record<string,string>)[String(type??"")] ?? "출퇴근 정정";
}
function attendanceCorrectionTimeLine(record:any) {
  return `출근 ${formatDateTime(record.old_check_in_time)} -> ${formatDateTime(record.requested_check_in_time)} / 퇴근 ${formatDateTime(record.old_check_out_time)} -> ${formatDateTime(record.requested_check_out_time)}`;
}
function attendanceCorrectionDocumentText(employee:any, request:any) {
  return [
    "출퇴근 기록 정정 확인서",
    `직원: ${employee?.name??"-"} (${employee?.employee_no??"-"})`,
    `근무일: ${request.work_date}`,
    `정정 구분: ${attendanceCorrectionTypeLabel(request.correction_type)}`,
    `기존 기록: 출근 ${formatDateTime(request.old_check_in_time)} / 퇴근 ${formatDateTime(request.old_check_out_time)}`,
    `정정 요청: 출근 ${formatDateTime(request.requested_check_in_time)} / 퇴근 ${formatDateTime(request.requested_check_out_time)}`,
    `정정 사유: ${request.reason||"-"}`,
    request.evidence_note ? `확인 자료: ${request.evidence_note}` : "확인 자료: -",
    ATTENDANCE_CORRECTION_DETAIL_TEXT,
  ].join("\n");
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
function isAnnualLeaveDisabled(employee:any){ return !!employee?.no_annual_leave; }
function isFullTimeEmployee(employee:any){
  if(isAnnualLeaveDisabled(employee)) return false;
  const days=Array.isArray(employee?.work_days)?employee.work_days.length:Number(employee?.weekly_work_days||0);
  const hours=scheduleHours(employee?.work_start,employee?.work_end);
  return employee?.contract_type==="daily"&&days>=5&&hours>=8;
}
function automaticAnnualLeaveDays(employee:any, entitlement:any) {
  return isAnnualLeaveDisabled(employee) ? 0 : (isFullTimeEmployee(employee) ? entitlement.baseGrantedDays : 0);
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
function dateTimeLocalValue(iso?: string | null) {
  if(!iso) return "";
  const d=kstDate(iso);
  return `${d.toISOString().slice(0,10)}T${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
}
function defaultDateTimeLocal(dateIso:string, time?:string|null) {
  return `${dateIso}T${String(time||"09:00").slice(0,5)}`;
}
function dateTimeLocalToIso(value?: string | null) {
  return value ? new Date(`${value}:00+09:00`).toISOString() : null;
}
function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60000);
}
function latestCompEndForDate(compRequests:any[], dateIso:string) {
  return compRequests.filter((r:any)=>r.status==="approved")
    .filter((r:any)=>r.work_date===dateIso&&r.end_time)
    .reduce((latest:Date|null,r:any)=>{
      let end=kstDateTime(dateIso,r.end_time);
      const startMin=timeToMinutes(r.start_time);
      const endMin=timeToMinutes(r.end_time);
      if(startMin!=null&&endMin!=null&&endMin<=startMin) end=addMinutes(end,24*60);
      return !latest||end.getTime()>latest.getTime()?end:latest;
    },null);
}
function checkoutReminderTarget(log:any, employee:any, overrides:any[], compRequests:any[], workTimeChanges:any[] = []) {
  if(!log?.check_in_time||log?.check_out_time) return null;
  const dateIso=localDateStr(log.check_in_time);
  const sched=getScheduleForDate(employee,dateIso,overrides,workTimeChanges);
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
function minutesToTime(minutes:number){
  const safe=Math.max(0,Math.min(23*60+59,minutes));
  return `${String(Math.floor(safe/60)).padStart(2,"0")}:${String(safe%60).padStart(2,"0")}`;
}
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
function daysLabel(days:string[] = []) { return days.length ? days.map((d:string)=>DAY_LABELS[d]??d).join(", ") : "-"; }
function timeLabel(time?: string | null) { return time ? String(time).slice(0,5) : "-"; }
function timeRangeLabel(start?: string | null, end?: string | null) { return `${timeLabel(start)} ~ ${timeLabel(end)}`; }
function employeeContractStart(employee:any) { return employee?.work_start_date ?? employee?.contract_start ?? employee?.joined_at ?? todayIso(); }
function employeeContractEnd(employee:any) { return employee?.contract_end ?? null; }
function isOnOrAfterIsoDate(value?: string | null, baseline?: string | null) {
  if(!value || !baseline) return true;
  return localDateStr(value) >= String(baseline).slice(0,10);
}
function consentAppliesToCurrentEmployment(consent:any, employee:any) {
  if(!consent) return false;
  return isOnOrAfterIsoDate(consent.created_at, employeeContractStart(employee));
}
function logAppliesToCurrentEmployment(log:any, employee:any) {
  return isOnOrAfterIsoDate(log?.check_in_time, employeeContractStart(employee));
}
function daysFromPeriods(periods:any[] = []) {
  const result:string[] = [];
  periods.forEach((p:any)=>{
    if(!p.start_date||!p.end_date||p.end_date<p.start_date) return;
    let d=dateFromIso(p.start_date); const end=dateFromIso(p.end_date);
    while(d<=end){
      const key=dayKeyFromDate(d);
      if(!result.includes(key)) result.push(key);
      d=addLocalDays(d,1);
    }
  });
  return result.length>0 ? ALL_DAYS.filter(d=>result.includes(d)) : [];
}
function breakMinutes(start?: string | null, end?: string | null) {
  const s=timeToMinutes(start), e=timeToMinutes(end);
  if(s==null||e==null||e<=s) return 0;
  return e-s;
}
function netDailyHours(start?: string | null, end?: string | null, breakStart?: string | null, breakEnd?: string | null) {
  const workStart=timeToMinutes(start), workEndRaw=timeToMinutes(end);
  const breakStartMin=timeToMinutes(breakStart), breakEndRaw=timeToMinutes(breakEnd);
  if(workStart==null||workEndRaw==null) return 0;
  const workEnd=workEndRaw<=workStart?workEndRaw+24*60:workEndRaw;
  const span=workEnd-workStart;
  let overlap=0;
  if(breakStartMin!=null&&breakEndRaw!=null&&breakEndRaw>breakStartMin){
    const candidates=[
      [breakStartMin,breakEndRaw],
      [breakStartMin+24*60,breakEndRaw+24*60],
    ];
    overlap=candidates.reduce((max,[bs,be])=>Math.max(max,Math.max(0,Math.min(workEnd,be)-Math.max(workStart,bs))),0);
  }
  return Math.max(0, Math.round(((span-overlap)/60)*10)/10);
}
function weeklyScheduledHours(emp:any) {
  return Math.round(netDailyHours(emp?.work_start??"09:00",emp?.work_end??"18:00","12:00","13:00")*(emp?.work_days??["mon","tue","wed","thu","fri"]).length*10)/10;
}
function isUnderAnnualLeaveThreshold(emp:any) {
  return weeklyScheduledHours(emp) < 15;
}
function annualLeaveThresholdNotice(emp:any) {
  const hours=weeklyScheduledHours(emp);
  return `현재 등록된 주 소정근로시간은 약 ${hours.toFixed(1)}시간입니다. 4주 평균 1주 소정근로시간이 15시간 미만인 경우 근로기준법 제18조에 따라 제60조 연차유급휴가 규정 적용 제외가 가능합니다.`;
}
function annualLeaveEligibilityNote(emp:any) {
  const hours=weeklyScheduledHours(emp);
  return hours>=15
    ? `현재 설정 기준 주 소정근로시간이 약 ${hours.toFixed(1)}시간입니다. 15시간 이상이면 파트타임이어도 연차가 발생할 수 있어 "연차 없음" 처리 전 근로조건을 다시 확인해주세요.`
    : `현재 설정 기준 주 소정근로시간이 약 ${hours.toFixed(1)}시간입니다. 4주 평균 1주 소정근로시간이 15시간 미만인 경우 연차 규정 적용 제외가 가능합니다.`;
}
function countDaysInRange(startIso:string, endIso:string, workDays?:string[]) {
  if(!startIso||!endIso||endIso<startIso) return { totalDays: 0, workDays: 0 };
  let total=0; let work=0; let d=dateFromIso(startIso); const end=dateFromIso(endIso);
  while(d<=end){ total++; if((workDays??[]).includes(dayKeyFromDate(d))) work++; d=addLocalDays(d,1); }
  return { totalDays: total, workDays: work };
}
function summarizePeriods(periods:any[] = [], workDays:string[] = []) {
  return periods.reduce((acc:any,p:any)=>{
    const s=countDaysInRange(p.start_date,p.end_date,workDays);
    acc.totalDays += s.totalDays;
    acc.workDays += s.workDays;
    return acc;
  },{totalDays:0,workDays:0});
}
function approvedWorkTimeChangeForDate(changes:any[] = [], emp:any, dateIso:string) {
  return changes.find((c:any)=>c.status==="approved" && c.employee_id===emp?.id && (c.periods??[]).some((p:any)=>dateInRange(dateIso,p.start_date,p.end_date)));
}
function getScheduleForDate(emp:any, dateIso:string, overrides:any[]=[], workTimeChanges:any[]=[]) {
  if(!emp) return {work_days:["mon","tue","wed","thu","fri"], work_start:"09:00", work_end:"18:00"};
  const baseDays=emp.work_days ?? ["mon","tue","wed","thu","fri"];
  const contractStart=employeeContractStart(emp);
  const contractEnd=emp.contract_type==="fixed_term" ? emp.contract_end : null;
  if((contractStart&&dateIso<contractStart)||(contractEnd&&dateIso>contractEnd)) {
    return {work_days:[], work_start:emp.work_start??"09:00", work_end:emp.work_end??"18:00", break_start:"12:00", break_end:"13:00"};
  }
  const change=approvedWorkTimeChangeForDate(workTimeChanges,emp,dateIso);
  if(change) return {
    work_days: change.new_work_days ?? baseDays,
    work_start: change.new_work_start ?? emp.work_start ?? "09:00",
    work_end: change.new_work_end ?? emp.work_end ?? "18:00",
    break_start: change.new_break_start ?? "12:00",
    break_end: change.new_break_end ?? "13:00",
  };
  const weekStart=weekStartIso(dateIso);
  const ov=overrides.find((o:any)=>o.employee_id===emp.id && o.week_start===weekStart);
  const ovDays=Array.isArray(ov?.work_days) ? ov.work_days.filter((day:string)=>baseDays.includes(day)) : undefined;
  return {
    work_days: ovDays ?? baseDays,
    work_start: ov?.work_start ?? emp.work_start ?? "09:00",
    work_end: ov?.work_end ?? emp.work_end ?? "18:00",
  };
}
function attendanceDisplay(emp:any,log:any,overrides:any[],workTimeChanges:any[]=[]){
  if(!log) return {primary:"미출근",primaryClass:"",workType:null,lateMinutes:0,scheduleStart:null};
  const reviewStatuses=["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음","확인 완료","관리자 강제퇴근"];
  const dateIso=localDateStr(log.check_in_time);
  const schedule=getScheduleForDate(emp,dateIso,overrides,workTimeChanges);
  const scheduledStart=timeToMinutes(schedule.work_start);
  const lateThreshold=Math.max(10*60,scheduledStart??10*60);
  const checkedIn=kstDate(log.check_in_time);
  const actualMinutes=checkedIn.getUTCHours()*60+checkedIn.getUTCMinutes();
  const lateMinutes=Math.max(0,actualMinutes-lateThreshold);
  const workplaceType=log.workplaces?.type;
  const workType=workplaceType==="remote"||log.status==="재택"?"재택":["special_school","external_education","other_field"].includes(workplaceType)||log.status==="외근"?"외근":null;
  const thresholdText=minutesToTime(lateThreshold);
  if(reviewStatuses.includes(log.status)||["지각","결근"].includes(log.status)) return {primary:log.status,primaryClass:badgeClass(log.status),workType,lateMinutes,scheduleStart:thresholdText};
  return {primary:lateMinutes>=1?"지각":"정상출근",primaryClass:lateMinutes>=1?"bad":"good",workType,lateMinutes,scheduleStart:thresholdText};
}
function countScheduledWorkdays(emp:any, startIso:string, endIso:string, overrides:any[]=[], workTimeChanges:any[]=[]) {
  let count=0; let d=dateFromIso(startIso); const end=dateFromIso(endIso);
  while(d<=end){ const iso=isoDate(d); const sched=getScheduleForDate(emp, iso, overrides, workTimeChanges); if((sched.work_days??[]).includes(dayKeyFromDate(d))) count++; d=addLocalDays(d,1); }
  return count;
}
function formatHourValue(value:any) {
  const num=Number(value||0);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}
function scheduledWorkStats(emp:any, startIso:string, endIso:string, overrides:any[]=[], workTimeChanges:any[]=[]) {
  let days=0; let hours=0; let d=dateFromIso(startIso); const end=dateFromIso(endIso);
  while(d<=end){
    const iso=isoDate(d);
    const sched=getScheduleForDate(emp, iso, overrides, workTimeChanges);
    if((sched.work_days??[]).includes(dayKeyFromDate(d))){
      days++;
      hours+=netDailyHours(sched.work_start,sched.work_end,sched.break_start??"12:00",sched.break_end??"13:00");
    }
    d=addLocalDays(d,1);
  }
  return {days,hours:Math.round(hours*10)/10};
}
function weeklyStatsForDate(emp:any, dateIso=todayIso(), overrides:any[]=[], workTimeChanges:any[]=[]) {
  const start=weekStartIso(dateIso);
  return scheduledWorkStats(emp,start,addIsoDays(start,6),overrides,workTimeChanges);
}
function countUnpaidAbsenceWorkdays(emp:any, absences:any[], startIso:string, endIso:string, overrides:any[]=[], workTimeChanges:any[]=[]) {
  let count=0;
  absences.filter((a:any)=>a.employee_id===emp?.id && a.unpaid).forEach((a:any)=>{
    let d=dateFromIso(a.start_date); const e=dateFromIso(a.end_date);
    while(d<=e){ const iso=isoDate(d); if(iso>=startIso&&iso<=endIso){ const sched=getScheduleForDate(emp, iso, overrides, workTimeChanges); if((sched.work_days??[]).includes(dayKeyFromDate(d))) count++; } d=addLocalDays(d,1); }
  });
  return count;
}
function monthRangeFor(anchor=todayIso()) { const d=dateFromIso(anchor); const start=new Date(d.getFullYear(), d.getMonth(), 1); const end=new Date(d.getFullYear(), d.getMonth()+1, 0); return {start:isoDate(start), end:isoDate(end)}; }
function currentMonthRange() { return monthRangeFor(todayIso()); }
function monthRangeFromValue(value:string) {
  const [year,month]=value.split("-").map(Number);
  const start=new Date(year,month-1,1);
  const end=new Date(year,month,0);
  return {start:isoDate(start), end:isoDate(end)};
}
function monthSelectOptions(anchor=todayIso(), before=6, after=2) {
  const d=dateFromIso(anchor);
  return Array.from({length:before+after+1},(_,index)=>{
    const month=new Date(d.getFullYear(),d.getMonth()-before+index,1);
    const value=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,"0")}`;
    return {value,label:`${month.getFullYear()}년 ${month.getMonth()+1}월`};
  }).reverse();
}


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
function ApprovedCompCard({ compRequests, leaveRequests, empMap, onChanged }: { compRequests:any[]; leaveRequests:any[]; empMap:Record<string,any>; onChanged:()=>void }) {
  const [filterEmpId,setFilterEmpId]=useState("");
  const [msg,setMsg]=useState("");
  const approved=uniqueCompRequests(compRequests);
  const month=currentMonthRange();
  const usedByEmployee=leaveRequests
    .filter((request:any)=>isCompLeaveUsageRequest(request)&&request.status==="approved")
    .reduce((map:Record<string,number>,request:any)=>{
      const hours=Number((request.amount_hours??(Number(request.amount_days||0)*8))||0);
      map[request.employee_id]=(map[request.employee_id]??0)+hours;
      return map;
    },{});
  const compSummaryByEmployee=approved.reduce((map:Record<string,any>,request:any)=>{
    const employeeId=request.employee_id;
    if(!map[employeeId]) map[employeeId]={employee:empMap[employeeId],monthHours:0,totalHours:0,usedHours:usedByEmployee[employeeId]??0};
    const hours=Number(request.hours||0);
    map[employeeId].totalHours+=hours;
    if(request.work_date>=month.start&&request.work_date<=month.end) map[employeeId].monthHours+=hours;
    return map;
  },{});
  Object.entries(usedByEmployee).forEach(([employeeId,usedHours])=>{
    if(!compSummaryByEmployee[employeeId]) compSummaryByEmployee[employeeId]={employee:empMap[employeeId],monthHours:0,totalHours:0,usedHours};
    else compSummaryByEmployee[employeeId].usedHours=usedHours;
  });
  const compSummaryRows=Object.entries(compSummaryByEmployee)
    .map(([employeeId,summary]:any)=>({employeeId,...summary}))
    .filter((summary:any)=>summary.employee)
    .sort((a:any,b:any)=>String(a.employee?.name??"").localeCompare(String(b.employee?.name??"")));
  const selectedSummary=filterEmpId
    ? compSummaryRows.find((row:any)=>row.employeeId===filterEmpId)
    : compSummaryRows.reduce((sum:any,row:any)=>({
        monthHours:sum.monthHours+Number(row.monthHours||0),
        totalHours:sum.totalHours+Number(row.totalHours||0),
        usedHours:sum.usedHours+Number(row.usedHours||0),
      }),{monthHours:0,totalHours:0,usedHours:0});
  const shown=filterEmpId?approved.filter(r=>r.employee_id===filterEmpId):approved;
  const shownHours=shown.reduce((sum,r)=>sum+Number(r.hours||0),0);
  const shownDays=shown.reduce((sum,r)=>sum+Number(r.converted_days||0),0);
  async function deleteComp(id:string) {
    if(!window.confirm("이 추가근무 적립을 삭제할까요? 해당 직원의 대체휴가 잔여가 줄어듭니다.")) return;
    await supabase.from("leave_adjustments").delete().eq("source_type","comp_time_requests").eq("source_id",id);
    const {error}=await supabase.from("comp_time_requests").delete().eq("id",id);
    if(error) setMsg(error.message); else onChanged();
  }
  return (
    <section className="card">
      <h2 className="card-title"><i className="ti ti-clock-check" aria-hidden="true"></i>추가근무 적립 내역</h2>
      {approved.length===0 ? <p className="subtle">아직 승인되어 적립된 추가근무 내역이 없습니다.</p> : (
        <div className="comp-employee-filter">
          <button className={!filterEmpId?"active":""} onClick={()=>setFilterEmpId("")}>
            <b>전체</b>
            <span>이번달 {formatHourValue(selectedSummary?.monthHours||0)}h · 누적 {formatHourValue(selectedSummary?.totalHours||0)}h · 사용 {formatHourValue(selectedSummary?.usedHours||0)}h</span>
          </button>
          {compSummaryRows.map((row:any)=>(
            <button key={row.employeeId} className={filterEmpId===row.employeeId?"active":""} onClick={()=>setFilterEmpId(row.employeeId)}>
              <b>{row.employee.name}</b>
              <span>이번달 {formatHourValue(row.monthHours)}h · 누적 {formatHourValue(row.totalHours)}h · 사용 {formatHourValue(row.usedHours)}h</span>
            </button>
          ))}
        </div>
      )}
      {msg&&<div className="alert error">{msg}</div>}
      {approved.length>0&&!filterEmpId&&<p className="subtle" style={{marginTop:12}}>직원 버튼을 누르면 해당 직원의 적립 내역을 접어서 확인할 수 있습니다.</p>}
      {approved.length>0&&filterEmpId&&<CollapsibleSection title={`상세 적립 내역 ${shown.length}건`} icon="ti-list-details" defaultOpen={false}>
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
      </CollapsibleSection>}
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

function WorkTimeDetailBlock({ className = "" }: { className?: string }) {
  return (
    <div className={`type-desc work-time-detail ${className}`}>
      {WORK_TIME_DETAIL_MAIN_TEXT}
      <br />
      <span className="work-time-legal">{WORK_TIME_DETAIL_LEGAL_TEXT}</span>
      <br />
      {WORK_TIME_DETAIL_SIGN_TEXT}
    </div>
  );
}
function ConsentDetailToggle({ title, open, onToggle, children }: { title:string; open:boolean; onToggle:()=>void; children:any }) {
  return (
    <div className="consent-detail-toggle">
      <button className="collapsible-btn" type="button" onClick={onToggle}>
        {title}
        <i className={`ti ${open?"ti-chevron-up":"ti-chevron-down"}`} style={{marginLeft:"auto"}} aria-hidden="true"></i>
      </button>
      {open&&children}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [employee, setEmployee] = useState<any | null>(null);
  const [consent, setConsent] = useState<any | null>(null);
  const [workTimeConsent, setWorkTimeConsent] = useState<any | null>(null);
  const [tab, setTab] = useState<Tab>("attendance");
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [showPwModal, setShowPwModal] = useState(false);
  const [mobileNavOpen,setMobileNavOpen]=useState(false);
  const loadSeqRef=useRef(0);

  async function load() {
    const seq=++loadSeqRef.current;
    setLoading(true);
    try {
      const r = await fetchCurrentEmployee();
      if(seq!==loadSeqRef.current) return;
      setSession(r.session);
      setEmployee(r.employee);
      if (r.employee) {
        const [privacyResult, workTimeConsentResult] = await Promise.all([
          supabase.from("privacy_consents").select("*").eq("employee_id", r.employee.id).eq("is_active", true).order("created_at",{ascending:false}).limit(1),
          supabase.from("work_time_change_consents").select("*").eq("employee_id", r.employee.id).eq("consent_version", WORK_TIME_CHANGE_CONSENT_VERSION).maybeSingle(),
        ]);
        if(seq!==loadSeqRef.current) return;
        setConsent(privacyResult.data?.[0]??null);
        setWorkTimeConsent(workTimeConsentResult.data??null);
        if (r.employee.role === "admin") {
          const [w, rq, c, d, lg, wt] = await Promise.all([
            supabase.from("workplaces").select("id, approval_status"),
            supabase.from("attendance_requests").select("id, status"),
            supabase.from("comp_time_requests").select("id, status"),
            supabase.from("registered_devices").select("id, status"),
            supabase.from("attendance_logs").select("id, status, check_in_time, check_out_time"),
            supabase.from("work_time_change_requests").select("id, status"),
          ]);
          if(seq!==loadSeqRef.current) return;
          setPendingCount(
            (w.data??[]).filter((x:any)=>x.approval_status==="pending").length +
            (rq.data??[]).filter((x:any)=>x.status==="pending").length +
            (c.data??[]).filter((x:any)=>x.status==="pending").length +
            (d.data??[]).filter((x:any)=>x.status==="pending").length +
            (wt.data??[]).filter((x:any)=>x.status==="pending").length +
            (lg.data??[]).filter((x:any)=>{
              const openToday=!x.check_out_time&&isToday(x.check_in_time);
              if(x.status==="확인 완료"||openToday) return false;
              return !x.check_out_time||["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음"].includes(x.status);
            }).length
          );
        } else setPendingCount(0);
      } else {
        setConsent(null);
        setWorkTimeConsent(null);
        setPendingCount(0);
      }
    } finally {
      if(seq===loadSeqRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const { data } = supabase.auth.onAuthStateChange(() => setTimeout(load, 0));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signOut() { await supabase.auth.signOut(); setSession(null); setEmployee(null); setConsent(null); setWorkTimeConsent(null); }

  if (loading) return <div className="container" style={{ paddingTop: 48, textAlign: "center", color: "#8b94a6" }}>불러오는 중…</div>;
  if (!session) return <LoginPage />;
  if (!employee) return <div className="container"><section className="card auth-card"><h1 className="card-title">직원 정보가 없습니다</h1><p className="subtle">관리자 계정의 employees.user_id 연결을 확인해주세요.</p><button className="button full" onClick={signOut}>로그아웃</button></section></div>;
  if (!employee.is_active || employee.employment_status !== "active") return <InactivePage signOut={signOut} />;
  const validPrivacyConsent=consentAppliesToCurrentEmployment(consent,employee) ? consent : null;
  const validWorkTimeConsent=consentAppliesToCurrentEmployment(workTimeConsent,employee) ? workTimeConsent : null;
  const shouldShowCombinedConsent = !validPrivacyConsent || (validPrivacyConsent?.consent_version === PRIVACY_CONSENT_VERSION && !validWorkTimeConsent);
  if (shouldShowCombinedConsent) return <ConsentGate employee={employee} onDone={load} signOut={signOut} />;
  const isAdmin = employee.role === "admin";
  const pageTitles:Record<Tab,string>={
    attendance:"출퇴근",
    leave:"휴가",
    overtime:"추가근무",
    worktime:"근무시간 변경",
    "admin-dashboard":"오늘 관리",
    approvals:"승인함",
    employees:"직원",
    rnr:"업무 R&R",
    workplaces:"근무지",
    schedule:"일정",
    payroll:"급여",
    reports:"리포트",
    consents:"동의서",
    improvements:"개선함",
  };
  const personalMenus:{id:Tab;label:string;icon:string}[]=[
    {id:"attendance",label:"출퇴근",icon:"ti-clock"},
    {id:"leave",label:"휴가",icon:"ti-calendar"},
    {id:"overtime",label:"추가근무",icon:"ti-clock-plus"},
    {id:"worktime",label:"근무시간 변경",icon:"ti-calendar-time"},
    {id:"improvements",label:"개선함",icon:"ti-notes"},
  ];
  const adminMenus:{id:Tab;label:string;icon:string;badge?:number}[]=[
    {id:"admin-dashboard",label:"오늘",icon:"ti-layout-dashboard"},
    {id:"approvals",label:"승인함",icon:"ti-inbox",badge:pendingCount},
    {id:"schedule",label:"일정",icon:"ti-calendar-time"},
    {id:"employees",label:"직원",icon:"ti-users"},
    {id:"workplaces",label:"근무지",icon:"ti-map-pin"},
  ];
  const reportMenus:{id:Tab;label:string;icon:string;badge?:number}[]=[
    {id:"reports",label:"근태 리포트",icon:"ti-chart-bar"},
    {id:"payroll",label:"급여",icon:"ti-coin"},
    {id:"consents",label:"동의서",icon:"ti-file-certificate"},
  ];
  const extraMenus:{id:Tab;label:string;icon:string;badge?:number}[]=[
    {id:"rnr",label:"업무 R&R",icon:"ti-sitemap"},
  ];
  const improvementMenuOptions=[...personalMenus,...adminMenus,...reportMenus,...extraMenus].map(item=>({id:item.id,label:item.label}));
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
          {isAdmin&&<><p className="side-nav-label">관리</p>{adminMenus.map(menuButton)}<p className="side-nav-label">리포트</p>{reportMenus.map(menuButton)}<p className="side-nav-label">설정</p>{extraMenus.map(menuButton)}</>}
        </nav>
        <div className="sidebar-account">
          <div className="sidebar-user"><span><i className="ti ti-user" aria-hidden="true"></i></span><div><b>{employee.name}</b><small>{employee.employee_no} · {isAdmin?"관리자":"직원"}</small></div></div>
          <button title="비밀번호 변경" onClick={()=>setShowPwModal(true)}><i className="ti ti-lock" aria-hidden="true"></i></button>
          <button title="로그아웃" onClick={signOut}><i className="ti ti-logout" aria-hidden="true"></i></button>
        </div>
      </aside>
      {mobileNavOpen&&<button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={()=>setMobileNavOpen(false)} />}
      <div className="app-workspace">
        <header className="topbar">
          <div className="topbar-inner">
            <button className="mobile-menu-button" title="메뉴 열기" onClick={()=>setMobileNavOpen(true)}><i className="ti ti-menu-2" aria-hidden="true"></i></button>
            <div className="page-heading"><span>{reportMenus.some(m=>m.id===tab)?"리포트":extraMenus.some(m=>m.id===tab)?"설정":isAdmin&&adminMenus.some(m=>m.id===tab)?"관리":"내 근무"}</span><h1>{pageTitles[tab]}</h1></div>
            <div className="topbar-user"><span>{employee.name}</span><b>{employee.employee_no} · {isAdmin?"관리자":"직원"}</b></div>
          </div>
        </header>
        <main className="container">
          {tab==="attendance" && <HomePage employee={employee} />}
          {tab==="leave" && <LeavePage employee={employee} mode="leave" />}
          {tab==="overtime" && <LeavePage employee={employee} mode="overtime" />}
          {tab==="worktime" && <WorkTimeChangePage employee={employee} />}
          {tab==="admin-dashboard" && isAdmin && <AdminPage currentEmployee={employee} onChanged={load} view="dashboard" onNavigate={go} />}
          {tab==="approvals" && isAdmin && <AdminPage currentEmployee={employee} onChanged={load} view="approvals" onNavigate={go} />}
          {tab==="employees" && isAdmin && <AdminPage currentEmployee={employee} onChanged={load} view="employees" onNavigate={go} />}
          {tab==="rnr" && isAdmin && <AdminPage currentEmployee={employee} onChanged={load} view="rnr" onNavigate={go} />}
          {tab==="workplaces" && isAdmin && <WorkplacePage employee={employee} />}
          {tab==="schedule" && isAdmin && <SettingsPage currentEmployee={employee} section="schedule" />}
          {tab==="payroll" && isAdmin && <SettingsPage currentEmployee={employee} section="payroll" />}
          {tab==="reports" && isAdmin && <ReportsPage />}
          {tab==="consents" && isAdmin && <ConsentReportPage />}
          {tab==="improvements" && <ImprovementRequestsPage currentEmployee={employee} menuOptions={improvementMenuOptions} />}
        </main>
      </div>
      <ImprovementQuickCapture employee={employee} currentTab={tab} currentPageTitle={pageTitles[tab]} menuOptions={improvementMenuOptions} />
      {showPwModal && <PasswordModal onClose={()=>setShowPwModal(false)} />}
      {validPrivacyConsent && !validWorkTimeConsent && validPrivacyConsent.consent_version !== PRIVACY_CONSENT_VERSION && <WorkTimeConsentModal employee={employee} onDone={load} />}
    </div>
  );
}

function LoginPage() {
  const [employeeNo, setEmployeeNo] = useState(""); const [password, setPassword] = useState(""); const [message, setMessage] = useState("");
  async function login() {
    setMessage("");
    const loginId=employeeNo.trim();
    const normalizedId=loginId.toLowerCase();
    const aliasNos=LOGIN_EMAIL_ALIASES[normalizedId]??[];
    const candidateEmails=Array.from(new Set([
      ...aliasNos.map(internalEmail),
      loginId.includes("@") ? normalizedId : internalEmail(loginId),
    ]));
    for(const email of candidateEmails){
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if(!error) return;
    }
    setMessage("사번/이메일 또는 비밀번호를 확인해주세요.");
  }
  return (
    <div className="container"><section className="card auth-card">
      <div className="logo logo-lg"><span>근태</span></div>
      <h1 className="card-title" style={{ marginTop: 16, display: "block" }}>러플 근태관리 로그인</h1>
      <p className="subtle">직원은 사번으로, 기존 관리자 계정은 이메일로 로그인할 수 있습니다. 초기 비밀번호는 lupl + 휴대폰 뒷번호 4자리입니다.</p>
      {message && <div className="alert error">{message}</div>}
      <div className="form-row"><label className="label">사번 또는 관리자 이메일</label><input className="input" value={employeeNo} onChange={e=>setEmployeeNo(e.target.value)} placeholder="예: 22061201 / leehuieun@lupl.kr" onKeyDown={e=>e.key==="Enter"&&login()} /></div>
      <div className="form-row"><label className="label">비밀번호</label><input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} /></div>
      <button className="button full" onClick={login}>로그인</button>
    </section></div>
  );
}

function InactivePage({ signOut }: { signOut: () => void }) {
  return <div className="container"><section className="card auth-card"><h1 className="card-title">비활성 계정입니다</h1><p className="subtle">관리자에게 계정 활성화를 요청해주세요.</p><button className="button full" onClick={signOut}>로그아웃</button></section></div>;
}

function ImprovementQuickCapture({ employee, currentTab, currentPageTitle, menuOptions }:
  { employee:any; currentTab:Tab; currentPageTitle:string; menuOptions:{id:Tab;label:string}[] }) {
  const [open,setOpen]=useState(false);
  const [requestType,setRequestType]=useState("bug");
  const [menuId,setMenuId]=useState<Tab>(currentTab);
  const [submenu,setSubmenu]=useState("");
  const [note,setNote]=useState("");
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    function onKeyDown(event:KeyboardEvent) {
      if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==="m"){
        event.preventDefault();
        setMenuId(currentTab);
        setOpen(true);
      }
    }
    window.addEventListener("keydown",onKeyDown);
    return ()=>window.removeEventListener("keydown",onKeyDown);
  },[currentTab]);
  const currentMenu=menuOptions.find(menu=>menu.id===menuId);
  const submenuOptions=IMPROVEMENT_SUBMENU_OPTIONS[menuId]??[];
  async function save() {
    setMsg("");
    if(!note.trim()) return setMsg("개선 메모를 입력해주세요.");
    setBusy(true);
    const selectedType=IMPROVEMENT_TYPES.find(type=>type.value===requestType);
    const {error}=await supabase.from("improvement_requests").insert({
      created_by:employee.id,
      request_type:requestType,
      request_type_label:selectedType?.label??requestType,
      menu_id:menuId,
      menu_label:currentMenu?.label??currentPageTitle,
      submenu_label:submenu||null,
      page_title:currentPageTitle,
      page_path:`${window.location.pathname}${window.location.hash}`,
      note:note.trim(),
      status:"open",
      user_agent:navigator.userAgent,
      viewport_width:window.innerWidth,
      viewport_height:window.innerHeight,
    });
    if(error) setMsg(error.message.includes("improvement_requests")?"개선 요청 저장 테이블이 아직 DB에 없습니다. 새 SQL 패치를 먼저 실행해주세요.":error.message);
    else { setMsg("개선 요청함에 저장되었습니다."); setNote(""); setSubmenu(""); setTimeout(()=>setOpen(false),650); }
    setBusy(false);
  }
  return (
    <>
      <button className="improvement-fab" title="개선 메모 열기 (Ctrl+Shift+M)" onClick={()=>{setMenuId(currentTab);setOpen(true);}}>
        <i className="ti ti-message-plus" aria-hidden="true"></i>
      </button>
      {open&&<div className="modal-backdrop improvement-backdrop" onClick={()=>setOpen(false)}>
        <div className="modal-box improvement-modal" onClick={e=>e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="card-title" style={{margin:0}}><i className="ti ti-message-plus" aria-hidden="true"></i>개선 메모</h2>
            <button className="modal-close" title="닫기" onClick={()=>setOpen(false)}><i className="ti ti-x" aria-hidden="true"></i></button>
          </div>
          <div className="grid two">
            <div className="form-row"><label className="label">메모 유형</label><select className="select" value={requestType} onChange={e=>setRequestType(e.target.value)}>{IMPROVEMENT_TYPES.map(type=><option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
            <div className="form-row"><label className="label">메뉴</label><select className="select" value={menuId} onChange={e=>{setMenuId(e.target.value as Tab);setSubmenu("");}}>{menuOptions.map(menu=><option key={menu.id} value={menu.id}>{menu.label}</option>)}</select></div>
          </div>
          <div className="form-row"><label className="label">하위 항목</label><select className="select" value={submenu} onChange={e=>setSubmenu(e.target.value)}><option value="">선택 안 함</option>{submenuOptions.map(option=><option key={option} value={option}>{option}</option>)}</select></div>
          <div className="form-row"><label className="label">메모</label><textarea className="textarea compact-textarea" value={note} onChange={e=>setNote(e.target.value)} placeholder="예: 직원 현황에서 강제퇴근 버튼이 너무 안 보여서 바로 처리하기 어렵다." /></div>
          <p className="subtle">현재 화면: {currentPageTitle} · 단축키 Ctrl+Shift+M</p>
          {msg&&<div className={`alert ${msg.includes("저장")?"success":"error"}`}>{msg}</div>}
          <div className="actions" style={{justifyContent:"flex-end"}}>
            <button className="button ghost" onClick={()=>setOpen(false)}>닫기</button>
            <button className="button" disabled={busy} onClick={save}><i className="ti ti-check" aria-hidden="true"></i>{busy?"저장 중":"저장"}</button>
          </div>
        </div>
      </div>}
    </>
  );
}

function ImprovementRequestsPage({ currentEmployee, menuOptions }: { currentEmployee:any; menuOptions:{id:Tab;label:string}[] }) {
  const [rows,setRows]=useState<any[]>([]);
  const [statusFilter,setStatusFilter]=useState("open");
  const [menuFilter,setMenuFilter]=useState("all");
  const [msg,setMsg]=useState("");
  const [aiBusy,setAiBusy]=useState(false);
  const [aiSummary,setAiSummary]=useState<any|null>(null);
  const [githubBusy,setGithubBusy]=useState(false);
  const [githubIssue,setGithubIssue]=useState<any|null>(null);
  const isAdmin=currentEmployee?.role==="admin";
  async function load() {
    let query=supabase.from("improvement_requests").select("*, employees(name, employee_no)").order("created_at",{ascending:false}).limit(300);
    if(!isAdmin) query=query.eq("created_by",currentEmployee.id);
    const {data,error}=await query;
    if(error) setMsg(error.message.includes("improvement_requests")?"개선 요청 저장 테이블이 아직 DB에 없습니다. 새 SQL 패치를 먼저 실행해주세요.":error.message);
    else { setRows(data??[]); setMsg(""); }
  }
  useEffect(()=>{load();},[]);
  const visible=rows.filter(row=>(statusFilter==="all"||row.status===statusFilter)&&(menuFilter==="all"||row.menu_id===menuFilter));
  async function updateStatus(id:string,status:string) {
    const {error}=await supabase.from("improvement_requests").update({status,updated_at:new Date().toISOString()}).eq("id",id);
    if(error) setMsg(error.message); else await load();
  }
  async function markVisibleDone() {
    if(!isAdmin) return;
    const ids=visible.filter(row=>row.status!=="done").map(row=>row.id);
    if(ids.length===0) return setMsg("개선완료로 바꿀 항목이 없습니다.");
    if(!window.confirm(`현재 보이는 개선 요청 ${ids.length}건을 개선완료로 변경할까요?`)) return;
    const {error}=await supabase.from("improvement_requests").update({status:"done",updated_at:new Date().toISOString()}).in("id",ids);
    if(error) setMsg(error.message); else { setMsg(`${ids.length}건을 개선완료로 변경했습니다.`); await load(); }
  }
  async function markActiveDone() {
    if(!isAdmin) return;
    const ids=rows.filter(row=>!["done","dismissed"].includes(row.status)).map(row=>row.id);
    if(ids.length===0) return setMsg("처리할 개선 요청이 없습니다.");
    if(!window.confirm(`대기/검토/수정 예정 개선 요청 ${ids.length}건을 모두 개선완료로 변경할까요?`)) return;
    const {error}=await supabase.from("improvement_requests").update({status:"done",updated_at:new Date().toISOString()}).in("id",ids);
    if(error) setMsg(error.message); else { setMsg(`${ids.length}건을 모두 개선완료로 변경했습니다.`); await load(); }
  }
  async function summarize() {
    if(!isAdmin) return;
    setMsg(""); setAiBusy(true); setAiSummary(null);
    try {
      const {data:sessionData}=await supabase.auth.getSession();
      const token=sessionData.session?.access_token;
      if(!token) throw new Error("로그인이 필요합니다.");
      const response=await fetch("/api/improvement-summarize",{
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({requests:visible.slice(0,80).map(row=>({
          id:row.id,
          type:row.request_type_label||row.request_type,
          menu:row.menu_label,
          submenu:row.submenu_label,
          note:row.note,
          status:row.status,
          created_at:row.created_at,
          requester:row.employees?.name,
        }))}),
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error||"AI 정리 실패");
      setAiSummary(data.summary);
    } catch(error:any) {
      setMsg(error.message||String(error));
    } finally {
      setAiBusy(false);
    }
  }
  async function createGithubIssue() {
    if(!isAdmin) return;
    const target=visible.filter(row=>!["done","dismissed"].includes(row.status));
    if(target.length===0) return setMsg("GitHub Issue로 보낼 개선 요청이 없습니다.");
    setMsg(""); setGithubBusy(true); setGithubIssue(null);
    try {
      const {data:sessionData}=await supabase.auth.getSession();
      const token=sessionData.session?.access_token;
      if(!token) throw new Error("로그인이 필요합니다.");
      const response=await fetch("/api/improvement-github-issue",{
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({requests:target.slice(0,100).map(row=>({
          id:row.id,
          type:row.request_type_label||row.request_type,
          menu:row.menu_label,
          submenu:row.submenu_label,
          note:row.note,
          status:row.status,
          created_at:row.created_at,
          requester:row.employees?.name,
        }))}),
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error||"GitHub Issue 생성 실패");
      const ids=target.filter(row=>row.status!=="planned").map(row=>row.id);
      if(ids.length>0) await supabase.from("improvement_requests").update({status:"planned",updated_at:new Date().toISOString()}).in("id",ids);
      await load();
      setGithubIssue(data.issue);
      setMsg(`GitHub Issue #${data.issue?.number} 생성 완료`);
    } catch(error:any) {
      setMsg(error.message||String(error));
    } finally {
      setGithubBusy(false);
    }
  }
  const openCount=rows.filter(row=>row.status==="open").length;
  const doneCount=rows.filter(row=>row.status==="done").length;
  const hiddenCount=rows.filter(row=>row.status==="dismissed").length;
  return (
    <section className="card improvement-page">
      <div className="section-head">
        <div><h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-notes" aria-hidden="true"></i>개선 요청함</h2><p className="subtle" style={{margin:0}}>{isAdmin?"앱에서 바로 남긴 개선 메모가 쌓입니다. 처리한 항목은 개선완료로 정리합니다.":"내가 남긴 개선 요청과 처리 상태를 확인합니다."}</p></div>
        {isAdmin&&<div className="actions"><button className="button secondary" onClick={createGithubIssue} disabled={githubBusy||visible.every(row=>["done","dismissed"].includes(row.status))}><i className="ti ti-brand-github" aria-hidden="true"></i>{githubBusy?"보내는 중":"GitHub Issue로 보내기"}</button><button className="button ghost" onClick={markActiveDone} disabled={rows.every(row=>["done","dismissed"].includes(row.status))}><i className="ti ti-checklist" aria-hidden="true"></i>전체 완료</button></div>}
      </div>
      {msg&&<div className={`alert ${msg.includes("변경했습니다")||msg.includes("생성 완료")?"success":"error"}`}>{msg}</div>}
      {githubIssue?.html_url&&<div className="alert success"><a href={githubIssue.html_url} target="_blank" rel="noreferrer">GitHub Issue #{githubIssue.number} 열기</a></div>}
      <div className="improvement-summary-line">대기 {openCount}건 · 완료 {doneCount}건 · 삭제 {hiddenCount}건</div>
      <div className="grid two">
        <div className="form-row"><label className="label">상태</label><select className="select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="open">대기</option><option value="all">전체</option>{Object.entries(IMPROVEMENT_STATUS_LABELS).filter(([key])=>key!=="open").map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
        <div className="form-row"><label className="label">메뉴</label><select className="select" value={menuFilter} onChange={e=>setMenuFilter(e.target.value)}><option value="all">전체 메뉴</option>{menuOptions.map(menu=><option key={menu.id} value={menu.id}>{menu.label}</option>)}</select></div>
      </div>
      <div className="improvement-stack">
        {visible.length===0 ? <p className="subtle">표시할 개선 요청이 없습니다.</p> : visible.map(row=>(
          <article className="improvement-item" key={row.id}>
            <div className="improvement-item-head">
              <div><span>{row.request_type_label||row.request_type}</span><b>{row.menu_label}{row.submenu_label?` · ${row.submenu_label}`:""}</b></div>
              <em>{IMPROVEMENT_STATUS_LABELS[row.status]??row.status}</em>
            </div>
            <p>{row.note}</p>
            <small>{row.employees?.name??"작성자"} · {formatDateTime(row.created_at)} · {row.page_title??"-"}</small>
            {isAdmin&&<div className="actions">
              {row.status!=="done"&&<button className="button secondary compact" onClick={()=>updateStatus(row.id,"done")}>완료</button>}
              {row.status!=="dismissed"&&<button className="button ghost compact" onClick={()=>updateStatus(row.id,"dismissed")}>삭제</button>}
              {row.status!=="open"&&<button className="button ghost compact" onClick={()=>updateStatus(row.id,"open")}>대기</button>}
            </div>}
          </article>
        ))}
      </div>
    </section>
  );
}

function SignaturePad({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement|null> }) {
  const [drawing,setDrawing] = useState(false);
  const pointerIdRef=useRef<number|null>(null);
  function ctx() { const c=canvasRef.current; if(!c) return null; const x=c.getContext("2d"); if(!x) return null; x.lineWidth=2.4; x.lineCap="round"; x.strokeStyle="#161b26"; return x; }
  function point(e:any) {
    const c=canvasRef.current!;
    const r=c.getBoundingClientRect();
    const scaleX=c.width/Math.max(1,r.width);
    const scaleY=c.height/Math.max(1,r.height);
    return {x:(e.clientX-r.left)*scaleX,y:(e.clientY-r.top)*scaleY};
  }
  function start(e:any) {
    e.preventDefault();
    pointerIdRef.current=e.pointerId;
    e.currentTarget?.setPointerCapture?.(e.pointerId);
    setDrawing(true);
    const c=ctx(); const p=point(e);
    c?.beginPath(); c?.moveTo(p.x,p.y);
  }
  function move(e:any) {
    if(!drawing||pointerIdRef.current!==e.pointerId) return;
    e.preventDefault();
    const c=ctx(); const p=point(e);
    c?.lineTo(p.x,p.y); c?.stroke();
  }
  function end(e:any) {
    if(pointerIdRef.current!==null) e.currentTarget?.releasePointerCapture?.(pointerIdRef.current);
    pointerIdRef.current=null;
    setDrawing(false);
  }
  return <canvas ref={canvasRef} width={700} height={170} className="signature-pad" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end} />;
}

function clearSignature(canvasRef: React.RefObject<HTMLCanvasElement|null>) {
  const c=canvasRef.current; const x=c?.getContext("2d");
  if(c&&x) x.clearRect(0,0,c.width,c.height);
}

function signatureData(canvasRef: React.RefObject<HTMLCanvasElement|null>) {
  return canvasRef.current?.toDataURL("image/png") ?? "";
}

function friendlySignatureDbError(error:any) {
  const message=String(error?.message??error??"");
  if(message.includes("work_time_change_consents")||error?.code==="PGRST205") {
    return "근무시간 변경 동의 저장 테이블이 아직 Supabase API에 반영되지 않았습니다. 새 DB 패치를 실행한 뒤 1분 후 다시 시도해주세요.";
  }
  if(message.includes("work_time_change_requests")) {
    return "근무시간 변경 요청 저장 테이블이 아직 Supabase API에 반영되지 않았습니다. 새 DB 패치를 실행한 뒤 1분 후 다시 시도해주세요.";
  }
  if(message.includes("attendance_correction_requests")) {
    return "출퇴근 기록 정정 저장 테이블이 아직 Supabase API에 반영되지 않았습니다. 새 DB 패치를 실행한 뒤 1분 후 다시 시도해주세요.";
  }
  return message || "저장 중 오류가 발생했습니다.";
}

function ConsentGate({ employee, onDone, signOut }: { employee: any; onDone: () => void; signOut: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const [agree1,setAgree1] = useState(false); const [agree2,setAgree2] = useState(false); const [agree3,setAgree3] = useState(false); const [agree4,setAgree4] = useState(false);
  const [showPrivacyDetail,setShowPrivacyDetail]=useState(false);
  const [showOvertimeDetail,setShowOvertimeDetail]=useState(false);
  const [showWorkTimeDetail,setShowWorkTimeDetail]=useState(false);
  const [msg,setMsg] = useState("");
  function clear() { clearSignature(canvasRef); }
  async function submit() {
    setMsg("");
    if(!agree1||!agree2||!agree3||!agree4) return setMsg("동의 항목을 모두 체크해주세요.");
    const signature=signatureData(canvasRef);
    if(!signature||signature.length<1200) return setMsg("서명을 입력해주세요.");
    const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
    const {error:workTimeConsentError}=await supabase.from("work_time_change_consents").upsert({employee_id:employee.id,consent_version:WORK_TIME_CHANGE_CONSENT_VERSION,notice_text:WORK_TIME_CONSENT_TEXT,detail_text:WORK_TIME_DETAIL_TEXT,signature_data:signature,device_fingerprint_hash:fingerprintHash,device_info:deviceInfo},{onConflict:"employee_id,consent_version"});
    if(workTimeConsentError) return setMsg(friendlySignatureDbError(workTimeConsentError));
    const {error}=await supabase.from("privacy_consents").insert({employee_id:employee.id,consent_location:true,consent_device:true,consent_version:PRIVACY_CONSENT_VERSION,signature_data:signature,device_fingerprint_hash:fingerprintHash,device_info:deviceInfo,is_active:true});
    if(error) return setMsg(error.message);
    onDone();
  }
  return (
    <div className="container"><section className="card" style={{maxWidth:760,margin:"28px auto"}}>
      <h1 className="card-title" style={{display:"block"}}>개인정보 수집·이용 및 위치정보 동의서</h1>
      <p className="subtle">주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를 수집·이용합니다.</p>
      <div className="alert" style={{marginTop:16}}>위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다.</div>
      {msg&&<div className="alert error">{msg}</div>}
      <label className="checkbox"><input type="checkbox" checked={agree1} onChange={e=>setAgree1(e.target.checked)} /> 개인정보 및 위치정보 수집·이용에 동의합니다.</label>
      <label className="checkbox"><input type="checkbox" checked={agree2} onChange={e=>setAgree2(e.target.checked)} /> 위치·기기 정보는 근태 확인 목적 외로 사용하지 않는다는 설명을 확인했습니다.</label>
      <label className="checkbox"><input type="checkbox" checked={agree3} onChange={e=>setAgree3(e.target.checked)} /> {OVERTIME_COMP_CONSENT_CHECK_TEXT}</label>
      <label className="checkbox"><input type="checkbox" checked={agree4} onChange={e=>setAgree4(e.target.checked)} /> {WORK_TIME_CONSENT_CHECK_TEXT}</label>
      <div className="consent-detail-stack">
        <ConsentDetailToggle title="개인정보·위치정보 상세 설명" open={showPrivacyDetail} onToggle={()=>setShowPrivacyDetail(v=>!v)}>
          <div className="type-desc work-time-detail work-time-detail-space">
            출퇴근 처리와 근태 확인을 위해 직원 정보, 기기 정보, 출근·퇴근 시점의 위치정보를 수집·이용합니다.
            <br />
            위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 수집되며, 실시간 위치 추적에는 사용하지 않습니다.
          </div>
        </ConsentDetailToggle>
        <ConsentDetailToggle title="추가근무·대체휴가 상세 설명" open={showOvertimeDetail} onToggle={()=>setShowOvertimeDetail(v=>!v)}>
          <div className="type-desc work-time-detail work-time-detail-space">
            {OVERTIME_COMP_DETAIL_MAIN_TEXT}
            <br />
            <span className="work-time-legal">{OVERTIME_COMP_DETAIL_LEGAL_TEXT}</span>
            <br />
            {OVERTIME_COMP_DETAIL_SIGN_TEXT}
          </div>
        </ConsentDetailToggle>
        <ConsentDetailToggle title="근무조건 변경 상세 설명" open={showWorkTimeDetail} onToggle={()=>setShowWorkTimeDetail(v=>!v)}>
          <WorkTimeDetailBlock className="work-time-detail-space" />
        </ConsentDetailToggle>
      </div>
      <div style={{marginTop:18}}><label className="label">서명</label><SignaturePad canvasRef={canvasRef} /></div>
      <div className="actions" style={{marginTop:16}}>
        <button className="button" onClick={submit}>동의하고 시작</button>
        <button className="button secondary" onClick={clear}>서명 다시 쓰기</button>
        <button className="button ghost" onClick={signOut}>로그아웃</button>
      </div>
    </section></div>
  );
}

function WorkTimeConsentModal({ employee, onDone }: { employee:any; onDone:()=>void }) {
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const [showDetail,setShowDetail]=useState(false);
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit() {
    setMsg("");
    const signature=signatureData(canvasRef);
    if(!signature||signature.length<1200) return setMsg("서명을 입력해주세요.");
    setBusy(true);
    const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
    const {error}=await supabase.from("work_time_change_consents").upsert({
      employee_id:employee.id,
      consent_version:WORK_TIME_CHANGE_CONSENT_VERSION,
      notice_text:WORK_TIME_CONSENT_TEXT,
      detail_text:WORK_TIME_DETAIL_TEXT,
      signature_data:signature,
      device_fingerprint_hash:fingerprintHash,
      device_info:deviceInfo,
    },{onConflict:"employee_id,consent_version"});
    setBusy(false);
    if(error) setMsg(friendlySignatureDbError(error)); else onDone();
  }
  return (
    <div className="modal-backdrop">
      <div className="modal-box work-consent-modal" onClick={e=>e.stopPropagation()}>
        <div className="popup-mark"><i className="ti ti-check" aria-hidden="true"></i></div>
        <h2 className="card-title" style={{display:"block",marginBottom:8}}>근무시간 변경 안내</h2>
        <p className="body-text">{WORK_TIME_CONSENT_TEXT}</p>
        <div className="alert" style={{margin:"13px 0 0"}}>
          기존 직원에게 필요한 필수 확인 절차입니다. 서명을 완료해야 출퇴근, 휴가, 추가근무 등 다른 메뉴를 이용할 수 있습니다.
        </div>
        <button className="collapsible-btn" style={{marginTop:13}} onClick={()=>setShowDetail(v=>!v)}>
          상세 설명 보기
          <i className={`ti ${showDetail?"ti-chevron-up":"ti-chevron-down"}`} style={{marginLeft:"auto"}} aria-hidden="true"></i>
        </button>
        {showDetail&&<WorkTimeDetailBlock className="work-time-detail-space" />}
        <div style={{marginTop:14}}>
          <label className="label">서명</label>
          <SignaturePad canvasRef={canvasRef} />
        </div>
        {msg&&<div className="alert error" style={{marginTop:12}}>{msg}</div>}
        <div className="actions" style={{marginTop:14}}>
          <button className="button full" disabled={busy} onClick={submit}>확인하고 서명하기</button>
          <button className="button ghost full" disabled={busy} onClick={()=>clearSignature(canvasRef)}>서명 다시 쓰기</button>
        </div>
      </div>
    </div>
  );
}

function AttendanceCorrectionSignModal({ employee, request, onDone }: { employee:any; request:any; onDone:()=>void }) {
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const [showDetail,setShowDetail]=useState(true);
  const [note,setNote]=useState("");
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit() {
    setMsg("");
    const signature=signatureData(canvasRef);
    if(!signature||signature.length<1200) return setMsg("서명을 입력해주세요.");
    setBusy(true);
    try {
      const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
      const {error}=await supabase.rpc("sign_attendance_correction_request",{
        p_request_id:request.id,
        p_signature_data:signature,
        p_signer_note:note.trim()||null,
        p_device_fingerprint_hash:fingerprintHash,
        p_device_info:deviceInfo,
      });
      if(error) throw error;
      onDone();
    } catch(e:any) {
      setMsg(friendlySignatureDbError(e));
    } finally {
      setBusy(false);
    }
  }
  async function objectRequest() {
    const signerNote=window.prompt("실제 출퇴근 시간과 다른 부분을 적어주세요.", note||"정정 요청 시각이 실제 근로시간과 다릅니다.");
    if(signerNote===null) return;
    setBusy(true); setMsg("");
    try {
      const {error}=await supabase.rpc("object_attendance_correction_request",{p_request_id:request.id,p_signer_note:signerNote});
      if(error) throw error;
      onDone();
    } catch(e:any) {
      setMsg(friendlySignatureDbError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <div className="modal-box work-consent-modal" onClick={e=>e.stopPropagation()}>
        <div className="popup-mark"><i className="ti ti-pencil-check" aria-hidden="true"></i></div>
        <h2 className="card-title" style={{display:"block",marginBottom:8}}>출퇴근 기록 정정 확인</h2>
        <p className="body-text">관리자가 출퇴근 버튼 누락 또는 오입력으로 판단한 기록 정정을 요청했습니다. 실제 근로시간과 맞는지 확인한 뒤 서명해주세요.</p>
        <div className="alert" style={{margin:"13px 0 0"}}>서명 전에는 정정 기록이 최종 반영되지 않습니다. 다르면 이의제기를 눌러 사유를 남겨주세요.</div>
        <div className="consent-preview" style={{marginTop:13}}>
          <dl>
            <div><dt>직원</dt><dd>{employee.name}</dd></div>
            <div><dt>근무일</dt><dd>{request.work_date}</dd></div>
            <div><dt>구분</dt><dd>{attendanceCorrectionTypeLabel(request.correction_type)}</dd></div>
          </dl>
          <div className="type-desc">{attendanceCorrectionTimeLine(request)}<br/>사유: {request.reason||"-"}{request.evidence_note?<><br/>확인 자료: {request.evidence_note}</>:null}</div>
        </div>
        <button className="collapsible-btn" style={{marginTop:13}} onClick={()=>setShowDetail(v=>!v)}>
          상세 설명 보기
          <i className={`ti ${showDetail?"ti-chevron-up":"ti-chevron-down"}`} style={{marginLeft:"auto"}} aria-hidden="true"></i>
        </button>
        {showDetail&&<div className="type-desc work-time-detail work-time-detail-space" style={{whiteSpace:"pre-wrap"}}>{ATTENDANCE_CORRECTION_DETAIL_TEXT}</div>}
        <div className="form-row" style={{marginTop:14}}>
          <label className="label">메모</label>
          <textarea className="textarea compact-textarea" value={note} onChange={e=>setNote(e.target.value)} placeholder="필요하면 확인 메모를 적어주세요." />
        </div>
        <div style={{marginTop:14}}><label className="label">서명</label><SignaturePad canvasRef={canvasRef} /></div>
        {msg&&<div className="alert error" style={{marginTop:12}}>{msg}</div>}
        <div className="actions" style={{marginTop:14}}>
          <button className="button full" disabled={busy} onClick={submit}>확인하고 서명하기</button>
          <button className="button ghost full" disabled={busy} onClick={()=>clearSignature(canvasRef)}>서명 다시 쓰기</button>
          <button className="button danger full" disabled={busy} onClick={objectRequest}>이의제기</button>
        </div>
      </div>
    </div>
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
  const [earlyCheckoutAsk,setEarlyCheckoutAsk] = useState<any|null>(null);
  const [recheckMode,setRecheckMode] = useState(false);
  const [compTimeRows,setCompTimeRows] = useState<any[]>([]);
  const [todayOverrides,setTodayOverrides] = useState<any[]>([]);
  const [workTimeChanges,setWorkTimeChanges] = useState<any[]>([]);
  const [attendanceCorrectionRequests,setAttendanceCorrectionRequests] = useState<any[]>([]);
  const [todayTasks,setTodayTasks] = useState<any[]>([]);
  const [todoDraft,setTodoDraft] = useState({title:"",content:""});
  const [todoMessage,setTodoMessage] = useState("");
  const [todoTargetEmployeeId,setTodoTargetEmployeeId] = useState("");
  const [todoEmployees,setTodoEmployees] = useState<any[]>([]);
  const [roleGuideEntries,setRoleGuideEntries] = useState<any[]>([]);
  const [notificationPermission,setNotificationPermission] = useState<NotificationPermission|"unsupported">("unsupported");
  const [lastReminderMessage,setLastReminderMessage] = useState("");
  const sentReminderKeys = useRef<Set<string>>(new Set());
  const todayTask = employee.role==="admin"
    ? (todayTasks.find((task:any)=>String(task.target_employee_id??"")===todoTargetEmployeeId)??null)
    : (todayTasks.find((task:any)=>!task.target_employee_id||task.target_employee_id===employee.id)??null);
  const todoTargetLabel = todoTargetEmployeeId
    ? (todoEmployees.find((e:any)=>e.id===todoTargetEmployeeId)?.name??"선택 직원")
    : "전체 직원";
  function todoTaskTargetLabel(task:any) {
    return task?.target_employee_id
      ? (todoEmployees.find((e:any)=>e.id===task.target_employee_id)?.name??"선택 직원")
      : "전체 직원";
  }

  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return()=>clearInterval(t); },[]);
  useEffect(()=>{
    if(employee.role==="admin") setTodoDraft({title:todayTask?.title??"",content:todayTask?.content??""});
  },[employee.role,todoTargetEmployeeId,todayTask?.id,todayTask?.updated_at]);
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
    const [{data:places},{data:logs},{data:openLogs},{data:compRows},{data:overrides},{data:changes},{data:taskRows},{data:rnrRows},{data:correctionRows,error:correctionError}]=await Promise.all([
      supabase.from("workplaces").select("*").neq("approval_status","rejected").eq("is_active",true).order("name"),
      supabase.from("attendance_logs").select("*, workplaces(name,type)").eq("employee_id",employee.id).order("check_in_time",{ascending:false}).limit(10),
      supabase.from("attendance_logs").select("*, workplaces(name,type)").eq("employee_id",employee.id).is("check_out_time",null).order("check_in_time",{ascending:false}),
      supabase.from("comp_time_requests").select("*").eq("employee_id",employee.id).eq("work_date",today).in("status",["pending","approved"]).order("start_time"),
      supabase.from("weekly_schedule_overrides").select("*").eq("employee_id",employee.id).eq("week_start",weekStartIso(today)).limit(1),
      supabase.from("work_time_change_requests").select("*").eq("employee_id",employee.id).eq("status","approved").order("created_at",{ascending:false}).limit(100),
      supabase.from("daily_tasks").select("*").eq("task_date",today).eq("is_active",true).order("created_at",{ascending:false}).limit(100),
      supabase.from("rnr_entries").select("*").eq("is_active",true).order("created_at",{ascending:false}).limit(80),
      supabase.from("attendance_correction_requests").select("*").eq("employee_id",employee.id).eq("status","pending").order("created_at",{ascending:true}).limit(10),
    ]);
    setWorkplaces(places??[]);
    setCompTimeRows(compRows??[]);
    setTodayOverrides(overrides??[]);
    setWorkTimeChanges(changes??[]);
    setAttendanceCorrectionRequests(correctionError?[]:correctionRows??[]);
    setTodayTasks(taskRows??[]);
    if(employee.role==="admin"){
      const {data:todoEmployeeRows}=await supabase.from("employees").select("id,name,employee_no").eq("employment_status","active").order("name");
      setTodoEmployees(todoEmployeeRows??[]);
    } else {
      setTodoEmployees([]);
    }
    const employeeDept=String(employee.department??"").trim();
    const employeePosition=String(employee.position??"").trim();
    setRoleGuideEntries((rnrRows??[]).filter((entry:any)=>
      entry.assigned_employee_id===employee.id ||
      (!!employeeDept&&String(entry.department??"").trim()===employeeDept) ||
      (!!employeePosition&&String(entry.position??"").trim()===employeePosition)
    ).slice(0,5));
    const currentOpenLogs=(openLogs??[]).filter((log:any)=>logAppliesToCurrentEmployment(log,employee));
    const currentLogs=(logs??[]).filter((log:any)=>logAppliesToCurrentEmployment(log,employee));
    const merged=uniqueLogs([...currentOpenLogs, ...currentLogs]).sort(byCheckInDesc);
    setOpenLogRows(currentOpenLogs);
    setTodayLog(merged.find((l:any)=>isToday(l.check_in_time))??null);
    setRecentLogs(merged.filter((l:any)=>!isToday(l.check_in_time)).slice(0,5));
    await loadDevices();
  }
  useEffect(()=>{ load(); },[]);
  async function handleAttendanceCorrectionDone() {
    setMessage("출퇴근 기록 정정 확인이 처리되었습니다.");
    await load();
  }

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
  function selectTodoTarget(targetEmployeeId:string) {
    setTodoTargetEmployeeId(targetEmployeeId);
    setTodoMessage("");
    const nextTask=todayTasks.find((task:any)=>String(task.target_employee_id??"")===targetEmployeeId)??null;
    setTodoDraft({title:nextTask?.title??"",content:nextTask?.content??""});
  }
  async function saveTodayTask() {
    if(employee.role!=="admin") return;
    setTodoMessage("");
    const title=todoDraft.title.trim();
    const content=todoDraft.content.trim();
    if(!title&&!content) return setTodoMessage("오늘의 할일 제목과 내용을 입력해주세요.");
    const saveTitle=title||"오늘의 할일";
    const saveContent=content;
    const target_employee_id=todoTargetEmployeeId||null;
    const payload={task_date:todayIso(),title:saveTitle,content:saveContent,is_active:true,created_by:employee.id,target_employee_id};
    const result=todayTask?.id
      ? await supabase.from("daily_tasks").update({title:saveTitle,content:saveContent,is_active:true,target_employee_id,updated_at:new Date().toISOString()}).eq("id",todayTask.id).select().single()
      : await supabase.from("daily_tasks").insert(payload).select().single();
    if(result.error) setTodoMessage(result.error.message);
    else { setTodoMessage("오늘의 할일이 저장되었습니다."); await load(); }
  }
  async function hideTodayTask() {
    if(employee.role!=="admin"||!todayTask?.id) return;
    const {error}=await supabase.from("daily_tasks").update({is_active:false,updated_at:new Date().toISOString()}).eq("id",todayTask.id);
    if(error) setTodoMessage(error.message);
    else { setTodoDraft({title:"",content:""}); setTodoMessage("오늘의 할일을 숨겼습니다."); await load(); }
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
    if(todayLog?.check_in_time&&todayLog?.check_out_time) {
      setMessage("오늘 출근과 퇴근이 모두 완료되어 다시 출근할 수 없습니다.");
      return;
    }
    if(todayLog?.check_in_time&&!todayLog?.check_out_time) { setRecheckAsk(todayLog); return; }
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
  const reminderTarget=checkoutReminderTarget(todayLog,employee,todayOverrides,compTimeRows,workTimeChanges);
  const reminderTargetTime=reminderTarget?.getTime() ?? null;
  const activeCompRows=compTimeRows.filter((request:any)=>request.status==="approved");
  const reminderOffsets=[-5,5,15,30];

  function handleCheckoutClick() {
    if(!checkedIn) {
      if(openLogs[0]) closeSpecificLog(openLogs[0]);
      return;
    }
    if(reminderTargetTime&&Date.now()<reminderTargetTime) {
      setEarlyCheckoutAsk({targetTime:new Date(reminderTargetTime).toISOString()});
      return;
    }
    checkOut();
  }
  async function confirmEarlyCheckout() {
    setEarlyCheckoutAsk(null);
    await checkOut();
  }

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
      {attendanceCorrectionRequests[0]&&<AttendanceCorrectionSignModal employee={employee} request={attendanceCorrectionRequests[0]} onDone={handleAttendanceCorrectionDone} />}
      <section className="card">
        <p className="date-line">{now.toLocaleDateString("ko-KR",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
        <div className="clock">{clockText(now)}</div>
        <div className="today-times">
          <div className="today-time-item"><span className="today-time-label">출근</span><span className="today-time-val">{checkedIn?timeOnly(todayLog.check_in_time):"--:--"}</span></div>
          <div className="today-time-item"><span className="today-time-label">퇴근</span><span className="today-time-val">{checkedOut?timeOnly(todayLog.check_out_time):"--:--"}</span></div>
          {worked!=null&&<div className="today-time-item"><span className="today-time-label">실근무</span><span className="today-time-val" style={{fontSize:17}}>{fmtMin(worked)}</span></div>}
        </div>
        {roleGuideEntries.length>0&&(
          <div className="role-guide-card">
            <div><b>내 업무 안내</b><span>{roleGuideEntries[0].position||roleGuideEntries[0].department||"역할"} 기준으로 정리된 업무가 있습니다.</span></div>
            <ul>{roleGuideEntries.slice(0,3).map((entry:any)=><li key={entry.id}>{entry.title}</li>)}</ul>
          </div>
        )}
        <div className="punch-grid">
          <button className="button punch" disabled={busy||hasBlockingOpenLog||(checkedIn&&checkedOut)} onClick={handleCheckInClick}>출근하기</button>
          <button className="button secondary punch" disabled={busy||openLogs.length===0} onClick={handleCheckoutClick}>퇴근하기</button>
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
        {earlyCheckoutAsk&&(<ConfirmModal title="아직 퇴근 시간이 아닙니다" confirmText="퇴근 처리" cancelText="취소" busy={busy} onCancel={()=>setEarlyCheckoutAsk(null)} onConfirm={confirmEarlyCheckout}>
          <p style={{margin:"0 0 8px"}}>오늘 퇴근 기준 시각은 <b>{timeOnly(earlyCheckoutAsk.targetTime)}</b>입니다.</p>
          <p style={{margin:0}}>지금 퇴근하면 현재 시각으로 퇴근 기록이 저장됩니다.</p>
        </ConfirmModal>)}
      </section>

      <div className="home-side-stack">
      {(employee.role==="admin"||todayTask)&&(
        <section className="card today-task-desktop">
          <h2 className="card-title"><i className="ti ti-clipboard-list" aria-hidden="true"></i>오늘의 할일</h2>
          {employee.role==="admin"&&todoMessage&&<div className="alert" style={{marginTop:10}}>{todoMessage}</div>}
          {employee.role==="admin" ? (
            <div className="today-task-editor">
              <div className="form-row">
                <label className="label">대상 직원</label>
                <select className="select" value={todoTargetEmployeeId} onChange={e=>selectTodoTarget(e.target.value)}>
                  <option value="">전체 직원</option>
                  {todoEmployees.map(e=><option key={e.id} value={e.id}>{e.name}{e.employee_no?` · ${e.employee_no}`:""}</option>)}
                </select>
              </div>
              <div className="form-row"><label className="label">제목</label><input className="input" value={todoDraft.title} onChange={e=>setTodoDraft({...todoDraft,title:e.target.value})} placeholder="예: 오늘 오전 준비사항" /></div>
              <div className="form-row"><label className="label">내용</label><textarea className="textarea compact-textarea" value={todoDraft.content} onChange={e=>setTodoDraft({...todoDraft,content:e.target.value})} placeholder="직원들이 출근 후 확인할 내용을 적어주세요." /></div>
              <div className="actions">
                {todayTask&&<button className="button danger compact" onClick={hideTodayTask}>숨기기</button>}
                <button className="button compact" onClick={saveTodayTask}>{todayTask?"수정 저장":"저장"}</button>
              </div>
              <p className="subtle" style={{marginTop:8}}>{todoTargetLabel}에게 표시됩니다.</p>
              {todayTasks.length>0&&(
                <div className="today-task-list">
                  <b>오늘 등록된 할일</b>
                  {todayTasks.slice(0,5).map((task:any)=>(
                    <button key={task.id} className="today-task-mini" onClick={()=>selectTodoTarget(String(task.target_employee_id??""))}>
                      <span>{todoTaskTargetLabel(task)}</span>
                      <strong>{task.title}</strong>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : todayTask ? (
            <div className="today-task-view">
              <h3>{todayTask.title}</h3>
              <p>{todayTask.content}</p>
            </div>
          ) : (
            <div className="today-task-button">
              <i className="ti ti-plus" aria-hidden="true"></i>
              <span>오늘의 할일</span>
              <b>출근 전에 직원들이 확인할 내용을 적어둘 수 있습니다.</b>
            </div>
          )}
        </section>
      )}

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
    </div>
  );
}

function sameDays(a:string[] = [], b:string[] = []) {
  const left=ALL_DAYS.filter(d=>a.includes(d)).join("|");
  const right=ALL_DAYS.filter(d=>b.includes(d)).join("|");
  return left===right;
}
function workChangePeriodLabel(request:any) {
  return (request?.periods??[]).map((p:any)=>`${p.start_date}~${p.end_date}`).join(" / ") || "-";
}
function isNoWorkChange(request:any) {
  return (request?.new_work_days??[]).length===0 || (Number(request?.total_work_days||0)===0 && Number(request?.weekly_work_hours||0)===0);
}
function workChangeKind(request:any) {
  if(isNoWorkChange(request)) return "근무 안 함";
  const dayChanged=!sameDays(request?.old_work_days??[], request?.new_work_days??[]);
  const timeChanged=timeLabel(request?.old_work_start)!==timeLabel(request?.new_work_start) || timeLabel(request?.old_work_end)!==timeLabel(request?.new_work_end);
  if(dayChanged&&timeChanged) return "근무요일·시간 변경";
  if(dayChanged) return "근무요일 변경";
  if(timeChanged) return "근무시간 변경";
  return "근무조건 변경";
}
function workChangeConditionLabel(request:any) {
  if(isNoWorkChange(request)) return "변경 후: 해당 기간 근무 없음";
  return `변경 후: ${daysLabel(request?.new_work_days??[])} · ${timeRangeLabel(request?.new_work_start,request?.new_work_end)} · 휴게 ${timeRangeLabel(request?.new_break_start,request?.new_break_end)}`;
}
function workChangePreviousLabel(request:any) {
  return `기존: ${daysLabel(request?.old_work_days??[])} · ${timeRangeLabel(request?.old_work_start,request?.old_work_end)} · 휴게 ${timeRangeLabel(request?.old_break_start,request?.old_break_end)}`;
}
function workChangeWorkloadLabel(request:any) {
  const daily=isNoWorkChange(request)?0:netDailyHours(request?.new_work_start,request?.new_work_end,request?.new_break_start,request?.new_break_end);
  const totalHours=Math.round(daily*Number(request?.total_work_days||0)*10)/10;
  return `근무 ${request?.total_work_days??0}일 · 실근무 ${formatHourValue(totalHours)}시간 · 주 ${formatHourValue(request?.weekly_work_hours||0)}시간`;
}
function workChangeSummaryLine(employee:any,request:any) {
  const daily=isNoWorkChange(request)?0:netDailyHours(request?.new_work_start,request?.new_work_end,request?.new_break_start,request?.new_break_end);
  const totalHours=Math.round(daily*Number(request?.total_work_days||0)*10)/10;
  const period=workChangePeriodLabel(request);
  const reason=String(request?.reason??"").trim();
  return `${employee?.name??"직원"}님 ${period} ${workChangeKind(request)} · 최종 근무 ${request?.total_work_days??0}일, ${formatHourValue(totalHours)}시간${reason?` · 사유 ${reason}`:""}`;
}
function leaveRequestTimeLabel(request:any) {
  const period=`${request.start_date}${request.end_date&&request.end_date!==request.start_date?`~${request.end_date}`:""}`;
  const time=request.start_time?` ${String(request.start_time).slice(0,5)}~${String(request.end_time??"").slice(0,5)}`:"";
  return `${period}${time}`;
}
function isCompLeaveUsageRequest(request:any) {
  return ["comp_leave_use","hourly"].includes(request?.request_type) && Number((request?.amount_hours??0)||0)>0;
}
function leaveTypeDisplayLabel(request:any) {
  if(isCompLeaveUsageRequest(request)) return "대체휴가 시간 사용";
  return requestTypeLabels[request?.request_type]??request?.request_type??"-";
}
function leaveDeductionLabel(request:any) {
  if(isCompLeaveUsageRequest(request)) {
    const hours=Number((request.amount_hours??(Number(request.amount_days||0)*8))||0);
    return `추가근무 적립분 ${formatHourValue(hours)}시간 사용`;
  }
  if(["sick","official","remote","field"].includes(request.request_type)) return "연차 미차감";
  const days=requestToDays(request);
  return days>0 ? `연차 ${formatHourValue(days)}일 차감` : "연차 차감 없음";
}
function classifyRnrCategory(text:string) {
  const normalized=String(text||"").toLowerCase();
  return RNR_CATEGORY_RULES.find(rule=>rule.keywords.some(keyword=>normalized.includes(keyword.toLowerCase())))?.label ?? "기타";
}
function professionalRnrTitle(text:string, category="기타") {
  const clean=String(text||"").trim();
  const normalized=clean
    .replace(/https?:\/\/\S+/g,"")
    .replace(/[“”"']/g,"")
    .replace(/\b(test|테스트)\b/gi,"")
    .replace(/(해줘|해주세요|해라|시켜|시키려고|누구한테|내가|좀|주절주절|해야\s*해?|해놔|해두기|부탁|진행해|정리해)/g," ")
    .replace(/\s+/g," ")
    .trim();
  const categoryPrefix:Record<string,string>={
    회계:"회계",
    세무:"세무",
    서류:"문서",
    인사:"인사",
    운영:"운영",
    홍보:"홍보",
    고객응대:"고객 응대",
    개발:"개발",
    디자인:"디자인",
    AI:"AI 자동화",
    기타:"업무",
  };
  const keywordMap=[
    {re:/영수증|증빙|정산|입금|출금|비용|매출|청구|결제/, title:"증빙 및 정산 자료 관리"},
    {re:/부가세|원천세|세금|세무사|신고/, title:"세무 신고 자료 관리"},
    {re:/디자인|현수막|배너|포스터|시안|이미지|카드뉴스|브랜드/, title:"디자인 제작 자료 관리"},
    {re:/계약서|공문|제출|양식|파일|서류|문서|자료/, title:"문서 및 제출 자료 관리"},
    {re:/근태|휴가|연차|채용|근로계약|급여/, title:"인사·근태 자료 관리"},
    {re:/비품|소모품|재고|교육장|학교|일정|준비|체크|운영/, title:"운영 준비 및 일정 관리"},
    {re:/블로그|인스타|SNS|콘텐츠|홍보|마케팅|광고|제휴/, title:"홍보 콘텐츠 운영 관리"},
    {re:/전화|문의|상담|학부모|고객|안내|응대/, title:"고객 문의 응대 관리"},
    {re:/버그|배포|앱|시스템|기능|개발|오류/, title:"서비스 기능 및 이슈 관리"},
    {re:/AI|자동화|프롬프트|데이터|모델/, title:"AI 자동화 업무 관리"},
  ];
  const matched=keywordMap.find(item=>item.re.test(normalized));
  if(matched) return matched.title;
  const nouns=normalized
    .split(/[\s,，、/·]+/)
    .map(word=>word.replace(/[^가-힣a-zA-Z0-9]/g,""))
    .filter(word=>word.length>=2)
    .filter(word=>!["업무","관리","확인","진행","정리","담당","사람","내용","관련"].includes(word))
    .slice(0,3);
  if(nouns.length>0) return `${nouns.join(" ")} 관리 업무`;
  return `${categoryPrefix[category]??"업무"} 관리 업무`;
}
function rnrDisplayTitle(entry:any) {
  return professionalRnrTitle(`${entry?.raw_input??""} ${entry?.summary??""} ${entry?.title??""}`, entry?.category||classifyRnrCategory(`${entry?.raw_input??""} ${entry?.summary??""} ${entry?.title??""}`));
}
function rnrDutyLine(text:any) {
  const cleaned=String(text||"").trim().replace(/[.!?。]+$/,"");
  if(!cleaned) return "";
  return /업무$/.test(cleaned) ? cleaned : `${cleaned} 업무`;
}
function rnrDescriptionLines(entry:any) {
  const checklist=Array.isArray(entry?.checklist) ? entry.checklist.map(rnrDutyLine).filter(Boolean) : [];
  if(checklist.length>0) return checklist;
  const summary=String(entry?.summary??"").trim();
  if(!summary) return [rnrDutyLine(rnrDisplayTitle(entry))];
  return summary
    .split(/\s*(?:\r?\n+|[.;。]\s*)\s*/)
    .map(rnrDutyLine)
    .filter(Boolean)
    .slice(0,4);
}
function splitWorkTimePromptSegments(text:string) {
  return text.split(/\s*(?:[,，、;；]|\r?\n+|\s+그리고\s+|\s+또는\s+)\s*/).map(part=>part.trim()).filter(Boolean);
}
function parseKoreanDateRange(text:string, index=0) {
  const year=new Date().getFullYear();
  const rangeMatch=text.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일?\s*(?:부터|에서|~|-)\s*(?:(?:(\d{4})년\s*)?(\d{1,2})월\s*)?(\d{1,2})일?\s*(?:까지)?/);
  if(rangeMatch){
    const y1=Number(rangeMatch[1]??year);
    const m1=Number(rangeMatch[2]);
    const d1=Number(rangeMatch[3]);
    const y2=Number(rangeMatch[4]??y1);
    const m2=Number(rangeMatch[5]??m1);
    const d2=Number(rangeMatch[6]);
    return {
      id:`p${Date.now()}-${index}`,
      start_date:`${y1}-${String(m1).padStart(2,"0")}-${String(d1).padStart(2,"0")}`,
      end_date:`${y2}-${String(m2).padStart(2,"0")}-${String(d2).padStart(2,"0")}`,
    };
  }
  const matches=Array.from(text.matchAll(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/g));
  const dates=matches.map(match=>{
    const y=Number(match[1]??year);
    const m=String(Number(match[2])).padStart(2,"0");
    const d=String(Number(match[3])).padStart(2,"0");
    return `${y}-${m}-${d}`;
  });
  if(dates.length>=2) return {id:`p${Date.now()}-${index}`,start_date:dates[0],end_date:dates[1]};
  if(dates.length===1) return {id:`p${Date.now()}-${index}`,start_date:dates[0],end_date:dates[0]};
  return null;
}
function parseKoreanDateRanges(text:string) {
  const segments=splitWorkTimePromptSegments(text);
  const ranges=segments.map((segment,index)=>parseKoreanDateRange(segment,index)).filter(Boolean);
  if(ranges.length>0) return ranges;
  return null;
}
function koreanNumberToInt(value:string) {
  const raw=value.trim().replace(/\s/g,"");
  if(!raw) return null;
  if(/^\d+$/.test(raw)) return Number(raw);
  const simple:Record<string,number>={
    영:0,공:0,
    한:1,하나:1,일:1,
    두:2,둘:2,이:2,
    세:3,셋:3,삼:3,
    네:4,넷:4,사:4,
    다섯:5,오:5,
    여섯:6,육:6,
    일곱:7,칠:7,
    여덟:8,팔:8,
    아홉:9,구:9,
    열:10,
    스무:20,스물:20,
  };
  if(simple[raw]!=null) return simple[raw];
  if(raw.startsWith("스물")) return 20+(simple[raw.slice(2)]??0);
  if(raw.startsWith("스무")) return 20+(simple[raw.slice(2)]??0);
  if(raw.startsWith("열")) return 10+(simple[raw.slice(1)]??0);
  const sino=raw.match(/^(?:(일|이|삼)?십)?(일|이|삼|사|오|육|칠|팔|구)?$/);
  if(sino&&sino[0]){
    const tens=sino[1]?simple[sino[1]]*10:(raw.includes("십")?10:0);
    const ones=sino[2]?simple[sino[2]]:0;
    return tens+ones;
  }
  return null;
}
function parsePromptTime(meridiem:string|undefined,hourText:string,minuteText?:string) {
  let hour=koreanNumberToInt(hourText);
  const minute=minuteText?koreanNumberToInt(minuteText):0;
  if(hour==null||minute==null||hour<0||hour>24||minute<0||minute>59) return null;
  const marker=(meridiem??"").trim();
  if(["오후","저녁","밤","낮"].includes(marker)&&hour<12) hour+=12;
  if(["오전","아침"].includes(marker)&&hour===12) hour=0;
  if(hour===24) hour=0;
  return `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
}
function parsePromptTimeRange(text:string) {
  const timeWord="(?:\\d{1,2}|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|스무|스물(?:한|두|세|네)?|일|이|삼|사|오|육|칠|팔|구|십|이십(?:일|이|삼|사)?)";
  const timePoint=`(?:(오전|오후|아침|낮|저녁|밤)\\s*)?(${timeWord})\\s*(?:시\\s*(?:(\\d{1,2}|[가-힣]{1,4})\\s*분)?|:\\s*(\\d{1,2}))`;
  const re=new RegExp(`${timePoint}\\s*(?:부터|에서|~|-)\\s*${timePoint}`);
  const match=text.match(re);
  if(!match) return null;
  const start=parsePromptTime(match[1],match[2],match[3]??match[4]);
  let end=parsePromptTime(match[5],match[6],match[7]??match[8]);
  if(start&&end&&!match[5]){
    const startMinutes=timeToMinutes(start);
    const endMinutes=timeToMinutes(end);
    if(startMinutes!=null&&endMinutes!=null&&endMinutes<=startMinutes) end=minutesToTime(endMinutes+12*60);
  }
  return start&&end?{start,end}:null;
}
function parsePromptTimeRanges(text:string) {
  const ranges=splitWorkTimePromptSegments(text).map(parsePromptTimeRange).filter(Boolean);
  if(ranges.length>0) return ranges;
  const fallback=parsePromptTimeRange(text);
  return fallback?[fallback]:[];
}
function parseWorkTimeChangePrompt(text:string, oldDays:string[]) {
  const normalized=text.trim();
  const parsed:any={};
  const ranges=parseKoreanDateRanges(normalized);
  if(ranges) parsed.periods=ranges;
  if(/근무\s*안|일\s*안|안\s*함|휴무|쉬는|쉼/.test(normalized)) parsed.mode="no_work";
  const weekdayMatches=Array.from(normalized.matchAll(/(월요일|화요일|수요일|목요일|금요일|토요일|일요일)/g)).map(match=>match[1].slice(0,1));
  const keyByLabel:Record<string,string>={월:"mon",화:"tue",수:"wed",목:"thu",금:"fri",토:"sat",일:"sun"};
  if(weekdayMatches.length>=2 && /변경|이동|바꿔|바꾸/.test(normalized)){
    const from=keyByLabel[weekdayMatches[0]];
    const to=keyByLabel[weekdayMatches[1]];
    if(from&&to) parsed.newDays=ALL_DAYS.filter(day=>(oldDays.includes(day)&&day!==from)||day===to);
    parsed.mode="date_change";
  }
  const timeRanges=parsePromptTimeRanges(normalized);
  const timeRange=timeRanges[0];
  if(timeRange){
    parsed.start=timeRange.start;
    parsed.end=timeRange.end;
    parsed.mode=parsed.mode??"work_time";
    const hasDifferentTimes=timeRanges.some(range=>range?.start!==timeRange.start||range?.end!==timeRange.end);
    if(hasDifferentTimes) parsed.warning="적용기간은 나누어 반영했지만, 요청 1건에는 하나의 근무시간만 저장됩니다. 기간별 시간이 다르면 요청을 따로 작성해주세요.";
  }
  return parsed;
}
function buildWorkTimeChangeDocument(employee:any, periods:any[], newDays:string[], newStart:string, newEnd:string, newBreakStart:string, newBreakEnd:string, reason:string, changeMode="work_time") {
  const oldDays=employee.work_days??["mon","tue","wed","thu","fri"];
  return [
    "근로시간 변경 요청 및 합의서",
    "",
    `근로자: ${employee.name} (${employee.employee_no})`,
    `신청일: ${todayIso()}`,
    "",
    "1. 변경 전 근무조건",
    `- 근무 시작일: ${employeeContractStart(employee)}`,
    `- 근무 종료일: ${employeeContractEnd(employee)??"정해진 종료일 없음"}`,
    `- 근무요일: ${daysLabel(oldDays)}`,
    `- 근무시간: ${timeRangeLabel(employee.work_start??"09:00", employee.work_end??"18:00")}`,
    "- 휴게시간: 12:00 ~ 13:00",
    "",
    "2. 변경 후 근무조건",
    `- 변경 유형: ${WORK_TIME_CHANGE_MODE_LABELS[changeMode]??"근무조건 변경"}`,
    `- 적용기간: ${periods.map((p:any)=>`${p.start_date} ~ ${p.end_date} (${p.total_days}일, 근무 예정 ${p.work_days_count}일)`).join(" / ")}`,
    `- 근무요일: ${daysLabel(newDays)}`,
    `- 근무시간: ${timeRangeLabel(newStart,newEnd)}`,
    `- 휴게시간: ${timeRangeLabel(newBreakStart,newBreakEnd)}`,
    `- 주 소정근로시간: ${(netDailyHours(newStart,newEnd,newBreakStart,newBreakEnd)*newDays.length).toFixed(1)}시간`,
    "",
    "3. 확인 및 동의",
    "본인은 위 변경 내용이 본인의 요청 또는 회사와의 합의에 따른 것임을 확인합니다.",
    "본 동의는 위에 기재된 변경 내용에 한하여 유효하며, 향후 추가 변경이 필요한 경우 별도의 요청 및 동의 절차를 거쳐야 합니다.",
    "본 동의는 연장근로, 야간근로, 휴일근로에 대한 사전 포괄 동의가 아닙니다.",
    "",
    `변경 사유: ${reason || "-"}`,
  ].join("\n");
}

function WorkTimeChangePage({ employee }: { employee:any }) {
  const isAdmin=employee.role==="admin";
  const [selectableEmployees,setSelectableEmployees]=useState<any[]>([employee]);
  const [selectedEmployeeId,setSelectedEmployeeId]=useState(employee.id);
  const [requests,setRequests]=useState<any[]>([]);
  const [changeMode,setChangeMode]=useState("work_time");
  const [naturalText,setNaturalText]=useState("");
  const [manualDays,setManualDays]=useState<string[]|null>(null);
  const [periods,setPeriods]=useState([{id:"p1",start_date:todayIso(),end_date:todayIso()}]);
  const [newStart,setNewStart]=useState(timeLabel(employee.work_start??"09:00"));
  const [newEnd,setNewEnd]=useState(timeLabel(employee.work_end??"18:00"));
  const [newBreakStart,setNewBreakStart]=useState("12:00");
  const [newBreakEnd,setNewBreakEnd]=useState("13:00");
  const [reason,setReason]=useState("");
  const [showDetail,setShowDetail]=useState(false);
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const selectedEmployee=selectableEmployees.find(e=>e.id===selectedEmployeeId)??employee;
  const oldDays=selectedEmployee.work_days??["mon","tue","wed","thu","fri"];
  const oldStart=timeLabel(selectedEmployee.work_start??"09:00");
  const oldEnd=timeLabel(selectedEmployee.work_end??"18:00");
  const oldContractStart=employeeContractStart(selectedEmployee);
  const oldContractEnd=employeeContractEnd(selectedEmployee);
  const periodDays=daysFromPeriods(periods);
  const newDays=manualDays??periodDays;
  const effectiveNewDays=changeMode==="no_work"?[]:(newDays.length>0?newDays:oldDays);
  const periodPayload=periods.map(p=>{const s=countDaysInRange(p.start_date,p.end_date,effectiveNewDays); return {...p,total_days:s.totalDays,work_days_count:s.workDays};});
  const totals=summarizePeriods(periods,effectiveNewDays);
  const weeklyHours=Math.round(netDailyHours(newStart,newEnd,newBreakStart,newBreakEnd)*effectiveNewDays.length*10)/10;

  async function load() {
    const {data}=await supabase.from("work_time_change_requests").select("*").eq("employee_id",selectedEmployee.id).order("created_at",{ascending:false});
    setRequests(data??[]);
  }
  async function loadSelectableEmployees() {
    if(!isAdmin) return setSelectableEmployees([employee]);
    const {data,error}=await supabase.from("employees").select("*").eq("employment_status","active").order("name");
    if(error||!data?.length) setSelectableEmployees([employee]);
    else setSelectableEmployees(data);
  }
  useEffect(()=>{loadSelectableEmployees();},[]);
  useEffect(()=>{load();},[selectedEmployee.id]);
  useEffect(()=>{
    setNewStart(timeLabel(selectedEmployee.work_start??"09:00"));
    setNewEnd(timeLabel(selectedEmployee.work_end??"18:00"));
    setNewBreakStart("12:00");
    setNewBreakEnd("13:00");
    setChangeMode("work_time");
    setNaturalText("");
    setManualDays(null);
    setPeriods([{id:"p1",start_date:todayIso(),end_date:todayIso()}]);
    setReason("");
    clearSignature(canvasRef);
  },[selectedEmployee.id]);
  function updatePeriod(id:string,patch:Record<string,string>){setManualDays(null);setPeriods(list=>list.map(p=>p.id===id?{...p,...patch}:p));}
  function mergePeriodLists(current:any[], next:any[]) {
    const base=current.length===1&&current[0].id==="p1"&&current[0].start_date===todayIso()&&current[0].end_date===todayIso()?[]:current;
    const merged=[...base];
    next.forEach((period:any)=>{
      const exists=merged.some((item:any)=>item.start_date===period.start_date&&item.end_date===period.end_date);
      if(!exists) merged.push({...period,id:`p${Date.now()}-${merged.length}`});
    });
    return merged.length>0?merged:current;
  }
  function applyParsedNaturalDraft(parsed:any, appendPeriods=false) {
    if(parsed.mode) setChangeMode(parsed.mode);
    if(parsed.periods) setPeriods(list=>appendPeriods?mergePeriodLists(list,parsed.periods):parsed.periods);
    if(parsed.newDays) setManualDays(parsed.newDays);
    if(parsed.mode==="no_work") setManualDays([]);
    if(parsed.start) setNewStart(parsed.start);
    if(parsed.end) setNewEnd(parsed.end);
    if(parsed.warning) setMsg(parsed.warning);
  }
  function addPeriod(){
    if(naturalText.trim()){
      const parsed=parseWorkTimeChangePrompt(naturalText,oldDays);
      if(parsed.periods?.length){
        setMsg("");
        applyParsedNaturalDraft(parsed,true);
        return;
      }
    }
    setManualDays(null);
    setPeriods(list=>[...list,{id:`p${Date.now()}`,start_date:todayIso(),end_date:todayIso()}]);
  }
  function removePeriod(id:string){setPeriods(list=>list.length===1?list:list.filter(p=>p.id!==id));}
  function applyNaturalDraft() {
    const parsed=parseWorkTimeChangePrompt(naturalText,oldDays);
    if(!naturalText.trim()) return setMsg("변경 내용을 한 문장으로 적어주세요.");
    const hasDraft=parsed.mode||parsed.periods||parsed.newDays||parsed.start||parsed.end;
    if(!hasDraft) return setMsg("날짜, 시간, 근무 안함, 요일 변경 중 하나를 포함해 적어주세요.");
    setMsg("");
    applyParsedNaturalDraft(parsed,false);
  }
  async function submit() {
    setMsg("");
    if(changeMode!=="no_work"&&effectiveNewDays.length===0) return setMsg("변경 후 근무요일을 확인해주세요.");
    if(periods.some(p=>!p.start_date||!p.end_date||p.end_date<p.start_date)) return setMsg("적용기간의 시작일과 종료일을 확인해주세요.");
    if(!newStart||!newEnd) return setMsg("변경 후 근무시간을 입력해주세요.");
    if(breakMinutes(newBreakStart,newBreakEnd) < 0) return setMsg("휴게시간을 확인해주세요.");
    const noScheduleChange=sameDays(effectiveNewDays,oldDays)&&newStart===oldStart&&newEnd===oldEnd&&newBreakStart==="12:00"&&newBreakEnd==="13:00";
    if(changeMode!=="no_work"&&noScheduleChange) return setMsg("변경된 근무조건이 없습니다. 날짜, 근무요일, 근무시간 중 변경 내용을 입력해주세요.");
    const signature=signatureData(canvasRef);
    if(!signature||signature.length<1200) return setMsg("자필 서명을 입력해주세요.");
    setBusy(true);
    const documentText=buildWorkTimeChangeDocument(selectedEmployee,periodPayload,effectiveNewDays,newStart,newEnd,newBreakStart,newBreakEnd,reason,changeMode);
    const {error}=await supabase.from("work_time_change_requests").insert({
      employee_id:selectedEmployee.id,
      old_work_days:oldDays,
      old_work_start:oldStart,
      old_work_end:oldEnd,
      old_break_start:"12:00",
      old_break_end:"13:00",
      new_work_days:effectiveNewDays,
      new_work_start:newStart,
      new_work_end:newEnd,
      new_break_start:newBreakStart,
      new_break_end:newBreakEnd,
      periods:periodPayload,
      total_calendar_days:totals.totalDays,
      total_work_days:totals.workDays,
      weekly_work_hours:weeklyHours,
      reason,
      legal_notice_version:WORK_TIME_LEGAL_NOTICE_VERSION,
      document_text:documentText,
      signature_data:signature,
      status:"pending",
    });
    setBusy(false);
    if(error) setMsg(error.message);
    else {
      setMsg("근무시간 변경 요청이 저장되었습니다. 회사 승인 후 적용됩니다.");
      clearSignature(canvasRef);
      setReason("");
      await load();
    }
  }

  return (
    <div className="grid worktime-page">
      {msg&&<div className={`alert ${msg.includes("저장")?"success":""}`}>{msg}</div>}
      <section className="card work-change-card">
        <div className="work-change-title">
          <div>
            <h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-calendar-time" aria-hidden="true"></i>근무시간 변경 요청</h2>
            <p className="subtle">직원이 요청하고 회사가 승인한 기록으로 저장됩니다.</p>
          </div>
          <span className="badge">작성중</span>
        </div>

        {isAdmin ? (
          <div className="form-row">
            <label className="label">직원 이름</label>
            <select className="select" value={selectedEmployeeId} onChange={e=>setSelectedEmployeeId(e.target.value)}>
              {selectableEmployees.map(e=><option key={e.id} value={e.id}>{e.name}{e.employee_no?` · ${e.employee_no}`:""}</option>)}
            </select>
          </div>
        ) : (
          <div className="type-desc work-change-guide">
            <b>{selectedEmployee.name} 본인 요청</b>
            <span>로그인한 직원 계정으로 자동 접수됩니다.</span>
          </div>
        )}

        <div className="work-section-head">
          <h3>기존 근무조건</h3>
          <span className="locked-badge">자동 기입</span>
        </div>
        <div className="readonly-grid">
          <div className="readonly-field"><span>기준</span><b>근로계약서 기준</b></div>
          <div className="readonly-field"><span>근무 시작일</span><b>{oldContractStart}</b></div>
          <div className="readonly-field"><span>근무 종료일</span><b>{oldContractEnd??"정해진 종료일 없음"}</b></div>
          <div className="readonly-field"><span>근무요일</span><b>{daysLabel(oldDays)}</b></div>
          <div className="readonly-field"><span>근무시간</span><b>{timeRangeLabel(oldStart,oldEnd)}</b></div>
          <div className="readonly-field"><span>휴게시간</span><b>12:00 ~ 13:00</b></div>
        </div>

        <div className="work-section-head">
          <h3>변경 후 근무조건</h3>
        </div>
        <div className="type-desc work-change-guide">
          <span className="work-change-guide-line">아래 입력칸에 “7월 7일부터 8일까지 오전 열시부터 오후 여덟시까지 근무”처럼 적고 초안을 누르면 적용기간과 시간이 자동으로 채워집니다.</span>
          <span className="work-change-guide-line">여러 기간은 쉼표로 이어 적을 수 있습니다. 예: “8월 7일부터 8월 10일까지 오전 열한시부터 오후 여덟시까지 근무, 7월 7일 오전 열한시부터 오후 여덟시까지 근무”</span>
        </div>

        <div className="natural-change-box">
          <div className="grid two">
            <div className="form-row"><label className="label">변경 유형</label>
              <select className="select" value={changeMode} onChange={e=>{setChangeMode(e.target.value); if(e.target.value==="no_work") setManualDays([]); else if(manualDays?.length===0) setManualDays(null);}}>
                {Object.entries(WORK_TIME_CHANGE_MODE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="form-row"><label className="label">한 문장으로 입력</label>
              <div className="input-action-row">
                <input className="input" value={naturalText} onChange={e=>setNaturalText(e.target.value)} placeholder="예: 7월 10일부터 12일까지 근무 안함 / 8월 7일부터 10일까지 오전 열한시부터 오후 여덟시까지 근무" />
                <button className="button secondary compact" onClick={applyNaturalDraft}><i className="ti ti-sparkles" aria-hidden="true"></i>초안</button>
              </div>
            </div>
          </div>
          <p className="subtle" style={{margin:0}}>쉼표로 여러 기간을 적으면 적용기간이 각각 생성됩니다. 변경 사유는 아래 사유 칸에 별도로 적어주세요.</p>
        </div>

        <div className="period-stack">
          {periods.map((p,index)=>{
            const stats=countDaysInRange(p.start_date,p.end_date,effectiveNewDays);
            return (
              <div className="period-card" key={p.id}>
                <div className="grid two">
                  <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={p.start_date} onChange={e=>updatePeriod(p.id,{start_date:e.target.value})} /></div>
                  <div className="form-row"><label className="label">종료일</label><input className="input" type="date" value={p.end_date} onChange={e=>updatePeriod(p.id,{end_date:e.target.value})} /></div>
                </div>
                <div className="period-summary">
                  <div><span>총 적용일</span><b>{stats.totalDays}일</b></div>
                  <div><span>근무 예정일</span><b>{stats.workDays}일</b></div>
                </div>
                {periods.length>1&&<button className="button ghost compact" onClick={()=>removePeriod(p.id)}>기간 삭제</button>}
                {index===periods.length-1&&<button className="add-period-button" onClick={addPeriod}>+ 적용기간 추가</button>}
              </div>
            );
          })}
        </div>

        <div className="form-row"><label className="label">근무요일</label>
          <p className="subtle" style={{margin:"0 0 8px"}}>적용기간에 포함된 날짜 기준으로 자동 선택됩니다.</p>
          <div className="days-grid">{ALL_DAYS.map(d=><button key={d} type="button" disabled className={`day-btn ${effectiveNewDays.includes(d)?"active":""}`}>{DAY_LABELS[d]}</button>)}</div>
        </div>
        <div className="grid two">
          <div className="form-row"><label className="label">근무 시작</label><input className="input" type="time" value={newStart} onChange={e=>setNewStart(e.target.value)} /></div>
          <div className="form-row"><label className="label">근무 종료</label><input className="input" type="time" value={newEnd} onChange={e=>setNewEnd(e.target.value)} /></div>
        </div>
        <div className="grid two">
          <div className="form-row"><label className="label">휴게 시작</label><input className="input" type="time" value={newBreakStart} onChange={e=>setNewBreakStart(e.target.value)} /></div>
          <div className="form-row"><label className="label">휴게 종료</label><input className="input" type="time" value={newBreakEnd} onChange={e=>setNewBreakEnd(e.target.value)} /></div>
        </div>
        <div className="work-change-summary">
          <div><span>주 소정근로시간</span><b>{weeklyHours.toFixed(1)}시간</b></div>
          <div><span>전체 적용</span><b>{totals.totalDays}일 / 근무 {totals.workDays}일</b></div>
        </div>
        <div className="form-row"><label className="label">변경 사유</label><textarea className="textarea" value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 학업 일정, 개인 사정, 매장 운영 일정 조정 등" /></div>

        <button className="collapsible-btn" onClick={()=>setShowDetail(v=>!v)}>
          상세 설명 보기
          <i className={`ti ${showDetail?"ti-chevron-up":"ti-chevron-down"}`} style={{marginLeft:"auto"}} aria-hidden="true"></i>
        </button>
        {showDetail&&<WorkTimeDetailBlock className="work-time-detail-space" />}

        <div style={{marginTop:16}}>
          <label className="label">자필 서명</label>
          <SignaturePad canvasRef={canvasRef} />
        </div>
        <div className="actions" style={{marginTop:16}}>
          <button className="button full" disabled={busy} onClick={submit}>확인하고 서명하기</button>
          <button className="button ghost" disabled={busy} onClick={()=>clearSignature(canvasRef)}>서명 다시 쓰기</button>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-list-details" aria-hidden="true"></i>근무시간 변경 요청 내역</h2>
        {requests.length===0 ? <p className="subtle">요청 내역이 없습니다.</p> : (
          <div className="grid">
            {requests.map(r=>(
              <div className="list-row" key={r.id}>
                <div>
                  <b>{(r.periods??[]).map((p:any)=>`${p.start_date}~${p.end_date}`).join(" / ") || "-"}</b>
                  <div className="subtle">{daysLabel(r.new_work_days??[])} · {timeRangeLabel(r.new_work_start,r.new_work_end)} · 주 {Number(r.weekly_work_hours||0).toFixed(1)}시간</div>
                </div>
                <span className={`badge ${badgeClass(r.status)}`}>{r.status==="pending"?"승인 대기":r.status==="approved"?"승인":"반려"}</span>
              </div>
            ))}
          </div>
        )}
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
  const [compBaseline,setCompBaseline]=useState<any|null>(null);
  const [message,setMessage]=useState("");

  async function load() {
    const [r,a,c]=await Promise.all([
      supabase.from("attendance_requests").select("*").eq("employee_id",employee.id).order("created_at",{ascending:false}),
      supabase.from("leave_adjustments").select("*").eq("employee_id",employee.id).order("created_at",{ascending:false}),
      supabase.from("comp_time_requests").select("*").eq("employee_id",employee.id).order("created_at",{ascending:false}),
    ]);
    setRequests(r.data??[]); setAdjustments(a.data??[]); setCompRequests(c.data??[]);
  }
  useEffect(()=>{load();},[]);
  useEffect(()=>{
    if(mode!=="overtime") return;
    let cancelled=false;
    async function loadCompBaseline(){
      const date=compForm.work_date;
      const dayStart=new Date(`${date}T00:00:00+09:00`).toISOString();
      const dayEnd=new Date(`${date}T23:59:59.999+09:00`).toISOString();
      const [logResult,overrideResult]=await Promise.all([
        supabase.from("attendance_logs").select("check_in_time").eq("employee_id",employee.id).gte("check_in_time",dayStart).lte("check_in_time",dayEnd).order("check_in_time",{ascending:false}).limit(1).maybeSingle(),
        supabase.from("weekly_schedule_overrides").select("*").eq("employee_id",employee.id).eq("week_start",weekStartIso(date)).maybeSingle(),
      ]);
      const workStart=overrideResult.data?.work_start??employee.work_start??"09:00";
      const workEnd=overrideResult.data?.work_end??employee.work_end??"18:00";
      const startMin=timeToMinutes(workStart)??9*60;
      const endMin=timeToMinutes(workEnd)??18*60;
      const shiftMinutes=endMin>startMin?endMin-startMin:(24*60-startMin)+endMin;
      const checkIn=logResult.data?.check_in_time?new Date(logResult.data.check_in_time):null;
      const expectedEnd=checkIn?addMinutes(checkIn,shiftMinutes):kstDateTime(date,workEnd);
      if(cancelled) return;
      const expectedEndHHMM=new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Seoul"}).format(expectedEnd);
      setCompBaseline({hasCheckIn:!!checkIn,checkInTime:checkIn?.toISOString()??null,expectedEndTime:expectedEnd.toISOString(),expectedEndHHMM,shiftMinutes});
      setCompForm(current=>{
        if(current.work_date!==date||(timeToMinutes(current.start_time)??0)>=(timeToMinutes(expectedEndHHMM)??0)) return current;
        const durationMinutes=Math.max(30,Math.round(Number(current.hours||2)*60));
        const nextEnd=Math.min(23*60+59,(timeToMinutes(expectedEndHHMM)??0)+durationMinutes);
        return {...current,start_time:expectedEndHHMM,end_time:minutesToTime(nextEnd),hours:Math.round((nextEnd-(timeToMinutes(expectedEndHHMM)??0))/6)/10};
      });
    }
    loadCompBaseline();
    return ()=>{cancelled=true;};
  },[compForm.work_date,employee.id,employee.work_start,employee.work_end,mode]);

  const ent=calculateLeaveEntitlement(employee.joined_at);
  const adj=calculateAdjustmentDays(adjustments);
  const compEarned=calculateApprovedCompDays(compRequests);
  const approvedUsed=calculateUsedDays(requests,false);
  const pendingUsed=calculateUsedDays(requests,true);
  const automaticAnnual=automaticAnnualLeaveDays(employee,ent);
  const totalGranted=automaticAnnual+adj;
  const remaining=Math.max(0,totalGranted-approvedUsed);
  const expectedRemaining=Math.max(0,totalGranted-pendingUsed);
  const compEarnedHours=Math.round(compEarned*8*10)/10;
  const compUsedHours=requests.filter(r=>isCompLeaveUsageRequest(r)&&r.status==="approved").reduce((s,r)=>s+(r.amount_hours??(r.amount_days??0)*8),0);
  const compRemainHours=Math.max(0,compEarnedHours-compUsedHours);
  const remainPct=totalGranted>0?Math.round((remaining/totalGranted)*100):0;
  const meta=LEAVE_TYPE_META[form.request_type];
  const isSingle=SINGLE_DAY_TYPES.includes(form.request_type);
  const isHourly=form.request_type==="hourly";
  const showLeave=mode==="leave";
  const showOvertime=mode==="overtime";
  const underAnnualLeaveThreshold=isUnderAnnualLeaveThreshold(employee);

  function setType(t:string){
    setForm(f=>{
      const next={...f,request_type:t,
        end_date:SINGLE_DAY_TYPES.includes(t)?f.start_date:f.end_date,
        start_time:t==="half_am"?"09:00":t==="half_pm"?"14:00":f.start_time,
        end_time:t==="half_am"?"14:00":t==="half_pm"?"18:00":f.end_time,
      };
      const hours=timeDiffHours(next.start_time,next.end_time);
      return {...next,amount_hours:t==="hourly"&&hours>0?String(hours):next.amount_hours};
    });
  }
  function handleLeaveTimeChange(field:"start_time"|"end_time",value:string){
    setForm(current=>{
      const next={...current,[field]:value};
      const hours=timeDiffHours(next.start_time,next.end_time);
      return {...next,amount_hours:next.request_type==="hourly"&&hours>0?String(hours):next.amount_hours};
    });
  }

  async function submitLeave() {
    setMessage("");
    const requestedHours=isHourly?Number(form.amount_hours||0):0;
    const effectiveRequestType=isHourly&&compRemainHours>0?"comp_leave_use":form.request_type;
    const m=LEAVE_TYPE_META[effectiveRequestType]??LEAVE_TYPE_META[form.request_type];
    const requestedDays = m?.fixedDays ?? (isHourly ? requestedHours/8 : 1);
    // 잔여 검증 — 휴가 차감형 전체 (연차/반차/시간차/특별/대체/보상)
    if (isHourly && (!requestedHours || requestedHours<=0)) return setMessage("시간차 사용 시간을 입력해주세요.");
    if (effectiveRequestType==="comp_leave_use") {
      if(requestedHours>compRemainHours+1e-9) return setMessage(`대체휴가 잔여 시간(${compRemainHours}시간)이 부족합니다.`);
    } else if (m?.usesLeave) {
      if (requestedDays > expectedRemaining + 1e-9) return setMessage(`잔여 휴가(${expectedRemaining.toFixed(1)}일)가 부족하여 신청할 수 없습니다.`);
    }
    const single = SINGLE_DAY_TYPES.includes(effectiveRequestType);
    const amountHours = isHourly && form.amount_hours ? requestedHours : null;
    const useTimes = ["half_am","half_pm","hourly","comp_leave_use"].includes(effectiveRequestType);
    const {error}=await supabase.from("attendance_requests").insert({
      employee_id:employee.id, request_type:effectiveRequestType,
      start_date:form.start_date, end_date:single?form.start_date:form.end_date,
      start_time: useTimes? form.start_time : null,
      end_time: useTimes? form.end_time : null,
      amount_hours:amountHours, amount_days: m?.fixedDays ?? (amountHours?amountHours/8:null),
      reason:form.reason, status:"pending",
    });
    if(error) setMessage(error.message); else{setMessage(effectiveRequestType==="comp_leave_use"?"대체휴가 시간 사용 신청이 저장되었습니다.":"휴가 신청이 저장되었습니다.");await load();}
  }

  async function useCompLeave() {
    setMessage(""); const hours=Number(form.amount_hours||0);
    if(!hours||hours<=0) return setMessage("사용할 시간을 입력해주세요.");
    if(hours>compRemainHours+1e-9) return setMessage(`대체휴가 잔여 시간(${compRemainHours}시간)이 부족합니다.`);
    const {error}=await supabase.from("attendance_requests").insert({employee_id:employee.id,request_type:"comp_leave_use",start_date:form.start_date,end_date:form.start_date,amount_hours:hours,amount_days:hours/8,reason:form.reason||"대체휴가 시간 사용",status:"pending"});
    if(error) setMessage(error.message); else{setMessage("대체휴가 시간 사용 신청이 저장되었습니다.");await load();}
  }

  function handleCompTimeChange(field:"start_time"|"end_time",val:string){
    const next={...compForm,[field]:val};
    const h=timeDiffHours(next.start_time,next.end_time);
    setCompForm({...next,hours:h>0?h:compForm.hours});
  }
  async function submitCompTime() {
    setMessage("");
    if(!compForm.hours||compForm.hours<=0) return setMessage("추가 근무 시간을 입력해주세요.");
    if(!compBaseline) return setMessage("정상 퇴근 기준을 계산 중입니다. 잠시 후 다시 신청해주세요.");
    const requestedStart=timeToMinutes(compForm.start_time)??0;
    const overtimeStart=timeToMinutes(compBaseline.expectedEndHHMM)??0;
    if(requestedStart<overtimeStart){
      const basis=compBaseline.hasCheckIn
        ? `${timeOnly(compBaseline.checkInTime)} 출근 기준 정상 퇴근은 ${compBaseline.expectedEndHHMM}입니다.`
        : `출근기록이 없어 등록된 스케줄 기준 정상 퇴근은 ${compBaseline.expectedEndHHMM}입니다.`;
      return setMessage(`${basis} ${compBaseline.expectedEndHHMM} 이후 시간만 추가근무로 신청할 수 있습니다.`);
    }
    const startAt=new Date(`${compForm.work_date}T${compForm.start_time}:00`);
    if(new Date().getTime()>=startAt.getTime()) return setMessage("추가근무 신청은 신청 시작 시간 전에만 가능합니다.");
    const duplicate=compRequests.find(r=>r.work_date===compForm.work_date&&r.start_time===compForm.start_time&&r.end_time===compForm.end_time&&["pending","approved"].includes(r.status));
    if(duplicate) return setMessage("이미 신청한 시간입니다. 관리자의 승인을 기다려주세요.");
    const basis=compBaseline.hasCheckIn
      ? `실제 출근 ${timeOnly(compBaseline.checkInTime)} + 정상 근무 ${Math.round(compBaseline.shiftMinutes/6)/10}시간 = 정상 퇴근 ${compBaseline.expectedEndHHMM}`
      : `출근 전이므로 등록 스케줄 기준 정상 퇴근 ${compBaseline.expectedEndHHMM}`;
    if(!window.confirm(`${basis}\n${compBaseline.expectedEndHHMM} 이후부터 추가근무로 인정됩니다.\n\n추가근무를 신청하시겠습니까?\n신청 후 수정이 불가능합니다.`)) return;
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
      {showLeave&&underAnnualLeaveThreshold&&<div className="alert annual-threshold-alert">{annualLeaveThresholdNotice(employee)}</div>}
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
            <p className="subtle leave-period-text">근무 시작일 {employee.joined_at??"-"} · {automaticAnnual>0?ent.description:"자동 연차 미발생"}<br />{automaticAnnual>0?`산정기간 ${ent.periodStart??"-"} ~ ${ent.periodEnd??"-"} (근로기준법 제60조)`:isAnnualLeaveDisabled(employee)?ANNUAL_LEAVE_LEGAL_NOTE:"관리자가 별도로 부여한 특별·대체휴가는 사용할 수 있습니다."}</p>
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
            <div className="alert">
              시간차 휴가는 승인된 추가근무 대체휴가 잔여시간 {compRemainHours}시간에서 자동 차감됩니다.
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
              <div className="form-row"><label className="label">시작 시각</label><input className="input" type="time" value={form.start_time} onChange={e=>handleLeaveTimeChange("start_time",e.target.value)} /></div>
              <div className="form-row"><label className="label">종료 시각</label><input className="input" type="time" value={form.end_time} onChange={e=>handleLeaveTimeChange("end_time",e.target.value)} /></div>
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
          <p className="body-text" style={{marginBottom:14}}>추가근무는 신청 또는 회사 확인 후 건별 승인된 시간만 인정됩니다. 승인된 시간은 앱에서 대체휴가 적립·사용 내역으로 관리됩니다 (8시간 = 1일).</p>
          <div className="alert">※ 추가근무는 시작 시간 전에만 신청할 수 있습니다.<br/>※ 한 번 신청하면 수정이 불가능합니다. 수정이 필요하면 승인 전 취소 후 다시 신청해주세요.</div>
          {compBaseline&&<div className="alert overtime-baseline-alert">
            <b>추가근무 인정 시작: {compBaseline.expectedEndHHMM} 이후</b>
            <span>{compBaseline.hasCheckIn
              ? `${timeOnly(compBaseline.checkInTime)} 출근 · 정상 근무 ${Math.round(compBaseline.shiftMinutes/6)/10}시간 · 정상 퇴근 ${compBaseline.expectedEndHHMM}`
              : "아직 출근기록이 없어 등록된 출근 스케줄 기준으로 계산했습니다."}</span>
          </div>}
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

      {showOvertime&&<section className="card">
        <h2 className="card-title"><i className="ti ti-clock-edit" aria-hidden="true"></i>추가근무 신청 내역</h2>
        {compRequests.length===0?<p className="subtle">신청 내역이 없습니다.</p>:(
          <div className="grid">
            {compRequests.map(r=>(
              <div className="list-row" key={r.id}>
                <div><b>{r.work_date} {r.start_time?.slice(0,5)}~{r.end_time?.slice(0,5)}</b><div className="subtle">{r.hours}시간 → {r.converted_days}일 · {r.reason??"-"}</div></div>
                <div className="actions"><span className={`badge ${badgeClass(r.status)}`}>{statusLabel(r.status)}</span>{r.status==="pending"&&<button className="button ghost" onClick={()=>cancelCompRequest(r.id)}>취소</button>}</div>
              </div>
            ))}
          </div>
        )}
      </section>}

      {showLeave&&<section className="card">
        <h2 className="card-title"><i className="ti ti-list" aria-hidden="true"></i>신청 내역</h2>
        <DataTable rows={[
          ...requests.map(r=>({구분:leaveTypeDisplayLabel(r),기간:`${r.start_date}${r.end_date!==r.start_date?"~"+r.end_date:""}`,시간:r.start_time?`${r.start_time?.slice(0,5)}~${r.end_time?.slice(0,5)}`:"-",환산:r.amount_days!=null&&!isCompLeaveUsageRequest(r)?r.amount_days+"일":r.amount_hours!=null?r.amount_hours+"시간":"-",상태:statusLabel(r.status),사유:r.reason??"-"})),
        ]} />
      </section>}
    </div>
  );
}

function AdminCompGrantCard({currentEmployee,onChanged}:{currentEmployee:any;onChanged?:()=>void}){
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
    else{setMessage(`${empName(form.employee_id)} 직원의 추가근무를 승인 등록하고 대체휴가를 적립했습니다.`);setForm({...form,reason:""});onChanged?.();}
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
  const approvedGroups=Object.entries(workplaceTypeLabels)
    .map(([type,label])=>({type,label,items:approved.filter(w=>w.type===type)}))
    .filter(group=>group.items.length>0);
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
          <h3 style={{margin:0}}>승인된 근무지</h3>
          <button className="button ghost" onClick={load}><i className="ti ti-refresh" aria-hidden="true"></i>새로고침</button>
        </div>
        {approved.length===0&&<p className="subtle">승인된 근무지가 없습니다.</p>}
        {approvedGroups.map(group=>(
          <div className="workplace-category-group" key={group.type}>
            <h4>{group.label}<span>{group.items.length}곳</span></h4>
            {group.items.map(w=>(
              <div className="list-row workplace-row" key={w.id}>
                <div>
                  <b>{w.name}</b>
                  <div className="subtle">{w.address??"주소 없음"} · 반경 {w.radius_m}m · {w.visibility==="private"?"나에게만":"전체 공개"}</div>
                </div>
                {isAdmin&&<div className="actions">
                  <button className="button ghost" title="근무지 수정" onClick={()=>setEditing({...w})}><i className="ti ti-edit" aria-hidden="true"></i>수정</button>
                  <button className="button danger" title="근무지 삭제" onClick={()=>archiveWorkplace(w)}><i className="ti ti-trash" aria-hidden="true"></i>삭제</button>
                </div>}
              </div>
            ))}
          </div>
        ))}
        <h3>승인 대기 {pending.length>0&&<span className="count-badge">{pending.length}</span>}</h3>
        {pending.length===0&&<p className="subtle">승인 대기 근무지가 없습니다.</p>}
        {pending.map(w=>(
          <div className="list-row workplace-row" key={w.id}>
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
  const [noAnnualLeave,setNoAnnualLeave]=useState(!!emp.no_annual_leave);
  const ent=calculateLeaveEntitlement(emp.joined_at);
  const annualBase=noAnnualLeave?0:automaticAnnualLeaveDays(emp,ent);
  const adj=calculateAdjustmentDays(adjustments);
  const used=calculateUsedDays(requests,false);
  const total=annualBase+adj;
  const remain=Math.max(0,total-used);
  async function toggleNoAnnualLeave(next:boolean) {
    setNoAnnualLeave(next);
    const {error}=await supabase.from("employees").update({no_annual_leave:next}).eq("id",emp.id);
    if(error) { setNoAnnualLeave(!next); setMsg(error.message); }
    else { setMsg(next?"연차 없음으로 설정했습니다. 자동 연차가 생성되지 않습니다.":"연차 없음 설정을 해제했습니다."); onChanged(); }
  }
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
          <div className="leave-chip"><span>자동 연차</span><b>{annualBase.toFixed(1)}일</b></div>
          <div className="leave-chip"><span>총 부여</span><b>{total.toFixed(1)}일</b></div>
          <div className="leave-chip"><span>사용</span><b>{used.toFixed(1)}일</b></div>
          <div className="leave-chip"><span>잔여</span><b>{remain.toFixed(1)}일</b></div>
        </div>
        {msg&&<div className={`alert ${msg.includes("반영")?"success":"error"}`}>{msg}</div>}
        <label className="checkbox" style={{alignItems:"flex-start",marginBottom:12}}>
          <input type="checkbox" checked={noAnnualLeave} onChange={e=>toggleNoAnnualLeave(e.target.checked)} />
          <span><b>연차 없음</b><br/><small>{ANNUAL_LEAVE_LEGAL_NOTE}</small></span>
        </label>
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

function AdminPage({ currentEmployee, onChanged, view="dashboard", onNavigate }: { currentEmployee: any; onChanged: () => void; view?:"dashboard"|"approvals"|"employees"|"rnr"; onNavigate?:(tab:Tab)=>void }) {
  const [employees,setEmployees]=useState<any[]>([]);
  const [empMap,setEmpMap]=useState<Record<string,any>>({});
  const [employeeFilter,setEmployeeFilter]=useState("active");
  const [devices,setDevices]=useState<any[]>([]);
  const [workplaces,setWorkplaces]=useState<any[]>([]);
  const [requests,setRequests]=useState<any[]>([]);
  const [compRequests,setCompRequests]=useState<any[]>([]);
  const [workTimeRequests,setWorkTimeRequests]=useState<any[]>([]);
  const [attendanceCorrectionRequests,setAttendanceCorrectionRequests]=useState<any[]>([]);
  const [adjustments,setAdjustments]=useState<any[]>([]);
  const [overrides,setOverrides]=useState<any[]>([]);
  const [absences,setAbsences]=useState<any[]>([]);
  const [allLogs,setAllLogs]=useState<any[]>([]);
  const [rnrEntries,setRnrEntries]=useState<any[]>([]);
  const [rnrInput,setRnrInput]=useState("");
  const [rnrSuggestion,setRnrSuggestion]=useState<any|null>(null);
  const [rnrAssigneeId,setRnrAssigneeId]=useState("");
  const [selectedRnr,setSelectedRnr]=useState<any|null>(null);
  const [editingRnr,setEditingRnr]=useState<any|null>(null);
  const [rnrDepartmentFilter,setRnrDepartmentFilter]=useState("all");
  const [rnrBusy,setRnrBusy]=useState(false);
  const [rnrMsg,setRnrMsg]=useState("");
  const [message,setMessage]=useState("");
  const [settledCompIds,setSettledCompIds]=useState<Set<string>>(()=>{
    try { return new Set(JSON.parse(localStorage.getItem("lupl_settled_comp_ids")??"[]")); }
    catch { return new Set(); }
  });
  const [selectedDetailEmployeeId,setSelectedDetailEmployeeId]=useState("");
  const [hiddenRejectedIds,setHiddenRejectedIds]=useState<string[]>(()=>{
    try { return JSON.parse(localStorage.getItem("lupl_hidden_rejected_archive")??"[]"); }
    catch { return []; }
  });
  const [newEmployee,setNewEmployee]=useState({name:"",employee_no:"",phone:"",joined_at:todayIso(),work_start_date:todayIso(),role:"employee",device_limit:3,department:"",position:"",no_annual_leave:false,work_days:["mon","tue","wed","thu","fri"]});
  const [scheduleEmpId,setScheduleEmpId]=useState("");
  const [scheduleMsg,setScheduleMsg]=useState("");
  const [leaveModalEmp,setLeaveModalEmp]=useState<any|null>(null);
  const [leaveUsageEmpId,setLeaveUsageEmpId]=useState("all");
  const [correctionDraft,setCorrectionDraft]=useState<any|null>(null);

  async function load() {
    const {data:emps}=await supabase.from("employees").select("*").order("created_at",{ascending:false});
    const list=emps??[]; const map:Record<string,any>={};
    list.forEach((e:any)=>{map[e.id]=e;});
    setEmployees(list); setEmpMap(map);
    const [d,w,r,c,wt,ac,a,ov,ab,lg,rn]=await Promise.all([
      supabase.from("registered_devices").select("*").order("created_at",{ascending:false}),
      supabase.from("workplaces").select("*").order("created_at",{ascending:false}),
      supabase.from("attendance_requests").select("*").order("created_at",{ascending:false}),
      supabase.from("comp_time_requests").select("*").order("created_at",{ascending:false}),
      supabase.from("work_time_change_requests").select("*").order("created_at",{ascending:false}),
      supabase.from("attendance_correction_requests").select("*").order("created_at",{ascending:false}).limit(300),
      supabase.from("leave_adjustments").select("*").order("created_at",{ascending:false}),
      supabase.from("weekly_schedule_overrides").select("*").order("week_start",{ascending:false}).limit(50),
      supabase.from("employee_absences").select("*").order("start_date",{ascending:false}),
      supabase.from("attendance_logs").select("id, employee_id, workplace_id, check_in_time, check_out_time, original_check_out_time, scheduled_check_out_time, overtime_review_status, status, workplaces(name,type)").order("check_in_time",{ascending:false}).limit(300),
      supabase.from("rnr_entries").select("*").eq("is_active",true).order("created_at",{ascending:false}).limit(200),
    ]);
    setDevices(d.data??[]); setWorkplaces(w.data??[]); setRequests(r.data??[]); setCompRequests(c.data??[]); setWorkTimeRequests(wt.data??[]); setAttendanceCorrectionRequests(ac.error?[]:ac.data??[]); setAdjustments(a.data??[]); setOverrides(ov.data??[]); setAbsences(ab.data??[]); setAllLogs(lg.data??[]); setRnrEntries(rn.data??[]);
  }
  useEffect(()=>{load();},[]);
  const empName=(id?:string|null)=>id?(empMap[id]?.name??"-"):"-";
  const rnrAssigneeName=(entry:any)=>entry?.assigned_person_name||(
    entry?.assigned_employee_id&&empMap[entry.assigned_employee_id]?.name
      ? empMap[entry.assigned_employee_id].name
      : "직책 기준"
  );

  function leaveForEmployee(empId:string) {
    const emp=empMap[empId]; if(!emp) return null;
    const ent=calculateLeaveEntitlement(emp.joined_at);
    const adj=adjustments.filter(a=>a.employee_id===empId);
    const reqs=requests.filter(r=>r.employee_id===empId);
    const comps=compRequests.filter(c=>c.employee_id===empId);
    const adjDays=calculateAdjustmentDays(adj);
    const compEarned=calculateApprovedCompDays(comps);
    const used=calculateUsedDays(reqs,false);
    const total=automaticAnnualLeaveDays(emp,ent)+adjDays;
    const remain=Math.max(0,total-used);
    const compH=Math.round(compEarned*8*10)/10;
    const compUsedH=reqs.filter(r=>isCompLeaveUsageRequest(r)&&r.status==="approved").reduce((s,r)=>s+(r.amount_hours??(r.amount_days??0)*8),0);
    const pendingComp=comps.filter(c=>c.status==="pending").reduce((s,c)=>s+Number(c.converted_days||0),0);
    return {total,used,remain,compEarned,compUsedH,compRemainH:Math.max(0,compH-compUsedH),pendingComp};
  }

  async function createEmployee() {
    setMessage("");
    const duplicate=employees.find((employee:any)=>String(employee.employee_no??"").trim().toLowerCase()===newEmployee.employee_no.trim().toLowerCase());
    if(duplicate) return setMessage(`이미 등록된 사번입니다. ${duplicate.name} 직원의 기존 근태·동의 기록과 섞이지 않도록 다른 사번을 입력해주세요.`);
    const {data,error}=await supabase.functions.invoke("admin-create-employee",{body:newEmployee});
    if(error) setMessage(error.message); else if(data?.error) setMessage(data.error);
    else{
      await supabase.from("employees").update({department:newEmployee.department,position:newEmployee.position,no_annual_leave:newEmployee.no_annual_leave}).eq("employee_no",newEmployee.employee_no);
      setMessage(`직원 계정이 생성되었습니다. 초기 비밀번호: ${data.initial_password}`);
      setNewEmployee({name:"",employee_no:"",phone:"",joined_at:todayIso(),work_start_date:todayIso(),role:"employee",device_limit:3,department:"",position:"",no_annual_leave:false,work_days:["mon","tue","wed","thu","fri"]});
      await load();onChanged();
    }
  }
  async function updateEmployee(id:string,patch:Record<string,any>){const {error}=await supabase.from("employees").update(patch).eq("id",id);if(error)setMessage(error.message);else{await load();onChanged();}}
  async function toggleEmployee(id:string,cur:string){const n=cur!=="active";await updateEmployee(id,{is_active:n,employment_status:n?"active":"inactive"});}
  function localRnrSuggestion(text:string) {
    const normalized=text.toLowerCase();
    const picked=RNR_BASELINE_ROLES.find(role=>role.keywords.some(keyword=>normalized.includes(keyword.toLowerCase())))??RNR_BASELINE_ROLES[0];
    const category=classifyRnrCategory(text);
    return {
      title:professionalRnrTitle(text,category),
      summary:text.trim(),
      department:picked.department,
      position:picked.position,
      category,
      priority:"normal",
      checklist:picked.duties,
      assigned_person_name:"",
    };
  }
  async function suggestRnr() {
    const raw=rnrInput.trim();
    if(!raw) return setRnrMsg("정리할 업무 내용을 입력해주세요.");
    setRnrBusy(true); setRnrMsg("");
    try {
      const {data:sessionData}=await supabase.auth.getSession();
      const token=sessionData.session?.access_token;
      if(!token) throw new Error("로그인이 필요합니다.");
      const response=await fetch("/api/rnr-suggest",{
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({
          input:raw,
          employees:employees.map((e:any)=>({id:e.id,name:e.name,department:e.department,position:e.position,role:e.role})),
          existing:rnrEntries.slice(0,80).map((e:any)=>({title:e.title,department:e.department,position:e.position,category:e.category})),
          categories:RNR_CATEGORY_OPTIONS.filter(Boolean),
          baseline:RNR_BASELINE_ROLES,
        }),
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error||"AI 정리 실패");
      const suggestion=data?.suggestion??localRnrSuggestion(raw);
      setRnrSuggestion(suggestion);
      const matched=employees.find((e:any)=>e.name&&suggestion.assigned_person_name&&String(suggestion.assigned_person_name).includes(e.name));
      if(matched) setRnrAssigneeId(matched.id);
    } catch(e:any) {
      setRnrSuggestion(localRnrSuggestion(raw));
      setRnrMsg(`AI 호출 대신 기본 추천으로 정리했습니다. ${e.message}`);
    } finally {
      setRnrBusy(false);
    }
  }
  async function saveRnrEntry() {
    if(!rnrSuggestion) return setRnrMsg("먼저 업무를 정리해주세요.");
    const assignee=employees.find((e:any)=>e.id===rnrAssigneeId);
    const category=rnrSuggestion.category||classifyRnrCategory(`${rnrInput} ${rnrSuggestion.summary??""}`);
    const payload={
      raw_input:rnrInput.trim(),
      title:professionalRnrTitle(`${rnrInput.trim()} ${rnrSuggestion.summary??""} ${rnrSuggestion.title??""}`,category),
      summary:rnrSuggestion.summary||rnrInput.trim(),
      department:rnrSuggestion.department||assignee?.department||"",
      position:rnrSuggestion.position||assignee?.position||"",
      category,
      priority:rnrSuggestion.priority||"normal",
      checklist:Array.isArray(rnrSuggestion.checklist)?rnrSuggestion.checklist:[],
      assigned_employee_id:rnrAssigneeId||null,
      assigned_person_name:assignee?.name||rnrSuggestion.assigned_person_name||"",
      created_by:currentEmployee.id,
      source:"admin_note",
      is_active:true,
    };
    const {error}=await supabase.from("rnr_entries").insert(payload);
    if(error) setRnrMsg(error.message);
    else { setRnrMsg("업무 R&R이 저장되었습니다."); setRnrInput(""); setRnrSuggestion(null); setRnrAssigneeId(""); await load(); }
  }
  function openRnr(entry:any){
    setSelectedRnr(entry);
    setEditingRnr(null);
  }
  function beginEditRnr(entry:any){
    setEditingRnr({
      ...entry,
      assigned_employee_id:entry.assigned_employee_id??"",
      checklistText:Array.isArray(entry.checklist)?entry.checklist.join("\n"):"",
    });
  }
  async function saveEditedRnr(){
    if(!editingRnr?.id) return;
    const assignee=employees.find((e:any)=>e.id===editingRnr.assigned_employee_id);
    const checklist=String(editingRnr.checklistText??"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const category=editingRnr.category||classifyRnrCategory(`${editingRnr.title} ${editingRnr.summary}`);
    const payload={
      title:professionalRnrTitle(`${editingRnr.summary??""} ${editingRnr.title??""}`,category),
      summary:String(editingRnr.summary??"").trim()||professionalRnrTitle(editingRnr.title,category),
      department:editingRnr.department||assignee?.department||"",
      position:editingRnr.position||assignee?.position||"",
      category,
      checklist,
      assigned_employee_id:editingRnr.assigned_employee_id||null,
      assigned_person_name:assignee?.name||editingRnr.assigned_person_name||"",
      updated_at:new Date().toISOString(),
    };
    const {data,error}=await supabase.from("rnr_entries").update(payload).eq("id",editingRnr.id).select().single();
    if(error) setRnrMsg(error.message);
    else { setRnrMsg("업무 R&R을 수정했습니다."); setSelectedRnr(data); setEditingRnr(null); await load(); }
  }
  async function sendRnrToTodayTask(entry:any){
    const contentLines=rnrDescriptionLines(entry).map((item:string)=>`- ${item}`).join("\n");
    const targetEmployeeId=entry.assigned_employee_id||null;
    const {error}=await supabase.from("daily_tasks").insert({
      task_date:todayIso(),
      title:rnrDisplayTitle(entry)||"오늘의 할일",
      content:contentLines,
      is_active:true,
      created_by:currentEmployee.id,
      target_employee_id:targetEmployeeId,
    });
    if(error) setRnrMsg(error.message);
    else setRnrMsg(targetEmployeeId?`${rnrAssigneeName(entry)}에게 오늘의 할일로 보냈습니다.`:"전체 직원 오늘의 할일로 보냈습니다.");
  }
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
    return getScheduleForDate(empMap[request.employee_id],request.work_date,overrides,workTimeRequests.filter(r=>r.status==="approved"));
  }
  function expectedCompCheckout(request:any, log=compAttendance(request)){
    const schedule=compSchedule(request);
    if(log?.check_in_time){
      const startMin=timeToMinutes(schedule.work_start)??9*60;
      const endMin=timeToMinutes(schedule.work_end)??18*60;
      const shiftSpan=endMin>startMin ? endMin-startMin : (24*60-startMin)+endMin;
      return addMinutes(new Date(log.check_in_time),shiftSpan);
    }
    return kstDateTime(request.work_date,schedule.work_end);
  }
  function estimatedOvertime(request:any){
    const log=compAttendance(request);
    if(!log?.check_out_time) return null;
    const scheduledEnd=expectedCompCheckout(request,log);
    return Math.max(0,Math.round(((new Date(log.check_out_time).getTime()-scheduledEnd.getTime())/3600000)*100)/100);
  }
  async function reviewCompRequest(request:any,status:string){
    const usesActualCheckout=request.work_date>="2026-06-24";
    const completedLog=compAttendance(request);
    const scheduledEnd=expectedCompCheckout(request,completedLog);
    const result=usesActualCheckout&&completedLog
      ? await supabase.rpc("review_comp_time_attendance",{p_request_id:request.id,p_status:status,p_scheduled_end:kstHHMM(scheduledEnd),p_review_note:status==="approved"?"실제 퇴근시간 기준 승인":"초과근무 미인정 및 예정 퇴근시간 적용"})
      : await supabase.from("comp_time_requests").update({
          status,
          reviewed_by:currentEmployee.id,
          reviewed_at:new Date().toISOString(),
          review_note:status==="approved"?"퇴근 전 추가근무 사전 승인":"추가근무 불인정",
        }).eq("id",request.id);
    if(result.error) setMessage(result.error.message);
    else{
      if(completedLog) setSettledCompIds(previous=>{
        const next=new Set(previous).add(request.id);
        localStorage.setItem("lupl_settled_comp_ids",JSON.stringify(Array.from(next)));
        return next;
      });
      setMessage(status==="approved"
        ? completedLog?"실제 초과근무가 승인되어 대체휴가로 적립되었습니다.":"추가근무를 사전 승인했습니다. 승인 종료시간까지 퇴근 기준이 연장됩니다."
        : completedLog?"초과근무를 불인정하고 예정 퇴근시간으로 근태를 마감했습니다.":"추가근무를 불인정했습니다.");
      await load();
      onChanged();
    }
  }
  async function reviewWorkTimeRequest(id:string,status:string){const {error}=await supabase.rpc("review_work_time_change_request",{p_request_id:id,p_status:status,p_review_note:""});if(error)setMessage(error.message);else{setMessage(status==="approved"?"근무시간 변경 요청을 승인했습니다.":"근무시간 변경 요청을 반려했습니다.");await load();onChanged();}}
  async function reviewDevice(id:string,status:string){const {error}=await supabase.from("registered_devices").update({status}).eq("id",id);if(error)setMessage(error.message);else{await load();onChanged();}}
  async function confirmAttendanceLog(id:string){const {error}=await supabase.rpc("confirm_attendance_log",{p_log_id:id,p_status:"확인 완료"});if(error)setMessage(error.message);else{setMessage("근태 기록을 확인 완료 처리했습니다.");await load();onChanged();}}
  async function forceClockOut(id:string){if(!window.confirm("이 기록을 현재 시각으로 강제 퇴근 처리할까요?")) return; const {error}=await supabase.rpc("close_attendance_log",{p_log_id:id,p_status:"관리자 강제퇴근",p_device_fingerprint_hash:null,p_device_info:{}});if(error)setMessage(error.message);else{setMessage("강제 퇴근 처리했습니다.");await load();onChanged();}}
  function openAttendanceCorrection(employee:any, log:any|null) {
    const workDate=log?.check_in_time ? localDateStr(log.check_in_time) : todayIso();
    const schedule=getScheduleForDate(employee,workDate,overrides,workTimeRequests.filter((r:any)=>r.status==="approved"));
    setCorrectionDraft({
      employee_id:employee.id,
      employee_name:employee.name,
      employee_no:employee.employee_no,
      attendance_log_id:log?.id??null,
      work_date:workDate,
      old_check_in_time:log?.check_in_time??null,
      old_check_out_time:log?.check_out_time??null,
      requested_check_in_time:log?.check_in_time ? dateTimeLocalValue(log.check_in_time) : defaultDateTimeLocal(workDate,schedule.work_start),
      requested_check_out_time:log?.check_out_time ? dateTimeLocalValue(log.check_out_time) : "",
      reason:"출퇴근 버튼 누락 또는 오입력 정정",
      evidence_note:"관리자 확인",
    });
  }
  function changeCorrectionWorkDate(workDate:string) {
    setCorrectionDraft((draft:any)=>{
      if(!draft) return draft;
      const employee=empMap[draft.employee_id];
      const schedule=getScheduleForDate(employee,workDate,overrides,workTimeRequests.filter((r:any)=>r.status==="approved"));
      const keepTime=(value:string,fallback:string)=>value ? `${workDate}T${String(value).slice(11,16)}` : defaultDateTimeLocal(workDate,fallback);
      return {
        ...draft,
        work_date:workDate,
        requested_check_in_time:keepTime(draft.requested_check_in_time,schedule.work_start),
        requested_check_out_time:draft.requested_check_out_time ? `${workDate}T${String(draft.requested_check_out_time).slice(11,16)}` : "",
      };
    });
  }
  async function saveAttendanceCorrection() {
    if(!correctionDraft) return;
    setMessage("");
    const employee=empMap[correctionDraft.employee_id];
    const requestedIn=dateTimeLocalToIso(correctionDraft.requested_check_in_time);
    const requestedOut=dateTimeLocalToIso(correctionDraft.requested_check_out_time);
    const changedIn=!!requestedIn && (!correctionDraft.old_check_in_time || Math.abs(new Date(requestedIn).getTime()-new Date(correctionDraft.old_check_in_time).getTime())>59000);
    const changedOut=!!requestedOut && (!correctionDraft.old_check_out_time || Math.abs(new Date(requestedOut).getTime()-new Date(correctionDraft.old_check_out_time).getTime())>59000);
    if(!changedIn&&!changedOut) return setMessage("정정할 출근 또는 퇴근 시각을 변경해주세요.");
    if(!correctionDraft.attendance_log_id&&!requestedIn) return setMessage("출근 기록이 없는 날은 정정 출근 시각이 필요합니다.");
    const effectiveIn=requestedIn||correctionDraft.old_check_in_time;
    const effectiveOut=requestedOut||correctionDraft.old_check_out_time;
    if(effectiveIn&&effectiveOut&&new Date(effectiveOut).getTime()<=new Date(effectiveIn).getTime()) return setMessage("퇴근 시각은 출근 시각보다 늦어야 합니다.");
    const correction_type=changedIn&&changedOut?"both":changedIn?"check_in":"check_out";
    const row={
      employee_id:correctionDraft.employee_id,
      attendance_log_id:correctionDraft.attendance_log_id,
      work_date:correctionDraft.work_date,
      correction_type,
      old_check_in_time:correctionDraft.old_check_in_time,
      old_check_out_time:correctionDraft.old_check_out_time,
      requested_check_in_time:requestedIn,
      requested_check_out_time:requestedOut,
      reason:String(correctionDraft.reason??"").trim()||"출퇴근 버튼 누락 또는 오입력 정정",
      evidence_note:String(correctionDraft.evidence_note??"").trim()||null,
      legal_notice_version:ATTENDANCE_CORRECTION_LEGAL_NOTICE_VERSION,
      requested_by:currentEmployee.id,
      status:"pending",
    };
    const {error}=await supabase.from("attendance_correction_requests").insert({
      ...row,
      document_text:attendanceCorrectionDocumentText(employee,row),
    });
    if(error) setMessage(friendlySignatureDbError(error));
    else { setMessage(`${employee?.name??"직원"}에게 출퇴근 기록 정정 확인을 요청했습니다.`); setCorrectionDraft(null); await load(); onChanged(); }
  }
  async function cancelAttendanceCorrection(id:string) {
    const {data,error}=await supabase.from("attendance_correction_requests").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("id",id).select("id").maybeSingle();
    if(error) setMessage(friendlySignatureDbError(error));
    else if(!data) setMessage("이미 처리된 정정 요청은 취소할 수 없습니다.");
    else { setMessage("출퇴근 기록 정정 요청을 취소했습니다."); await load(); }
  }

  function isTestEmployee(employee:any){
    const name=String(employee?.name??"").trim().toLowerCase();
    const no=String(employee?.employee_no??"").trim().toLowerCase();
    return name==="test"||no.startsWith("test");
  }
  const filtered=employees.filter(e=>employeeFilter==="all"?true:employeeFilter==="inactive"?e.employment_status!=="active":e.employment_status==="active");
  const activeEmployees=employees.filter(e=>e.employment_status==="active"&&!isTestEmployee(e));
  useEffect(()=>{
    if(activeEmployees.length===0) { if(selectedDetailEmployeeId) setSelectedDetailEmployeeId(""); return; }
    if(!selectedDetailEmployeeId || !activeEmployees.some((employee:any)=>employee.id===selectedDetailEmployeeId)) {
      setSelectedDetailEmployeeId(activeEmployees[0].id);
    }
  },[employees,selectedDetailEmployeeId]);
  const leaveUsageRows=requests
    .filter((request:any)=>requestTypeLabels[request.request_type])
    .filter((request:any)=>!isTestEmployee(empMap[request.employee_id])&&String(request.reason??"").trim().toLowerCase()!=="test")
    .filter((request:any)=>leaveUsageEmpId==="all"||request.employee_id===leaveUsageEmpId);
  const todayLogByEmployee:Record<string,any>={};
  allLogs
    .filter((l:any)=>isToday(l.check_in_time))
    .sort(byCheckInDesc)
    .forEach((l:any)=>{ if(!todayLogByEmployee[l.employee_id]) todayLogByEmployee[l.employee_id]=l; });
  const dailyRows=activeEmployees.map((e:any)=>({employee:e,log:todayLogByEmployee[e.id]}));
  const pW=workplaces.filter(w=>w.approval_status==="pending");
  const approvedWorkTimeChanges=workTimeRequests.filter(r=>r.status==="approved");
  const payrollMonth=currentMonthRange();
  function actualCompSettled(r:any){
    return settledCompIds.has(r.id)
      || !!r.attendance_log_id
      || r.actual_overtime_hours !== null && r.actual_overtime_hours !== undefined
      || String(r.review_note??"").includes("실제 퇴근시간 기준");
  }
  const pC=compRequests.filter(r=>{
    if(actualCompSettled(r)) return false;
    if(r.status==="pending") return true;
    return r.status==="approved"&&r.work_date>="2026-06-24"&&!!compAttendance(r);
  });
  const pT=workTimeRequests.filter(r=>r.status==="pending");
  const pA=attendanceCorrectionRequests.filter(r=>r.status==="pending");
  const pR=requests.filter(r=>r.status==="pending");
  const pD=devices.filter(d=>d.status==="pending");
  const reviewStatuses=["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음"];
  const pL=allLogs.filter((l:any)=>{
    const openToday=!l.check_out_time&&isToday(l.check_in_time);
    if(l.status==="확인 완료") return false;
    if(openToday) return false;
    return !l.check_out_time || reviewStatuses.includes(l.status);
  });
  const pendingTotal=pW.length+pC.length+pT.length+pA.length+pR.length+pD.length+pL.length;
  const checkedInCount=dailyRows.filter(x=>x.log?.check_in_time).length;
  const checkedOutCount=dailyRows.filter(x=>x.log?.check_out_time).length;
  const openClockOutCount=dailyRows.filter(x=>x.log?.check_in_time&&!x.log?.check_out_time).length;
  const attentionTotal=pW.length+pD.length+pL.length;
  function isRejectedStatus(status:any){
    const value=String(status??"").toLowerCase();
    return value==="rejected"||value==="denied"||value.includes("반려")||value.includes("불인정");
  }
  function hideRejectedArchiveRow(key:string) {
    const next=Array.from(new Set([...hiddenRejectedIds,key]));
    setHiddenRejectedIds(next);
    localStorage.setItem("lupl_hidden_rejected_archive",JSON.stringify(next));
  }
  function restoreRejectedArchiveRows() {
    setHiddenRejectedIds([]);
    localStorage.removeItem("lupl_hidden_rejected_archive");
  }
  const rejectedArchiveRows=[
    ...requests.filter((r:any)=>isRejectedStatus(r.status)).map((r:any)=>({
      key:`leave-${r.id}`,
      type:"휴가",
      employee:empName(r.employee_id),
      title:leaveTypeDisplayLabel(r),
      detail:`${r.start_date}${r.end_date!==r.start_date?`~${r.end_date}`:""}${r.start_time?` · ${r.start_time.slice(0,5)}~${r.end_time?.slice(0,5)}`:""} · ${r.reason||"사유 없음"}`,
      createdAt:r.reviewed_at??r.created_at,
      status:r.status,
    })),
    ...compRequests.filter((r:any)=>isRejectedStatus(r.status)).map((r:any)=>({
      key:`comp-${r.id}`,
      type:"추가근무",
      employee:empName(r.employee_id),
      title:r.work_date,
      detail:`신청 ${r.start_time?.slice(0,5)??"-"}~${r.end_time?.slice(0,5)??"-"} · ${r.hours??0}시간 · ${r.reason||"사유 없음"}`,
      createdAt:r.reviewed_at??r.created_at,
      status:r.status,
    })),
    ...workTimeRequests.filter((r:any)=>isRejectedStatus(r.status)).map((r:any)=>({
      key:`worktime-${r.id}`,
      type:"근무시간",
      employee:empName(r.employee_id),
      title:workChangeKind(r),
      detail:`${workChangePeriodLabel(r)} · ${workChangeConditionLabel(r)} · ${r.reason||"사유 없음"}`,
      createdAt:r.reviewed_at??r.created_at,
      status:r.status,
    })),
  ].filter((row:any)=>!hiddenRejectedIds.includes(row.key)).sort((a:any,b:any)=>String(b.createdAt??"").localeCompare(String(a.createdAt??"")));
  const unassignedRnrEntries=rnrEntries.filter((entry:any)=>!entry.assigned_employee_id);
  const rnrBoardColumns=[
    ...activeEmployees.map((employee:any)=>({
      key:employee.id,
      title:employee.name,
      subtitle:[employee.department,employee.position].filter(Boolean).join(" · ")||employee.employee_no,
      entries:rnrEntries.filter((entry:any)=>entry.assigned_employee_id===employee.id),
    })).filter(column=>column.entries.length>0),
    ...(unassignedRnrEntries.length>0?[{key:"role",title:"직책 기준",subtitle:"담당자 미지정",entries:unassignedRnrEntries}]:[]),
  ];
  const rnrStackGroups=Array.from(rnrEntries.reduce((map:Map<string,any>,entry:any)=>{
    const department=entry.department||"공통";
    const position=entry.position||"직책 공통";
    const category=entry.category||"업무";
    const key=`${department}|${position}|${category}`;
    if(!map.has(key)) map.set(key,{key,department,position,category,entries:[]});
    map.get(key).entries.push(entry);
    return map;
  },new Map<string,any>()).values()).sort((a:any,b:any)=>`${a.department}${a.position}${a.category}`.localeCompare(`${b.department}${b.position}${b.category}`));
  const rnrDepartments=Array.from(new Set(rnrStackGroups.map((group:any)=>group.department))).sort();
  const visibleRnrStackGroups=rnrDepartmentFilter==="all"
    ? rnrStackGroups
    : rnrStackGroups.filter((group:any)=>group.department===rnrDepartmentFilter);
  const selectedDetailEmployee=activeEmployees.find((employee:any)=>employee.id===selectedDetailEmployeeId)??activeEmployees[0]??null;
  const selectedBreakStart=selectedDetailEmployee?.break_start??"12:00";
  const selectedBreakEnd=selectedDetailEmployee?.break_end??"13:00";
  const selectedDailyHours=selectedDetailEmployee?netDailyHours(selectedDetailEmployee.work_start??"09:00",selectedDetailEmployee.work_end??"18:00",selectedBreakStart,selectedBreakEnd):0;
  const selectedWeeklyHours=selectedDetailEmployee?Math.round(selectedDailyHours*(selectedDetailEmployee.work_days??["mon","tue","wed","thu","fri"]).length*10)/10:0;
  const selectedMonthStats=selectedDetailEmployee?scheduledWorkStats(selectedDetailEmployee,payrollMonth.start,payrollMonth.end,overrides,approvedWorkTimeChanges):null;
  function toggleDay(arr:string[],day:string){return arr.includes(day)?arr.filter(d=>d!==day):[...arr,day];}
  async function updateEmployeeContract(emp:any, patch:Record<string,any>) {
    const next={...emp,...patch};
    const derived:any={};
    if("work_days" in patch || "work_start" in patch || "work_end" in patch) {
      const dailyHours=netDailyHours(next.work_start??"09:00",next.work_end??"18:00",next.break_start??"12:00",next.break_end??"13:00");
      const weeklyDays=(next.work_days??[]).length;
      derived.weekly_work_days=weeklyDays;
      derived.daily_work_hours=dailyHours;
      derived.monthly_standard_hours=Math.round(weeklyDays*dailyHours*4.345*10)/10;
    }
    await updateEmployee(emp.id,{...patch,...derived});
  }
  const showsApprovals=view==="approvals";

  return (
    <div className="grid">
      {message&&<div className="alert">{message}</div>}
      {correctionDraft&&<div className="modal-backdrop" onClick={()=>setCorrectionDraft(null)}>
        <div className="modal-box" style={{maxWidth:620}} onClick={e=>e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="card-title" style={{margin:0}}><i className="ti ti-pencil-check" aria-hidden="true"></i>출퇴근 기록 정정 요청</h2>
            <button className="modal-close" title="닫기" onClick={()=>setCorrectionDraft(null)}><i className="ti ti-x" aria-hidden="true"></i></button>
          </div>
          <p className="subtle" style={{marginTop:4}}>직원이 서명해야 실제 출퇴근 기록에 반영됩니다.</p>
          <div className="consent-preview" style={{marginTop:12}}>
            <dl>
              <div><dt>직원</dt><dd>{correctionDraft.employee_name} ({correctionDraft.employee_no})</dd></div>
              <div><dt>기존 출근</dt><dd>{formatDateTime(correctionDraft.old_check_in_time)}</dd></div>
              <div><dt>기존 퇴근</dt><dd>{formatDateTime(correctionDraft.old_check_out_time)}</dd></div>
            </dl>
          </div>
          <div className="grid two" style={{marginTop:12}}>
            <div className="form-row"><label className="label">근무일</label><input className="input" type="date" value={correctionDraft.work_date} onChange={e=>changeCorrectionWorkDate(e.target.value)} /></div>
            <div className="form-row"><label className="label">확인 자료</label><input className="input" value={correctionDraft.evidence_note} onChange={e=>setCorrectionDraft({...correctionDraft,evidence_note:e.target.value})} placeholder="예: 관리자 확인, 업무 메시지, 현장 확인" /></div>
            <div className="form-row"><label className="label">정정 출근 시각</label><input className="input" type="datetime-local" value={correctionDraft.requested_check_in_time} onChange={e=>setCorrectionDraft({...correctionDraft,requested_check_in_time:e.target.value})} /></div>
            <div className="form-row"><label className="label">정정 퇴근 시각</label><input className="input" type="datetime-local" value={correctionDraft.requested_check_out_time} onChange={e=>setCorrectionDraft({...correctionDraft,requested_check_out_time:e.target.value})} /></div>
          </div>
          <div className="form-row"><label className="label">정정 사유</label><textarea className="textarea compact-textarea" value={correctionDraft.reason} onChange={e=>setCorrectionDraft({...correctionDraft,reason:e.target.value})} /></div>
          <div className="type-desc work-time-detail work-time-detail-space" style={{whiteSpace:"pre-wrap"}}>{ATTENDANCE_CORRECTION_DETAIL_TEXT}</div>
          <div className="actions" style={{justifyContent:"flex-end",marginTop:16}}>
            <button className="button ghost" onClick={()=>setCorrectionDraft(null)}>취소</button>
            <button className="button" onClick={saveAttendanceCorrection}>직원 서명 요청</button>
          </div>
        </div>
      </div>}

      {view==="dashboard"&&<section className="admin-command-center">
        <div className="admin-command-head">
          <div>
            <span>관리자 홈</span>
            <h2>오늘 처리할 일만 먼저 봅니다</h2>
            <p>승인, 예외, 직원 계약, 일정, 리포트를 역할별 화면으로 나눴습니다. 급한 일은 아래 버튼에서 바로 들어가 처리하시면 됩니다.</p>
          </div>
          <button className="button secondary" onClick={()=>onNavigate?.("approvals")}><i className="ti ti-inbox" aria-hidden="true"></i>승인함 열기</button>
        </div>
        <div className="admin-command-metrics">
          <div><span>출근</span><b>{checkedInCount}/{activeEmployees.length}</b><small>오늘 출근 기록</small></div>
          <div><span>퇴근 미완료</span><b>{openClockOutCount}</b><small>강제 퇴근 확인 대상</small></div>
          <div><span>승인 대기</span><b>{pendingTotal}</b><small>휴가·추가근무·기기·근무지</small></div>
          <div><span>예외 확인</span><b>{attentionTotal}</b><small>위치·기기·미퇴근</small></div>
        </div>
        <div className="admin-flow-grid">
          <button onClick={()=>onNavigate?.("approvals")}>
            <i className="ti ti-inbox" aria-hidden="true"></i>
            <b>승인함</b>
            <span>{pendingTotal}건 대기 · 반려 기록은 따로 접어 정리</span>
          </button>
          <button onClick={()=>onNavigate?.("schedule")}>
            <i className="ti ti-calendar-time" aria-hidden="true"></i>
            <b>일정</b>
            <span>직원별 근무시간, 휴가, 추가근무를 한 화면에서 확인</span>
          </button>
          <button onClick={()=>onNavigate?.("employees")}>
            <i className="ti ti-users" aria-hidden="true"></i>
            <b>직원</b>
            <span>계약사항과 휴게 제외 실근무시간 기준 관리</span>
          </button>
          <button onClick={()=>onNavigate?.("reports")}>
            <i className="ti ti-chart-bar" aria-hidden="true"></i>
            <b>리포트</b>
            <span>급여와 근태 자료는 보고서 흐름에서 확인</span>
          </button>
        </div>
      </section>}

      {view==="dashboard"&&<section className="card dashboard-status-card">
        <h2 className="card-title"><i className="ti ti-users" aria-hidden="true"></i>오늘 직원 출퇴근</h2>
        <div className="grid four" style={{marginBottom:16}}>
          <div className="metric"><div className="metric-value">{activeEmployees.length}</div><div className="metric-label">재직 직원</div></div>
          <div className="metric"><div className="metric-value">{checkedInCount}</div><div className="metric-label">오늘 출근</div></div>
          <div className="metric"><div className="metric-value">{checkedOutCount}</div><div className="metric-label">오늘 퇴근</div></div>
          <div className="metric"><div className="metric-value">{pendingTotal}</div><div className="metric-label">확인 대기</div></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>직원</th><th>출근 위치</th><th>출근 시각</th><th>퇴근 시각</th><th>상태</th><th>처리</th></tr></thead>
            <tbody>
              {dailyRows.map(({employee:e,log}:any)=>{
                const display=attendanceDisplay(e,log,overrides,workTimeRequests.filter(r=>r.status==="approved"));
                return (
                <tr key={e.id}>
                  <td><b>{e.name}</b><br /><span className="subtle">{e.employee_no}</span></td>
                  <td>{log?.workplaces?.name ?? "-"}</td>
                  <td>{log ? formatDateTime(log.check_in_time) : "-"}</td>
                  <td>{log?.check_out_time ? formatDateTime(log.check_out_time) : "-"}</td>
                  <td><div className="status-badges"><span className={`badge ${display.primaryClass}`}>{display.primary}</span>{display.workType&&<span className="badge work-type">{display.workType}</span>}</div>{display.primary==="지각"&&<span className="late-detail">{display.lateMinutes}분 지각 · 기준 {String(display.scheduleStart).slice(0,5)}</span>}</td>
                  <td><div className="actions">{log&&!log.check_out_time&&<button className="button danger compact" onClick={()=>forceClockOut(log.id)}>강제 퇴근</button>}<button className="button secondary compact" onClick={()=>openAttendanceCorrection(e,log)}>{log?"기록 정정":"출근 정정"}</button></div></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>}

      {showsApprovals&&<section className="card">
        <h2 className="card-title"><i className="ti ti-inbox" aria-hidden="true"></i>승인 대기{pendingTotal>0&&<span className="count-badge">{pendingTotal}</span>}</h2>
        <div className="grid two">
          <div>
            <h3 className="approval-section-title">근무지 {pW.length>0&&<span className="count-badge">{pW.length}</span>}</h3>
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
            <h3 className="approval-section-title">위치·미퇴근 확인 {pL.length>0&&<span className="count-badge">{pL.length}</span>}</h3>
            {pL.length===0&&<p className="subtle">없음</p>}
            {pL.map((l:any)=>(
              <div className="list-row" key={l.id} style={{flexDirection:"column",alignItems:"stretch"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                  <div><b>{empName(l.employee_id)}</b><div className="subtle">출근 {formatDateTime(l.check_in_time)} · 퇴근 {formatDateTime(l.check_out_time)} · {l.status??"-"}</div></div>
                  <span className={`badge ${!l.check_out_time?"warn":""}`}>{!l.check_out_time?"미퇴근":"확인 필요"}</span>
                </div>
                <div className="type-desc" style={{marginTop:8}}>상세: 출근 {formatDateTime(l.check_in_time)} / 퇴근 {formatDateTime(l.check_out_time)} / 상태 {l.status??"-"}</div>
                <div className="actions"><button className="button secondary" onClick={()=>confirmAttendanceLog(l.id)}>확인 완료</button><button className="button ghost" onClick={()=>openAttendanceCorrection(empMap[l.employee_id],l)}>기록 정정</button>{!l.check_out_time&&<button className="button danger" onClick={()=>forceClockOut(l.id)}>강제 퇴근</button>}</div>
              </div>
            ))}
          </div>
          <div>
            <h3 className="approval-section-title">추가근무 {pC.length>0&&<span className="count-badge">{pC.length}</span>}</h3>
            {pC.length===0&&<p className="subtle">없음</p>}
            {pC.map(r=>{
              const log=compAttendance(r);
              const actual=estimatedOvertime(r);
              const usesActualCheckout=r.work_date>="2026-06-24";
              return <div className="list-row" key={r.id}>
                <div>
                  <b>{empName(r.employee_id)}</b>
                  <div className="subtle">{r.work_date} · 신청 {r.start_time?.slice(0,5)}~{r.end_time?.slice(0,5)} · {r.hours}시간</div>
                  <div className="type-desc" style={{marginTop:6}}>신청 사유: {r.reason||"사유 미입력"}</div>
                  {usesActualCheckout&&<div className="type-desc" style={{marginTop:6}}>예정 퇴근 {log?timeOnly(expectedCompCheckout(r,log)):String(compSchedule(r).work_end??"18:00").slice(0,5)} · 실제 퇴근 {log?.check_out_time?timeOnly(log.check_out_time):"아직 퇴근 전"} · 인정 예상 {actual==null?"-":`${actual}시간`}</div>}
                </div>
                <div className="actions">
                  <button className="button secondary" onClick={()=>reviewCompRequest(r,"approved")}>{log?.check_out_time?"실제시간 정산":"초과근무 승인"}</button>
                  <button className="button danger" onClick={()=>reviewCompRequest(r,"rejected")}>{usesActualCheckout?"불인정":"반려"}</button>
                </div>
              </div>;
            })}
          </div>
          <div>
            <h3 className="approval-section-title">근무시간 변경 {pT.length>0&&<span className="count-badge">{pT.length}</span>}</h3>
            {pT.length===0&&<p className="subtle">없음</p>}
            {pT.map(r=>(
              <div className="list-row" key={r.id} style={{flexDirection:"column",alignItems:"stretch"}}>
                <div>
                  <b>{empName(r.employee_id)}</b>
                  <div className="subtle">{(r.periods??[]).map((p:any)=>`${p.start_date}~${p.end_date}`).join(" / ")} · {daysLabel(r.new_work_days??[])} · {timeRangeLabel(r.new_work_start,r.new_work_end)}</div>
                </div>
                <div className="type-desc" style={{marginTop:8,marginBottom:0}}>
                  기존 {daysLabel(r.old_work_days??[])} · {timeRangeLabel(r.old_work_start,r.old_work_end)}<br/>
                  변경 주 {Number(r.weekly_work_hours||0).toFixed(1)}시간 · 총 {r.total_calendar_days??0}일 / 근무 {r.total_work_days??0}일<br/>
                  사유 {r.reason||"-"}
                </div>
                <div className="actions"><button className="button secondary" onClick={()=>reviewWorkTimeRequest(r.id,"approved")}>승인</button><button className="button danger" onClick={()=>reviewWorkTimeRequest(r.id,"rejected")}>반려</button></div>
              </div>
            ))}
          </div>
          <div>
            <h3 className="approval-section-title">출퇴근 기록 정정 {pA.length>0&&<span className="count-badge">{pA.length}</span>}</h3>
            {pA.length===0&&<p className="subtle">없음</p>}
            {pA.map((r:any)=>(
              <div className="list-row" key={r.id} style={{flexDirection:"column",alignItems:"stretch"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                  <div><b>{empName(r.employee_id)}</b><div className="subtle">{r.work_date} · {attendanceCorrectionTypeLabel(r.correction_type)} · 직원 서명 대기</div></div>
                  <span className="badge warn">{attendanceCorrectionStatusLabel(r.status)}</span>
                </div>
                <div className="type-desc" style={{marginTop:8}}>{attendanceCorrectionTimeLine(r)}<br/>사유 {r.reason||"-"}</div>
                <div className="actions"><button className="button danger" onClick={()=>cancelAttendanceCorrection(r.id)}>요청 취소</button></div>
              </div>
            ))}
          </div>
          <div>
            <h3 className="approval-section-title">휴가 신청 {pR.length>0&&<span className="count-badge">{pR.length}</span>}</h3>
            {pR.length===0&&<p className="subtle">없음</p>}
            {pR.map(r=>(<div className="list-row" key={r.id}><div><b>{empName(r.employee_id)}</b><div className="subtle">{leaveTypeDisplayLabel(r)} · {r.start_date}{r.end_date!==r.start_date?"~"+r.end_date:""}{r.start_time?` ${r.start_time.slice(0,5)}~${r.end_time?.slice(0,5)}`:""}</div></div><div className="actions"><button className="button secondary" onClick={()=>reviewRequest(r.id,"approved")}>승인</button><button className="button danger" onClick={()=>reviewRequest(r.id,"rejected")}>반려</button></div></div>))}
          </div>
          <div>
            <h3 className="approval-section-title">기기 {pD.length>0&&<span className="count-badge">{pD.length}</span>}</h3>
            {pD.length===0&&<p className="subtle">없음</p>}
            {pD.map(d=>(<div className="list-row" key={d.id}><div><b>{empName(d.employee_id)}</b><div className="subtle">{d.device_info?.platform||"기기"}</div></div><div className="actions"><button className="button secondary" onClick={()=>reviewDevice(d.id,"approved")}>승인</button><button className="button danger" onClick={()=>reviewDevice(d.id,"rejected")}>반려</button></div></div>))}
          </div>
        </div>
      </section>}

      {view==="approvals"&&<section className="card rejected-archive-card">
        <div className="section-head">
          <div>
            <h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-archive" aria-hidden="true"></i>반려 기록 정리</h2>
            <p className="subtle">근태 이력은 보존하고, 확인 끝난 반려 항목만 관리자 화면에서 숨깁니다.</p>
          </div>
          {hiddenRejectedIds.length>0&&<button className="button ghost" onClick={restoreRejectedArchiveRows}>숨김 초기화</button>}
        </div>
        <div className="rejected-archive-list">
          {rejectedArchiveRows.slice(0,20).map((row:any)=>(
            <div className="rejected-archive-row" key={row.key}>
              <div>
                <span>{row.type}</span>
                <b>{row.employee} · {row.title}</b>
                <small>{row.detail}</small>
                <em>{formatDateTime(row.createdAt)}</em>
              </div>
              <button className="button ghost compact" onClick={()=>hideRejectedArchiveRow(row.key)}>숨기기</button>
            </div>
          ))}
          {rejectedArchiveRows.length===0&&<p className="subtle">정리할 반려 기록이 없습니다.</p>}
        </div>
      </section>}

      {view==="employees"&&selectedDetailEmployee&&<section className="employee-detail-panel">
        <div className="employee-detail-head">
          <div>
            <span>직원 상세</span>
            <h2>{selectedDetailEmployee.name}</h2>
            <p>{selectedDetailEmployee.employee_no} · {[selectedDetailEmployee.department,selectedDetailEmployee.position].filter(Boolean).join(" · ")||"부서/직책 미지정"}</p>
          </div>
          <button className="button secondary" onClick={()=>onNavigate?.("schedule")}><i className="ti ti-calendar-time" aria-hidden="true"></i>일정에서 보기</button>
        </div>
        <div className="employee-detail-picker">
          {activeEmployees.map((employee:any)=>(
            <button key={employee.id} className={selectedDetailEmployee.id===employee.id?"active":""} onClick={()=>setSelectedDetailEmployeeId(employee.id)}>
              <b>{employee.name}</b>
              <span>{employee.employee_no}</span>
            </button>
          ))}
        </div>
        <div className="employee-contract-grid">
          <div><span>계약 유형</span><select className="select compact-select" value={selectedDetailEmployee.contract_type??"daily"} onChange={e=>updateEmployeeContract(selectedDetailEmployee,{contract_type:e.target.value})}>{Object.entries(CONTRACT_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><small>{selectedDetailEmployee.contract_end?`${employeeContractStart(selectedDetailEmployee)} ~ ${selectedDetailEmployee.contract_end}`:`${employeeContractStart(selectedDetailEmployee)}부터`}</small></div>
          <div><span>근무 요일</span><div className="days-grid compact-days">{ALL_DAYS.map(day=><button key={day} type="button" className={`day-btn ${(selectedDetailEmployee.work_days??["mon","tue","wed","thu","fri"]).includes(day)?"active":""}`} onClick={()=>updateEmployeeContract(selectedDetailEmployee,{work_days:toggleDay(selectedDetailEmployee.work_days??["mon","tue","wed","thu","fri"],day)})}>{DAY_LABELS[day]}</button>)}</div><small>일정·급여 계산에 반영</small></div>
          <div><span>근무 시간</span><div className="inline-time-edit"><input className="input" type="time" value={timeLabel(selectedDetailEmployee.work_start??"09:00")} onChange={e=>updateEmployeeContract(selectedDetailEmployee,{work_start:e.target.value})} /><input className="input" type="time" value={timeLabel(selectedDetailEmployee.work_end??"18:00")} onChange={e=>updateEmployeeContract(selectedDetailEmployee,{work_end:e.target.value})} /></div><small>휴게 {timeRangeLabel(selectedBreakStart,selectedBreakEnd)}</small></div>
          <div><span>1일 실근무</span><b>{formatHourValue(selectedDailyHours)}시간</b><small>휴게시간 제외</small></div>
          <div><span>주 소정</span><b>{formatHourValue(selectedWeeklyHours)}시간</b><small>{(selectedDetailEmployee.work_days??["mon","tue","wed","thu","fri"]).length}일 기준</small></div>
          <div><span>이번 달 예정</span><b>{selectedMonthStats?`${selectedMonthStats.days}일 · ${formatHourValue(selectedMonthStats.hours)}시간`:"-"}</b><small>승인된 변경·개별 일정 반영</small></div>
          <div><span>연차 적용</span><b>{selectedDetailEmployee.no_annual_leave?"연차 없음":"자동 계산"}</b><small>{selectedDetailEmployee.no_annual_leave?"직원 관리에도 없음 체크됨":"근무조건 기준으로 산정"}</small></div>
        </div>
        <div className="employee-contract-note">
          <i className="ti ti-info-circle" aria-hidden="true"></i>
          <span>직원 상세의 계약사항은 근무 일정, 지각 기준, 급여 산정의 기준값으로 이어집니다. 휴게시간을 제외한 실근무시간을 먼저 확인하고 세부 예외는 일정 화면에서 조정합니다.</span>
        </div>
      </section>}

      {view==="employees"&&<ApprovedCompCard compRequests={compRequests} leaveRequests={requests} empMap={empMap} onChanged={load} />}
      {view==="employees"&&<AdminCompGrantCard currentEmployee={currentEmployee} onChanged={load} />}

      {view==="employees"&&pT.length>0&&<section className="card">
        <h2 className="card-title"><i className="ti ti-clock-edit" aria-hidden="true"></i>근무시간 변경 요청</h2>
        <div className="grid two">
            {pT.map((r:any)=>(
              <div className="list-row" key={r.id} style={{flexDirection:"column",alignItems:"stretch"}}>
                <div>
                  <b>{empName(r.employee_id)}</b>
                  <div className="subtle">{workChangePeriodLabel(r)} · {workChangeKind(r)}</div>
                </div>
                <div className="type-desc" style={{marginTop:8,marginBottom:0}}>
                  {workChangeConditionLabel(r)}<br/>
                  {workChangeWorkloadLabel(r)}<br/>
                  사유 {r.reason||"-"}
                </div>
                <div className="actions"><button className="button secondary" onClick={()=>reviewWorkTimeRequest(r.id,"approved")}>승인</button><button className="button danger" onClick={()=>reviewWorkTimeRequest(r.id,"rejected")}>반려</button></div>
              </div>
            ))}
        </div>
      </section>}

      {view==="employees"&&<CollapsibleSection title="근무시간 변경 기록" icon="ti-file-description" defaultOpen={false}>
        <p className="subtle" style={{marginBottom:12}}>세무·급여 확인용으로 이번 달 직원별 근무 예정일과 실근무시간을 함께 표시합니다.</p>
        <div className="table-wrap work-time-record-table">
          <table>
            <thead><tr><th>직원</th><th>적용기간</th><th>변경 내용</th><th>근무 산정</th><th>상태</th><th>사유</th></tr></thead>
            <tbody>{workTimeRequests.slice(0,50).map((r:any)=>{
              const employee=empMap[r.employee_id]??{};
              return <tr key={r.id}>
                <td data-label="직원" className="nowrap-cell"><b>{employee.name??empName(r.employee_id)}</b><span>{employee.employee_no??""}</span></td>
                <td data-label="적용기간">{workChangePeriodLabel(r)}</td>
                <td data-label="변경 내용">
                  <span className="work-change-kind">{workChangeKind(r)}</span>
                  <div className="work-change-detail">{workChangeConditionLabel(r)}</div>
                  <small>{workChangePreviousLabel(r)}</small>
                </td>
                <td data-label="근무 산정">{workChangeWorkloadLabel(r)}</td>
                <td data-label="상태"><span className={`badge ${badgeClass(r.status)}`}>{r.status==="pending"?"승인 대기":r.status==="approved"?"승인":"반려"}</span></td>
                <td data-label="사유">{r.reason??"-"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </CollapsibleSection>}

      {view==="employees"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-calendar-check" aria-hidden="true"></i>직원 연차 소진내용</h2>
        <p className="subtle" style={{marginBottom:12}}>반차·연차는 연차 차감으로, 대체휴가 시간 사용은 추가근무 적립분 차감으로 구분해서 표시합니다.</p>
        <div className="comp-employee-filter leave-usage-filter">
          <button className={leaveUsageEmpId==="all"?"active":""} onClick={()=>setLeaveUsageEmpId("all")}>
            <b>전체</b>
            <span>직원별 소진 내역 전체 보기</span>
          </button>
          {activeEmployees.map((employee:any)=>{
            const lv=leaveForEmployee(employee.id);
            return <button key={employee.id} className={leaveUsageEmpId===employee.id?"active":""} onClick={()=>setLeaveUsageEmpId(employee.id)}>
              <b>{employee.name}</b>
              <span>연차 사용 {lv?.used.toFixed(1)??"0.0"}일 · 대체휴가 사용 {formatHourValue(lv?.compUsedH||0)}시간</span>
            </button>;
          })}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>직원</th><th>구분</th><th>기간/시간</th><th>차감 기준</th><th>상태</th><th>사유</th></tr></thead>
            <tbody>
              {leaveUsageRows.slice(0,80).map((request:any)=>(
                <tr key={request.id}>
                  <td data-label="직원"><b>{empName(request.employee_id)}</b></td>
                  <td data-label="구분">{leaveTypeDisplayLabel(request)}</td>
                  <td data-label="기간/시간">{leaveRequestTimeLabel(request)}</td>
                  <td data-label="차감 기준"><span className={isCompLeaveUsageRequest(request)?"leave-source comp":"leave-source annual"}>{leaveDeductionLabel(request)}</span></td>
                  <td data-label="상태"><span className={`badge ${badgeClass(request.status)}`}>{request.status==="pending"?"승인 대기":request.status==="approved"?"승인":"반려"}</span></td>
                  <td data-label="사유">{request.reason??"-"}</td>
                </tr>
              ))}
              {leaveUsageRows.length===0&&<tr><td colSpan={6} className="subtle">휴가 사용 기록이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      {view==="employees"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-chart-pie" aria-hidden="true"></i>직원 연차 현황</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>직원</th><th>총 부여</th><th>사용</th><th>잔여</th><th>대체휴가</th><th>관리</th></tr></thead>
            <tbody>
              {employees.filter(e=>e.employment_status==="active").map(e=>{
                const lv=leaveForEmployee(e.id); if(!lv) return null;
                return (<tr key={e.id}><td><b>{e.name}</b><br /><span className="subtle">{e.employee_no}</span>{e.no_annual_leave&&<><br/><span className="badge warn">연차 없음</span></>}</td><td>{lv.total.toFixed(1)}일</td><td>{lv.used.toFixed(1)}일</td><td><b style={{color:lv.remain<3?"var(--red)":"inherit"}}>{lv.remain.toFixed(1)}일</b></td><td>{lv.compEarned.toFixed(1)}일 ({lv.compRemainH}h)</td><td><button className="button secondary" onClick={()=>setLeaveModalEmp(e)}>연차 관리</button></td></tr>);
              })}
            </tbody>
          </table>
        </div>
      </section>}

      {view==="rnr"&&<section className="card rnr-card">
        <h2 className="card-title"><i className="ti ti-sitemap" aria-hidden="true"></i>업무 R&R 정리</h2>
        <p className="subtle" style={{marginBottom:12}}>업무를 편하게 적으면 부서/직책/업무명으로 정리해서 누적합니다. 다음 직원이 같은 역할을 맡을 때 기준 업무로 볼 수 있습니다.</p>
        {rnrMsg&&<div className={`alert ${rnrMsg.includes("저장")?"success":""}`}>{rnrMsg}</div>}
        <div className="grid two">
          <div>
            <div className="form-row"><label className="label">업무 메모</label><textarea className="textarea rnr-textarea" value={rnrInput} onChange={e=>setRnrInput(e.target.value)} placeholder="예: 내일 오전에 학교 제출용 서류 정리하고, 영수증은 민지한테 맡기고, 교육장 비품은 사무보조가 체크하게 해줘." /></div>
            <button className="button" disabled={rnrBusy} onClick={suggestRnr}><i className="ti ti-sparkles" aria-hidden="true"></i>{rnrBusy?"정리 중":"AI로 정리"}</button>
          </div>
          <div className="rnr-suggestion-box">
            {rnrSuggestion ? (
              <>
                <div className="rnr-result-head"><b>{professionalRnrTitle(rnrSuggestion.title||rnrInput,rnrSuggestion.category||classifyRnrCategory(rnrInput))}</b><span>{rnrSuggestion.department||"부서 미정"} · {rnrSuggestion.position||"직책 미정"} · {rnrSuggestion.category||"업무분류 미정"}</span></div>
                <p>{rnrSuggestion.summary}</p>
                <div className="form-row"><label className="label">담당 직원</label>
                  <select className="select" value={rnrAssigneeId} onChange={e=>setRnrAssigneeId(e.target.value)}>
                    <option value="">직책 기준으로 저장</option>
                    {employees.filter(e=>e.employment_status==="active").map(e=><option key={e.id} value={e.id}>{e.name} {e.department||e.position?`· ${e.department??""} ${e.position??""}`:""}</option>)}
                  </select>
                </div>
                <ul className="rnr-checklist">{(rnrSuggestion.checklist??[]).map((item:string,index:number)=><li key={index}>{item}</li>)}</ul>
                <button className="button full" onClick={saveRnrEntry}>R&R에 저장</button>
              </>
            ) : (
              <div className="type-desc">
                <b>기본 역할 추천</b>
                <div className="rnr-role-guide">
                  {RNR_BASELINE_ROLES.map(role=>(
                    <div className="rnr-role-guide-row" key={role.position}>
                      <strong>{role.department} · {role.position}</strong>
                      <span>{role.duties.slice(0,3).join(" · ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="rnr-board">
          {rnrEntries.length===0 ? <p className="subtle">아직 저장된 R&R이 없습니다.</p> : rnrEntries.slice(0,12).map(entry=>(
            <button className="rnr-entry rnr-entry-button" key={entry.id} onClick={()=>openRnr(entry)}>
              <span>{entry.department||"공통"} · {entry.position||entry.category||"업무"}</span>
              <b>{rnrDisplayTitle(entry)}</b>
              <small>담당 {rnrAssigneeName(entry)} · 자세히 보기</small>
            </button>
          ))}
        </div>
        <div className="rnr-section-title"><b>부서·직책·업무별 R&R 스택</b><span>같은 유형의 업무가 쌓여 다음 담당자가 기준 업무를 빠르게 볼 수 있습니다.</span></div>
        <div className="rnr-department-tabs">
          <button className={rnrDepartmentFilter==="all"?"active":""} onClick={()=>setRnrDepartmentFilter("all")}>전체</button>
          {rnrDepartments.map((department:string)=><button key={department} className={rnrDepartmentFilter===department?"active":""} onClick={()=>setRnrDepartmentFilter(department)}>{department}</button>)}
        </div>
        <div className="rnr-stack-board">
          {visibleRnrStackGroups.length===0 ? <p className="subtle">분류할 R&R이 없습니다.</p> : visibleRnrStackGroups.map((group:any)=>(
            <div className="rnr-stack-column" key={group.key}>
              <div className="rnr-person-head"><b>{group.department}</b><span>{group.position} · {group.category}</span></div>
              {group.entries.map((entry:any)=>(
                <button className="rnr-person-task" key={entry.id} onClick={()=>openRnr(entry)}>
                  <b>{rnrDisplayTitle(entry)}</b>
                  <span>담당 {rnrAssigneeName(entry)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="rnr-person-board">
          {rnrBoardColumns.length===0 ? <p className="subtle">담당자별로 표시할 R&R이 없습니다.</p> : rnrBoardColumns.map(column=>(
            <div className="rnr-person-column" key={column.key}>
              <div className="rnr-person-head"><b>{column.title}</b><span>{column.subtitle}</span></div>
              {column.entries.map((entry:any)=>(
                <button className="rnr-person-task" key={entry.id} onClick={()=>openRnr(entry)}>
                  <b>{rnrDisplayTitle(entry)}</b>
                  <span>{entry.department||"공통"} · {entry.position||entry.category||"업무"}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>}

      {selectedRnr&&<div className="modal-backdrop" onClick={()=>setSelectedRnr(null)}>
        <div className="modal-box" style={{maxWidth:560}} onClick={e=>e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="card-title" style={{margin:0}}><i className="ti ti-sitemap" aria-hidden="true"></i>{rnrDisplayTitle(selectedRnr)}</h2>
            <button className="modal-close" title="닫기" onClick={()=>setSelectedRnr(null)}><i className="ti ti-x" aria-hidden="true"></i></button>
          </div>
          {editingRnr ? (
            <div className="rnr-edit-form">
              <div className="form-row"><label className="label">공식 업무명</label><input className="input" value={editingRnr.title??""} onChange={e=>setEditingRnr({...editingRnr,title:e.target.value})} /></div>
              <div className="grid three">
                <div className="form-row"><label className="label">부서</label><select className="select" value={editingRnr.department??""} onChange={e=>setEditingRnr({...editingRnr,department:e.target.value})}>{DEPARTMENT_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"공통"}</option>)}</select></div>
                <div className="form-row"><label className="label">직책</label><select className="select" value={editingRnr.position??""} onChange={e=>setEditingRnr({...editingRnr,position:e.target.value})}>{POSITION_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"공통"}</option>)}</select></div>
                <div className="form-row"><label className="label">업무 분류</label><select className="select" value={editingRnr.category??""} onChange={e=>setEditingRnr({...editingRnr,category:e.target.value})}>{RNR_CATEGORY_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"미분류"}</option>)}</select></div>
              </div>
              <div className="form-row"><label className="label">담당 직원</label><select className="select" value={editingRnr.assigned_employee_id??""} onChange={e=>setEditingRnr({...editingRnr,assigned_employee_id:e.target.value})}><option value="">직책 기준</option>{employees.filter(e=>e.employment_status==="active").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
              <div className="form-row"><label className="label">업무 설명</label><textarea className="textarea" value={editingRnr.summary??""} onChange={e=>setEditingRnr({...editingRnr,summary:e.target.value})} /></div>
              <div className="form-row"><label className="label">체크리스트</label><textarea className="textarea compact-textarea" value={editingRnr.checklistText??""} onChange={e=>setEditingRnr({...editingRnr,checklistText:e.target.value})} placeholder={"한 줄에 하나씩 입력"} /></div>
            </div>
          ) : (
            <div className="consent-preview">
              <dl>
                <div><dt>담당</dt><dd>{rnrAssigneeName(selectedRnr)}</dd></div>
                <div><dt>부서</dt><dd>{selectedRnr.department||"공통"}</dd></div>
                <div><dt>직책</dt><dd>{selectedRnr.position||"-"}</dd></div>
                <div><dt>업무 분류</dt><dd>{selectedRnr.category||"기타"}</dd></div>
              </dl>
              <div className="type-desc"><b>업무 설명</b><ul className="rnr-duty-list detail">{rnrDescriptionLines(selectedRnr).map((line:string,index:number)=><li key={index}>{line}</li>)}</ul></div>
            </div>
          )}
          <div className="actions rnr-modal-actions" style={{justifyContent:"flex-end",marginTop:16}}>
            {editingRnr ? <><button className="button ghost" onClick={()=>setEditingRnr(null)}>취소</button><button className="button" onClick={saveEditedRnr}>수정 저장</button></> : <><button className="button secondary" onClick={()=>sendRnrToTodayTask(selectedRnr)}><i className="ti ti-clipboard-plus" aria-hidden="true"></i>오늘의 할일</button><button className="button ghost" onClick={()=>beginEditRnr(selectedRnr)}><i className="ti ti-edit" aria-hidden="true"></i>수정</button><button className="button" onClick={()=>setSelectedRnr(null)}>확인</button></>}
          </div>
        </div>
      </div>}

      {view==="employees"&&<section className="card">
        <CollapsibleSection title="직원 계정 생성" icon="ti-user-plus" defaultOpen={false}>
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
          <div className="grid three">
            <div className="form-row"><label className="label">부서</label><select className="select nowrap-select" value={newEmployee.department} onChange={e=>setNewEmployee({...newEmployee,department:e.target.value})}>{DEPARTMENT_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"없음"}</option>)}</select></div>
            <div className="form-row"><label className="label">직책/역할</label><select className="select nowrap-select" value={newEmployee.position} onChange={e=>setNewEmployee({...newEmployee,position:e.target.value})}>{POSITION_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"없음"}</option>)}</select></div>
            <label className="checkbox no-wrap-checkbox" style={{alignSelf:"end",marginBottom:10}}><input type="checkbox" checked={newEmployee.no_annual_leave} onChange={e=>{const checked=e.target.checked; setNewEmployee({...newEmployee,no_annual_leave:checked}); if(checked) setMessage(annualLeaveEligibilityNote({...newEmployee,work_start:"09:00",work_end:"18:00"}));}} /> 연차 없음</label>
          </div>
          <div className="form-row"><label className="label">출근 요일</label>
            <div className="days-grid">{ALL_DAYS.map(d=><button key={d} type="button" className={`day-btn ${newEmployee.work_days.includes(d)?"active":""}`} onClick={()=>setNewEmployee(current=>({...current,work_days:toggleDay(current.work_days,d)}))}>{DAY_LABELS[d]}</button>)}</div>
          </div>
          {newEmployee.no_annual_leave&&<div className="alert">{annualLeaveEligibilityNote({...newEmployee,work_start:"09:00",work_end:"18:00"})}</div>}
          <button className="button" onClick={createEmployee}><i className="ti ti-plus" aria-hidden="true"></i>직원 생성</button>
        </CollapsibleSection>
      </section>}

      {view==="employees"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-users" aria-hidden="true"></i>직원 관리</h2>
        <div className="tabs">
          <button className={`tab ${employeeFilter==="active"?"active":""}`} onClick={()=>setEmployeeFilter("active")}>재직</button>
          <button className={`tab ${employeeFilter==="inactive"?"active":""}`} onClick={()=>setEmployeeFilter("inactive")}>비활성</button>
          <button className={`tab ${employeeFilter==="all"?"active":""}`} onClick={()=>setEmployeeFilter("all")}>전체</button>
        </div>
        <div className="table-wrap employee-table-wrap">
          <table className="employee-admin-table">
            <thead><tr><th>직원</th><th>부서/직책</th><th>권한</th><th>상태</th><th>입사일</th><th>출근 시작일</th><th>연차</th><th>계정</th><th>처리</th></tr></thead>
            <tbody>
              {filtered.map(e=>(
                <tr key={e.id}>
                  <td data-label="직원"><div className="employee-identity"><b>{e.name}</b><span>{e.employee_no}</span><small>{e.phone||"-"}</small></div></td>
                  <td data-label="부서/직책"><div className="grid" style={{gap:6}}>
                    <select className="select nowrap-select" value={e.department??""} onChange={ev=>updateEmployee(e.id,{department:ev.target.value})}>
                      {DEPARTMENT_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"없음"}</option>)}
                      {e.department&&!DEPARTMENT_OPTIONS.includes(e.department)&&<option value={e.department}>{e.department}</option>}
                    </select>
                    <select className="select nowrap-select" value={e.position??""} onChange={ev=>updateEmployee(e.id,{position:ev.target.value})}>
                      {POSITION_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"없음"}</option>)}
                      {e.position&&!POSITION_OPTIONS.includes(e.position)&&<option value={e.position}>{e.position}</option>}
                    </select>
                  </div></td>
                  <td data-label="권한"><select className="select" value={e.role} onChange={ev=>updateEmployee(e.id,{role:ev.target.value})}><option value="admin">관리자</option><option value="employee">직원</option></select></td>
                  <td data-label="상태"><span className={`badge employee-status-badge ${badgeClass(e.employment_status)}`}>{e.employment_status==="active"?"재직":"비활성"}</span></td>
                  <td data-label="입사일"><input className="input" type="date" value={e.joined_at??""} onChange={ev=>updateEmployee(e.id,{joined_at:ev.target.value})} /></td>
                  <td data-label="출근 시작일"><input className="input" type="date" value={e.work_start_date??e.joined_at??""} onChange={ev=>updateEmployee(e.id,{work_start_date:ev.target.value})} /></td>
                  <td data-label="연차"><label className="checkbox no-wrap-checkbox" title={annualLeaveEligibilityNote(e)} style={{margin:0}}><input type="checkbox" checked={!!e.no_annual_leave} onChange={ev=>{if(ev.target.checked) setMessage(annualLeaveEligibilityNote(e)); updateEmployee(e.id,{no_annual_leave:ev.target.checked});}} /> 없음</label></td>
                  <td data-label="계정"><div className="employee-account-actions"><button className="button ghost compact" onClick={()=>resetEmployeeNo(e)}>사번 변경</button><button className="button ghost compact" onClick={()=>resetPassword(e)}>비번 초기화</button></div></td>
                  <td data-label="처리"><button className={`${e.employment_status==="active"?"button danger":"button secondary"} compact employee-status-action`} onClick={()=>toggleEmployee(e.id,e.employment_status)}>{e.employment_status==="active"?"비활성화":"활성화"}</button></td>
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
  const [workTimeChanges,setWorkTimeChanges]=useState<any[]>([]);
  const [absences,setAbsences]=useState<any[]>([]);
  const [scheduleEvents,setScheduleEvents]=useState<any[]>([]);
  const [leaveRequests,setLeaveRequests]=useState<any[]>([]);
  const [compTimeRequests,setCompTimeRequests]=useState<any[]>([]);
  const [msg,setMsg]=useState("");
  async function load(){
    const [e,ov,wt,ab,se,lr,cr]=await Promise.all([
      supabase.from("employees").select("*").order("employee_no",{ascending:true}),
      supabase.from("weekly_schedule_overrides").select("*").order("week_start",{ascending:false}).limit(200),
      supabase.from("work_time_change_requests").select("*").order("created_at",{ascending:false}).limit(300),
      supabase.from("employee_absences").select("*").order("start_date",{ascending:false}),
      supabase.from("employee_schedule_events").select("*").order("start_date",{ascending:true}),
      supabase.from("attendance_requests").select("*").eq("status","approved").order("start_date",{ascending:true}),
      supabase.from("comp_time_requests").select("*").in("status",["pending","approved"]).order("work_date",{ascending:true}),
    ]);
    const list=e.data??[]; const map:Record<string,any>={}; list.forEach((x:any)=>{map[x.id]=x;});
    setEmployees(list); setEmpMap(map); setOverrides(ov.data??[]); setWorkTimeChanges(wt.data??[]); setAbsences(ab.data??[]); setScheduleEvents(se.data??[]); setLeaveRequests(lr.data??[]); setCompTimeRequests(cr.data??[]);
  }
  useEffect(()=>{load();},[]);
  function empName(id?:string|null){return id&&empMap[id]?empMap[id].name:"-";}
  return <div className="grid">
    {section==="schedule"&&<>
      <TeamScheduleBoard employees={employees} events={scheduleEvents} overrides={overrides} workTimeChanges={workTimeChanges} leaveRequests={leaveRequests} compTimeRequests={compTimeRequests} currentEmployee={currentEmployee} onChanged={load} />
      <ScheduleCard employees={employees} empMap={empMap} overrides={overrides} absences={absences} currentEmployee={currentEmployee} empName={empName} onChanged={load} setMsg={setMsg} msg={msg} />
    </>}
    {section==="payroll"&&<PayrollCard employees={employees} absences={absences} overrides={overrides} workTimeChanges={workTimeChanges} />}
  </div>;
}

function TeamScheduleBoard({employees,events,overrides,workTimeChanges,leaveRequests,compTimeRequests,currentEmployee,onChanged}:{employees:any[];events:any[];overrides:any[];workTimeChanges:any[];leaveRequests:any[];compTimeRequests:any[];currentEmployee:any;onChanged:()=>void}) {
  const [employeeOrder,setEmployeeOrder]=useState<string[]>(()=>{
    try{return JSON.parse(localStorage.getItem("lupl_schedule_employee_order")??"[]");}catch{return [];}
  });
  const activeEmployees=employees
    .filter(e=>e.employment_status==="active")
    .sort((a,b)=>{
      const ai=employeeOrder.indexOf(a.id),bi=employeeOrder.indexOf(b.id);
      if(ai>=0||bi>=0) return (ai<0?9999:ai)-(bi<0?9999:bi);
      return String(a.employee_no??"").localeCompare(String(b.employee_no??""));
    });
  const [weekAnchor,setWeekAnchor]=useState(todayIso());
  const [selectedEmpId,setSelectedEmpId]=useState("all");
  const [editing,setEditing]=useState<any|null>(null);
  const [message,setMessage]=useState("");
  const [draggingId,setDraggingId]=useState<string|null>(null);
  const [draggingEmployeeId,setDraggingEmployeeId]=useState<string|null>(null);
  const [movingBase,setMovingBase]=useState<{employeeId:string;employeeName:string;sourceDate:string}|null>(null);
  const [timeDrag,setTimeDrag]=useState<any|null>(null);
  const [scheduleCommand,setScheduleCommand]=useState("");
  const timeDragRef=useRef<any|null>(null);
  const timeDragClickGuard=useRef(0);
  const weekStart=weekStartIso(weekAnchor);
  const dates=Array.from({length:5},(_,i)=>addIsoDays(weekStart,i));
  const weekEnd=dates[4];
  const monthRange=monthRangeFor(weekAnchor);
  const isAll=selectedEmpId==="all";
  const employeeCount=Math.max(1,activeEmployees.length);
  const teamColumnCount=dates.length*employeeCount;
  const selectedEmployee=isAll?null:(activeEmployees.find(e=>e.id===selectedEmpId)??activeEmployees[0]??null);
  const selectedEvents=events.filter(e=>(isAll||e.employee_id===selectedEmployee?.id)&&e.start_date<=weekEnd&&e.end_date>=weekStart);
  const allDayEvents=isAll?[]:selectedEvents.filter(e=>e.event_type==="info"&&!e.start_time&&!e.end_time);
  const timedEvents=isAll?selectedEvents:selectedEvents.filter(e=>!allDayEvents.includes(e));
  const visibleEmployees=isAll?activeEmployees:(selectedEmployee?[selectedEmployee]:[]);
  const visibleLeaveEvents=dates.flatMap(date=>visibleEmployees.flatMap(employee=>leaveEventsFor(employee,date)));
  const visibleOvertimeEvents=dates.flatMap(date=>visibleEmployees.flatMap(employee=>overtimeEventsFor(employee,date)));
  const visibleScheduleRanges=dates.flatMap(date=>visibleEmployees.map(employee=>getScheduleForDate(employee,date,overrides,workTimeChanges)));
  const visibleStartMinutes=[
    ...visibleScheduleRanges.map(schedule=>timeToMinutes(schedule.work_start)).filter((v):v is number=>v!=null),
    ...timedEvents.map(e=>timeToMinutes(e.start_time)).filter((v):v is number=>v!=null),
    ...visibleLeaveEvents.map(e=>timeToMinutes(e.start_time)).filter((v):v is number=>v!=null),
    ...visibleOvertimeEvents.map(e=>timeToMinutes(e.start_time)).filter((v):v is number=>v!=null),
  ];
  const visibleEndMinutes=[
    ...visibleScheduleRanges.map(schedule=>timeToMinutes(schedule.work_end)).filter((v):v is number=>v!=null),
    ...timedEvents.map(e=>timeToMinutes(e.end_time)).filter((v):v is number=>v!=null),
    ...visibleLeaveEvents.map(e=>timeToMinutes(e.end_time)).filter((v):v is number=>v!=null),
    ...visibleOvertimeEvents.map(e=>timeToMinutes(e.end_time)).filter((v):v is number=>v!=null),
  ];
  const calendarStartHour=Math.max(0,Math.min(9,Math.floor(Math.min(...visibleStartMinutes,9*60)/60)));
  const calendarEndHour=Math.min(24,Math.max(19,Math.ceil(Math.max(...visibleEndMinutes,19*60)/60)));
  const calendarStartMin=calendarStartHour*60;
  const calendarEndMin=calendarEndHour*60;
  const calendarRows=(calendarEndHour-calendarStartHour)*2;
  const calendarRowHeight=24;
  const calendarHeight=calendarRows*calendarRowHeight;
  const hours=Array.from({length:calendarEndHour-calendarStartHour+1},(_,i)=>calendarStartHour+i);
  const selectedColor=selectedEmployee?employeeColorFromList(activeEmployees,selectedEmployee.id):EMPLOYEE_COLORS[0];
  useEffect(()=>{
    if(selectedEmpId!=="all"&&!activeEmployees.some(e=>e.id===selectedEmpId)) setSelectedEmpId("all");
  },[activeEmployees.length,selectedEmpId]);
  useEffect(()=>{
    const ids=activeEmployees.map(employee=>employee.id);
    const normalized=[...employeeOrder.filter(id=>ids.includes(id)),...ids.filter(id=>!employeeOrder.includes(id))];
    if(normalized.join("|")!==employeeOrder.join("|")){
      setEmployeeOrder(normalized);
      localStorage.setItem("lupl_schedule_employee_order",JSON.stringify(normalized));
    }
  },[employees.length]);
  function emptyEvent(employeeId=selectedEmployee?.id??activeEmployees[0]?.id??"",date=todayIso()){
    return {employee_id:employeeId,title:"",event_type:"info",start_date:date,end_date:date,start_time:"",end_time:"",note:"",apply_all:false};
  }
  function commandDays(text:string, fallback:string[]){
    if(/평일|월\s*~\s*금|월-금/.test(text)) return ["mon","tue","wed","thu","fri"];
    const found=ALL_DAYS.filter(day=>{
      if(day==="sun") return /일\s*요일|일요일/.test(text);
      return new RegExp(`${DAY_LABELS[day]}\\s*(?:요일)?`).test(text);
    });
    return found.length>0?found:fallback;
  }
  function commandTargetEmployee(text:string){
    const compact=text.replace(/\s/g,"");
    return [...activeEmployees]
      .sort((a,b)=>String(b.name??"").length-String(a.name??"").length)
      .find(employee=>compact.includes(String(employee.name??"").replace(/\s/g,""))||compact.includes(String(employee.employee_no??"").replace(/\s/g,"")))
      ?? selectedEmployee;
  }
  async function applyScheduleCommand(){
    const raw=scheduleCommand.trim();
    if(!raw) return setMessage("변경할 일정을 한 줄로 입력해주세요. 예: 홍준기 월화수 09:00~18:00");
    const employee=commandTargetEmployee(raw);
    if(!employee) return setMessage("직원 이름을 찾지 못했습니다. 예: 홍준기 월화수 09:00~18:00");
    const oldDays=employee.work_days??["mon","tue","wed","thu","fri"];
    const nextDays=commandDays(raw,oldDays);
    const parsedTime=parsePromptTimeRange(raw);
    const nextStart=parsedTime?.start??String(employee.work_start??"09:00").slice(0,5);
    const nextEnd=parsedTime?.end??String(employee.work_end??"18:00").slice(0,5);
    const dailyHours=netDailyHours(nextStart,nextEnd,"12:00","13:00");
    const weeklyWorkDays=nextDays.length;
    const monthlyStandardHours=Math.round(weeklyWorkDays*dailyHours*4.345*10)/10;
    const preview=[
      `${employee.name} 직원의 기본 근무일정을 변경합니다.`,
      `기존: ${daysLabel(oldDays)} · ${timeRangeLabel(employee.work_start??"09:00",employee.work_end??"18:00")}`,
      `변경: ${daysLabel(nextDays)} · ${timeRangeLabel(nextStart,nextEnd)}`,
      `주 ${formatHourValue(dailyHours*weeklyWorkDays)}시간 · 월 ${formatHourValue(monthlyStandardHours)}시간 기준`,
      "",
      "이 일정대로 변경 맞나요?"
    ].join("\n");
    if(!window.confirm(preview)) return;
    const {error}=await supabase.from("employees").update({
      work_days:nextDays,
      work_start:nextStart,
      work_end:nextEnd,
      weekly_work_days:weeklyWorkDays,
      daily_work_hours:dailyHours,
      monthly_standard_hours:monthlyStandardHours,
    }).eq("id",employee.id);
    if(error) return setMessage(`일정 변경 실패: ${error.message}`);
    const currentWeekStart=weekStartIso(todayIso());
    await Promise.all(overrides.filter((override:any)=>override.employee_id===employee.id&&override.week_start>=currentWeekStart).map(async (override:any)=>{
      const overrideDays=override.work_days??oldDays;
      const hasRemovedDay=overrideDays.some((day:string)=>!nextDays.includes(day));
      const timeMatchesOld=timeLabel(override.work_start)===timeLabel(employee.work_start??"09:00")&&timeLabel(override.work_end)===timeLabel(employee.work_end??"18:00");
      if(!hasRemovedDay&&!timeMatchesOld) return null;
      return supabase.from("weekly_schedule_overrides").update({
        work_days:hasRemovedDay?overrideDays.filter((day:string)=>nextDays.includes(day)):overrideDays,
        work_start:timeMatchesOld?nextStart:override.work_start,
        work_end:timeMatchesOld?nextEnd:override.work_end,
      }).eq("id",override.id);
    }));
    setScheduleCommand("");
    setMessage(`${employee.name} 기본 근무일정을 변경했습니다.`);
    await onChanged();
  }
  function changeWeek(offset:number){setWeekAnchor(addIsoDays(weekStart,offset*7));}
  function goToday(){
    setWeekAnchor(todayIso());
    window.setTimeout(()=>{
      document.querySelector(".week-day-column.today,.team-day-head.today")?.scrollIntoView({block:"nearest",inline:"center"});
    },80);
  }
  function eventTime(event:any,employee=selectedEmployee){
    const defaults:Record<string,[string,string]>={
      work:[String(employee?.work_start??"09:00").slice(0,5),String(employee?.work_end??"18:00").slice(0,5)],
      am_only:["09:00","12:00"],
      pm_only:["13:00","18:00"],
      unavailable:["09:00","19:00"],
      info:["09:00","18:00"],
      leave:[String(employee?.work_start??"09:00").slice(0,5),String(employee?.work_end??"18:00").slice(0,5)],
      overtime:[String(employee?.work_end??"18:00").slice(0,5),"20:00"],
    };
    const fallback=defaults[event.event_type]??defaults.info;
    return [String(event.start_time??fallback[0]).slice(0,5),String(event.end_time??fallback[1]).slice(0,5)];
  }
  function timeGridPosition(event:any,employee=selectedEmployee){
    const [start,end]=eventTime(event,employee);
    const startMin=Math.max(calendarStartMin,Math.min(calendarEndMin-30,timeToMinutes(start)??calendarStartMin));
    const endMin=Math.max(startMin+30,Math.min(calendarEndMin,timeToMinutes(end)??calendarEndMin));
    return {row:Math.floor((startMin-calendarStartMin)/30)+1,span:Math.max(1,Math.ceil((endMin-startMin)/30)),start,end,label:`${start}~${end}`};
  }
  async function saveEvent(){
    if(!editing?.employee_id) return setMessage("직원을 선택해주세요.");
    if(!editing.start_date||!editing.end_date||editing.end_date<editing.start_date) return setMessage("일정 기간을 확인해주세요.");
    if(editing.fromBase&&editing.apply_all){
      const {error}=await supabase.from("employees").update({
        work_start:editing.start_time||"09:00",
        work_end:editing.end_time||"18:00",
        schedule_title:String(editing.title??""),
        schedule_note:String(editing.note??""),
      }).eq("id",editing.employee_id);
      if(error) setMessage(`전체 변경 실패: ${error.message}`);
      else{setMessage("이 직원의 모든 기본 근무요일과 출근 스케줄을 변경했습니다.");setEditing(null);await onChanged();}
      return;
    }
    const payload={
      employee_id:editing.employee_id,
      title:String(editing.title??"").trim(),
      event_type:editing.event_type==="hidden"?"hidden":editing.event_type,
      start_date:editing.start_date,
      end_date:editing.end_date,
      start_time:editing.start_time||null,
      end_time:editing.end_time||null,
      note:String(editing.note??"").trim()||null,
      updated_at:new Date().toISOString(),
    };
    let result;
    if(editing.id&&editing.apply_all){
      result=await supabase.from("employee_schedule_events").update({
        title:payload.title,
        event_type:payload.event_type,
        start_time:payload.start_time,
        end_time:payload.end_time,
        note:payload.note,
        updated_at:payload.updated_at,
      }).eq("employee_id",editing.employee_id).eq("title",editing.original_title??editing.title);
    }else{
      result=editing.id
        ? await supabase.from("employee_schedule_events").update(payload).eq("id",editing.id)
        : await supabase.from("employee_schedule_events").insert({...payload,created_by:currentEmployee.id});
    }
    if(result.error) setMessage(`저장 실패: ${result.error.message}`);
    else{setMessage("직원 일정이 저장되었습니다.");setEditing(null);await onChanged();}
  }
  async function deleteEvent(){
    if(editing?.fromBase){
      if(!window.confirm(`${editing.title||"기본 근무"} 일정을 삭제할까요?`)) return;
      const employee=activeEmployees.find(e=>e.id===editing.employee_id);
      if(!employee) return setMessage("직원을 찾지 못했습니다.");
      const sourceDate=editing.source_date??editing.start_date;
      const sourceDay=dayKeyFromDate(dateFromIso(sourceDate));
      const currentDays=employee.work_days??["mon","tue","wed","thu","fri"];
      const nextDays=currentDays.filter((day:string)=>day!==sourceDay);
      const {error}=await supabase.from("employees").update({work_days:nextDays}).eq("id",editing.employee_id);
      if(error) setMessage(`삭제 실패: ${error.message}`);
      else{setMessage(`${employee.name} ${DAY_LABELS[sourceDay]}요일 기본 근무를 삭제했습니다.`);setEditing(null);await onChanged();}
      return;
    }
    if(!editing?.id||!window.confirm(`${editing.title} 일정을 삭제할까요?`)) return;
    const {error}=await supabase.from("employee_schedule_events").delete().eq("id",editing.id);
    if(error) setMessage(`삭제 실패: ${error.message}`); else{setMessage("일정을 삭제했습니다.");setEditing(null);await onChanged();}
  }
  function startMoveBaseWorkday(){
    if(!editing?.fromBase) return;
    const employee=activeEmployees.find(e=>e.id===editing.employee_id);
    if(!employee) return setMessage("직원을 찾지 못했습니다.");
    const sourceDate=editing.source_date??editing.start_date;
    setMovingBase({employeeId:employee.id,employeeName:employee.name,sourceDate});
    setEditing(null);
    setMessage(`${employee.name} ${DAY_LABELS[dayKeyFromDate(dateFromIso(sourceDate))]}요일 근무를 이동할 날짜 칸을 눌러주세요.`);
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
  async function moveBaseWorkday(targetEmployeeId:string,targetDate:string){
    if(!movingBase) return;
    if(targetEmployeeId!==movingBase.employeeId) return setMessage("기본 근무요일 이동은 같은 직원 칸 안에서만 가능합니다.");
    const employee=activeEmployees.find(e=>e.id===movingBase.employeeId);
    if(!employee) return setMovingBase(null);
    const sourceDay=dayKeyFromDate(dateFromIso(movingBase.sourceDate));
    const targetDay=dayKeyFromDate(dateFromIso(targetDate));
    if(sourceDay===targetDay){setMovingBase(null);return setMessage("같은 날짜라 이동하지 않았습니다.");}
    const currentDays=employee.work_days??["mon","tue","wed","thu","fri"];
    if(currentDays.includes(targetDay)) return setMessage(`${movingBase.employeeName}은 이미 ${DAY_LABELS[targetDay]}요일 근무로 설정되어 있습니다.`);
    const nextDays=ALL_DAYS.filter(day=>(currentDays.includes(day)&&day!==sourceDay)||day===targetDay);
    const {error}=await supabase.from("employees").update({work_days:nextDays}).eq("id",movingBase.employeeId);
    if(error) setMessage(`근무요일 이동 실패: ${error.message}`);
    else { setMessage(`${movingBase.employeeName} ${DAY_LABELS[sourceDay]}요일 근무를 ${DAY_LABELS[targetDay]}요일로 이동했습니다.`); setMovingBase(null); await onChanged(); }
  }
  function handleScheduleCellClick(employeeId:string,date:string){
    if(movingBase) moveBaseWorkday(employeeId,date);
  }
  async function reorderEmployees(targetEmployeeId:string){
    if(!draggingEmployeeId||draggingEmployeeId===targetEmployeeId) return setDraggingEmployeeId(null);
    const reordered=[...activeEmployees];
    const from=reordered.findIndex(employee=>employee.id===draggingEmployeeId);
    const to=reordered.findIndex(employee=>employee.id===targetEmployeeId);
    if(from<0||to<0) return setDraggingEmployeeId(null);
    const [moved]=reordered.splice(from,1);
    reordered.splice(to,0,moved);
    setDraggingEmployeeId(null);
    const order=reordered.map(employee=>employee.id);
    setEmployeeOrder(order);
    localStorage.setItem("lupl_schedule_employee_order",JSON.stringify(order));
    setMessage("직원 표시 순서를 변경했습니다.");
  }
  function leaveEventsFor(employee:any,date:string){
    return leaveRequests
      .filter(request=>request.employee_id===employee.id&&date>=request.start_date&&date<=request.end_date)
      .map(request=>{
        const schedule=getScheduleForDate(employee,date,overrides,workTimeChanges);
        let start=String(schedule.work_start??"09:00").slice(0,5);
        let end=String(schedule.work_end??"18:00").slice(0,5);
        if(request.request_type==="half_am"){start=String(request.start_time??start).slice(0,5);end=String(request.end_time??"14:00").slice(0,5);}
        if(request.request_type==="half_pm"){start=String(request.start_time??"14:00").slice(0,5);end=String(request.end_time??end).slice(0,5);}
        if(["hourly","comp_leave_use"].includes(request.request_type)){start=String(request.start_time??start).slice(0,5);end=String(request.end_time??end).slice(0,5);}
        return {
          id:`leave-${request.id}-${date}`,
          employee_id:employee.id,
          title:leaveTypeDisplayLabel(request),
          event_type:"leave",
          start_date:date,
          end_date:date,
          start_time:start,
          end_time:end,
          note:request.reason??"",
          leave:true,
          request_type:request.request_type,
        };
      });
  }
  function overtimeEventsFor(employee:any,date:string){
    return compTimeRequests
      .filter(request=>request.employee_id===employee.id&&request.work_date===date&&request.start_time&&request.end_time)
      .map(request=>({
        id:`overtime-${request.id}`,
        employee_id:employee.id,
        title:request.status==="approved"?"승인 추가근무":"추가근무 신청",
        event_type:"overtime",
        start_date:date,
        end_date:date,
        start_time:String(request.start_time).slice(0,5),
        end_time:String(request.end_time).slice(0,5),
        note:request.reason??"",
        readonly:true,
        overtimeStatus:request.status,
      }));
  }
  function beginTimeDrag(e:React.PointerEvent,event:any,employee:any,date:string,edge:"move"|"start"|"end"){
    e.preventDefault();
    e.stopPropagation();
    const [start,end]=eventTime(event,employee);
    const drag={event,employee,date,edge,startY:e.clientY,startMin:timeToMinutes(start)??540,endMin:timeToMinutes(end)??1080};
    timeDragRef.current=drag;
    setTimeDrag(drag);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  async function finishTimeDrag(e:React.PointerEvent){
    const drag=timeDragRef.current??timeDrag;
    if(!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const delta=Math.round((e.clientY-drag.startY)/calendarRowHeight)*30;
    let startMin=drag.startMin;
    let endMin=drag.endMin;
    if(drag.edge==="move"){startMin+=delta;endMin+=delta;}
    if(drag.edge==="start") startMin=Math.min(endMin-30,startMin+delta);
    if(drag.edge==="end") endMin=Math.max(startMin+30,endMin+delta);
    startMin=Math.max(calendarStartMin,Math.min(calendarEndMin-30,startMin));
    endMin=Math.max(startMin+30,Math.min(calendarEndMin,endMin));
    const event=drag.event;
    const payload={
      employee_id:event.employee_id,
      title:String(event.title??""),
      event_type:event.event_type,
      start_date:event.start_date??drag.date,
      end_date:event.end_date??drag.date,
      start_time:minutesToTime(startMin),
      end_time:minutesToTime(endMin),
      note:event.note??null,
      updated_at:new Date().toISOString(),
    };
    const result=event.base
      ? await supabase.from("employee_schedule_events").insert({...payload,start_date:drag.date,end_date:drag.date,created_by:currentEmployee.id})
      : await supabase.from("employee_schedule_events").update(payload).eq("id",event.id);
    timeDragClickGuard.current=Date.now()+350;
    timeDragRef.current=null;
    setTimeDrag(null);
    if(result.error) setMessage(`시간 변경 실패: ${result.error.message}`);
    else{setMessage(`${minutesToTime(startMin)}~${minutesToTime(endMin)}으로 변경했습니다.`);await onChanged();}
  }
  return (
    <section className="card schedule-board-card">
      <div className="schedule-board-toolbar">
        <div>
          <h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-calendar-week" aria-hidden="true"></i>직원 근무 일정</h2>
          <p className="subtle" style={{margin:0}}>월요일부터 금요일까지 실제 시간대로 확인합니다. 기본 근무칸을 누른 뒤 이동할 날짜 칸을 누르면 근무요일이 바뀝니다.</p>
        </div>
      </div>
      <div className="schedule-command-bar">
        <i className="ti ti-sparkles" aria-hidden="true"></i>
        <input className="input" value={scheduleCommand} onChange={e=>setScheduleCommand(e.target.value)} onKeyDown={e=>e.key==="Enter"&&applyScheduleCommand()} placeholder="예: 홍준기 월화수 09:00~18:00 / 정혜리 평일 오전 10시부터 오후 7시" />
        <button className="button secondary" onClick={applyScheduleCommand}>일정 변경</button>
      </div>
      <p className="subtle schedule-command-help">직원명, 근무요일, 시간을 한 줄로 적으면 확인 후 기본 근무일정과 월 근무시간 기준에 반영됩니다.</p>
      {message&&<div className={`alert ${message.includes("실패")?"error":"success"}`} style={{marginTop:14}}>{message}</div>}
      {movingBase&&<div className="alert" style={{marginTop:14}}>{movingBase.employeeName}의 {DAY_LABELS[dayKeyFromDate(dateFromIso(movingBase.sourceDate))]}요일 근무를 이동할 날짜 칸을 눌러주세요.</div>}
      <div className="schedule-employee-tabs">
        <span>직원 선택</span>
        <button className={isAll?"active":""} onClick={()=>setSelectedEmpId("all")}><i className="ti ti-users" aria-hidden="true"></i>전체</button>
        {activeEmployees.map(emp=><button key={emp.id} className={selectedEmployee?.id===emp.id?"active":""} onClick={()=>setSelectedEmpId(emp.id)}><i style={{background:employeeColorFromList(activeEmployees,emp.id)}}></i>{emp.name}</button>)}
      </div>
      <div className="schedule-month-nav">
        <button className="icon-button" title="이전 주" onClick={()=>changeWeek(-1)}><i className="ti ti-chevron-left" aria-hidden="true"></i></button>
        <button className="month-title" onClick={goToday}>{weekOfMonthLabel(weekStart)}</button>
        <button className="icon-button" title="다음 주" onClick={()=>changeWeek(1)}><i className="ti ti-chevron-right" aria-hidden="true"></i></button>
        <button className="button ghost compact schedule-today-button" onClick={goToday}>오늘</button>
      </div>
      {isAll&&activeEmployees.length>0&&(
        <div className="team-week-overview">
          <div className="team-week-title">
            <div><b>직원별 주간 캘린더 요약</b><span>근무일과 실근무시간을 직원별로 빠르게 확인합니다.</span></div>
            <span>{weekStart} ~ {weekEnd}</span>
          </div>
          <div className="team-week-grid">
            <div className="team-week-head">직원</div>
            {dates.map(date=>{
              const d=dateFromIso(date);
              return <div className="team-week-head" key={`head-${date}`}><b>{["일","월","화","수","목","금","토"][d.getDay()]}</b><small>{d.getMonth()+1}/{d.getDate()}</small></div>;
            })}
            {activeEmployees.flatMap(employee=>{
              const color=employeeColorFromList(activeEmployees,employee.id);
              const monthStats=scheduledWorkStats(employee,monthRange.start,monthRange.end,overrides,workTimeChanges);
              return [
                <div className="team-week-employee" key={`${employee.id}-name`}><i style={{background:color}}></i><div><b>{employee.name}</b><small>{[employee.department,employee.position].filter(Boolean).join(" · ")||employee.employee_no}</small><small className="team-week-month">{dateFromIso(monthRange.start).getMonth()+1}월 / 근무일수 {monthStats.days}일 / 근무시간 {formatHourValue(monthStats.hours)}시간</small></div></div>,
                ...dates.map(date=>{
                  const sched=getScheduleForDate(employee,date,overrides,workTimeChanges);
                  const explicitEvent=events.find(event=>event.employee_id===employee.id&&date>=event.start_date&&date<=event.end_date&&["hidden","unavailable","work","am_only","pm_only"].includes(event.event_type));
                  const eventIsWork=["work","am_only","pm_only"].includes(explicitEvent?.event_type);
                  const workday=explicitEvent ? eventIsWork : (sched.work_days??[]).includes(dayKeyFromDate(dateFromIso(date)));
                  const start=explicitEvent?.start_time??sched.work_start;
                  const end=explicitEvent?.end_time??sched.work_end;
                  const hours=workday?netDailyHours(start,end,sched.break_start??"12:00",sched.break_end??"13:00"):0;
                  return <div className={`team-week-cell ${workday?"":"off"}`} key={`${employee.id}-${date}`} style={{"--employee-color":color} as React.CSSProperties}>
                    <b>{workday?`${timeLabel(start)}~${timeLabel(end)}`:"휴무"}</b>
                    <small>{workday?`실근무 ${formatHourValue(hours)}시간`:"근무 없음"}</small>
                  </div>;
                }),
              ];
            })}
          </div>
        </div>
      )}
      <div className="week-calendar-scroll">
        <div className={`week-calendar ${isAll?"team-view":""}`} style={isAll?{minWidth:78+teamColumnCount*59}:undefined}>
          <div className={`week-calendar-header ${isAll?"team-calendar-header":""}`} style={isAll?{gridTemplateColumns:`78px repeat(${teamColumnCount},59px)`}:undefined}>
            <div className="week-time-head" style={isAll?{gridRow:"1 / span 2"}:undefined}>시간</div>
            {dates.map((date,dateIndex)=>{
              const d=dateFromIso(date);
              return <div key={date} className={`${date===todayIso()?"today":""} ${isAll?"team-day-head":""}`} style={isAll?{gridColumn:`${dateIndex*employeeCount+2} / span ${employeeCount}`,gridRow:1}:undefined}><b>{["일","월","화","수","목","금","토"][d.getDay()]} {d.getMonth()+1}/{d.getDate()}</b>{!isAll&&<span>{d.getMonth()+1}/{d.getDate()}</span>}</div>;
            })}
            {isAll&&dates.flatMap((date,dateIndex)=>activeEmployees.map((employee,employeeIndex)=>{
              const color=employeeColorFromList(activeEmployees,employee.id);
              return <button key={`${date}-${employee.id}-head`} draggable className={`team-employee-head ${draggingEmployeeId===employee.id?"dragging":""} ${employeeIndex===activeEmployees.length-1?"team-day-end":""}`} style={{gridColumn:dateIndex*employeeCount+employeeIndex+2,gridRow:2,"--employee-color":color} as React.CSSProperties} onDragStart={e=>{setDraggingEmployeeId(employee.id);e.dataTransfer.effectAllowed="move";}} onDragOver={e=>e.preventDefault()} onDrop={()=>reorderEmployees(employee.id)} onDragEnd={()=>setDraggingEmployeeId(null)} onClick={()=>setSelectedEmpId(employee.id)} title={`${employee.name} 드래그로 순서 변경 · 클릭하면 개인 일정`}><span>{employee.name}</span></button>;
            }))}
          </div>
          {!isAll&&<div className="week-all-day">
            <div className="week-all-day-label">종일</div>
            <div className="week-all-day-track">
              {dates.map(date=><div key={date} className={`week-drop-column ${movingBase?"moving-target":""}`} onClick={()=>selectedEmployee&&handleScheduleCellClick(selectedEmployee.id,date)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveEvent(selectedEmployee?.id??"",date)} onDoubleClick={()=>setEditing(emptyEvent(selectedEmployee?.id??activeEmployees[0]?.id,date))} />)}
              {allDayEvents.map(event=>{
                const visible=dates.map((date,index)=>({date,index})).filter(x=>x.date>=event.start_date&&x.date<=event.end_date);
                if(!visible.length) return null;
                const owner=activeEmployees.find(emp=>emp.id===event.employee_id);
                const color=owner?employeeColorFromList(activeEmployees,owner.id):selectedColor;
                return <button key={event.id} draggable className="week-all-day-event" style={{gridColumn:`${visible[0].index+1} / span ${visible.length}`,"--employee-color":color} as React.CSSProperties} onDragStart={e=>{setDraggingId(event.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>setDraggingId(null)} onClick={()=>setEditing({...event,start_time:event.start_time?.slice(0,5)??"",end_time:event.end_time?.slice(0,5)??""})}><b>{event.title}</b><span>{event.note??`${event.start_date}~${event.end_date}`}</span></button>;
              })}
            </div>
          </div>}
          <div className="week-time-grid">
            <div className="week-time-axis" style={{height:calendarHeight}}>{hours.map(hour=><div key={hour}>{String(hour).padStart(2,"0")}:00</div>)}</div>
            <div className={`week-event-grid ${isAll?"team-event-grid":""}`} style={{height:calendarHeight,gridTemplateRows:`repeat(${calendarRows},${calendarRowHeight}px)`,backgroundSize:`100% ${calendarRowHeight}px,100% ${calendarRowHeight*2}px`,...(isAll?{gridTemplateColumns:`repeat(${teamColumnCount},59px)`}:{})}}>
              {isAll
                ? dates.flatMap((date,dateIndex)=>activeEmployees.map((employee,employeeIndex)=><div key={`${date}-${employee.id}-drop`} className={`week-day-column team-employee-column ${employeeIndex===activeEmployees.length-1?"team-day-end":""} ${date===todayIso()?"today":""} ${movingBase?"moving-target":""}`} style={{gridColumn:dateIndex*employeeCount+employeeIndex+1,gridRow:`1 / span ${calendarRows}`}} onClick={()=>handleScheduleCellClick(employee.id,date)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveEvent(employee.id,date)} onDoubleClick={()=>setEditing(emptyEvent(employee.id,date))} />))
                : dates.map((date,index)=><div key={date} className={`week-day-column ${date===todayIso()?"today":""} ${movingBase?"moving-target":""}`} style={{gridColumn:index+1,gridRow:`1 / span ${calendarRows}`}} onClick={()=>selectedEmployee&&handleScheduleCellClick(selectedEmployee.id,date)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveEvent(selectedEmployee?.id??"",date)} onDoubleClick={()=>setEditing(emptyEvent(selectedEmployee?.id??activeEmployees[0]?.id,date))} />)}
              {dates.flatMap((date,index)=>{
                const shownEmployees=isAll?activeEmployees:(selectedEmployee?[selectedEmployee]:[]);
                return shownEmployees.flatMap((employee:any,employeeIndex:number)=>{
                  const dayEvents=timedEvents.filter(event=>event.employee_id===employee.id&&date>=event.start_date&&date<=event.end_date);
                  const leaveEvents=leaveEventsFor(employee,date);
                  const overtimeEvents=overtimeEventsFor(employee,date);
                  const shown=[...dayEvents.filter(event=>event.event_type!=="hidden"),...leaveEvents,...overtimeEvents];
                  const fullDayLeaveEvents=leaveEvents.filter(event=>!["hourly","comp_leave_use","half_am","half_pm"].includes(event.request_type));
                  const suppressBase=fullDayLeaveEvents.length>0||dayEvents.some(event=>["hidden","work","unavailable","am_only","pm_only"].includes(event.event_type));
                  const schedule=getScheduleForDate(employee,date,overrides,workTimeChanges);
                  const isBaseWorkday=(schedule.work_days??[]).includes(dayKeyFromDate(dateFromIso(date)));
                  const baseWork=!suppressBase&&isBaseWorkday?{id:`base-${employee.id}-${date}`,employee_id:employee.id,title:employee.schedule_title??"기본 근무",event_type:"work",start_time:schedule.work_start,end_time:schedule.work_end,note:employee.schedule_note??"",base:true}:null;
                  const color=employeeColorFromList(activeEmployees,employee.id);
                  return [...shown,...(baseWork?[baseWork]:[])].map((event:any)=>{
                    const pos=timeGridPosition(event,employee);
                    const meta=SCHEDULE_EVENT_META[event.event_type]??SCHEDULE_EVENT_META.info;
                    const gridColumn=isAll?index*employeeCount+employeeIndex+1:index+1;
                    const openEditor=()=>{
                      if(event.leave||event.readonly) return;
                      if(Date.now()<timeDragClickGuard.current) return;
                      if(event.base){
                        setMovingBase(null);
                        setEditing({...event,id:undefined,base:undefined,fromBase:true,source_date:date,start_date:date,end_date:date,start_time:String(event.start_time??"09:00").slice(0,5),end_time:String(event.end_time??"18:00").slice(0,5),apply_all:false});
                        return;
                      }
                      setEditing({...event,original_title:event.title,start_time:event.start_time?.slice(0,5)??"",end_time:event.end_time?.slice(0,5)??"",apply_all:false});
                    };
                    return <button key={`${event.id}-${date}`} title={`${employee.name} · ${event.title||"빈 일정"} · ${pos.label}${event.leave?" · 승인된 휴가":event.readonly?"":" · 눌러서 수정"}`} draggable={!event.base&&!event.leave&&!event.readonly} className={`week-time-event event-${event.event_type} ${event.overtimeStatus?`overtime-${event.overtimeStatus}`:""} ${isAll?"team-lane-event":""}`} style={{gridColumn,gridRow:`${pos.row} / span ${pos.span}`,"--employee-color":color} as React.CSSProperties} onDragStart={e=>{if(event.base||event.leave||event.readonly)return;setDraggingId(event.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>setDraggingId(null)} onClick={openEditor}>
                      {!event.leave&&!event.readonly&&<><span className="time-resize-handle top" title="시작 시간 드래그" onPointerDown={e=>beginTimeDrag(e,event,employee,date,"start")} onPointerUp={finishTimeDrag}></span>
                      <span className="time-resize-handle move" title="일정 시간 이동" onPointerDown={e=>beginTimeDrag(e,event,employee,date,"move")} onPointerUp={finishTimeDrag}><i className="ti ti-grip-horizontal" aria-hidden="true"></i></span></>}
                      {event.title&&<b>{!isAll&&<i className={`ti ${meta.icon}`} aria-hidden="true"></i>}{event.title}</b>}<span className="event-time-label"><em>{pos.start}</em><i>~</i><em>{pos.end}</em></span>{event.note&&<small>{event.note}</small>}
                      {!event.leave&&!event.readonly&&<span className="time-resize-handle bottom" title="종료 시간 드래그" onPointerDown={e=>beginTimeDrag(e,event,employee,date,"end")} onPointerUp={finishTimeDrag}></span>}
                    </button>;
                  });
                });
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="schedule-help"><i className="ti ti-info-circle" aria-hidden="true"></i>{isAll?"요일 아래 직원별 열을 표시합니다. 이름을 누르면 개인 일정으로 이동하고, 모든 일정칸은 눌러서 수정할 수 있습니다.":"빈 시간대를 두 번 누르면 일정을 추가하고, 일정칸을 누르면 수정할 수 있습니다."} 토요일과 일요일은 표시하지 않습니다.</p>
      {activeEmployees.length===0&&<p className="subtle">표시할 재직 직원이 없습니다.</p>}
      {editing&&<div className="modal-backdrop" onClick={()=>setEditing(null)}>
        <div className="modal-box schedule-event-modal" onClick={e=>e.stopPropagation()}>
          <div className="modal-header"><h2 className="card-title" style={{margin:0}}><i className="ti ti-calendar-event" aria-hidden="true"></i>{editing.id||editing.fromBase?"일정 수정":"일정 추가"}</h2><button className="modal-close" title="닫기" onClick={()=>setEditing(null)}><i className="ti ti-x" aria-hidden="true"></i></button></div>
          <div className="grid two">
            <div className="form-row"><label className="label">직원</label><select className="select" value={editing.employee_id} onChange={e=>setEditing({...editing,employee_id:e.target.value})}>{activeEmployees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
            {!editing.fromBase&&<div className="form-row"><label className="label">표시 방식</label><div className="schedule-type-control">{EDITABLE_SCHEDULE_TYPES.map(key=><button type="button" key={key} className={editing.event_type===key?"active":""} onClick={()=>setEditing({...editing,event_type:key})}><i className={`ti ${SCHEDULE_EVENT_META[key].icon}`} aria-hidden="true"></i>{SCHEDULE_EVENT_META[key].label}</button>)}</div></div>}
          </div>
          <div className="form-row"><label className="label">일정 이름</label><input className="input" value={editing.title??""} onChange={e=>setEditing({...editing,title:e.target.value})} placeholder="예: 기본 근무" /></div>
          <div className="grid two">
            <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={editing.start_date} onChange={e=>setEditing({...editing,start_date:e.target.value,end_date:editing.end_date<e.target.value?e.target.value:editing.end_date})} /></div>
            <div className="form-row"><label className="label">종료일</label><input className="input" type="date" value={editing.end_date} onChange={e=>setEditing({...editing,end_date:e.target.value})} /></div>
          </div>
          <div className="grid two">
            <div className="form-row"><label className="label">가능 시작 시간</label><input className="input" type="time" value={editing.start_time??""} onChange={e=>setEditing({...editing,start_time:e.target.value})} /></div>
            <div className="form-row"><label className="label">가능 종료 시간</label><input className="input" type="time" value={editing.end_time??""} onChange={e=>setEditing({...editing,end_time:e.target.value})} /></div>
          </div>
          <div className="form-row"><label className="label">메모</label><textarea className="textarea" value={editing.note??""} onChange={e=>setEditing({...editing,note:e.target.value})} placeholder="예: 교육으로 인한 근무 불가" /></div>
          <label className="checkbox schedule-apply-all"><input type="checkbox" checked={!!editing.apply_all} onChange={e=>setEditing({...editing,apply_all:e.target.checked})} /> 일정 전체 변경하기</label>
          <p className="subtle schedule-edit-note">{editing.fromBase?"체크하면 이 직원의 모든 기본 근무요일과 운영설정 출근 스케줄에 적용됩니다. 체크하지 않으면 선택한 날짜만 변경됩니다.":"체크하면 이 직원의 같은 이름 일정 전체가 변경됩니다."}</p>
          <p className="subtle schedule-edit-note">일정 이름과 메모는 비워둘 수 있습니다.</p>
          <div className="schedule-modal-actions"><div className="actions">{editing.fromBase&&<button className="button secondary" onClick={startMoveBaseWorkday}><i className="ti ti-arrows-move" aria-hidden="true"></i>요일 이동</button>}{(editing.id||editing.fromBase)&&<button className="button danger" onClick={deleteEvent}><i className="ti ti-trash" aria-hidden="true"></i>삭제</button>}</div><div className="actions"><button className="button ghost" onClick={()=>setEditing(null)}>취소</button><button className="button" onClick={saveEvent}><i className="ti ti-check" aria-hidden="true"></i>저장</button></div></div>
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

function PayrollCard({ employees, absences, overrides, workTimeChanges }: { employees:any[]; absences:any[]; overrides:any[]; workTimeChanges:any[] }) {
  const [empId,setEmpId]=useState("");
  const [pay,setPay]=useState({monthly:"",hourly:"",annual:"",weeklyDays:"",dailyHours:"",monthlyHours:""});
  const [payMsg,setPayMsg]=useState("");
  const [localEmployees,setLocalEmployees]=useState<any[]>(employees);
  const [payrollMonthValue,setPayrollMonthValue]=useState(todayIso().slice(0,7));
  useEffect(()=>{setLocalEmployees(employees);},[employees]);
  const emp=empId?localEmployees.find(e=>e.id===empId):null;
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
    if(error) setPayMsg(`급여 설정 저장 실패: ${error.message}`);
    else {
      setLocalEmployees(list=>list.map(employee=>employee.id===empId?{
        ...employee,
        monthly_salary:monthly,
        hourly_wage:hourly,
        annual_salary:annual,
        weekly_work_days:weeklyDays,
        daily_work_hours:dailyHours,
        monthly_standard_hours:monthlyHours,
      }:employee));
      setPayMsg("급여 설정이 저장되었습니다.");
    }
  }
  const monthly=numberValue(pay.monthly);
  const hourly=numberValue(pay.hourly);
  const annual=numberValue(pay.annual)||monthly*12;
  const monthlyHours=numberValue(pay.monthlyHours);
  const approvedWorkTimeChanges=workTimeChanges.filter((request:any)=>request.status==="approved");
  const month=monthRangeFromValue(payrollMonthValue);
  const payrollMonthLabel=monthLabel(month.start);
  const payrollMonthOptions=monthSelectOptions(todayIso(),8,2);
  const scheduledDays=emp?countScheduledWorkdays(emp, month.start, month.end, overrides, approvedWorkTimeChanges):0;
  const absentDays=emp?countUnpaidAbsenceWorkdays(emp, absences, month.start, month.end, overrides, approvedWorkTimeChanges):0;
  const dayRate=scheduledDays>0?monthly/scheduledDays:0;
  const deduction=Math.round(dayRate*absentDays);
  const baseAfterDeduction=Math.max(0,monthly-deduction);
  const ins=calcInsurance(baseAfterDeduction);
  const netPay=baseAfterDeduction-ins.employee;
  const payrollSummaryRows=localEmployees.filter(e=>e.employment_status==="active").map((employee:any)=>{
    const week=weeklyStatsForDate(employee,todayIso(),overrides,approvedWorkTimeChanges);
    const monthStats=scheduledWorkStats(employee,month.start,month.end,overrides,approvedWorkTimeChanges);
    const savedMonthlyHours=Number(employee.monthly_standard_hours||0);
    const monthlyStandardHours=savedMonthlyHours||monthStats.hours;
    const monthlySalary=Number(employee.monthly_salary||0);
    const hourlyWage=Number(employee.hourly_wage||(monthlySalary&&monthlyStandardHours?Math.round(monthlySalary/monthlyStandardHours):0));
    const estimatedPay=hourlyWage?Math.round(hourlyWage*monthStats.hours):monthlySalary;
    return {employee,week,month:monthStats,monthlyStandardHours,monthlySalary,hourlyWage,estimatedPay};
  });
  const payrollEstimatedTotal=payrollSummaryRows.reduce((sum:number,row:any)=>sum+Number(row.estimatedPay||0),0);
  return (
    <section className="card">
      <div className="section-head payroll-head">
        <div>
          <h2 className="card-title"><i className="ti ti-coin" aria-hidden="true"></i>급여 계산</h2>
          <p className="subtle" style={{margin:0}}>시급, 월급, 연봉, 주 근무일, 일 근무시간, 월 소정근로시간 중 값을 바꾸면 나머지 기준값이 자동 계산됩니다. 4대보험은 정기분 추정치입니다.</p>
        </div>
        <div className="payroll-month-picker">
          <label className="label">월별 보기</label>
          <select className="select" value={payrollMonthValue} onChange={e=>setPayrollMonthValue(e.target.value)}>
            {payrollMonthOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>
      <div className="grid two">
        <div className="form-row"><label className="label">직원</label>
          <select className="select" value={empId} onChange={e=>setEmpId(e.target.value)}>
            <option value="">직원 선택</option>
            {localEmployees.filter(e=>e.employment_status==="active").map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
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
      <div className="payroll-summary-list">
        <div className="payroll-summary-head">직원별 급여·근무 기준 <span>{payrollMonthLabel} 승인된 근무시간 변경을 반영합니다</span></div>
        <div className="payroll-summary-row payroll-summary-columns"><b>직원</b><span>시급</span><span>월급</span><span>주 근무시간</span><span>월 근무시간</span><span>예상 급여</span><small>{payrollMonthLabel} 기준</small></div>
        {payrollSummaryRows.map(({employee,week,month,monthlyStandardHours,monthlySalary,hourlyWage,estimatedPay}:any)=>(
          <div className="payroll-summary-row" key={employee.id}>
            <div className="payroll-employee-cell"><b>{employee.name}</b><small>사번 {employee.employee_no||"-"} · {employee.role==="admin"?"관리자":"직원"}</small></div>
            <span>{hourlyWage?won(hourlyWage):"-"}</span>
            <span>{monthlySalary?won(monthlySalary):"-"}</span>
            <span>{formatHourValue(week.hours)}시간</span>
            <span>{formatHourValue(monthlyStandardHours||month.hours)}시간</span>
            <span>{estimatedPay?won(estimatedPay):"-"}</span>
            <small>{payrollMonthLabel} 예정 {month.days}일 · 실제 기준 {formatHourValue(month.hours)}시간</small>
          </div>
        ))}
        <div className="payroll-summary-row payroll-summary-total"><b>총 합산</b><span></span><span></span><span></span><span></span><span>{won(payrollEstimatedTotal)}</span><small>직원별 예상 급여 합계</small></div>
      </div>
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
      {empId&&<p className="subtle" style={{marginTop:8}}>{payrollMonthLabel} 근무 예정일 {scheduledDays}일 · 무급 미출근 반영 {absentDays}일 · 주간 스케줄 변경 포함</p>}
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
  },[scheduleEmpId,scheduleEmp?.work_days,scheduleEmp?.work_start,scheduleEmp?.work_end,scheduleEmp?.contract_type,scheduleEmp?.contract_start,scheduleEmp?.contract_end]);
  function toggleDay(arr:string[],day:string){return arr.includes(day)?arr.filter(d=>d!==day):[...arr,day];}
  async function saveSchedule() {
    setMsg("");
    if(!scheduleEmpId) return setMsg("직원을 선택해주세요.");
    if(contractType==="fixed_term" && (!contractStart || !contractEnd)) return setMsg("기간제는 계약 시작일과 종료일을 입력해주세요.");
    if(contractType==="fixed_term" && contractEnd < contractStart) return setMsg("계약 종료일은 시작일보다 뒤여야 합니다.");
    const oldDays=scheduleEmp?.work_days??["mon","tue","wed","thu","fri"];
    const oldStart=scheduleEmp?.work_start??"09:00";
    const oldEnd=scheduleEmp?.work_end??"18:00";
    const dailyHours=netDailyHours(editStart,editEnd,"12:00","13:00");
    const weeklyWorkDays=editDays.length;
    const monthlyStandardHours=Math.round(weeklyWorkDays*dailyHours*4.345*10)/10;
    const {error}=await supabase.from("employees").update({
      work_days:editDays,
      work_start:editStart,
      work_end:editEnd,
      weekly_work_days:weeklyWorkDays,
      daily_work_hours:dailyHours,
      monthly_standard_hours:monthlyStandardHours,
      contract_type:contractType,
      contract_start:contractType==="fixed_term"?contractStart:null,
      contract_end:contractType==="fixed_term"?contractEnd:null,
    }).eq("id",scheduleEmpId);
    if(error) setMsg(`저장 실패: ${error.message}`);
    else {
      const currentWeekStart=weekStartIso(todayIso());
      const staleOverrides=overrides.filter((override:any)=>override.employee_id===scheduleEmpId&&override.week_start>=currentWeekStart);
      const cleanupResults=await Promise.all(staleOverrides.map(async (override:any)=>{
        const overrideDays=override.work_days??oldDays;
        const hasRemovedDay=overrideDays.some((day:string)=>!editDays.includes(day));
        const timeMatchesOld=timeLabel(override.work_start)===timeLabel(oldStart)&&timeLabel(override.work_end)===timeLabel(oldEnd);
        const followsOldBase=sameDays(overrideDays,oldDays)&&timeMatchesOld;
        if(!hasRemovedDay&&!followsOldBase&&!timeMatchesOld) return null;
        const nextDays=followsOldBase ? editDays : overrideDays.filter((day:string)=>editDays.includes(day));
        const result=await supabase.from("weekly_schedule_overrides").update({
          work_days:nextDays,
          work_start:timeMatchesOld?editStart:override.work_start,
          work_end:timeMatchesOld?editEnd:override.work_end,
        }).eq("id",override.id);
        return result.error?.message ?? "ok";
      }));
      const cleanupErrors=cleanupResults.filter((result):result is string=>!!result&&result!=="ok");
      if(cleanupErrors.length>0) setMsg(`스케줄은 저장됐지만 주간 변경 정리 실패: ${cleanupErrors[0]}`);
      else setMsg(`스케줄이 저장되었습니다. 주 ${formatHourValue(dailyHours*weeklyWorkDays)}시간 · 월 ${formatHourValue(monthlyStandardHours)}시간 기준으로 반영됩니다.`);
      await onChanged();
    }
  }

  // 주간 오버라이드
  const [ovEmpId,setOvEmpId]=useState(""); const [ovWeek,setOvWeek]=useState(todayIso());
  const [ovDays,setOvDays]=useState<string[]>(["mon","tue","wed","thu","fri"]);
  const [ovStart,setOvStart]=useState("09:00"); const [ovEnd,setOvEnd]=useState("18:00"); const [ovNote,setOvNote]=useState("");
  async function saveOverride() {
    setMsg(""); if(!ovEmpId) return setMsg("직원을 선택해주세요.");
    const monday=new Date(ovWeek); monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
    const weekStart=monday.toISOString().slice(0,10);
    const payload={employee_id:ovEmpId,week_start:weekStart,work_days:ovDays,work_start:ovStart,work_end:ovEnd,note:ovNote,created_by:currentEmployee.id};
    const {data:existing,error:findError}=await supabase.from("weekly_schedule_overrides").select("id").eq("employee_id",ovEmpId).eq("week_start",weekStart).maybeSingle();
    if(findError) return setMsg(`저장 실패: ${findError.message}`);
    const result=existing?.id
      ? await supabase.from("weekly_schedule_overrides").update(payload).eq("id",existing.id)
      : await supabase.from("weekly_schedule_overrides").insert(payload);
    if(result.error) setMsg(`저장 실패: ${result.error.message}`); else { setMsg(`${empName(ovEmpId)} ${weekStart} 주 스케줄이 저장되었습니다.`); await onChanged(); }
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
    <section className="card schedule-detail-card">
      <h2 className="card-title"><i className="ti ti-calendar-cog" aria-hidden="true"></i>세부 일정 관리</h2>
      <p className="subtle" style={{marginBottom:14}}>기본 근무요일·시간은 위 한 줄 변경에서 처리하고, 특정 기간 미출근이나 한 주짜리 예외 일정만 여기서 관리합니다.</p>
      {msg&&<div className={`alert ${msg.includes("저장")||msg.includes("등록")?"success":""}`}>{msg}</div>}

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
      <div className="form-row"><label className="label">이 주 출근 요일</label><div className="days-grid">{ALL_DAYS.map(d=><button key={d} type="button" className={`day-btn ${ovDays.includes(d)?"active":""}`} onClick={()=>setOvDays(days=>toggleDay(days,d))}>{DAY_LABELS[d]}</button>)}</div></div>
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
  OVERTIME_COMP_CONSENT_CHECK_TEXT,
  WORK_TIME_CONSENT_CHECK_TEXT,
];

function ConsentReportPage() {
  const [employees,setEmployees]=useState<any[]>([]);
  const [consents,setConsents]=useState<any[]>([]);
  const [workTimeConsents,setWorkTimeConsents]=useState<any[]>([]);
  const [workTimeRequests,setWorkTimeRequests]=useState<any[]>([]);
  const [attendanceCorrections,setAttendanceCorrections]=useState<any[]>([]);
  const [selected,setSelected]=useState<{employee:any;record:any;kind:"privacy"|"workTimeConsent"|"workTimeRequest"|"attendanceCorrection"}|null>(null);
  const [workRequestFilter,setWorkRequestFilter]=useState("all");
  const [correctionFilter,setCorrectionFilter]=useState("all");
  const [message,setMessage]=useState("");

  async function load(){
    const [employeeResult,consentResult,workConsentResult,workRequestResult,correctionResult]=await Promise.all([
      supabase.from("employees").select("id,name,employee_no,employment_status,is_active").order("employee_no",{ascending:true}),
      supabase.from("privacy_consents").select("*").order("created_at",{ascending:false}),
      supabase.from("work_time_change_consents").select("*").order("created_at",{ascending:false}),
      supabase.from("work_time_change_requests").select("*").order("created_at",{ascending:false}),
      supabase.from("attendance_correction_requests").select("*").order("created_at",{ascending:false}).limit(500),
    ]);
    if(employeeResult.error||consentResult.error||workConsentResult.error||workRequestResult.error||correctionResult.error) {
      setMessage(employeeResult.error?.message??consentResult.error?.message??workConsentResult.error?.message??workRequestResult.error?.message??friendlySignatureDbError(correctionResult.error)??"동의서를 불러오지 못했습니다.");
    }
    setEmployees(employeeResult.data??[]);
    setConsents(consentResult.data??[]);
    setWorkTimeConsents(workConsentResult.data??[]);
    setWorkTimeRequests(workRequestResult.data??[]);
    setAttendanceCorrections(correctionResult.error?[]:correctionResult.data??[]);
  }
  useEffect(()=>{load();},[]);

  const latestByEmployee:Record<string,any>={};
  consents.forEach(consent=>{if(!latestByEmployee[consent.employee_id]) latestByEmployee[consent.employee_id]=consent;});
  const latestWorkConsentByEmployee:Record<string,any>={};
  workTimeConsents.forEach(consent=>{if(!latestWorkConsentByEmployee[consent.employee_id]) latestWorkConsentByEmployee[consent.employee_id]=consent;});
  const employeeMap:Record<string,any>={};
  employees.forEach(employee=>{employeeMap[employee.id]=employee;});
  const signedWorkTimeRequests=workTimeRequests.filter(request=>request.signature_data);
  const signedAttendanceCorrections=attendanceCorrections.filter(request=>request.signature_data);
  const totalSigned=consents.length+workTimeConsents.length+signedWorkTimeRequests.length+signedAttendanceCorrections.length;
  const workRequestStatusGroups=[
    {key:"all",label:"전체",rows:workTimeRequests},
    ...[
      {key:"pending",label:"승인 대기"},
      {key:"approved",label:"승인"},
      {key:"rejected",label:"반려"},
    ].map(group=>({...group,rows:workTimeRequests.filter((request:any)=>request.status===group.key)})),
  ];
  const filteredWorkTimeRequests=workRequestFilter==="all"?workTimeRequests:workTimeRequests.filter((request:any)=>request.status===workRequestFilter);
  const correctionStatusGroups=[
    {key:"all",label:"전체",rows:attendanceCorrections},
    ...[
      {key:"pending",label:"서명 대기"},
      {key:"signed",label:"서명 완료"},
      {key:"objected",label:"이의제기"},
      {key:"cancelled",label:"취소"},
    ].map(group=>({...group,rows:attendanceCorrections.filter((request:any)=>request.status===group.key)})),
  ];
  const filteredAttendanceCorrections=correctionFilter==="all"?attendanceCorrections:attendanceCorrections.filter((request:any)=>request.status===correctionFilter);

  function signedTitle(kind:"privacy"|"workTimeConsent"|"workTimeRequest"|"attendanceCorrection"){
    if(kind==="privacy") return "개인정보 수집·이용 및 위치정보 동의서";
    if(kind==="workTimeConsent") return "근무시간 변경 안내 확인서";
    if(kind==="attendanceCorrection") return "출퇴근 기록 정정 확인서";
    return "근로시간 변경 요청 및 합의서";
  }
  function signedBody(kind:"privacy"|"workTimeConsent"|"workTimeRequest"|"attendanceCorrection",record:any){
    if(kind==="privacy") {
      const body=[
        "주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를 수집·이용합니다.",
        "위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다.",
        ...CONSENT_TERMS,
      ];
      if(record.consent_version===PRIVACY_CONSENT_VERSION) body.push(OVERTIME_COMP_DETAIL_TEXT, WORK_TIME_CONSENT_TEXT, WORK_TIME_DETAIL_TEXT);
      return body;
    }
    if(kind==="workTimeConsent") return [record.notice_text??WORK_TIME_CONSENT_TEXT, record.detail_text??WORK_TIME_DETAIL_TEXT];
    if(kind==="attendanceCorrection") return String(record.document_text??"저장된 문서 내용이 없습니다.").split("\n");
    return String(record.document_text??"저장된 문서 내용이 없습니다.").split("\n");
  }
  function printSignedRecord(employee:any,record:any,kind:"privacy"|"workTimeConsent"|"workTimeRequest"|"attendanceCorrection"){
    const popup=window.open("","_blank","width=860,height=1000");
    if(!popup) return setMessage("인쇄 창이 차단되었습니다. 브라우저의 팝업 차단을 해제해주세요.");
    popup.opener=null;
    const signature=String(record.signature_data??"").startsWith("data:image/")?record.signature_data:"";
    const title=signedTitle(kind);
    const body=signedBody(kind,record);
    const version=record.consent_version??record.legal_notice_version??"-";
    const status=kind==="attendanceCorrection" ? attendanceCorrectionStatusLabel(record.status) : record.status==="pending"?"승인 대기":record.status==="approved"?"승인":record.status==="rejected"?"반려":"-";
    popup.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(employee.name)} ${escapeHtml(title)}</title><style>
      @page{size:A4;margin:18mm}body{font-family:Arial,"Malgun Gothic",sans-serif;color:#111827;line-height:1.65;margin:0}
      h1{font-size:24px;margin:0 0 8px}h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #d1d5db;padding-bottom:7px}
      .meta{width:100%;border-collapse:collapse;margin-top:24px}.meta th,.meta td{border:1px solid #d1d5db;padding:9px;text-align:left;font-size:13px}.meta th{width:100px;background:#f3f4f6}
      ol{padding-left:22px}.notice{white-space:pre-wrap;padding:12px 14px;background:#f3f6fb;border:1px solid #dbe3ef;border-radius:6px}
      .signature{height:150px;border:1px solid #d1d5db;display:flex;align-items:center;justify-content:center}.signature img{max-width:95%;max-height:135px}
      .footer{margin-top:28px;text-align:right;font-size:13px}@media print{button{display:none}}
    </style></head><body>
      <h1>${escapeHtml(title)}</h1>
      <table class="meta"><tr><th>직원명</th><td>${escapeHtml(employee.name)}</td><th>사번</th><td>${escapeHtml(employee.employee_no)}</td></tr>
      <tr><th>서명 일시</th><td colspan="3">${escapeHtml(formatDateTime(record.created_at))}</td></tr>
      <tr><th>버전</th><td>${escapeHtml(version)}</td><th>상태</th><td>${escapeHtml(status)}</td></tr>
      <tr><th>기기</th><td colspan="3">${escapeHtml(record.device_info?.platform??"-")}</td></tr></table>
      <h2>서명 내용</h2><div class="notice">${body.map(line=>escapeHtml(line)).join("\n")}</div>
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
        <div><h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-file-certificate" aria-hidden="true"></i>직원 서명 리포트</h2><p className="subtle" style={{margin:0}}>개인정보 동의, 근무시간 변경 안내, 근무시간 변경 요청, 출퇴근 기록 정정 서명을 한 곳에서 확인하고 PDF로 저장합니다.</p></div>
        <span className="badge good">서명 {totalSigned}건</span>
      </div>
      <div className="table-wrap" style={{marginTop:18}}>
        <table>
          <caption className="table-summary">직원별 최신 필수 동의서</caption>
          <thead><tr><th>직원</th><th>개인정보 동의</th><th>근무시간 변경 안내</th><th>관리</th></tr></thead>
          <tbody>{employees.map(employee=>{
            const consent=latestByEmployee[employee.id];
            const workConsent=latestWorkConsentByEmployee[employee.id];
            return <tr key={employee.id}>
              <td><b>{employee.name}</b><br/><span className="subtle">{employee.employee_no}</span></td>
              <td><span className={`badge ${consent?"good":"warn"}`}>{consent?"완료":"미동의"}</span><br/><span className="subtle">{consent?formatDateTime(consent.created_at):"-"}</span></td>
              <td><span className={`badge ${workConsent?"good":"warn"}`}>{workConsent?"완료":"미서명"}</span><br/><span className="subtle">{workConsent?formatDateTime(workConsent.created_at):"-"}</span></td>
              <td><div className="actions">
                <button className="button secondary compact" disabled={!consent} onClick={()=>consent&&setSelected({employee,record:consent,kind:"privacy"})}><i className="ti ti-eye" aria-hidden="true"></i>개인정보</button>
                <button className="button secondary compact" disabled={!workConsent} onClick={()=>workConsent&&setSelected({employee,record:workConsent,kind:"workTimeConsent"})}><i className="ti ti-clock-edit" aria-hidden="true"></i>근무시간</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
    <section className="card">
      <h2 className="card-title"><i className="ti ti-calendar-time" aria-hidden="true"></i>근무시간 변경 요청 서명</h2>
      <div className="consent-status-grid">
        {workRequestStatusGroups.map(group=>(
          <button className={`consent-status-card ${workRequestFilter===group.key?"active":""}`} key={group.key} onClick={()=>setWorkRequestFilter(group.key)}>
            <b>{group.label}</b>
            <strong>{group.rows.length}건</strong>
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>직원</th><th>적용기간</th><th>변경 내용</th><th>요약</th><th>변경 요청 사유</th><th>상태</th><th>서명 일시</th><th>관리</th></tr></thead>
          <tbody>{filteredWorkTimeRequests.map(request=>{
            const employee=employeeMap[request.employee_id]??{name:"알 수 없음",employee_no:"-"};
            const periods=(request.periods??[]).map((p:any)=>`${p.start_date}~${p.end_date}`).join(" / ")||"-";
            return <tr key={request.id}>
              <td><b>{employee.name}</b><br/><span className="subtle">{employee.employee_no}</span></td>
              <td>{periods}</td>
              <td>{daysLabel(request.new_work_days??[])}<br/><span className="subtle">{timeRangeLabel(request.new_work_start,request.new_work_end)} · 휴게 {timeRangeLabel(request.new_break_start,request.new_break_end)}</span></td>
              <td>{workChangeSummaryLine(employee,request)}<br/><span className="subtle">{workChangePreviousLabel(request)}</span></td>
              <td>{request.reason||request.review_note||request.note||"-"}</td>
              <td><span className={`badge ${badgeClass(request.status)}`}>{request.status==="pending"?"승인 대기":request.status==="approved"?"승인":"반려"}</span></td>
              <td>{formatDateTime(request.created_at)}</td>
              <td><div className="actions"><button className="button secondary compact" disabled={!request.signature_data} onClick={()=>setSelected({employee,record:request,kind:"workTimeRequest"})}><i className="ti ti-eye" aria-hidden="true"></i>보기</button><button className="button ghost compact" disabled={!request.signature_data} onClick={()=>printSignedRecord(employee,request,"workTimeRequest")}><i className="ti ti-file-type-pdf" aria-hidden="true"></i>PDF</button></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {filteredWorkTimeRequests.length===0&&<p className="subtle" style={{marginTop:12}}>표시할 근무시간 변경 요청 서명이 없습니다.</p>}
    </section>
    <section className="card">
      <h2 className="card-title"><i className="ti ti-pencil-check" aria-hidden="true"></i>출퇴근 기록 정정 서명</h2>
      <div className="consent-status-grid">
        {correctionStatusGroups.map(group=>(
          <button className={`consent-status-card ${correctionFilter===group.key?"active":""}`} key={group.key} onClick={()=>setCorrectionFilter(group.key)}>
            <b>{group.label}</b>
            <strong>{group.rows.length}건</strong>
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>직원</th><th>근무일</th><th>정정 구분</th><th>정정 전후</th><th>사유</th><th>상태</th><th>서명 일시</th><th>관리</th></tr></thead>
          <tbody>{filteredAttendanceCorrections.map(request=>{
            const employee=employeeMap[request.employee_id]??{name:"알 수 없음",employee_no:"-"};
            return <tr key={request.id}>
              <td><b>{employee.name}</b><br/><span className="subtle">{employee.employee_no}</span></td>
              <td>{request.work_date}</td>
              <td>{attendanceCorrectionTypeLabel(request.correction_type)}</td>
              <td>{attendanceCorrectionTimeLine(request)}</td>
              <td>{request.reason||"-"}</td>
              <td><span className={`badge ${request.status==="signed"?"good":request.status==="objected"?"bad":"warn"}`}>{attendanceCorrectionStatusLabel(request.status)}</span></td>
              <td>{formatDateTime(request.signed_at)}</td>
              <td><div className="actions"><button className="button secondary compact" disabled={!request.signature_data} onClick={()=>setSelected({employee,record:request,kind:"attendanceCorrection"})}><i className="ti ti-eye" aria-hidden="true"></i>보기</button><button className="button ghost compact" disabled={!request.signature_data} onClick={()=>printSignedRecord(employee,request,"attendanceCorrection")}><i className="ti ti-file-type-pdf" aria-hidden="true"></i>PDF</button></div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {filteredAttendanceCorrections.length===0&&<p className="subtle" style={{marginTop:12}}>표시할 출퇴근 기록 정정 서명이 없습니다.</p>}
    </section>
    {selected&&<div className="modal-backdrop" onClick={()=>setSelected(null)}>
      <div className="modal-box consent-modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><h2 className="card-title" style={{margin:0}}><i className="ti ti-file-certificate" aria-hidden="true"></i>{selected.employee.name} {signedTitle(selected.kind)}</h2><button className="modal-close" title="닫기" onClick={()=>setSelected(null)}><i className="ti ti-x" aria-hidden="true"></i></button></div>
        <div className="consent-preview">
          <dl><div><dt>사번</dt><dd>{selected.employee.employee_no}</dd></div><div><dt>서명 일시</dt><dd>{formatDateTime(selected.record.created_at)}</dd></div><div><dt>버전</dt><dd>{selected.record.consent_version??selected.record.legal_notice_version??"-"}</dd></div></dl>
          <div className="type-desc">{signedBody(selected.kind,selected.record).map((line,index)=><p key={index} style={{margin:index===0?0:"8px 0 0",whiteSpace:"pre-wrap"}}>{line}</p>)}</div>
          <div className="consent-signature"><span>전자 서명</span>{selected.record.signature_data?<img src={selected.record.signature_data} alt={`${selected.employee.name} 전자 서명`} />:<p>서명 이미지가 없습니다.</p>}</div>
        </div>
        <div className="actions" style={{justifyContent:"flex-end",marginTop:16}}><button className="button ghost" onClick={()=>setSelected(null)}>닫기</button><button className="button" onClick={()=>printSignedRecord(selected.employee,selected.record,selected.kind)}><i className="ti ti-file-type-pdf" aria-hidden="true"></i>PDF 저장·인쇄</button></div>
      </div>
    </div>}
  </div>;
}

function ReportsPage() {
  const [logs,setLogs]=useState<any[]>([]);
  const [employees,setEmployees]=useState<any[]>([]);
  const [compRequests,setCompRequests]=useState<any[]>([]);

  async function fetchAllAttendanceLogs(){
    const rows:any[]=[];
    const pageSize=1000;
    for(let from=0;;from+=pageSize){
      const {data,error}=await supabase.from("attendance_logs").select("*, employees(name, employee_no), workplaces(name,type)").order("check_in_time",{ascending:false}).range(from,from+pageSize-1);
      if(error) break;
      rows.push(...(data??[]));
      if(!data||data.length<pageSize) break;
    }
    return rows;
  }
  async function load(){
    const [l,e,c]=await Promise.all([
      fetchAllAttendanceLogs(),
      supabase.from("employees").select("id, name, employee_no, role, employment_status, is_active, joined_at, created_at").order("created_at",{ascending:false}).limit(1000),
      supabase.from("comp_time_requests").select("*, employees(name, employee_no)").order("created_at",{ascending:false}).limit(1000)
    ]);
    setLogs(l??[]);
    setEmployees(e.data??[]);
    setCompRequests(c.data??[]);
  }

  useEffect(()=>{load();},[]);

  function reportEmployeeVisible(employee:any){
    const name=String(employee?.name??"").trim().toLowerCase();
    const no=String(employee?.employee_no??"").trim().toLowerCase();
    return name!=="test"&&!no.startsWith("test");
  }
  const visibleEmployees=employees.filter(reportEmployeeVisible);
  const visibleEmployeeIds=new Set(visibleEmployees.map((employee:any)=>employee.id));
  const visibleLogs=logs.filter((log:any)=>reportEmployeeVisible(log.employees));
  const visibleCompRequests=compRequests.filter((request:any)=>visibleEmployeeIds.has(request.employee_id));
  const allLogRows = visibleLogs.map(l=>({
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

  const fieldLogs=visibleLogs.filter(l=>["special_school","external_education","other_field"].includes(l.workplaces?.type));
  const exceptions=visibleLogs.filter(l=>["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음","지각","결근"].includes(l.status)||!l.check_out_time);
  const statusChartRows=visibleEmployees.map((employee:any)=>{
    const employeeLogs=visibleLogs.filter((log:any)=>log.employee_id===employee.id);
    const counts={normal:0,late:0,field:0,remote:0,exception:0};
    employeeLogs.forEach((log:any)=>{
      const status=String(log.status??"");
      const type=log.workplaces?.type;
      if(status.includes("지각")) counts.late+=1;
      else if(type==="remote") counts.remote+=1;
      else if(["special_school","external_education","other_field"].includes(type)) counts.field+=1;
      else if(!log.check_out_time||status.includes("확인")||status.includes("결근")) counts.exception+=1;
      else counts.normal+=1;
    });
    const total=Math.max(1,employeeLogs.length);
    return {employee,counts,total,shownTotal:employeeLogs.length};
  });

  return (
    <div className="grid">
      <section className="grid four">
        <div className="metric"><div className="metric-value">{visibleLogs.length}</div><div className="metric-label">전체 근태</div></div>
        <div className="metric"><div className="metric-value">{visibleEmployees.length}</div><div className="metric-label">전체 직원</div></div>
        <div className="metric"><div className="metric-value">{exceptions.length}</div><div className="metric-label">예외</div></div>
        <div className="metric"><div className="metric-value">{visibleCompRequests.filter(r=>r.status==="approved").reduce((s,r)=>s+Number(r.converted_days||0),0).toFixed(1)}</div><div className="metric-label">대체휴가 적립</div></div>
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-download" aria-hidden="true"></i>보고서 다운로드</h2>
        <div className="actions"><button className="button" onClick={downloadAll}><i className="ti ti-file-spreadsheet" aria-hidden="true"></i>전체 근태 Excel</button></div>
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-users" aria-hidden="true"></i>직원 목록</h2>
        <DataTable rows={visibleEmployees.map(e=>({
          이름:e.name,
          사번:e.employee_no,
          권한:e.role==="admin"?"관리자":"직원",
          상태:e.is_active&&e.employment_status==="active"?"활성":"비활성",
          입사일:e.joined_at??"-",
          등록일:formatDateTime(e.created_at)
        }))} />
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-chart-bar" aria-hidden="true"></i>직원별 근태 유형</h2>
        <div className="attendance-status-chart">
          {statusChartRows.map(({employee,counts,total,shownTotal}:any)=>(
            <div className="attendance-status-row" key={employee.id}>
              <div className="attendance-status-name"><b>{employee.name}</b><span>{shownTotal}건</span></div>
              <div className="attendance-status-detail">
                <div className="attendance-status-bars">
                  {[
                    ["normal","정상","#2563eb"],
                    ["late","지각","#dc2626"],
                    ["field","외근","#ea580c"],
                    ["remote","재택","#059669"],
                    ["exception","예외","#7c3aed"],
                  ].map(([key,label,color]:any)=>counts[key]>0&&(
                    <span key={key} style={{width:`${Math.max(8,(counts[key]/total)*100)}%`,background:color}} title={`${label} ${counts[key]}건`}>{label} {counts[key]}</span>
                  ))}
                  {shownTotal===0&&<span className="empty">기록 없음</span>}
                </div>
                <div className="attendance-status-counts">
                  <span>정상 {counts.normal}건</span>
                  <span>지각 {counts.late}건</span>
                  <span>외근 {counts.field}건</span>
                  <span>재택 {counts.remote}건</span>
                  <span>예외 {counts.exception}건</span>
                </div>
              </div>
            </div>
          ))}
        </div>
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
