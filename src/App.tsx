import { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getDeviceFingerprint } from "./lib/device";
import { getCurrentPositionFast, getPublicIp, distanceMeters } from "./lib/geo";
import {
  calculateAdjustmentDays, calculateLeaveEntitlement, calculateUsedDays,
  LEAVE_TYPE_META, requestToDays, calcInsurance, calcAbsenceDeduction,
} from "./lib/leave";
import { exportRowsToExcel, exportWorkbookToXlsx } from "./lib/exportExcel";

type Tab = "attendance" | "leave" | "overtime" | "worktime" | "team-schedule" | "work-map" | "kpi" | "admin-dashboard" | "approvals" | "employees" | "rnr" | "workplaces" | "schedule" | "payroll" | "reports" | "consents" | "improvements" | "admin-settings";
type SignedRecordKind = "privacy" | "workTimeConsent" | "adminConfidentiality" | "workTimeRequest" | "attendanceCorrection" | "attendancePolicy";

const ADMIN_PERMISSION_LEVEL_RANK: Record<string, number> = { none: 0, read: 1, edit: 2, all: 3 };
const ADMIN_PERMISSION_LEVELS = [
  { id: "none", label: "없음" },
  { id: "read", label: "읽기" },
  { id: "edit", label: "편집" },
  { id: "all", label: "전체" },
];
const ADMIN_PERMISSION_MENUS: { id: Tab; label: string; description: string }[] = [
  { id: "admin-dashboard", label: "오늘 관리", description: "관리자 대시보드와 당일 근무 현황" },
  { id: "approvals", label: "승인함", description: "휴가, 추가근무, 기기, 근태 승인 처리" },
  { id: "schedule", label: "근무 일정", description: "직원별 주간 캘린더와 출근 스케줄" },
  { id: "employees", label: "직원 관리", description: "직원 정보, 계약사항, 연차, 계정 관리" },
  { id: "workplaces", label: "근무지", description: "승인 근무지 등록, 수정, 삭제" },
  { id: "reports", label: "근태 리포트", description: "월별 근태 기록과 통계 확인" },
  { id: "kpi", label: "KPI", description: "데일리·주간·월별 KPI 확인" },
  { id: "payroll", label: "급여", description: "급여 기준, 세무사 제출용 정리" },
  { id: "consents", label: "직원 동의서", description: "동의서 조회와 PDF 출력" },
  { id: "rnr", label: "업무 R&R", description: "조직도와 부서별 업무 관리" },
  { id: "improvements", label: "개선 요청함", description: "직원 피드백 접수와 처리 상태 관리" },
  { id: "admin-settings", label: "권한 설정", description: "관리자별 메뉴 권한 부여" },
];
const PAYROLL_FIXED_FIELDS = ["monthly","hourly","annual","weeklyDays","dailyHours","monthlyHours"];
const COMPANY_SEAL_STORAGE_KEY = "lupl_company_seal_image";
const ATTENDANCE_RULE_CONSENT_VERSION = "2026-08-attendance-rules";
const COMPANY_SUMMER_HOLIDAY = {
  title: "회사 여름휴가",
  start: "2026-08-20",
  end: "2026-08-24",
  description: "전 직원 공통 여름휴가 · 자동 근무 일정 반영",
};
const ATTENDANCE_RULE_SECTIONS = [
  {
    title: "출근",
    items: [
      "정해진 출근 기준시각 이후 기록은 지각으로 확인될 수 있습니다.",
      "월 2회 이상 지각 시 직원 화면에 안내가 표시됩니다.",
      "월 3회 이상 반복되면 사유 확인 및 경위서 작성 대상이 될 수 있습니다.",
    ],
  },
  {
    title: "퇴근",
    items: [
      "근무 종료 후 바로 퇴근 기록을 남겨 주세요.",
      "퇴근 누락은 관리자 확인 후 정정 서명을 통해 보완합니다.",
      "출근 정정과 퇴근 정정은 각각 구분해 처리합니다.",
    ],
  },
  {
    title: "조퇴·결근·무단결근",
    items: [
      "휴가·일정 승인 여부와 실제 근무기록을 함께 확인합니다.",
      "조퇴는 근무 종료 전 퇴근하거나 승인된 시간보다 이르게 종료한 경우 확인합니다.",
      "결근은 근무 예정일에 출근 기록 또는 승인된 휴가·일정이 없는 경우 확인합니다.",
      "사전 승인 없이 근무하지 않은 경우 인사 검토 대상이 될 수 있습니다.",
      "반복성, 무단성, 업무 영향을 종합적으로 확인합니다.",
    ],
  },
  {
    title: "휴가 미신청 사용",
    items: [
      "휴가, 반차, 시간차, 병가, 경조사 등은 사전 신청과 관리자 확인을 원칙으로 합니다.",
      "긴급 사유는 사후 신청할 수 있으나 사유와 증빙을 함께 확인합니다.",
      "승인 없이 사용한 휴가는 근태 확인 또는 인사 검토 대상이 될 수 있습니다.",
    ],
  },
  {
    title: "출퇴근 기록 정정",
    items: [
      "기록이 누락되거나 실제와 다르면 관리자가 정정 요청을 만듭니다.",
      "직원 전자서명 후 정정 내용이 반영됩니다.",
      "정정 기록은 근태 확인 및 분쟁 예방 자료로 보관됩니다.",
    ],
  },
  {
    title: "인사 검토 절차",
    items: [
      "소명 내용, 기존 안내 여부, 업무 영향을 함께 검토합니다.",
      "필요 시 구두 안내, 서면 경고, 견책, 경위서 순으로 진행할 수 있습니다.",
      "중대하거나 반복되는 경우 징계위원회 또는 인사위원회 검토 대상이 될 수 있습니다.",
      "시스템은 자동 징계를 하지 않으며, 관리자 판단과 처리 기록만 남깁니다.",
    ],
  },
];
const ATTENDANCE_RULE_DETAIL_TEXT = [
  "출퇴근 기록은 근무시간 확인 기준입니다. 출근·퇴근 시 바로 기록해 주세요.",
  ...ATTENDANCE_RULE_SECTIONS.flatMap((section,index)=>[
    "",
    `${index+1}. ${section.title}`,
    ...section.items.map(item=>`- ${item}`),
  ]),
].join("\n");

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
const OVERTIME_COMP_CONSENT_CHECK_TEXT = "추가근무는 사전 신청 및 회사 승인 후 진행하는 것을 원칙으로 하며, 실제 근로 제공 여부가 회사 확인을 통해 인정되는 경우 법정 기준에 따라 추가근무로 처리된다는 설명을 확인했습니다.";
const OVERTIME_COMP_DETAIL_MAIN_TEXT = [
  "추가근무는 사전 신청 및 회사 승인 후 진행하는 것을 원칙으로 합니다.",
  "다만 실제 근로 제공 여부가 회사 확인을 통해 인정되는 경우, 해당 시간은 법정 기준에 따라 추가근무로 처리됩니다.",
  "",
  "승인 또는 확인된 추가근무 시간은 앱에서 보상휴가 적립·사용 내역으로 관리됩니다.",
  "보상휴가제는 근로기준법 제57조에 따른 서면합의 기준에 따라 운영되며, 연장·야간·휴일근로에 해당하는 경우 법정 가산 기준을 반영합니다.",
].join("\n");
const OVERTIME_COMP_DETAIL_LEGAL_TEXT = "(관계 법령 근로기준법 제53조, 제56조, 제57조)";
const OVERTIME_COMP_DETAIL_SIGN_TEXT = "이 서명은 향후 모든 연장근로·야간근로·휴일근로에 대한 사전 포괄 동의가 아니며, 실제 추가근무는 건별 신청·승인 또는 회사 확인 기록에 따라 처리됩니다.";
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
const ADMIN_CONFIDENTIALITY_CONSENT_VERSION = "2026-07-confidentiality-formal-all";
const ADMIN_CONFIDENTIALITY_NOTICE_TEXT = "비밀유지 및 정보보호 서약서";
const ADMIN_CONFIDENTIALITY_DETAIL_TEXT = [
  "1. 목적",
  "본 서약서는 근태 시스템 및 업무 수행 과정에서 알게 되는 회사 정보, 개인정보 및 업무자료를 보호하기 위하여 작성합니다.",
  "",
  "2. 비밀정보의 범위",
  "비밀정보란 회사가 공개하지 않은 모든 업무상 정보를 말합니다.",
  "여기에는 고객·직원 개인정보, 거래처 정보, 계약·정산·재무자료, 교육자료, 운영 매뉴얼, 소스코드, 계정 및 접근권한, 사업계획, 마케팅 자료, 내부 대화 및 회의 내용이 포함됩니다.",
  "",
  "3. 금지행위",
  "본인은 비밀정보를 회사의 승인 없이 공개, 제공, 복제, 전송, 게시하거나 사적으로 이용하지 않겠습니다.",
  "본인은 비밀정보를 개인 기기, 개인 이메일, 개인 클라우드 또는 외부 저장소에 임의로 보관하지 않겠습니다.",
  "",
  "4. 외부 공개 및 포트폴리오 사용",
  "본인은 회사 업무 산출물, 내부 자료 또는 고객·직원 관련 정보를 포트폴리오, 이력서, 발표자료, SNS, 블로그, 외부 제안서 등에 사용하려는 경우 사전에 회사의 명시적 승인을 받겠습니다.",
  "",
  "5. 퇴직·권한 변경 시 조치",
  "본인은 퇴직, 권한 변경 또는 회사 요청이 있는 경우 회사 자료, 계정, 저장매체, 출력물 및 사본을 즉시 반환하거나 삭제하겠습니다.",
  "",
  "6. 위반 시 조치",
  "본 서약을 위반한 경우 회사는 접근권한 회수, 징계, 손해배상 청구 및 관계 법령에 따른 조치를 할 수 있음을 확인합니다.",
  "",
  "7. 근로조건과의 관계",
  "본 서약은 임금, 휴가, 근로시간 등 근로조건의 포기 또는 위약벌 약정이 아닙니다.",
  "",
  "위 내용을 확인하고 서약합니다.",
].join("\n");
const WORK_TIME_CONSENT_CHECK_TEXT = "근무요일, 근무시간, 휴게시간이 변경되는 경우 앱에서 변경 내용을 확인하고 전자서명할 수 있으며, 실제 변경은 건별 요청 및 회사 승인 후 적용된다는 설명을 확인했습니다.";
const ANNUAL_LEAVE_LEGAL_NOTE = "파트타임이라는 이유만으로 연차가 항상 없는 것은 아닙니다. 4주 평균 1주 소정근로시간이 15시간 미만이면 연차 규정 적용 제외가 가능하고, 15시간 이상 단시간근로자는 연차가 발생할 수 있습니다.";
const RNR_BASELINE_ROLES = [
  {department:"홍보마케팅부서", position:"선임", keywords:["홍보","마케팅","광고","SNS","콘텐츠","제휴"], duties:["홍보 콘텐츠 기획","SNS/광고 운영","제휴 제안 정리","성과 지표 확인","브랜드 메시지 관리"]},
  {department:"경영지원부서", position:"선임", keywords:["문서","서류","계약","인사","정산","운영"], duties:["문서/계약 자료 정리","인사·근태 자료 확인","정산 기초자료 취합","운영 일정 조율"]},
  {department:"경영지원부서", position:"매니저", keywords:["일정","비품","입력","응대","지원","사무"], duties:["사무 지원","데이터 입력","비품/소모품 확인","전화/방문 응대","부서 요청 접수"]},
  {department:"AI부서", position:"선임", keywords:["AI","자동화","데이터","프롬프트","모델","분석"], duties:["AI 자동화 기획","데이터 정리","프롬프트/결과 검수","업무 효율화 제안"]},
  {department:"개발부서", position:"매니저", keywords:["개발","버그","배포","시스템","앱","기능"], duties:["서비스 기능 개발","버그 확인 및 수정","배포 상태 점검","운영 기능 개선"]},
  {department:"디자인부서", position:"매니저", keywords:["디자인","브랜드","UI","이미지","콘텐츠","시안"], duties:["브랜드/콘텐츠 디자인","UI 화면 정리","홍보 이미지 제작","시안 관리"]},
  {department:"기획부서", position:"선임", keywords:["기획","전략","사업","프로젝트","제안","운영안"], duties:["사업·운영 기획","프로젝트 요구사항 정리","일정·우선순위 조율","성과 지표 설계"]},
];
const RNR_CATEGORY_RULES = [
  {label:"기획·전략", keywords:["기획","전략","사업","프로젝트","제안","운영안","우선순위","로드맵"]},
  {label:"문서·행정", keywords:["서류","문서","계약서","제출","양식","파일","자료","공문","인사","채용","근로계약","근태","휴가"]},
  {label:"회계·정산", keywords:["회계","세무","세금","정산","입금","출금","매출","비용","영수증","청구","결제","부가세","원천세","신고","세무사","증빙"]},
  {label:"고객·수업운영", keywords:["운영","일정","비품","재고","교육장","학교","수업","교육","준비","체크","문의","전화","응대","상담","고객","학부모","안내"]},
  {label:"콘텐츠·홍보", keywords:["홍보","마케팅","광고","SNS","콘텐츠","블로그","인스타","디자인","시안","이미지","카드뉴스","브랜드"]},
  {label:"시스템·자동화", keywords:["개발","버그","앱","시스템","배포","기능","AI","자동화","프롬프트","데이터","모델"]},
];
const RNR_CATEGORY_OPTIONS = ["", ...RNR_CATEGORY_RULES.map(rule=>rule.label), "기타"];
const DEPARTMENT_OPTIONS = ["", ...Array.from(new Set(RNR_BASELINE_ROLES.map(role=>role.department)))];
const POSITION_OPTIONS = ["","대표","본부장","책임","선임","매니저","인턴"];
const RNR_FALLBACK_WORK_GROUPS = [
  "온보딩 및 교육",
  "문서 및 자료 관리",
  "운영 매뉴얼 관리",
  "내부 커뮤니케이션",
  "일정 및 진행 관리",
];
const RNR_DEPARTMENT_WORK_GROUPS:Record<string,string[]> = {
  공통:["온보딩 및 교육","문서 및 자료 관리","운영 매뉴얼 관리","내부 커뮤니케이션","일정 및 진행 관리"],
  경영지원부서:["인사·온보딩 관리","계약 및 문서 관리","세무·정산 관리","지원사업 관리","총무·운영 지원","내부 자료 관리"],
  홍보마케팅부서:["콘텐츠 기획·제작","SNS·블로그 운영","언론·보도 관리","홍보자료 관리","브랜드 커뮤니케이션"],
  기획부서:["교육 기획","행사 기획","전시 기획","프로그램 기획·운영","파트너십·대외협력","시장 조사·신규사업"],
  개발부서:["서비스 개발","기능 개선·이슈 관리","홈페이지 운영","내부 시스템 관리","외부 SaaS 연동·사용 관리"],
  AI부서:["AI 교육 콘텐츠","AI 수업 운영","AI 자동화 기획","데이터 정리·분석","AI 서비스 기획·운영"],
  디자인부서:["콘텐츠 디자인","브랜드 디자인","홍보물 제작","UI·화면 디자인","디자인 자료 관리"],
};
const WORK_TIME_CHANGE_MODE_LABELS:Record<string,string> = {
  work_time:"근무 일정 확인",
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
const IMPROVEMENT_STATUS_LABELS:Record<string,string>={open:"대기",reviewing:"처리중",planned:"배포·반영됨",done:"확인완료",dismissed:"보류"};
const IMPROVEMENT_SUBMENU_OPTIONS:Record<string,string[]> = {
  attendance:["오늘의 할일","출근하기","퇴근하기","내 기기","최근 기록","브라우저 알림"],
  leave:["휴가 신청","연차 현황","신청 내역","보상휴가 시간 사용"],
  overtime:["추가근무 신청","추가근무 내역","보상휴가 적립"],
  worktime:["근무 일정 확인","기존 근무조건","변경 사유","상세 설명","서명","요청 내역"],
  "team-schedule":["직원별 주간 캘린더","캘린더 요약"],
  "work-map":["공개 업무 분장표","부서별 업무 흐름"],
  kpi:["직원별 달성률","데일리 KPI","주간 KPI","월별 KPI","웍스 공유"],
  "admin-dashboard":["승인 대기","일일 직원 근무 현황","기록 마감","확인 완료"],
  employees:["추가근무 적립 내역","근무시간 변경 요청","근무시간 변경 기록","직원 연차 소진내용","직원 연차 현황","직원 계정 생성","직원 관리"],
  workplaces:["근무지 등록","승인된 근무지","근무지 승인"],
  schedule:["직원별 주간 캘린더","일정 한 줄 변경","주간 스케줄 변경","특정 기간 미출근 설정"],
  payroll:["급여 계산","직원별 급여·근무 기준","공제 내역"],
  reports:["근태 요약","근태 기록","엑셀 내보내기"],
  consents:["직원 서명 리포트","개인정보 동의","근무시간 변경 요청 서명"],
  rnr:["업무 메모","AI 정리","조직도","R&R 스택","담당자별 보드"],
  improvements:["개선 요청 목록","상태 관리"],
};

const workplaceTypeLabels: Record<string,string> = { office:"사무실", special_school:"특수학교", external_education:"외부 교육장", remote:"재택", other_field:"기타 외근지" };
const requestTypeLabels: Record<string,string> = { annual:"연차", half_am:"오전 반차", half_pm:"오후 반차", hourly:"시간차", sick:"병가", official:"공가", remote:"재택", field:"외근", special:"특별휴가", substitute:"대체휴가", compensatory:"보상휴가", time_fix:"근무시간 수정", comp_leave_use:"보상휴가 시간 사용" };
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

function simpleDocumentHash(value:any) {
  const text=String(value??"");
  let hash=2166136261;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return `LUPL-${(hash>>>0).toString(16).toUpperCase().padStart(8,"0")}`;
}

function companySealHtml() {
  let src="";
  try { src=localStorage.getItem(COMPANY_SEAL_STORAGE_KEY)??""; } catch { src=""; }
  if(src.startsWith("data:image/")) return `<img class="company-seal-img" src="${escapeHtml(src)}" alt="법인 도장">`;
  return `<div class="company-seal-placeholder">법인<br>도장</div>`;
}

function officialPrintHtml({title,docNo,employee,bodyHtml,metaRows=[],signatureData="",footerText="",confirmManager="대표 이희은",confirmDate=""}:{
  title:string;
  docNo:string;
  employee?:any;
  bodyHtml:string;
  metaRows?:{label:string;value:any}[];
  signatureData?:string;
  footerText?:string;
  confirmManager?:string;
  confirmDate?:string;
}) {
  const generatedAt=new Intl.DateTimeFormat("ko-KR",{dateStyle:"long",timeStyle:"short",timeZone:"Asia/Seoul"}).format(new Date());
  const confirmedAt=confirmDate||generatedAt;
  const hash=simpleDocumentHash([title,docNo,employee?.id,employee?.employee_no,bodyHtml,signatureData,generatedAt].join("|"));
  const targetRows=employee ? [
    {label:"대상자",value:`${employee.name??"-"} (${employee.employee_no??"-"})`},
    {label:"소속/직책",value:[employee.department,employee.position].filter(Boolean).join(" / ")||"-"},
  ] : [];
  const rows=[{label:"문서번호",value:docNo},{label:"출력일시",value:generatedAt},...targetRows,...metaRows,{label:"문서해시",value:hash}];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4;margin:18mm}
    *{box-sizing:border-box}
    body{margin:0;color:#111827;font-family:"Malgun Gothic",Arial,sans-serif;line-height:1.62}
    .doc{max-width:760px;margin:0 auto}
    .doc-mark{text-align:center;font-size:12px;color:#6b7280;letter-spacing:0;margin-bottom:6px}
    h1{margin:0 0 18px;text-align:center;font-size:25px;letter-spacing:0}
    .meta{width:100%;border-collapse:collapse;margin:0 0 18px}
    .meta th,.meta td{border:1px solid #9ca3af;padding:8px 10px;text-align:left;font-size:12px}
    .meta th{width:118px;background:#eef2f7;font-weight:700}
    .section-title{margin:20px 0 8px;font-size:14px;font-weight:800;border-bottom:2px solid #111827;padding-bottom:5px}
    .body{white-space:pre-wrap;border:1px solid #d1d5db;padding:13px 14px;font-size:13px}
    .consent-table{width:100%;border-collapse:collapse;margin-top:10px}
    .consent-table th,.consent-table td{border:1px solid #9ca3af;padding:8px 10px;font-size:12px;text-align:left}
    .consent-table th{background:#f3f4f6}
    .sign-grid{display:grid;grid-template-columns:1fr 180px;gap:14px;align-items:stretch;margin-top:10px}
    .signature,.seal{border:1px solid #9ca3af;min-height:120px;display:grid;place-items:center;padding:8px}
    .signature img{max-width:100%;max-height:105px}
    .signature span{color:#6b7280;font-size:12px}
    .company-seal-img{max-width:128px;max-height:128px;object-fit:contain}
    .company-seal-placeholder{width:96px;height:96px;border:2px solid #b91c1c;border-radius:50%;color:#b91c1c;display:grid;place-items:center;text-align:center;font-weight:800;line-height:1.25}
    .confirm-box{margin-top:12px;border:1px solid #9ca3af;padding:10px;font-size:12px}
    .footer{margin-top:22px;text-align:right;font-size:13px}
    .toolbar{position:fixed;right:14px;top:14px}
    button{border:0;border-radius:8px;background:#1d4ed8;color:white;padding:10px 14px;font-weight:700}
    @media print{.toolbar{display:none}}
  </style></head><body><div class="toolbar"><button onclick="window.print()">PDF 저장·인쇄</button></div><main class="doc">
    <div class="doc-mark">주식회사 러플 공식 문서</div>
    <h1>${escapeHtml(title)}</h1>
    <table class="meta"><tbody>${rows.map(row=>`<tr><th>${escapeHtml(row.label)}</th><td>${escapeHtml(row.value)}</td></tr>`).join("")}</tbody></table>
    <div class="section-title">본문</div>
    <div class="body">${bodyHtml}</div>
    <div class="section-title">동의 및 확인</div>
    <table class="consent-table"><thead><tr><th>항목</th><th>확인 내용</th></tr></thead><tbody><tr><td>전자서명</td><td>대상자가 위 내용을 확인하고 전자서명했습니다.</td></tr><tr><td>회사 확인</td><td>시스템 저장 기록과 관리자 확인란을 함께 보관합니다.</td></tr></tbody></table>
    <div class="sign-grid"><div><b>대상자 서명</b><div class="signature">${signatureData?`<img src="${escapeHtml(signatureData)}" alt="전자 서명">`:"<span>전자서명 이미지 없음</span>"}</div></div><div><b>회사 확인</b><div class="seal">${companySealHtml()}</div></div></div>
    <div class="confirm-box">회사 확인란: 담당자 ${escapeHtml(confirmManager)} / 확인일 ${escapeHtml(confirmedAt)} / 비고 ______________________________</div>
    <p class="footer">${escapeHtml(footerText || "위 문서는 시스템 저장 기록을 기준으로 생성되었습니다.")}</p>
    <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));<\/script>
  </main></body></html>`;
}

function openOfficialPrintWindow(args:Parameters<typeof officialPrintHtml>[0]) {
  const popup=window.open("","_blank","width=860,height=1000");
  if(!popup) return false;
  popup.opener=null;
  popup.document.write(officialPrintHtml(args));
  popup.document.close();
  return true;
}

function companySummerHolidayLabel() {
  return `${COMPANY_SUMMER_HOLIDAY.start}(목) ~ ${COMPANY_SUMMER_HOLIDAY.end}(월)`;
}
function isCompanySummerHolidayDate(dateIso:string) {
  return todayIso()<=COMPANY_SUMMER_HOLIDAY.end&&dateIso>=COMPANY_SUMMER_HOLIDAY.start&&dateIso<=COMPANY_SUMMER_HOLIDAY.end;
}
function companyHolidayLeaveObject(dateIso:string) {
  return {
    id:`company-holiday-${dateIso}`,
    request_type:"company_holiday",
    start_date:COMPANY_SUMMER_HOLIDAY.start,
    end_date:COMPANY_SUMMER_HOLIDAY.end,
    reason:COMPANY_SUMMER_HOLIDAY.description,
    status:"approved",
  };
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
function formatDateOnly(v?: string | null) {
  if (!v) return "-";
  return localDateStr(v);
}
function timeOnly(v?: string | Date | null) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Seoul" }).format(new Date(v));
}
function SignedAt({value}:{value?:string|null}) {
  if(!value) return <span className="subtle">-</span>;
  return <span className="signed-at-cell"><b>{formatDateOnly(value)}</b><span>{timeOnly(value)}</span></span>;
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
    .reduce((sum:number,r:any)=>sum+compRequestHours(r)/8,0);
}
function compRequestHours(r:any) {
  const hours=Number(r?.hours);
  if(Number.isFinite(hours)&&hours>0) return hours;
  return Number(r?.converted_days||0)*8;
}
function compRequestKey(r:any) {
  return [
    r.employee_id ?? "",
    r.work_date ?? "",
    r.start_time ?? "",
    r.end_time ?? "",
    Number(compRequestHours(r) || 0).toFixed(4),
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
  if (["rejected","반려","inactive","지각","결근","지각 확인 필요","결근 확인 필요"].includes(s)) return "bad";
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
  return [
    `출근 ${formatDateTime(record.old_check_in_time)} -> ${formatDateTime(record.requested_check_in_time)}`,
    `퇴근 ${formatDateTime(record.old_check_out_time)} -> ${formatDateTime(record.requested_check_out_time)}`,
  ].join("\n");
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
function fmtHoursFromMinutes(m: number | null) {
  return m == null ? "-" : `${formatHourValue(m/60)}시간`;
}
function timeDiffHours(start: string, end: string) {
  const [sh,sm] = start.split(":").map(Number);
  const [eh,em] = end.split(":").map(Number);
  const diff = (eh*60+em) - (sh*60+sm);
  return diff > 0 ? Math.round((diff/60)*100)/100 : 0;
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
function timeSpanMinutes(start?:string|null,end?:string|null) {
  const s=timeToMinutes(start), e=timeToMinutes(end);
  if(s==null||e==null) return 0;
  return e>s ? e-s : (24*60-s)+e;
}
function parseDurationMinutes(text:string) {
  const compact=text.replace(/\s/g,"");
  const numberWord="영|공|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|스무|스물(?:한|두|세|네)?|일|이|삼|사|오|육|칠|팔|구|십|이십(?:일|이|삼|사)?";
  const hourMatch=compact.match(new RegExp(`(\\d+(?:\\.\\d+)?|${numberWord})시간`));
  const minuteMatch=compact.match(new RegExp(`(\\d+|${numberWord})분`));
  const hourRaw=hourMatch?.[1];
  const minuteRaw=minuteMatch?.[1];
  const hours=hourRaw ? (/^\d/.test(hourRaw) ? Number(hourRaw) : koreanNumberToInt(hourRaw)??0) : 0;
  const minutes=minuteRaw ? (/^\d/.test(minuteRaw) ? Number(minuteRaw) : koreanNumberToInt(minuteRaw)??0) : 0;
  const total=Math.round(hours*60+minutes);
  return total>0?total:null;
}
function looksLikeOvertimeCommand(text:string) {
  const hasOvertimeWord=/추가\s*근무|초과\s*근무|연장\s*근무|야근/.test(text);
  const hasApplicationShape=/(신청|외부|미팅|거래처|식사)/.test(text)&&!!parsePromptTimeRange(text)&&(!!parseDurationMinutes(text)||/시간/.test(text));
  return hasOvertimeWord||hasApplicationShape;
}
function compactOvertimeReason(raw:string, employee:any, dateRange:any) {
  return raw
    .replace(/\*\*/g,"")
    .replace(new RegExp(String(employee?.name??"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"),"")
    .replace(new RegExp(String(employee?.employee_no??"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"g"),"")
    .replace(dateRange?.start_date??"","")
    .replace(/(?:(?:\d{4})[-./])?\d{1,2}[-./]\d{1,2}/g,"")
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g,"")
    .replace(/추가\s*근무|초과\s*근무|연장\s*근무|야근/g,"")
    .replace(/신청\s*사유\s*:/g,"")
    .replace(/신청/g,"")
    .replace(/\d{1,2}:\d{2}\s*(?:~|-|부터|에서)\s*\d{1,2}:\d{2}/g,"")
    .replace(/\d+(?:\.\d+)?\s*시간/g,"")
    .replace(/[·|]/g," ")
    .replace(/(^|\s)시간(?=\s|$)/g," ")
    .replace(/\s+/g," ")
    .trim();
}
function cleanOvertimeReasonText(text?:string|null) {
  return String(text??"")
    .replace(/\s*(원문:|저녁시간 처리:|근무 인정 사유:)[\s\S]*$/,"")
    .replace(/^시간\s+/,"")
    .replace(/\s+/g," ")
    .trim();
}
function displayOvertimeReason(reason?:string|null) {
  const raw=String(reason??"").trim();
  if(!raw) return "사유 미입력";
  const confirmedReason=raw.match(/근무 인정 사유:\s*([\s\S]*)$/)?.[1];
  const firstLine=raw.split(/\r?\n/).find(line=>{
    const value=line.trim();
    return value&&!/^원문:/.test(value)&&!/^저녁시간 처리:/.test(value)&&value!=="관리자 한 줄 입력";
  });
  const cleaned=cleanOvertimeReasonText(confirmedReason??firstLine??raw);
  return cleaned&&cleaned!=="관리자 한 줄 입력"?cleaned:"사유 미입력";
}
function normalizeMinuteRange(start?:string|null,end?:string|null):[number,number]|null {
  const s=timeToMinutes(start), e=timeToMinutes(end);
  if(s==null||e==null) return null;
  return [s,e>s?e:e+24*60];
}
function subtractMinuteRange(ranges:[number,number][], cut:[number,number]|null) {
  if(!cut) return ranges;
  const cuts:[number,number][]=[cut,[cut[0]+24*60,cut[1]+24*60]];
  let next=ranges;
  cuts.forEach(([cutStart,cutEnd])=>{
    next=next.flatMap(([start,end])=>{
      const overlapStart=Math.max(start,cutStart);
      const overlapEnd=Math.min(end,cutEnd);
      if(overlapEnd<=overlapStart) return [[start,end] as [number,number]];
      const pieces:[number,number][]=[];
      if(start<overlapStart) pieces.push([start,overlapStart]);
      if(overlapEnd<end) pieces.push([overlapEnd,end]);
      return pieces;
    });
  });
  return next.filter(([start,end])=>end>start);
}
function minuteRangeTotal(ranges:[number,number][]) {
  return ranges.reduce((sum,[start,end])=>sum+Math.max(0,end-start),0);
}
function addMinutesSkippingRanges(startMinute:number, minutes:number, blockedRanges:[number,number][]) {
  if(minutes<=0) return startMinute+minutes;
  let cursor=startMinute;
  let remaining=minutes;
  for(const [start,end] of blockedRanges.sort((a,b)=>a[0]-b[0])){
    if(end<=cursor) continue;
    if(cursor<start){
      const available=start-cursor;
      if(remaining<=available) return cursor+remaining;
      remaining-=available;
      cursor=start;
    }
    if(cursor<end) cursor=end;
  }
  return cursor+remaining;
}
function approvedLeaveRangesForDate(requests:any[], dateIso:string, schedule:any) {
  const workRange=normalizeMinuteRange(schedule?.work_start??"09:00",schedule?.work_end??"18:00");
  if(!workRange) return [];
  return requests
    .filter((request:any)=>request.status==="approved"&&dateIso>=request.start_date&&dateIso<=request.end_date)
    .filter((request:any)=>request.request_type==="comp_leave_use"||LEAVE_TYPE_META[request.request_type]?.usesLeave)
    .map((request:any)=>{
      if(["half_am","half_pm","hourly","comp_leave_use"].includes(request.request_type)){
        const start=request.request_type==="half_pm" ? (request.start_time??"14:00") : (request.start_time??schedule?.work_start??"09:00");
        const end=request.request_type==="half_am" ? (request.end_time??"14:00") : (request.end_time??schedule?.work_end??"18:00");
        return normalizeMinuteRange(start,end);
      }
      return workRange;
    })
    .filter(Boolean) as [number,number][];
}
function requiredWorkRangesForDate(dateIso:string, schedule:any, leaveRequests:any[]=[]) {
  const workRange=normalizeMinuteRange(schedule?.work_start??"09:00",schedule?.work_end??"18:00");
  if(!workRange) return [];
  let ranges=subtractMinuteRange([workRange],normalizeMinuteRange(schedule?.break_start??"12:00",schedule?.break_end??"13:00"));
  approvedLeaveRangesForDate(leaveRequests,dateIso,schedule).forEach(leave=>{ ranges=subtractMinuteRange(ranges,leave); });
  return ranges.sort((a,b)=>a[0]-b[0]);
}
function approvedLeaveMinutesForDate(requests:any[], dateIso:string, schedule:any) {
  const workRange=normalizeMinuteRange(schedule?.work_start??"09:00",schedule?.work_end??"18:00");
  if(!workRange) return 0;
  const gross=minuteRangeTotal(subtractMinuteRange([workRange],normalizeMinuteRange(schedule?.break_start??"12:00",schedule?.break_end??"13:00")));
  return Math.max(0,gross-minuteRangeTotal(requiredWorkRangesForDate(dateIso,schedule,requests)));
}
function kstMinutesOnDate(value:Date, dateIso:string) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(value);
  const part=(type:string)=>parts.find(p=>p.type===type)?.value??"";
  const seenDate=`${part("year")}-${part("month")}-${part("day")}`;
  const hour=Number(part("hour"))%24;
  let total=hour*60+Number(part("minute")||0);
  if(seenDate>dateIso) total+=24*60;
  if(seenDate<dateIso) total-=24*60;
  return total;
}
function expectedWorkEndForDate(dateIso:string, schedule:any, leaveRequests:any[]=[], checkIn?:Date|null) {
  const workRange=normalizeMinuteRange(schedule?.work_start??"09:00",schedule?.work_end??"18:00");
  const ranges=requiredWorkRangesForDate(dateIso,schedule,leaveRequests);
  const firstRange=ranges[0];
  const lastRange=ranges[ranges.length-1];
  let missedMinutes=0;
  let earlyMinutes=0;
  if(checkIn){
    const checkInMinute=kstMinutesOnDate(checkIn,dateIso);
    if(workRange&&ranges.length>0&&checkInMinute<workRange[0]) earlyMinutes=workRange[0]-checkInMinute;
    missedMinutes=ranges.reduce((sum,[start,end])=>{
      if(checkInMinute<=start) return sum;
      if(checkInMinute>=end) return sum+(end-start);
      return sum+(checkInMinute-start);
    },0);
  }
  const baseEndMinute=lastRange?.[1]??workRange?.[1]??(timeToMinutes(schedule?.work_end??"18:00")??18*60);
  const breakRange=normalizeMinuteRange(schedule?.break_start??"12:00",schedule?.break_end??"13:00");
  const blockedRanges=[...(breakRange?[breakRange]:[]),...approvedLeaveRangesForDate(leaveRequests,dateIso,schedule)];
  const endMinute=addMinutesSkippingRanges(baseEndMinute,missedMinutes-earlyMinutes,blockedRanges);
  const expectedEnd=addMinutes(kstDateTime(dateIso,minutesToTime(endMinute%(24*60))),Math.floor(endMinute/(24*60))*24*60);
  return {expectedEnd,shiftMinutes:minuteRangeTotal(ranges),leaveMinutes:approvedLeaveMinutesForDate(leaveRequests,dateIso,schedule)};
}
function dateTimeForWorkDateTime(dateIso:string, time?:string|null, after?:Date|null) {
  if(!time) return null;
  let value=kstDateTime(dateIso,time);
  if(after&&value.getTime()<=after.getTime()) value=addMinutes(value,24*60);
  return value;
}
function dinnerBreakOverlapMinutes(start:Date, end:Date|null) {
  if(!end||end.getTime()<=start.getTime()) return 0;
  const dateIso=localDateStr(start);
  const dinnerStart=kstDateTime(dateIso,"18:00");
  const dinnerEnd=kstDateTime(dateIso,"19:00");
  return Math.max(0,Math.round((Math.min(end.getTime(),dinnerEnd.getTime())-Math.max(start.getTime(),dinnerStart.getTime()))/60000));
}
function addOvertimeMinutes(start:Date, durationMinutes:number, excludeDinner:boolean) {
  const end=addMinutes(start,durationMinutes);
  return excludeDinner ? addMinutes(end,dinnerBreakOverlapMinutes(start,end)) : end;
}
function compRequestExcludesDinner(request:any) {
  return /저녁\s*휴게\s*제외|저녁시간\s*처리:\s*휴게시간\s*제외/.test(String(request?.reason??""));
}
function checkoutReminderTarget(log:any, employee:any, overrides:any[], compRequests:any[], workTimeChanges:any[] = [], leaveRequests:any[] = []) {
  if(!log?.check_in_time||log?.check_out_time) return null;
  const dateIso=localDateStr(log.check_in_time);
  const sched=getScheduleForDate(employee,dateIso,overrides,workTimeChanges);
  const checkIn=new Date(log.check_in_time);
  let target=expectedWorkEndForDate(dateIso,sched,leaveRequests,checkIn).expectedEnd;
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
function dateRangesOverlap(startA:string, endA:string, startB?:string|null, endB?:string|null) {
  if(!startB) return false;
  return startB<=endA && (endB??startB)>=startA;
}
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
function dateRangeList(start:string,end:string){
  const count=countDaysInclusive(start,end);
  return Array.from({length:count},(_,index)=>addIsoDays(start,index));
}
function scheduleEventLanes(events:any[]){
  const laneEnds:string[]=[];
  return [...events].sort((a,b)=>a.start_date.localeCompare(b.start_date)||a.end_date.localeCompare(b.end_date)).map(event=>{
    let lane=laneEnds.findIndex(end=>end<event.start_date);
    if(lane<0){lane=laneEnds.length;laneEnds.push(event.end_date);}else laneEnds[lane]=event.end_date;
    return {...event,lane};
  });
}
function orderedDays(days:string[] = []) {
  return ALL_DAYS.filter(day=>days.includes(day));
}
function daysLabel(days:string[] = []) {
  const ordered=orderedDays(days);
  return ordered.length ? ordered.map((d:string)=>DAY_LABELS[d]??d).join(", ") : "-";
}
function isEmployeeActive(employee:any) {
  return employee?.employment_status==="active"&&employee?.is_active!==false;
}
function isTestEmployee(employee:any) {
  const name=String(employee?.name??"").trim().toLowerCase();
  const no=String(employee?.employee_no??"").trim().toLowerCase();
  return name==="test"||no.startsWith("test");
}
function imageFileToAttachment(file:File, prefix="att") {
  return new Promise<any>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve({id:`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,name:file.name||"pasted-image.png",type:file.type||"image/png",data_url:String(reader.result)});
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function isImageAttachment(attachment:any) {
  return String(attachment?.data_url??"").startsWith("data:image/");
}
function timeLabel(time?: string | null) { return time ? String(time).slice(0,5) : "-"; }
function timeRangeLabel(start?: string | null, end?: string | null) { return `${timeLabel(start)} ~ ${timeLabel(end)}`; }
function employeeContractStart(employee:any) { return employee?.work_start_date ?? employee?.contract_start ?? employee?.joined_at ?? todayIso(); }
function employeeContractEnd(employee:any) { return employee?.contract_end ?? null; }
function employeeSeniorityValue(employee:any) { return String(employee?.work_start_date ?? employee?.joined_at ?? employee?.created_at ?? "9999-12-31").slice(0,10); }
function sortEmployeesBySeniority(a:any,b:any) {
  return employeeSeniorityValue(a).localeCompare(employeeSeniorityValue(b)) || String(a?.name??"").localeCompare(String(b?.name??""));
}
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
  return `현재 등록된 주 소정근로시간은 약 ${hours.toFixed(1)}시간입니다. 4주 평균 1주 소정근로시간이 15시간 미만인 경우 근로기준법 제18조에 따라 제60조 연차 규정 적용 제외가 가능합니다.`;
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
function scheduleEventIsNoWork(event:any){
  return /출근\s*안|근무\s*안|출근\s*불가|근무\s*불가|휴무|쉬는|쉼/.test(`${event?.title??""} ${event?.note??""}`);
}
function scheduleEventBlocksRoster(event:any){
  if(!event||!scheduleEventIsNoWork(event)) return false;
  const days=countDaysInclusive(event.start_date,event.end_date);
  return event.open_ended||event.end_date==="2099-12-31"||days>=28;
}
function workTimeChangeBlocksRoster(changes:any[] = [], emp:any, dateIso:string) {
  const change=approvedWorkTimeChangeForDate(changes,emp,dateIso);
  if(!change||(change.new_work_days??[]).length>0) return false;
  const period=(change.periods??[]).find((p:any)=>dateInRange(dateIso,p.start_date,p.end_date));
  if(!period) return false;
  const days=countDaysInclusive(period.start_date,period.end_date);
  return period.end_date==="2099-12-31"||days>=28;
}
function scheduleEventPriorityValue(event:any){
  if(event?.event_type==="hidden"&&scheduleEventIsNoWork(event)) return 60;
  if(event?.event_type==="unavailable") return 50;
  if(event?.event_type==="work") return 40;
  if(["am_only","pm_only"].includes(event?.event_type)) return 30;
  if(event?.event_type==="hidden") return 20;
  return 0;
}
function displayScheduleEventValue(event:any){
  if(event?.event_type==="hidden"&&scheduleEventIsNoWork(event)){
    return {...event,event_type:"unavailable",title:event.title||"출근 안 함",start_time:event.start_time??"09:00",end_time:event.end_time??"19:00"};
  }
  return event;
}
function scheduleEventForDate(events:any[] = [], employee:any, dateIso:string){
  const event=events
    .filter((item:any)=>item.employee_id===employee?.id&&dateIso>=item.start_date&&dateIso<=item.end_date&&["hidden","unavailable","work","am_only","pm_only"].includes(item.event_type))
    .sort((a:any,b:any)=>scheduleEventPriorityValue(b)-scheduleEventPriorityValue(a)||countDaysInclusive(a.start_date,a.end_date)-countDaysInclusive(b.start_date,b.end_date)||String(b.updated_at??b.created_at??"").localeCompare(String(a.updated_at??a.created_at??"")))[0];
  return displayScheduleEventValue(event);
}
function scheduleInfoForDateWithEvents(employee:any,dateIso:string,events:any[]=[],overrides:any[]=[],workTimeChanges:any[]=[]) {
  const schedule=getScheduleForDate(employee,dateIso,overrides,workTimeChanges);
  const change=approvedWorkTimeChangeForDate(workTimeChanges,employee,dateIso);
  const event=scheduleEventForDate(events,employee,dateIso);
  const eventOverridesSchedule=event&&!change;
  const eventIsWork=["work","am_only","pm_only"].includes(event?.event_type);
  const workday=eventOverridesSchedule ? eventIsWork : (schedule.work_days??[]).includes(dayKeyFromDate(dateFromIso(dateIso)));
  const start=eventOverridesSchedule ? event?.start_time??schedule.work_start : schedule.work_start;
  const end=eventOverridesSchedule ? event?.end_time??schedule.work_end : schedule.work_end;
  const hours=workday?netDailyHours(start,end,schedule.break_start??"12:00",schedule.break_end??"13:00"):0;
  return {workday,start,end,hours,event,schedule,change};
}
function employeeHasWeekWork(employee:any,dates:string[],events:any[]=[],overrides:any[]=[],workTimeChanges:any[]=[]) {
  const contractStart=employeeContractStart(employee);
  const contractEnd=employee?.contract_type==="fixed_term" ? employeeContractEnd(employee) : null;
  return dates.some(date=>{
    if((contractStart&&date<contractStart)||(contractEnd&&date>contractEnd)) return false;
    const event=scheduleEventForDate(events,employee,date);
    if(scheduleEventBlocksRoster(event)) return false;
    if(workTimeChangeBlocksRoster(workTimeChanges,employee,date)) return false;
    const dayKey=dayKeyFromDate(dateFromIso(date));
    const schedule=getScheduleForDate(employee,date,overrides,workTimeChanges);
    if((schedule.work_days??[]).includes(dayKey) || ["work","am_only","pm_only"].includes(event?.event_type)) return true;
    const baseSchedule=getScheduleForDate(employee,date,overrides,[]);
    return (baseSchedule.work_days??[]).includes(dayKey);
  });
}
function employeeHasWeekHistory(employee:any,dates:string[],events:any[]=[],overrides:any[]=[],workTimeChanges:any[]=[],leaveRequests:any[]=[],compTimeRequests:any[]=[]) {
  if(!employee?.id||dates.length===0) return false;
  const weekStart=dates[0], weekEnd=dates[dates.length-1];
  if(employeeHasWeekWork(employee,dates,events,overrides,workTimeChanges)) return true;
  if(events.some((event:any)=>event.employee_id===employee.id&&dateRangesOverlap(weekStart,weekEnd,event.start_date,event.end_date))) return true;
  if(leaveRequests.some((request:any)=>request.employee_id===employee.id&&request.status==="approved"&&dateRangesOverlap(weekStart,weekEnd,request.start_date,request.end_date))) return true;
  return compTimeRequests.some((request:any)=>request.employee_id===employee.id&&dateInRange(request.work_date,weekStart,weekEnd));
}
function employeeVisibleInScheduleWeek(employee:any,dates:string[],events:any[]=[],overrides:any[]=[],workTimeChanges:any[]=[],leaveRequests:any[]=[],compTimeRequests:any[]=[]) {
  if(isTestEmployee(employee)) return false;
  if(isEmployeeActive(employee)) {
    if(employeeHasWeekWork(employee,dates,events,overrides,workTimeChanges)) return true;
    const contractEnd=employee?.contract_type==="fixed_term" ? employeeContractEnd(employee) : null;
    if(contractEnd&&dates[0]&&dates[0]>contractEnd) return false;
    const blockedEveryDay=dates.length>0&&dates.every(date=>{
      const event=scheduleEventForDate(events,employee,date);
      return scheduleEventBlocksRoster(event)||workTimeChangeBlocksRoster(workTimeChanges,employee,date);
    });
    return !blockedEveryDay;
  }
  const weekEnd=dates[dates.length-1]??todayIso();
  return weekEnd<todayIso()&&employeeHasWeekHistory(employee,dates,events,overrides,workTimeChanges,leaveRequests,compTimeRequests);
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
  const ovDays=Array.isArray(ov?.work_days) ? orderedDays(ov.work_days) : undefined;
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
  const statusText=log.status==="관리자 강제퇴근"?"관리자 마감":log.status==="지각"?"지각 확인 필요":log.status==="결근"?"결근 확인 필요":log.status;
  if(reviewStatuses.includes(log.status)||["지각","결근"].includes(log.status)) return {primary:statusText,primaryClass:badgeClass(statusText),workType,lateMinutes,scheduleStart:thresholdText};
  return {primary:lateMinutes>=1?"지각 확인 필요":"정상출근",primaryClass:lateMinutes>=1?"bad":"good",workType,lateMinutes,scheduleStart:thresholdText};
}
function countScheduledWorkdays(emp:any, startIso:string, endIso:string, overrides:any[]=[], workTimeChanges:any[]=[], events:any[]=[]) {
  let count=0; let d=dateFromIso(startIso); const end=dateFromIso(endIso);
  while(d<=end){ const iso=isoDate(d); const info=scheduleInfoForDateWithEvents(emp, iso, events, overrides, workTimeChanges); if(info.workday) count++; d=addLocalDays(d,1); }
  return count;
}
function formatHourValue(value:any) {
  const num=Number(value||0);
  const rounded=Math.round(num*100)/100;
  if(Number.isInteger(rounded)) return String(rounded);
  if(Math.abs(rounded)<1) return rounded.toFixed(2).replace(/0$/,"");
  return (Math.round(num*10)/10).toFixed(1);
}
function scheduledWorkStats(emp:any, startIso:string, endIso:string, overrides:any[]=[], workTimeChanges:any[]=[], events:any[]=[]) {
  let days=0; let hours=0; let d=dateFromIso(startIso); const end=dateFromIso(endIso);
  while(d<=end){
    const iso=isoDate(d);
    const info=scheduleInfoForDateWithEvents(emp, iso, events, overrides, workTimeChanges);
    if(info.workday){
      days++;
      hours+=info.hours;
    }
    d=addLocalDays(d,1);
  }
  return {days,hours:Math.round(hours*10)/10};
}
function payrollScheduledWorkStats(emp:any, startIso:string, endIso:string, overrides:any[]=[], workTimeChanges:any[]=[], events:any[]=[]) {
  let days=0; let hours=0; let d=dateFromIso(startIso); const end=dateFromIso(endIso);
  while(d<=end){
    const iso=isoDate(d);
    const info=scheduleInfoForDateWithEvents(emp, iso, events, overrides, workTimeChanges);
    if(info.workday){
      days++;
      hours+=Number(info.hours||0);
    }
    d=addLocalDays(d,1);
  }
  return {days,hours:Math.round(hours*10)/10};
}
function weeklyStatsForDate(emp:any, dateIso=todayIso(), overrides:any[]=[], workTimeChanges:any[]=[], events:any[]=[]) {
  const start=weekStartIso(dateIso);
  return scheduledWorkStats(emp,start,addIsoDays(start,6),overrides,workTimeChanges,events);
}
function monthlyPaidHours(weeklyDays:number, dailyHours:number) {
  const weeklyWorkHours=weeklyDays*dailyHours;
  const weeklyHolidayHours=weeklyWorkHours>=15 ? Math.min(8,dailyHours) : 0;
  return Math.round((weeklyWorkHours+weeklyHolidayHours)*4.345);
}
function countUnpaidAbsenceWorkdays(emp:any, absences:any[], startIso:string, endIso:string, overrides:any[]=[], workTimeChanges:any[]=[], events:any[]=[]) {
  let count=0;
  absences.filter((a:any)=>a.employee_id===emp?.id && a.unpaid).forEach((a:any)=>{
    let d=dateFromIso(a.start_date); const e=dateFromIso(a.end_date);
    while(d<=e){ const iso=isoDate(d); if(iso>=startIso&&iso<=endIso){ const info=scheduleInfoForDateWithEvents(emp, iso, events, overrides, workTimeChanges); if(info.workday) count++; } d=addLocalDays(d,1); }
  });
  return count;
}
function monthRangeFor(anchor=todayIso()) { const d=dateFromIso(anchor); const start=new Date(d.getFullYear(), d.getMonth(), 1); const end=new Date(d.getFullYear(), d.getMonth()+1, 0); return {start:isoDate(start), end:isoDate(end)}; }
function currentMonthRange() { return monthRangeFor(todayIso()); }
function lastFridayOfMonthIso(anchor=todayIso()) {
  const d=dateFromIso(anchor);
  const last=new Date(d.getFullYear(),d.getMonth()+1,0);
  while(last.getDay()!==5) last.setDate(last.getDate()-1);
  return isoDate(last);
}
function hhmmFromDate(date:Date) {
  const kst=new Date(date.getTime()+9*3600000);
  return `${String(kst.getUTCHours()).padStart(2,"0")}:${String(kst.getUTCMinutes()).padStart(2,"0")}`;
}
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

function weekEndIso(dateIso:string) { return isoDate(addLocalDays(dateFromIso(weekStartIso(dateIso)),4)); }
function monthStartIso(month:string) { return `${month}-01`; }
function monthEndIso(month:string) {
  const [y,m]=month.split("-").map(Number);
  return isoDate(new Date(y,m,0));
}
function isAfterBusinessClose(date=new Date()) {
  return date.getHours()>=18;
}
function kpiLinesFromText(text:string) {
  return text
    .split(/\r?\n/)
    .map(line=>line.replace(/^\s*(?:[-*]|\d+[.)])\s*/,"").trim())
    .filter(Boolean)
    .slice(0,20);
}
function kpiStatusLabel(status?:string|null) {
  if(status==="done") return "완료";
  if(status==="missed") return "미완료";
  return "확인 전";
}
function kpiCompletionRate(entries:any[]) {
  const actionable=entries.filter((entry:any)=>entry?.scope==="daily"&&entry?.is_active!==false);
  if(actionable.length===0) return null;
  const done=actionable.filter((entry:any)=>entry.status==="done").length;
  return Math.round((done/actionable.length)*100);
}


async function fetchCurrentEmployee() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { session: null, employee: null };
  const { data } = await supabase.from("employees").select("*").eq("user_id", session.user.id).maybeSingle();
  if (!data) return { session, employee: null };
  let employee:any = data;
  if (employee.role === "admin") {
    const { data: permissionRows, error } = await supabase
      .from("admin_menu_permissions")
      .select("menu_id, access_level")
      .eq("employee_id", employee.id);
    if (!error) employee = { ...employee, admin_menu_permissions: permissionRows ?? [] };
  }
  return { session, employee };
}

function adminPermissionRows(employee:any) {
  return Array.isArray(employee?.admin_menu_permissions) ? employee.admin_menu_permissions : [];
}

function adminCan(employee:any, menuId:Tab, minimum="read") {
  if (employee?.role !== "admin") return false;
  const rows = adminPermissionRows(employee);
  if (rows.length === 0) return true;
  const permission = rows.find((row:any)=>row.menu_id === menuId)?.access_level ?? "none";
  return (ADMIN_PERMISSION_LEVEL_RANK[permission] ?? 0) >= (ADMIN_PERMISSION_LEVEL_RANK[minimum] ?? 1);
}

function payrollFixedState(raw:any) {
  let values:string[] = [];
  if (Array.isArray(raw)) values = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      values = Array.isArray(parsed) ? parsed : raw.split(",");
    } catch {
      values = raw.split(",");
    }
  }
  return PAYROLL_FIXED_FIELDS.reduce((map:Record<string,boolean>,field)=>{
    map[field] = values.includes(field);
    return map;
  },{});
}

function payrollFixedValues(state:Record<string,boolean>) {
  return PAYROLL_FIXED_FIELDS.filter(field=>!!state[field]);
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
    const hours=compRequestHours(request);
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
  const shownHours=shown.reduce((sum,r)=>sum+compRequestHours(r),0);
  async function deleteComp(id:string) {
    if(!window.confirm("이 추가근무 적립을 삭제할까요? 해당 직원의 보상휴가 잔여시간이 줄어듭니다.")) return;
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
            <caption className="table-summary">합계 {shownHours.toFixed(1)}시간</caption>
            <thead><tr><th>직원</th><th>날짜</th><th>승인 시간</th><th>사유</th><th></th></tr></thead>
            <tbody>
              {shown.map(r=>(
                <tr key={r.id}>
                  <td><b>{empMap[r.employee_id]?.name??"-"}</b></td>
                  <td>{r.work_date}</td>
                  <td>{formatHourValue(compRequestHours(r))}시간</td>
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
  const [adminPledgeConsent, setAdminPledgeConsent] = useState<any | null>(null);
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
        const [privacyResult, workTimeConsentResult, adminPledgeResult] = await Promise.all([
          supabase.from("privacy_consents").select("*").eq("employee_id", r.employee.id).eq("is_active", true).order("created_at",{ascending:false}).limit(1),
          supabase.from("work_time_change_consents").select("*").eq("employee_id", r.employee.id).eq("consent_version", WORK_TIME_CHANGE_CONSENT_VERSION).maybeSingle(),
          supabase.from("work_time_change_consents").select("*").eq("employee_id", r.employee.id).eq("consent_version", ADMIN_CONFIDENTIALITY_CONSENT_VERSION).maybeSingle(),
        ]);
        if(seq!==loadSeqRef.current) return;
        setConsent(privacyResult.data?.[0]??null);
        setWorkTimeConsent(workTimeConsentResult.data??null);
        setAdminPledgeConsent(adminPledgeResult.data??null);
        if (r.employee.role === "admin") {
          const [w, rq, c, d, lg, wt, rr] = await Promise.all([
            supabase.from("workplaces").select("id, approval_status"),
            supabase.from("attendance_requests").select("id, status"),
            supabase.from("comp_time_requests").select("*"),
            supabase.from("registered_devices").select("id, status"),
            supabase.from("attendance_logs").select("id, status, check_in_time, check_out_time"),
            supabase.from("work_time_change_requests").select("id, status"),
            supabase.from("rnr_review_requests").select("id, status"),
          ]);
          if(seq!==loadSeqRef.current) return;
          let settledCompIdsForBadge=new Set<string>();
          try { settledCompIdsForBadge=new Set(JSON.parse(localStorage.getItem("lupl_settled_comp_ids")??"[]")); } catch {}
          const actionableCompCount=(c.data??[]).filter((x:any)=>{
            if(settledCompIdsForBadge.has(x.id)) return false;
            if(x.attendance_log_id||x.actual_overtime_hours!==null&&x.actual_overtime_hours!==undefined) return false;
            if(String(x.review_note??"").includes("실제 퇴근시간 기준")) return false;
            return x.status==="pending";
          }).length;
          setPendingCount(
            (w.data??[]).filter((x:any)=>x.approval_status==="pending").length +
            (rq.data??[]).filter((x:any)=>x.status==="pending").length +
            actionableCompCount +
            (d.data??[]).filter((x:any)=>x.status==="pending").length +
            (wt.data??[]).filter((x:any)=>x.status==="pending").length +
            (rr.error?0:(rr.data??[]).filter((x:any)=>x.status==="pending").length) +
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
        setAdminPledgeConsent(null);
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

  async function signOut() { await supabase.auth.signOut(); setSession(null); setEmployee(null); setConsent(null); setWorkTimeConsent(null); setAdminPledgeConsent(null); }

  if (loading) return <div className="container" style={{ paddingTop: 48, textAlign: "center", color: "#8b94a6" }}>불러오는 중…</div>;
  if (!session) return <LoginPage />;
  if (!employee) return <div className="container"><section className="card auth-card"><h1 className="card-title">직원 정보가 없습니다</h1><p className="subtle">관리자 계정의 employees.user_id 연결을 확인해주세요.</p><button className="button full" onClick={signOut}>로그아웃</button></section></div>;
  if (!employee.is_active || employee.employment_status !== "active") return <InactivePage signOut={signOut} />;
  const validPrivacyConsent=consentAppliesToCurrentEmployment(consent,employee) ? consent : null;
  const validWorkTimeConsent=consentAppliesToCurrentEmployment(workTimeConsent,employee) ? workTimeConsent : null;
  const shouldShowCombinedConsent = !validPrivacyConsent || (validPrivacyConsent?.consent_version === PRIVACY_CONSENT_VERSION && !validWorkTimeConsent);
  if (shouldShowCombinedConsent) return <ConsentGate employee={employee} onDone={load} signOut={signOut} />;
  const isAdmin = employee.role === "admin";
  const validAdminPledgeConsent = consentAppliesToCurrentEmployment(adminPledgeConsent, employee) ? adminPledgeConsent : null;
  const pageTitles:Record<Tab,string>={
    attendance:"출퇴근",
    leave:"휴가",
    overtime:"추가근무",
    worktime:"근무 일정 확인",
    "team-schedule":"팀 일정",
    "work-map":"업무 분장표",
    kpi:"KPI",
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
    "admin-settings":"권한 설정",
  };
  const personalMenus:{id:Tab;label:string;icon:string}[]=[
    {id:"attendance",label:"출퇴근",icon:"ti-clock"},
    {id:"leave",label:"휴가",icon:"ti-calendar"},
    {id:"overtime",label:"추가근무",icon:"ti-clock-plus"},
    {id:"team-schedule",label:"팀 일정",icon:"ti-calendar-week"},
    {id:"work-map",label:"업무 분장표",icon:"ti-hierarchy-3"},
    {id:"improvements",label:"개선함",icon:"ti-notes"},
  ];
  const adminMenus:{id:Tab;label:string;icon:string;badge?:number}[]=[
    {id:"admin-dashboard",label:"오늘",icon:"ti-layout-dashboard"},
    {id:"approvals",label:"승인함",icon:"ti-inbox",badge:pendingCount},
    {id:"kpi",label:"KPI",icon:"ti-target-arrow"},
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
    {id:"admin-settings",label:"권한 설정",icon:"ti-shield-lock"},
  ];
  const visibleAdminMenus=adminMenus.filter(menu=>adminCan(employee,menu.id,"read"));
  const visibleReportMenus=reportMenus.filter(menu=>adminCan(employee,menu.id,"read"));
  const visibleExtraMenus=extraMenus.filter(menu=>adminCan(employee,menu.id,menu.id==="admin-settings"?"all":"read"));
  const improvementMenuOptions=[...personalMenus,...visibleAdminMenus,...visibleReportMenus,...visibleExtraMenus]
    .filter((item,index,list)=>list.findIndex(other=>other.id===item.id)===index)
    .map(item=>({id:item.id,label:item.label}));
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
          {isAdmin&&<><p className="side-nav-label">관리</p>{visibleAdminMenus.map(menuButton)}<p className="side-nav-label">리포트</p>{visibleReportMenus.map(menuButton)}<p className="side-nav-label">설정</p>{visibleExtraMenus.map(menuButton)}</>}
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
          {tab==="team-schedule" && <SettingsPage currentEmployee={employee} section="schedule" readOnly={true} />}
          {tab==="work-map" && <PublicWorkMapPage currentEmployee={employee} />}
          {tab==="kpi" && adminCan(employee,"kpi","read") && <KpiDashboardPage currentEmployee={employee} />}
          {tab==="admin-dashboard" && adminCan(employee,"admin-dashboard","read") && <AdminPage currentEmployee={employee} onChanged={load} view="dashboard" onNavigate={go} />}
          {tab==="approvals" && adminCan(employee,"approvals","read") && <AdminPage currentEmployee={employee} onChanged={load} view="approvals" onNavigate={go} />}
          {tab==="employees" && adminCan(employee,"employees","read") && <AdminPage currentEmployee={employee} onChanged={load} view="employees" onNavigate={go} />}
          {tab==="rnr" && adminCan(employee,"rnr","read") && <AdminPage currentEmployee={employee} onChanged={load} view="rnr" onNavigate={go} />}
          {tab==="workplaces" && adminCan(employee,"workplaces","read") && <WorkplacePage employee={employee} />}
          {tab==="schedule" && adminCan(employee,"schedule","read") && <SettingsPage currentEmployee={employee} section="schedule" readOnly={!adminCan(employee,"schedule","edit")} />}
          {tab==="payroll" && adminCan(employee,"payroll","read") && <SettingsPage currentEmployee={employee} section="payroll" readOnly={!adminCan(employee,"payroll","edit")} />}
          {tab==="reports" && adminCan(employee,"reports","read") && <ReportsPage />}
          {tab==="consents" && adminCan(employee,"consents","read") && <ConsentReportPage />}
          {tab==="improvements" && <ImprovementRequestsPage currentEmployee={employee} menuOptions={improvementMenuOptions} />}
          {tab==="admin-settings" && adminCan(employee,"admin-settings","all") && <AdminPermissionSettings currentEmployee={employee} onChanged={load} />}
        </main>
      </div>
      <ImprovementQuickCapture employee={employee} currentTab={tab} currentPageTitle={pageTitles[tab]} menuOptions={improvementMenuOptions} />
      {showPwModal && <PasswordModal onClose={()=>setShowPwModal(false)} />}
      {validPrivacyConsent && !validWorkTimeConsent && validPrivacyConsent.consent_version !== PRIVACY_CONSENT_VERSION && <WorkTimeConsentModal employee={employee} onDone={load} />}
      {!validAdminPledgeConsent && <AdminConfidentialityModal employee={employee} onDone={load} />}
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
  const [attachments,setAttachments]=useState<any[]>([]);
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
  function imageFileToAttachment(file:File) {
    return new Promise<any>((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve({id:`att-${Date.now()}-${Math.random().toString(36).slice(2)}`,name:file.name||"pasted-image.png",type:file.type||"image/png",data_url:String(reader.result)});
      reader.onerror=()=>reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  async function handlePaste(event:any) {
    const files=Array.from(event.clipboardData?.files??[]).filter((file:any)=>String(file.type??"").startsWith("image/")) as File[];
    if(!files.length) return;
    event.preventDefault();
    const added=await Promise.all(files.slice(0,5).map(imageFileToAttachment));
    setAttachments(current=>[...current,...added].slice(0,8));
    setMsg(`${added.length}개 이미지가 첨부되었습니다.`);
  }
  function handleNoteKeyDown(event:any) {
    if(event.key==="Enter"&&!event.shiftKey) {
      event.preventDefault();
      save();
    }
  }
  async function save() {
    setMsg("");
    if(!note.trim()&&!attachments.length) return setMsg("개선 메모를 입력해주세요.");
    setBusy(true);
    const selectedType=IMPROVEMENT_TYPES.find(type=>type.value===requestType);
    const basePayload={
      created_by:employee.id,
      request_type:requestType,
      request_type_label:selectedType?.label??requestType,
      menu_id:menuId,
      menu_label:currentMenu?.label??currentPageTitle,
      submenu_label:submenu||null,
      page_title:currentPageTitle,
      page_path:`${window.location.pathname}${window.location.hash}`,
      note:note.trim()||"이미지 첨부",
      status:"open",
      user_agent:navigator.userAgent,
      viewport_width:window.innerWidth,
      viewport_height:window.innerHeight,
    };
    let result=await supabase.from("improvement_requests").insert({...basePayload,attachments,visibility:employee.role==="admin"?"admin_only":"employee_owner"});
    if(result.error&&/attachments|visibility|schema cache/i.test(result.error.message)) result=await supabase.from("improvement_requests").insert(basePayload);
    const {error}=result;
    if(error) setMsg(error.message.includes("improvement_requests")?"개선 요청 저장 테이블이 아직 DB에 없습니다. 새 SQL 패치를 먼저 실행해주세요.":error.message);
    else { setMsg("개선 요청함에 저장되었습니다."); setNote(""); setSubmenu(""); setAttachments([]); setTimeout(()=>setOpen(false),650); }
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
          <div className="form-row"><label className="label">메모</label><textarea className="textarea compact-textarea" value={note} onChange={e=>setNote(e.target.value)} onPaste={handlePaste} onKeyDown={handleNoteKeyDown} placeholder="예: 직원 현황에서 기록 마감 버튼이 너무 안 보여서 바로 처리하기 어렵다." /></div>
          <p className="improvement-paste-hint"><i className="ti ti-photo-plus" aria-hidden="true"></i>이미지도 이 입력칸에 Ctrl+V로 붙여넣을 수 있습니다. 여러 장까지 함께 저장됩니다.</p>
          {attachments.length>0&&<div className="improvement-attachments">{attachments.map((attachment:any)=><button type="button" key={attachment.id} onClick={()=>setAttachments(current=>current.filter(item=>item.id!==attachment.id))} title="첨부 삭제"><img src={attachment.data_url} alt={attachment.name} /></button>)}</div>}
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
  const [githubIssues,setGithubIssues]=useState<any[]>([]);
  const [expandedGithubIssue,setExpandedGithubIssue]=useState<string|null>(null);
  const [showIndividualList,setShowIndividualList]=useState(false);
  const isAdmin=currentEmployee?.role==="admin";
  async function load() {
    let query=supabase.from("improvement_requests").select("*, employees(name, employee_no)").order("created_at",{ascending:false}).limit(300);
    if(!isAdmin) query=query.eq("created_by",currentEmployee.id);
    const {data,error}=await query;
    if(error) setMsg(error.message.includes("improvement_requests")?"개선 요청 저장 테이블이 아직 DB에 없습니다. 새 SQL 패치를 먼저 실행해주세요.":error.message);
    else { setRows(data??[]); setMsg(""); }
  }
  useEffect(()=>{load();},[]);
  const scopedRows=isAdmin?rows:rows.filter(row=>row.created_by===currentEmployee.id&&row.visibility!=="admin_only");
  const matchesMenuFilter=(row:any)=>menuFilter==="all"||row.menu_id===menuFilter;
  const matchesStatusFilter=(row:any)=>statusFilter==="all"||row.status===statusFilter;
  const matchesFilters=(row:any)=>matchesStatusFilter(row)&&matchesMenuFilter(row);
  const isGithubSentRequest=(row:any)=>Boolean(row.github_issue_url||row.github_issue_number);
  const visible=scopedRows.filter(row=>!isGithubSentRequest(row)&&matchesFilters(row));
  const githubSentRows=scopedRows.filter(row=>isGithubSentRequest(row)&&matchesMenuFilter(row)&&(statusFilter==="all"||statusFilter==="open"||matchesStatusFilter(row)));
  const githubIssueGroups=Object.values(githubSentRows.reduce((acc:any,row:any)=>{
    const key=String(row.github_issue_url||row.github_issue_number||"unknown");
    if(!acc[key]) acc[key]={key,number:row.github_issue_number,url:row.github_issue_url,title:row.github_issue_title,sentAt:row.github_sent_at||row.updated_at||row.created_at,rows:[]};
    const group=acc[key];
    group.rows.push(row);
    if(!group.number&&row.github_issue_number) group.number=row.github_issue_number;
    if(!group.url&&row.github_issue_url) group.url=row.github_issue_url;
    if(!group.title&&row.github_issue_title) group.title=row.github_issue_title;
    const sentAt=row.github_sent_at||row.updated_at||row.created_at;
    if(sentAt&&(!group.sentAt||String(sentAt)>String(group.sentAt))) group.sentAt=sentAt;
    return acc;
  },{})).sort((a:any,b:any)=>String(b.sentAt||"").localeCompare(String(a.sentAt||"")));
  function improvementRequestTitle(row:any) {
    const text=String(row.note??"").replace(/\s+/g," ").trim();
    if(text) {
      const normalized=text.toLowerCase();
      const titleRules:[RegExp,string][]=[
        [/개선함.*카테고리|카테고리.*버튼|이슈별.*카테고리/,"이슈별 카테고리 모아보기"],
        [/깃허브|github/,"GitHub 전송 기록 표시"],
        [/이미지|스크린샷|컨트롤\s*v|ctrl\s*\+\s*v|붙여넣/,"이미지 붙여넣기 첨부"],
        [/오늘.*할일|할\s*일/,"오늘의 할일 연동 확인"],
        [/수정.*안|수정.*저장|내용.*수정/,"개선 요청 수정 저장"],
        [/업무\s*r\s*&?\s*r|rnr|r&r/,"업무 R&R 개선"],
        [/근태|출퇴근|지각|퇴근|출근/,"출퇴근 근태 개선"],
        [/휴가|연차|반차|시간차|여름휴가/,"휴가 관리 개선"],
        [/급여|세무|월급|예정급여/,"급여 기준 개선"],
        [/리포트|엑셀|pdf|문서/,"리포트 문서 개선"],
      ];
      const matched=titleRules.find(([pattern])=>pattern.test(normalized));
      if(matched) return matched[1];
      const compact=text
        .replace(/^(아니|야|근데|그리고|흠|음|혹시|이거|저거)\s*/g,"")
        .replace(/(해줘|해주세요|해주라|좋겠어|좋겠다|으면 좋겠어|으면 좋겠다|같아|ㅇㅇ|ㅡㅡ|ㅠㅠ|ㅜㅜ)/g,"")
        .replace(/[.?!]+$/g,"")
        .trim();
      const firstSentence=(compact.split(/[.!?\n]/).find(Boolean)||compact).trim();
      return firstSentence.length>28?`${firstSentence.slice(0,28)}...`:firstSentence||"개선 요청";
    }
    return [row.menu_label,row.submenu_label].filter(Boolean).join(" · ")||"개선 요청";
  }
  function githubGroupMenus(group:any) {
    const menus=Array.from(new Set(group.rows.map((row:any)=>row.menu_label).filter(Boolean)));
    const shown=menus.slice(0,4).join(" · ");
    return shown+(menus.length>4?` 외 ${menus.length-4}개`:"");
  }
  function githubGroupStatus(group:any) {
    return githubRowsStatus(group.rows);
  }
  function githubRowsStatus(items:any[]) {
    const counts=items.reduce((acc:any,row:any)=>{acc[row.status]=(acc[row.status]??0)+1;return acc;},{});
    return Object.entries(counts).map(([status,count])=>`${IMPROVEMENT_STATUS_LABELS[status]??status} ${count}건`).join(" · ");
  }
  function improvementCategoryLabel(row:any) {
    return [row.menu_label,row.submenu_label].filter(Boolean).join(" · ")||"카테고리 없음";
  }
  function githubGroupCategories(group:any) {
    const categories=group.rows.reduce((acc:any,row:any)=>{
      const key=[row.menu_id||row.menu_label||"none",row.submenu_label||""].join("|");
      if(!acc[key]) acc[key]={key,label:improvementCategoryLabel(row),rows:[]};
      acc[key].rows.push(row);
      return acc;
    },{});
    return Object.values(categories).sort((a:any,b:any)=>String(a.label).localeCompare(String(b.label),"ko"));
  }
  function githubIssueCreationGroups(items:any[]) {
    const groups=items.reduce((acc:any,row:any)=>{
      const key=String(row.menu_id||row.menu_label||"uncategorized");
      if(!acc[key]) acc[key]={key,label:row.menu_label||"메뉴 미지정",rows:[]};
      acc[key].rows.push(row);
      return acc;
    },{});
    return Object.values(groups).sort((a:any,b:any)=>String(a.label).localeCompare(String(b.label),"ko"));
  }
  function githubIssueTitle(group:any) {
    const first=group.rows[0];
    return `[개선함 · ${group.label}] ${improvementRequestTitle(first)}${group.rows.length>1?` 외 ${group.rows.length-1}건`:""}`;
  }
  function improvementRequestGroups(items:any[]) {
    const groups=items.reduce((acc:any,row:any)=>{
      const key=[row.menu_id||row.menu_label||"none",row.submenu_label||""].join("|");
      if(!acc[key]) acc[key]={key,label:improvementCategoryLabel(row),rows:[]};
      acc[key].rows.push(row);
      return acc;
    },{});
    return Object.values(groups).map((group:any)=>({
      ...group,
      rows:group.rows.sort((a:any,b:any)=>String(b.created_at||"").localeCompare(String(a.created_at||""))),
    })).sort((a:any,b:any)=>String(a.label).localeCompare(String(b.label),"ko"));
  }
  function normalizedImprovementTitle(row:any) {
    return improvementRequestTitle(row).replace(/\s+/g,"").replace(/[^\w가-힣]/g,"").toLowerCase();
  }
  function similarImprovementGroups(items:any[]) {
    const groups=items.reduce((acc:any,row:any)=>{
      const key=normalizedImprovementTitle(row)||improvementCategoryLabel(row);
      if(!acc[key]) acc[key]={key,label:improvementRequestTitle(row),rows:[]};
      acc[key].rows.push(row);
      return acc;
    },{});
    return Object.values(groups)
      .filter((group:any)=>group.rows.length>1)
      .map((group:any)=>({...group,rows:group.rows.sort((a:any,b:any)=>String(b.created_at||"").localeCompare(String(a.created_at||"")))}))
      .sort((a:any,b:any)=>b.rows.length-a.rows.length||String(a.label).localeCompare(String(b.label),"ko"));
  }
  function githubIssueRequestPayload(row:any) {
    return {
      id:row.id,
      type:row.request_type_label||row.request_type,
      menu:row.menu_label,
      submenu:row.submenu_label,
      note:row.note,
      title:improvementRequestTitle(row),
      status:row.status,
      created_at:row.created_at,
      requester:row.employees?.name,
    };
  }
  async function updateStatus(id:string,status:string) {
    const {error}=await supabase.from("improvement_requests").update({status,updated_at:new Date().toISOString()}).eq("id",id);
    if(error) setMsg(error.message); else await load();
  }
  async function editRequest(row:any) {
    const note=window.prompt("개선 요청 내용을 수정해주세요.", row.note);
    if(note==null) return;
    const next=note.trim();
    if(!next) return setMsg("개선 요청 내용은 비워둘 수 없습니다.");
    const {error}=await supabase.from("improvement_requests").update({note:next,updated_at:new Date().toISOString()}).eq("id",row.id);
    if(error) setMsg(error.message);
    else { setMsg("개선 요청 내용을 수정했습니다."); await load(); }
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
    const ids=scopedRows.filter(row=>!isGithubSentRequest(row)&&!["done","dismissed"].includes(row.status)).map(row=>row.id);
    if(ids.length===0) return setMsg("처리할 개선 요청이 없습니다.");
    if(!window.confirm(`대기/검토/수정 예정 개선 요청 ${ids.length}건을 모두 개선완료로 변경할까요?`)) return;
    const {error}=await supabase.from("improvement_requests").update({status:"done",updated_at:new Date().toISOString()}).in("id",ids);
    if(error) setMsg(error.message); else { setMsg(`${ids.length}건을 모두 개선완료로 변경했습니다.`); await load(); }
  }
  async function markGithubGroupDone(group:any) {
    if(!isAdmin) return;
    const ids=group.rows.filter((row:any)=>row.status!=="done").map((row:any)=>row.id);
    if(ids.length===0) return setMsg("이미 완료된 GitHub 이슈 묶음입니다.");
    if(!window.confirm(`GitHub #${group.number??"-"}에 묶인 개선 요청 ${ids.length}건을 완료로 바꿀까요?`)) return;
    const {error}=await supabase.from("improvement_requests").update({status:"done",updated_at:new Date().toISOString()}).in("id",ids);
    if(error) setMsg(error.message); else { setMsg(`GitHub #${group.number??"-"} 묶음을 완료 처리했습니다.`); await load(); }
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
          title:improvementRequestTitle(row),
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
    if(!isAdmin) return setMsg("GitHub Issue 전송은 관리자 승인이 필요합니다.");
    const target=visible.filter(row=>!["done","dismissed"].includes(row.status));
    if(target.length===0) return setMsg("GitHub Issue로 보낼 개선 요청이 없습니다.");
    setMsg(""); setGithubBusy(true); setGithubIssue(null); setGithubIssues([]);
    try {
      const {data:sessionData}=await supabase.auth.getSession();
      const token=sessionData.session?.access_token;
      if(!token) throw new Error("로그인이 필요합니다.");
      const createdIssues:any[]=[];
      const groups=githubIssueCreationGroups(target) as any[];
      for(const group of groups) {
        const response=await fetch("/api/improvement-github-issue",{
          method:"POST",
          headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
          body:JSON.stringify({
            title:githubIssueTitle(group),
            requests:group.rows.slice(0,100).map(githubIssueRequestPayload),
          }),
        });
        const data=await response.json();
        if(!response.ok) throw new Error(data?.error||"GitHub Issue 생성 실패");
        createdIssues.push(data.issue);
        const ids=group.rows.map((row:any)=>row.id);
        const patch={
          status:"planned",
          github_issue_number:data.issue?.number??null,
          github_issue_url:data.issue?.html_url??null,
          github_issue_title:data.issue?.title??null,
          github_sent_at:new Date().toISOString(),
          updated_at:new Date().toISOString(),
        };
        let updateResult=await supabase.from("improvement_requests").update(patch).in("id",ids);
        if(updateResult.error&&/github_|schema cache/i.test(updateResult.error.message)) updateResult=await supabase.from("improvement_requests").update({status:"planned",updated_at:new Date().toISOString()}).in("id",ids);
        if(updateResult.error) throw updateResult.error;
      }
      await load();
      setGithubIssues(createdIssues);
      setGithubIssue(createdIssues[0]??null);
      setMsg(createdIssues.length===1?`GitHub Issue #${createdIssues[0]?.number} 생성 완료`:`GitHub Issue ${createdIssues.length}개 생성 완료`);
    } catch(error:any) {
      setMsg(error.message||String(error));
    } finally {
      setGithubBusy(false);
    }
  }
  const visibleCategoryGroups=improvementRequestGroups(visible);
  const visibleSimilarGroups=similarImprovementGroups(visible);
  const completedRows=scopedRows.filter(row=>row.status==="done"&&matchesMenuFilter(row));
  const completedCategoryGroups=improvementRequestGroups(completedRows);
  function renderImprovementActions(row:any) {
    if(!(isAdmin||(row.created_by===currentEmployee.id&&row.status==="open"))) return null;
    return <div className="actions improvement-inline-actions">
      <button className="button ghost compact" onClick={()=>editRequest(row)}>수정</button>
      {isAdmin&&<>
      {row.status!=="done"&&<button className="button secondary compact" onClick={()=>updateStatus(row.id,"done")}>완료</button>}
      {row.status!=="dismissed"&&<button className="button ghost compact" onClick={()=>updateStatus(row.id,"dismissed")}>삭제</button>}
      {row.status!=="open"&&<button className="button ghost compact" onClick={()=>updateStatus(row.id,"open")}>대기</button>}
      </>}
    </div>;
  }
  const openCount=scopedRows.filter(row=>row.status==="open").length;
  const githubCount=scopedRows.filter(row=>row.github_issue_url||row.github_issue_number).length;
  const githubIssueCount=new Set(scopedRows.filter(row=>row.github_issue_url||row.github_issue_number).map(row=>row.github_issue_url||row.github_issue_number)).size;
  const doneCount=scopedRows.filter(row=>row.status==="done").length;
  const hiddenCount=scopedRows.filter(row=>row.status==="dismissed").length;
  const weeklyStart=addIsoDays(todayIso(),-6);
  const weeklyRows=scopedRows.filter(row=>String(row.created_at??"").slice(0,10)>=weeklyStart);
  const weeklyTopMenus=Object.values(weeklyRows.reduce((acc:any,row:any)=>{
    const key=row.menu_label||"메뉴 미지정";
    acc[key]=acc[key]??{label:key,count:0};
    acc[key].count+=1;
    return acc;
  },{})).sort((a:any,b:any)=>b.count-a.count).slice(0,3);
  return (
    <section className="card improvement-page">
      <div className="section-head">
        <div><h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-notes" aria-hidden="true"></i>개선 요청함</h2><p className="subtle" style={{margin:0}}>{isAdmin?"앱에서 바로 남긴 개선 메모가 쌓입니다. 처리한 항목은 개선완료로 정리합니다.":"내가 남긴 개선 요청과 처리 상태를 확인합니다."}</p></div>
        <div className="actions"><button className="button secondary" onClick={createGithubIssue} disabled={isAdmin&&(githubBusy||visible.length===0||visible.every(row=>["done","dismissed"].includes(row.status)))}><i className="ti ti-brand-github" aria-hidden="true"></i>{githubBusy?"보내는 중":"GitHub Issue로 보내기"}</button>{isAdmin&&<button className="button ghost" onClick={markActiveDone} disabled={scopedRows.filter(row=>!isGithubSentRequest(row)).every(row=>["done","dismissed"].includes(row.status))}><i className="ti ti-checklist" aria-hidden="true"></i>전체 완료</button>}</div>
      </div>
      {msg&&<div className={`alert ${msg.includes("변경했습니다")||msg.includes("생성 완료")||msg.includes("관리자 승인")||msg.includes("수정했습니다")?"success":"error"}`}>{msg}</div>}
      {githubIssues.length>0&&<div className="alert success github-created-links">{githubIssues.map(issue=><a key={issue.number} href={issue.html_url} target="_blank" rel="noreferrer">GitHub Issue #{issue.number} 열기</a>)}</div>}
      {githubIssues.length===0&&githubIssue?.html_url&&<div className="alert success"><a href={githubIssue.html_url} target="_blank" rel="noreferrer">GitHub Issue #{githubIssue.number} 열기</a></div>}
      <div className="improvement-summary-line">대기 {openCount}건 · GitHub 이슈 {githubIssueCount}개 / 전송 {githubCount}건 · 완료 {doneCount}건 · 삭제 {hiddenCount}건</div>
      <div className="improvement-weekly-report">
        <div><span>최근 7일 접수</span><b>{weeklyRows.length}건</b></div>
        <div><span>처리 완료</span><b>{weeklyRows.filter(row=>row.status==="done").length}건</b></div>
        <div><span>GitHub 전송</span><b>{weeklyRows.filter(row=>row.github_issue_url||row.github_issue_number).length}건</b></div>
        <div><span>주요 메뉴</span><b>{weeklyTopMenus.map((menu:any)=>`${menu.label} ${menu.count}`).join(" · ")||"-"}</b></div>
      </div>
      <div className="grid two">
        <div className="form-row"><label className="label">상태</label><select className="select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="open">대기</option><option value="all">전체</option>{Object.entries(IMPROVEMENT_STATUS_LABELS).filter(([key])=>key!=="open").map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
        <div className="form-row"><label className="label">메뉴</label><select className="select" value={menuFilter} onChange={e=>setMenuFilter(e.target.value)}><option value="all">전체 메뉴</option>{menuOptions.map(menu=><option key={menu.id} value={menu.id}>{menu.label}</option>)}</select></div>
      </div>
      {visibleSimilarGroups.length>0&&<div className="improvement-issue-groups improvement-similar-groups">
        <div className="improvement-subhead">
          <h3>비슷한 요청 묶음</h3>
          <span>{visibleSimilarGroups.length}개 묶음</span>
        </div>
        {visibleSimilarGroups.map((group:any)=>(
          <details className="improvement-category-toggle" key={group.key}>
            <summary>
              <div>
                <b>{group.label}</b>
                <span>{group.rows.length}건 · {githubRowsStatus(group.rows)}</span>
              </div>
              <i className="ti ti-chevron-down" aria-hidden="true"></i>
            </summary>
            <div className="improvement-group-items">
              {group.rows.map((row:any)=>(
                <details className="improvement-request-toggle" key={row.id}>
                  <summary><div><b>{improvementRequestTitle(row)}</b><small>{formatDateTime(row.created_at)} · {row.employees?.name??"작성자"}</small></div><i className="ti ti-chevron-down" aria-hidden="true"></i></summary>
                  <div className="improvement-request-body">
                    <p>{row.note}</p>
                    {Array.isArray(row.attachments)&&row.attachments.length>0&&<div className="improvement-attachments readonly">{row.attachments.map((attachment:any,index:number)=>String(attachment?.data_url??"").startsWith("data:image/")?<a key={attachment.id??index} href={attachment.data_url} target="_blank" rel="noreferrer"><img src={attachment.data_url} alt={attachment.name??"첨부 이미지"} /></a>:null)}</div>}
                    {(row.github_issue_url||row.github_issue_number)&&<a className="github-issue-chip" href={row.github_issue_url??"#"} target="_blank" rel="noreferrer"><i className="ti ti-brand-github" aria-hidden="true"></i>GitHub #{row.github_issue_number??"-"} · {row.github_issue_title||"전송된 이슈"}</a>}
                    {renderImprovementActions(row)}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>}
      {visibleCategoryGroups.length>0&&<div className="improvement-issue-groups improvement-active-groups">
        <div className="improvement-subhead">
          <h3>요청 카테고리 모아보기</h3>
          <span>{visibleCategoryGroups.length}개 카테고리 · {visible.length}건</span>
        </div>
        {visibleCategoryGroups.map((group:any)=>(
          <details className="improvement-category-toggle" key={group.key}>
            <summary>
              <div>
                <b>{group.label}</b>
                <span>{group.rows.length}건 · {githubRowsStatus(group.rows)}</span>
              </div>
              <i className="ti ti-chevron-down" aria-hidden="true"></i>
            </summary>
            <div className="improvement-group-items">
              {group.rows.map((row:any)=>(
                <details className="improvement-request-toggle" key={row.id}>
                  <summary>
                    <div>
                      <b>{improvementRequestTitle(row)}</b>
                      <span>{row.employees?.name??"작성자"} · {formatDateTime(row.created_at)} · {IMPROVEMENT_STATUS_LABELS[row.status]??row.status}</span>
                    </div>
                    <i className="ti ti-chevron-down" aria-hidden="true"></i>
                  </summary>
                  <div className="improvement-request-body">
                    <p>{row.note}</p>
                    {Array.isArray(row.attachments)&&row.attachments.length>0&&<div className="improvement-attachments readonly">{row.attachments.map((attachment:any,index:number)=>String(attachment?.data_url??"").startsWith("data:image/")?<a key={attachment.id??index} href={attachment.data_url} target="_blank" rel="noreferrer"><img src={attachment.data_url} alt={attachment.name??"첨부 이미지"} /></a>:null)}</div>}
                    {(row.github_issue_url||row.github_issue_number)&&<a className="github-issue-chip" href={row.github_issue_url??"#"} target="_blank" rel="noreferrer"><i className="ti ti-brand-github" aria-hidden="true"></i>GitHub #{row.github_issue_number??"-"} · {row.github_issue_title||"전송된 이슈"}</a>}
                    <small>{row.page_title??"-"} · {row.menu_label}{row.submenu_label?` · ${row.submenu_label}`:""}</small>
                    {renderImprovementActions(row)}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>}
      {completedCategoryGroups.length>0&&<details className="improvement-completed-toggle">
        <summary>
          <div>
            <b>완료된 요청</b>
            <span>{completedCategoryGroups.length}개 카테고리 · {completedRows.length}건</span>
          </div>
          <i className="ti ti-chevron-down" aria-hidden="true"></i>
        </summary>
        <div className="improvement-group-categories">
          {completedCategoryGroups.map((group:any)=>(
            <details className="improvement-category-toggle" key={group.key}>
              <summary>
                <div>
                  <b>{group.label}</b>
                  <span>{group.rows.length}건</span>
                </div>
                <i className="ti ti-chevron-down" aria-hidden="true"></i>
              </summary>
              <div className="improvement-group-items">
                {group.rows.map((row:any)=>(
                  <div className="improvement-group-item" key={row.id}>
                    <b>{improvementRequestTitle(row)}</b>
                    <p>{row.note}</p>
                    <small>{row.employees?.name??"작성자"} · {formatDateTime(row.updated_at||row.created_at)}</small>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      </details>}
      {githubIssueGroups.length>0&&<div className="improvement-issue-groups">
        <div className="improvement-subhead">
          <h3>GitHub 이슈별 모아보기</h3>
          <span>{githubIssueGroups.length}개 이슈 · {githubSentRows.length}건</span>
        </div>
        {githubIssueGroups.map((group:any)=>{
          const expanded=expandedGithubIssue===group.key;
          const categories=githubGroupCategories(group);
          return <article className="improvement-issue-card" key={group.key}>
            <div className="improvement-issue-card-head">
              <div>
                <a className="github-issue-chip" href={group.url??"#"} target="_blank" rel="noreferrer"><i className="ti ti-brand-github" aria-hidden="true"></i>GitHub #{group.number??"-"}</a>
                <b>{group.number?`GitHub #${group.number}`:"GitHub 이슈"} · {githubGroupMenus(group)||"개선 요청"}</b>
                <small>{group.title||"전송된 개선 요청"} · {formatDateTime(group.sentAt)}</small>
                <span>{categories.length}개 카테고리 · {group.rows.length}건 · {githubGroupStatus(group)}</span>
              </div>
              <div className="improvement-issue-actions">
                {isAdmin&&<button className="button ghost compact" onClick={()=>markGithubGroupDone(group)}>이슈 완료</button>}
                <button className="button secondary compact" onClick={()=>setExpandedGithubIssue(expanded?null:group.key)}>{expanded?"접기":"카테고리 보기"}</button>
              </div>
            </div>
            {expanded&&<div className="improvement-group-categories">
              {categories.map((category:any)=>(
                <details className="improvement-category-toggle" key={category.key}>
                  <summary>
                    <div>
                      <b>{category.label}</b>
                      <span>{category.rows.length}건 · {githubRowsStatus(category.rows)}</span>
                    </div>
                    <i className="ti ti-chevron-down" aria-hidden="true"></i>
                  </summary>
                  <div className="improvement-group-items">
                    {category.rows.map((row:any)=>(
                      <div className="improvement-group-item" key={row.id}>
                        <b>{improvementRequestTitle(row)}</b>
                        <p>{row.note}</p>
                        <small>{row.employees?.name??"작성자"} · {formatDateTime(row.created_at)}</small>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>}
          </article>;
        })}
      </div>}
      {visible.length===0 ? <p className="subtle">{githubIssueGroups.length>0?"개별로 처리할 개선 요청은 없습니다. GitHub로 보낸 건은 이슈별 모아보기에서 카테고리별로 확인하세요.":"표시할 개선 요청이 없습니다."}</p> : <>
        <div className="improvement-list-toggle">
          <button className="button ghost compact" onClick={()=>setShowIndividualList(value=>!value)}>{showIndividualList?"개별 목록 숨기기":"개별 목록 보기"}</button>
          <span>기본 화면은 카테고리 모아보기입니다.</span>
        </div>
        {showIndividualList&&<div className="improvement-stack">
          {visible.map(row=>(
            <article className="improvement-item" key={row.id}>
              <div className="improvement-item-head">
                <div><span>{row.request_type_label||row.request_type}</span><b>{improvementRequestTitle(row)}</b><small>{row.menu_label}{row.submenu_label?` · ${row.submenu_label}`:""}</small></div>
                <em>{IMPROVEMENT_STATUS_LABELS[row.status]??row.status}</em>
              </div>
              <p>{row.note}</p>
              {Array.isArray(row.attachments)&&row.attachments.length>0&&<div className="improvement-attachments readonly">{row.attachments.map((attachment:any,index:number)=>String(attachment?.data_url??"").startsWith("data:image/")?<a key={attachment.id??index} href={attachment.data_url} target="_blank" rel="noreferrer"><img src={attachment.data_url} alt={attachment.name??"첨부 이미지"} /></a>:null)}</div>}
              {(row.github_issue_url||row.github_issue_number)&&<a className="github-issue-chip" href={row.github_issue_url??"#"} target="_blank" rel="noreferrer"><i className="ti ti-brand-github" aria-hidden="true"></i>GitHub #{row.github_issue_number??"-"} · {row.github_issue_title||"전송된 이슈"}</a>}
              <small>{row.employees?.name??"작성자"} · {formatDateTime(row.created_at)} · {row.page_title??"-"}</small>
              {renderImprovementActions(row)}
            </article>
          ))}
        </div>}
      </>}
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
      <div className="alert" style={{marginTop:16}}>위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다. 수집 정보는 근태 확인 목적과 회사 보존 기준에 따라 관리됩니다.</div>
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
            <br />
            수집 정보는 근태 확인, 임금·휴가 정산, 분쟁 대응 등 필요한 범위에서 보관되고, 보유기간 경과 또는 목적 달성 후 관련 법령과 회사 보존 기준에 따라 파기됩니다.
          </div>
        </ConsentDetailToggle>
        <ConsentDetailToggle title="추가근무·보상휴가 상세 설명" open={showOvertimeDetail} onToggle={()=>setShowOvertimeDetail(v=>!v)}>
          <div className="type-desc work-time-detail work-time-detail-space">
            <span style={{whiteSpace:"pre-line"}}>{OVERTIME_COMP_DETAIL_MAIN_TEXT}</span>
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

function AdminConfidentialityModal({ employee, onDone }: { employee:any; onDone:()=>void }) {
  const canvasRef = useRef<HTMLCanvasElement|null>(null);
  const [confirmDate,setConfirmDate]=useState(todayIso());
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);
  const roleLabel=employee.role==="admin"?"관리자":"직원";
  async function submit() {
    setMsg("");
    const signature=signatureData(canvasRef);
    if(!signature||signature.length<1200) return setMsg("서명을 입력해주세요.");
    setBusy(true);
    const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
    const {error}=await supabase.from("work_time_change_consents").upsert({
      employee_id:employee.id,
      consent_version:ADMIN_CONFIDENTIALITY_CONSENT_VERSION,
      notice_text:ADMIN_CONFIDENTIALITY_NOTICE_TEXT,
      detail_text:`성명: ${employee.name}\n사번: ${employee.employee_no}\n권한: ${roleLabel}\n확인일시: ${confirmDate}\n\n${ADMIN_CONFIDENTIALITY_DETAIL_TEXT}`,
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
        <div className="popup-mark"><i className="ti ti-shield-lock" aria-hidden="true"></i></div>
        <h2 className="card-title" style={{display:"block",marginBottom:8}}>{ADMIN_CONFIDENTIALITY_NOTICE_TEXT}</h2>
        <p className="body-text">근태 시스템과 업무 과정에서 알게 되는 회사 정보와 개인정보를 보호하기 위한 필수 서약입니다.</p>
        <div className="consent-preview admin-pledge-preview" style={{marginTop:14}}>
          <dl>
            <div><dt>성명</dt><dd>{employee.name}</dd></div>
            <div><dt>사번</dt><dd>{employee.employee_no}</dd></div>
            <div><dt>권한</dt><dd>{roleLabel}</dd></div>
            <div className="admin-pledge-date"><dt>확인일시</dt><dd><input className="input" type="date" value={confirmDate} onChange={e=>setConfirmDate(e.target.value||todayIso())} /></dd></div>
          </dl>
        </div>
        <div className="type-desc work-time-detail work-time-detail-space" style={{whiteSpace:"pre-wrap"}}>{ADMIN_CONFIDENTIALITY_DETAIL_TEXT}</div>
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

function AttendanceRuleConsentModal({ employee, onDone }: { employee:any; onDone:()=>void }) {
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit() {
    setMsg("");
    const signature=signatureData(canvasRef);
    if(!signature||signature.length<1200) return setMsg("서명을 입력해주세요.");
    setBusy(true);
    try {
      const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
      const {error}=await supabase.from("work_time_change_consents").upsert({
        employee_id:employee.id,
        consent_version:ATTENDANCE_RULE_CONSENT_VERSION,
        notice_text:"근태 기준 안내",
        detail_text:ATTENDANCE_RULE_DETAIL_TEXT,
        signature_data:signature,
        device_fingerprint_hash:fingerprintHash,
        device_info:deviceInfo,
      },{onConflict:"employee_id,consent_version"});
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
      <div className="modal-box work-consent-modal attendance-rule-modal" onClick={e=>e.stopPropagation()}>
        <div className="popup-mark"><i className="ti ti-clipboard-check" aria-hidden="true"></i></div>
        <h2 className="card-title" style={{display:"block",marginBottom:8}}>근태 기준 안내</h2>
        <p className="body-text attendance-rule-intro">출퇴근 기록 기준과 지각·조퇴·결근 처리 절차를 확인해 주세요. 규칙이 바뀌면 다시 서명 안내가 표시됩니다.</p>
        <div className="attendance-rule-list" aria-label="근태 기준 상세">
          {ATTENDANCE_RULE_SECTIONS.map(section=>(
            <section className="attendance-rule-section" key={section.title}>
              <h3>{section.title}</h3>
              <ul>
                {section.items.map(item=><li key={item}>{item}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <div className="attendance-rule-signature">
          <label className="label">전자서명</label>
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
  const [showDetail,setShowDetail]=useState(false);
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
      <div className="modal-box work-consent-modal attendance-correction-modal" onClick={e=>e.stopPropagation()}>
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
        <div className="form-row attendance-correction-note" style={{marginTop:14}}>
          <label className="label">메모</label>
          <textarea className="textarea compact-textarea" value={note} onChange={e=>setNote(e.target.value)} placeholder="필요하면 확인 메모를 적어주세요." />
        </div>
        <div className="attendance-correction-signature" style={{marginTop:14}}><label className="label">서명</label><SignaturePad canvasRef={canvasRef} /></div>
        {msg&&<div className="alert error" style={{marginTop:12}}>{msg}</div>}
        <div className="actions attendance-correction-actions" style={{marginTop:14}}>
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
  const [monthLogs,setMonthLogs] = useState<any[]>([]);
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
  const [lateCheckoutAsk,setLateCheckoutAsk] = useState<any|null>(null);
  const [lateCheckoutText,setLateCheckoutText] = useState("");
  const [earlyLeaveNotice,setEarlyLeaveNotice] = useState(false);
  const [recheckMode,setRecheckMode] = useState(false);
  const [compTimeRows,setCompTimeRows] = useState<any[]>([]);
  const [todayOverrides,setTodayOverrides] = useState<any[]>([]);
  const [workTimeChanges,setWorkTimeChanges] = useState<any[]>([]);
  const [todayLeaveRequests,setTodayLeaveRequests] = useState<any[]>([]);
  const [attendanceCorrectionRequests,setAttendanceCorrectionRequests] = useState<any[]>([]);
  const [attendanceRuleConsent,setAttendanceRuleConsent] = useState<any|null>(null);
  const [attendanceRuleChecked,setAttendanceRuleChecked] = useState(false);
  const [todayTasks,setTodayTasks] = useState<any[]>([]);
  const [todayTaskCompletions,setTodayTaskCompletions] = useState<any[]>([]);
  const [todayKpis,setTodayKpis] = useState<any[]>([]);
  const [weeklyKpiOptions,setWeeklyKpiOptions] = useState<any[]>([]);
  const [todoDraft,setTodoDraft] = useState({title:"",content:"",due_date:""});
  const [todoMessage,setTodoMessage] = useState("");
  const [todoTargetEmployeeId,setTodoTargetEmployeeId] = useState("");
  const [todoEmployees,setTodoEmployees] = useState<any[]>([]);
  const [roleGuideEntries,setRoleGuideEntries] = useState<any[]>([]);
  const [kpiModal,setKpiModal] = useState<any|null>(null);
  const [kpiDraftText,setKpiDraftText] = useState("");
  const [kpiParentId,setKpiParentId] = useState("");
  const [kpiReview,setKpiReview] = useState<Record<string,string>>({});
  const [kpiNotice,setKpiNotice] = useState("");
  const [notificationPermission,setNotificationPermission] = useState<NotificationPermission|"unsupported">("unsupported");
  const [lastReminderMessage,setLastReminderMessage] = useState("");
  const sentReminderKeys = useRef<Set<string>>(new Set());
  const completedTodayTaskIds=new Set(todayTaskCompletions.map((row:any)=>row.task_id));
  const employeeTodayTasks=todayTasks.filter((task:any)=>!completedTodayTaskIds.has(task.id));
  const todayTask = employee.role==="admin"
    ? (todayTasks.find((task:any)=>String(task.target_employee_id??"")===todoTargetEmployeeId)??null)
    : (employeeTodayTasks.find((task:any)=>!task.target_employee_id||task.target_employee_id===employee.id)??null);
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
    if(employee.role==="admin") setTodoDraft({title:todayTask?.title??"",content:todayTask?.content??"",due_date:String(todayTask?.due_date??"").slice(0,10)});
  },[employee.role,todoTargetEmployeeId,todayTask?.id,todayTask?.updated_at]);
  useEffect(()=>{
    sentReminderKeys.current=readSentReminderKeys();
    setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
    const today=todayIso();
    const key=`lupl_early_leave_notice_${today.slice(0,7)}`;
    if(employee.role!=="admin"&&today===lastFridayOfMonthIso(today)&&!localStorage.getItem(key)) setEarlyLeaveNotice(true);
  },[employee.role]);

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
    const weekStart=weekStartIso(today);
    const weekEnd=weekEndIso(today);
    const [{data:places},{data:logs},{data:openLogs},{data:compRows},{data:overrides},{data:changes},{data:leaveRows},{data:taskRows},{data:taskCompletionRows,error:taskCompletionError},{data:rnrRows},{data:correctionRows,error:correctionError},{data:ruleConsent,error:ruleError},{data:kpiRows},{data:kpiWeeklyRows}]=await Promise.all([
      supabase.from("workplaces").select("*").neq("approval_status","rejected").eq("is_active",true).order("name"),
      supabase.from("attendance_logs").select("*, workplaces(name,type)").eq("employee_id",employee.id).order("check_in_time",{ascending:false}).limit(80),
      supabase.from("attendance_logs").select("*, workplaces(name,type)").eq("employee_id",employee.id).is("check_out_time",null).order("check_in_time",{ascending:false}),
      supabase.from("comp_time_requests").select("*").eq("employee_id",employee.id).eq("work_date",today).in("status",["pending","approved"]).order("start_time"),
      supabase.from("weekly_schedule_overrides").select("*").eq("employee_id",employee.id).eq("week_start",weekStartIso(today)).limit(1),
      supabase.from("work_time_change_requests").select("*").eq("employee_id",employee.id).eq("status","approved").order("created_at",{ascending:false}).limit(100),
      supabase.from("attendance_requests").select("*").eq("employee_id",employee.id).eq("status","approved").lte("start_date",today).gte("end_date",today).order("created_at",{ascending:false}),
      supabase.from("daily_tasks").select("*").eq("task_date",today).eq("is_active",true).order("created_at",{ascending:false}).limit(100),
      supabase.from("daily_task_completions").select("*").eq("employee_id",employee.id).gte("completed_at",`${today}T00:00:00+09:00`).order("completed_at",{ascending:false}).limit(200),
      supabase.from("rnr_entries").select("*").eq("is_active",true).order("created_at",{ascending:false}).limit(80),
      supabase.from("attendance_correction_requests").select("*").eq("employee_id",employee.id).eq("status","pending").order("created_at",{ascending:true}).limit(10),
      supabase.from("work_time_change_consents").select("*").eq("employee_id",employee.id).eq("consent_version",ATTENDANCE_RULE_CONSENT_VERSION).maybeSingle(),
      supabase.from("kpi_entries").select("*").eq("employee_id",employee.id).eq("work_date",today).eq("scope","daily").eq("is_active",true).order("sort_order",{ascending:true}),
      supabase.from("kpi_entries").select("*").eq("scope","weekly").eq("is_active",true).gte("work_date",weekStart).lte("work_date",weekEnd).order("work_date",{ascending:true}).order("created_at",{ascending:true}).limit(100),
    ]);
    setWorkplaces(places??[]);
    setCompTimeRows(compRows??[]);
    setTodayOverrides(overrides??[]);
    setWorkTimeChanges(changes??[]);
    setTodayLeaveRequests(leaveRows??[]);
    setAttendanceCorrectionRequests(correctionError?[]:correctionRows??[]);
    setAttendanceRuleConsent(ruleError?{skipped:true}:ruleConsent??null);
    setAttendanceRuleChecked(true);
    setTodayTasks(taskRows??[]);
    setTodayTaskCompletions(taskCompletionError?[]:taskCompletionRows??[]);
    setTodayKpis(kpiRows??[]);
    setWeeklyKpiOptions(kpiWeeklyRows??[]);
    if(employee.role==="admin"){
      const {data:todoEmployeeRows}=await supabase.from("employees").select("id,name,employee_no").eq("employment_status","active").order("employee_no",{ascending:true});
      setTodoEmployees(todoEmployeeRows??[]);
    } else {
      setTodoEmployees([]);
    }
    const employeeDept=String(employee.department??"").trim();
    const employeePosition=String(employee.position??"").trim();
    setRoleGuideEntries((rnrRows??[]).filter((entry:any)=>
      entry.assigned_employee_id
        ? entry.assigned_employee_id===employee.id
        : ((!!employeeDept&&String(entry.department??"").trim()===employeeDept) || (!!employeePosition&&String(entry.position??"").trim()===employeePosition))
    ).slice(0,5));
    const currentOpenLogs=(openLogs??[]).filter((log:any)=>logAppliesToCurrentEmployment(log,employee));
    const currentLogs=(logs??[]).filter((log:any)=>logAppliesToCurrentEmployment(log,employee));
    const merged=uniqueLogs([...currentOpenLogs, ...currentLogs]).sort(byCheckInDesc);
    setOpenLogRows(currentOpenLogs);
    setTodayLog(merged.find((l:any)=>isToday(l.check_in_time))??null);
    setMonthLogs(merged.filter((l:any)=>localDateStr(l.check_in_time).startsWith(today.slice(0,7))));
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
    setTodoDraft({title:nextTask?.title??"",content:nextTask?.content??"",due_date:String(nextTask?.due_date??"").slice(0,10)});
  }
  async function saveTodayTask() {
    if(employee.role!=="admin") return;
    setTodoMessage("");
    const title=todoDraft.title.trim();
    const content=todoDraft.content.trim();
    if(!title&&!content) return setTodoMessage("오늘의 할일 제목과 내용을 입력해주세요.");
    const saveTitle=title||"오늘의 할일";
    const saveContent=content;
    const due_date=todoDraft.due_date||null;
    const target_employee_id=todoTargetEmployeeId||null;
    const taskDate=isAfterBusinessClose()&&window.confirm("오후 6시 이후입니다. 이 할일을 내일로 넘기겠습니까?")
      ? addIsoDays(todayIso(),1)
      : todayIso();
    const payload={task_date:taskDate,title:saveTitle,content:saveContent,due_date,is_active:true,created_by:employee.id,target_employee_id};
    let result=todayTask?.id
      ? await supabase.from("daily_tasks").update({task_date:taskDate,title:saveTitle,content:saveContent,due_date,is_active:true,target_employee_id,updated_at:new Date().toISOString()}).eq("id",todayTask.id).select().single()
      : await supabase.from("daily_tasks").insert(payload).select().single();
    if(result.error&&/due_date|schema cache/i.test(result.error.message)){
      const {due_date:_,...fallbackPayload}=payload;
      result=todayTask?.id
        ? await supabase.from("daily_tasks").update({task_date:taskDate,title:saveTitle,content:saveContent,is_active:true,target_employee_id,updated_at:new Date().toISOString()}).eq("id",todayTask.id).select().single()
        : await supabase.from("daily_tasks").insert(fallbackPayload).select().single();
    }
    if(result.error) setTodoMessage(result.error.message);
    else { setTodoMessage("오늘의 할일이 저장되었습니다."); await load(); }
  }
  async function hideTodayTask() {
    if(employee.role!=="admin"||!todayTask?.id) return;
    const {error}=await supabase.from("daily_tasks").update({is_active:false,updated_at:new Date().toISOString()}).eq("id",todayTask.id);
    if(error) setTodoMessage(error.message);
    else { setTodoDraft({title:"",content:"",due_date:""}); setTodoMessage("오늘의 할일을 숨겼습니다."); await load(); }
  }
  async function syncTodayTaskToDailyKpi(task:any) {
    if(!task?.id) return;
    const workDate=String(task.task_date??todayIso()).slice(0,10);
    const existing=todayKpis.find((entry:any)=>entry.source_daily_task_id===task.id || (entry.title===task.title&&entry.work_date===workDate));
    const nowIso=new Date().toISOString();
    if(existing?.id) {
      let updateResult=await supabase.from("kpi_entries").update({
        status:"done",
        description:task.content||null,
        source_daily_task_id:task.id,
        source_rnr_entry_id:task.source_rnr_entry_id||null,
        updated_by:employee.id,
        updated_at:nowIso,
      }).eq("id",existing.id);
      if(updateResult.error&&/description|source_daily_task_id|source_rnr_entry_id|updated_by|schema cache/i.test(updateResult.error.message)){
        updateResult=await supabase.from("kpi_entries").update({status:"done",updated_at:nowIso}).eq("id",existing.id);
      }
      if(updateResult.error) throw updateResult.error;
      return;
    }
    const payload={
      employee_id:employee.id,
      employee_name:employee.name,
      attendance_log_id:todayLog?.id??null,
      parent_id:weeklyKpiOptions.find((entry:any)=>!entry.employee_id||entry.employee_id===employee.id)?.id??null,
      scope:"daily",
      work_date:workDate,
      title:task.title||"오늘의 할일",
      description:task.content||null,
      source_daily_task_id:task.id,
      source_rnr_entry_id:task.source_rnr_entry_id||null,
      status:"done",
      sort_order:todayKpis.length+1,
      is_public:true,
      is_active:true,
      created_by:employee.id,
      updated_by:employee.id,
    };
    let insertResult=await supabase.from("kpi_entries").insert(payload);
    if(insertResult.error&&/description|source_daily_task_id|source_rnr_entry_id|updated_by|schema cache/i.test(insertResult.error.message)){
      const {description,source_daily_task_id,source_rnr_entry_id,updated_by,...fallbackPayload}=payload;
      insertResult=await supabase.from("kpi_entries").insert(fallbackPayload);
    }
    if(insertResult.error) throw insertResult.error;
  }
  async function completeTodayTask(task:any=todayTask) {
    if(!task?.id) return;
    setTodoMessage("");
    setBusy(true);
    try {
      let completionResult=await supabase.from("daily_task_completions").upsert({
        task_id:task.id,
        employee_id:employee.id,
      },{onConflict:"task_id,employee_id"});
      if(completionResult.error&&/daily_task_completions|schema cache|relation/i.test(completionResult.error.message)){
        completionResult=await supabase.from("daily_tasks").update({is_active:false,updated_at:new Date().toISOString()}).eq("id",task.id);
      }
      if(completionResult.error) throw completionResult.error;
      await syncTodayTaskToDailyKpi(task);
      setTodoMessage("완료 처리했고 데일리 KPI에도 반영했습니다.");
      await load();
    } catch(e:any) {
      setTodoMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  function openCheckInKpiModal(attendanceLogId?:string|null) {
    const currentText=todayKpis.map((entry:any,index:number)=>`${index+1}. ${entry.title}`).join("\n");
    setKpiDraftText(currentText);
    setKpiParentId(todayKpis.find((entry:any)=>entry.parent_id)?.parent_id??"");
    setKpiNotice("");
    setKpiModal({mode:"check_in",attendanceLogId});
  }
  function openCheckoutKpiModal() {
    setKpiNotice("");
    if(todayKpis.length===0) {
      setKpiDraftText("");
      setKpiParentId("");
      setKpiModal({mode:"checkout_create",attendanceLogId:todayLog?.id});
      return;
    }
    setKpiReview(todayKpis.reduce((map:Record<string,string>,entry:any)=>{
      map[entry.id]=["done","missed"].includes(entry.status)?entry.status:"";
      return map;
    },{}));
    setKpiModal({mode:"checkout_review",attendanceLogId:todayLog?.id});
  }
  function checkoutKpiReady() {
    return todayKpis.length>0 && todayKpis.every((entry:any)=>["done","missed"].includes(entry.status));
  }
  async function sendWorksKpiMessage(eventType:"check_in"|"check_out", attendanceLogId?:string|null) {
    if(!attendanceLogId) return {sent:false};
    const {data,error}=await supabase.functions.invoke("send-works-kpi-message",{
      body:{event_type:eventType,attendance_log_id:attendanceLogId},
    });
    if(error) return {sent:false,error:error.message};
    return data ?? {sent:false};
  }
  async function saveCheckInKpis(andContinueCheckout=false) {
    const lines=kpiLinesFromText(kpiDraftText);
    if(lines.length===0) {
      setKpiNotice("오늘 KPI를 한 줄 이상 입력해주세요.");
      return;
    }
    setBusy(true);
    setKpiNotice("");
    try {
      const workDate=todayIso();
      const nowIso=new Date().toISOString();
      const attendanceLogId=kpiModal?.attendanceLogId ?? todayLog?.id ?? null;
      const deactivate=await supabase.from("kpi_entries")
        .update({is_active:false,updated_at:nowIso})
        .eq("employee_id",employee.id)
        .eq("work_date",workDate)
        .eq("scope","daily")
        .eq("is_active",true);
      if(deactivate.error) throw deactivate.error;
      const payload=lines.map((title,index)=>({
        employee_id:employee.id,
        employee_name:employee.name,
        attendance_log_id:attendanceLogId,
        parent_id:kpiParentId||null,
        scope:"daily",
        work_date:workDate,
        title,
        status:"pending",
        sort_order:index+1,
        is_public:true,
        is_active:true,
        created_by:employee.id,
      }));
      const {data,error}=await supabase.from("kpi_entries").insert(payload).select("*");
      if(error) throw error;
      const savedRows=(data??[]).sort((a:any,b:any)=>Number(a.sort_order??0)-Number(b.sort_order??0));
      setTodayKpis(savedRows);
      if(andContinueCheckout) {
        setKpiReview(savedRows.reduce((map:Record<string,string>,entry:any)=>({...map,[entry.id]:""}),{}));
        setKpiModal({mode:"checkout_review",attendanceLogId});
        setKpiNotice("퇴근 전 각 KPI의 완료 또는 미완료를 선택해주세요.");
        return;
      }
      const works=await sendWorksKpiMessage("check_in", attendanceLogId);
      setKpiModal(null);
      await load();
      setMessage(works?.sent===false&&works?.skipped
        ? "오늘 KPI를 저장했습니다. 웍스 Secret 설정 후 자동 전송됩니다."
        : "오늘 KPI를 저장했고 웍스방 전송을 요청했습니다.");
    } catch(e:any) {
      setKpiNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveCheckoutKpiReview() {
    const unresolved=todayKpis.filter((entry:any)=>!["done","missed"].includes(kpiReview[entry.id]||""));
    if(unresolved.length>0) {
      setKpiNotice("퇴근 전 모든 KPI에 완료 또는 미완료를 선택해야 합니다.");
      return;
    }
    setBusy(true);
    setKpiNotice("");
    try {
      const updates=await Promise.all(todayKpis.map((entry:any)=>supabase.from("kpi_entries").update({
        status:kpiReview[entry.id],
        updated_at:new Date().toISOString(),
      }).eq("id",entry.id)));
      const failed=updates.find(result=>result.error);
      if(failed?.error) throw failed.error;
      setTodayKpis(todayKpis.map((entry:any)=>({...entry,status:kpiReview[entry.id]})));
      setKpiModal(null);
      await continueCheckoutAfterKpi();
    } catch(e:any) {
      setKpiNotice(e.message);
    } finally {
      setBusy(false);
    }
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
        setDetectedPlace(null); setUnknownPlaceName(""); setRecheckMode(false); await load(); openCheckInKpiModal(data?.attendance_log_id);
      }
      else{setDetectedPlace({currentLat:p.lat,currentLng:p.lng,accuracy:p.accuracy,ip});setSelectedWorkplaceId("");setMessage("등록된 근무지 반경 안이 아닙니다. 현재 장소명을 입력하면 관리자 승인 대기 근무지로 저장됩니다.");}
    } catch(e:any){setMessage(e.message);setRecheckMode(false);} finally{setBusy(false);}
  }
  function handleCheckInClick() {
    if(todayLog?.check_in_time&&todayLog?.check_out_time) {
      setMessage("오늘 출근과 퇴근이 모두 완료되어 다시 출근할 수 없습니다.");
      return;
    }
    if(!todayLog?.check_in_time&&monthlyLateCount>=2) {
      window.alert(monthlyLateCount>=3
        ? `이번 달 지각 확인 기록이 ${monthlyLateCount}회입니다.\n반복 사유 확인과 경위서 작성 대상이 될 수 있습니다. 오늘 출근 기록을 바로 남겨주세요.`
        : `이번 달 지각 확인 기록이 ${monthlyLateCount}회입니다.\n오늘 출근 기록을 바로 남겨주세요.`);
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
      setMessage(recheckMode ? `출근 시간을 갱신했습니다: ${data?.attendance_status??"처리 완료"}` : `출근 처리 결과: ${data?.attendance_status??"처리 완료"}`); setDetectedPlace(null); setUnknownPlaceName(""); setRecheckMode(false); await load(); openCheckInKpiModal(data?.attendance_log_id);
    } catch(e:any){setMessage(e.message);} finally{setBusy(false);}
  }
  async function checkOut(options:{sendKpi?:boolean}={}) {
    setBusy(true); setMessage("퇴근 위치를 확인하는 중입니다.");
    try {
      const p=await getCurrentPositionFast(); const ip=await getPublicIp();
      const {fingerprintHash,deviceInfo}=await getDeviceFingerprint();
      const {data,error}=await supabase.rpc("check_out",{p_lat:p.lat,p_lng:p.lng,p_accuracy_m:p.accuracy,p_ip_address:ip,p_device_fingerprint_hash:fingerprintHash,p_device_info:deviceInfo});
      if(error) throw error; setMessage(`퇴근 처리 결과: ${data?.attendance_status??"저장 완료"}`);
      if(options.sendKpi) await sendWorksKpiMessage("check_out", data?.attendance_log_id??todayLog?.id);
      await load();
      // 주말 근무 → 보상휴가 적립 여부 묻기
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
    const {error}=await supabase.from("comp_time_requests").insert({employee_id:employee.id,work_date:weekendAsk.work_date,start_time:null,end_time:null,hours:weekendAsk.hours,converted_days:Number((weekendAsk.hours/8).toFixed(4)),reason:"주말 근무 보상휴가",status:"pending"});
    if(error) setMessage(error.message); else setMessage("주말 근무 보상휴가 신청이 저장되었습니다. 관리자 승인 후 적립됩니다.");
    setWeekendAsk(null);
  }
  function lateOvertimeRange() {
    const fallbackStart=lateCheckoutAsk?.targetTime ? hhmmFromDate(new Date(lateCheckoutAsk.targetTime)) : "18:00";
    const fallbackEnd=hhmmFromDate(new Date(lateCheckoutAsk?.nowTime??Date.now()));
    const match=lateCheckoutText.match(/(\d{1,2})(?::(\d{2}))?\s*(?:~|-|부터|에서)\s*(\d{1,2})(?::(\d{2}))?/);
    const normalize=(h:string,m?:string)=>`${String(Math.min(23,Number(h))).padStart(2,"0")}:${String(Math.min(59,Number(m??0))).padStart(2,"0")}`;
    const start_time=match?normalize(match[1],match[2]):fallbackStart;
    const end_time=match?normalize(match[3],match[4]):fallbackEnd;
    const start=timeToMinutes(start_time)??0;
    const endRaw=timeToMinutes(end_time)??start;
    const minutes=(endRaw<=start?endRaw+1440:endRaw)-start;
    return {start_time,end_time,hours:Math.round((minutes/60)*10)/10};
  }
  async function confirmLateOvertime() {
    if(!todayLog?.check_in_time) return;
    const range=lateOvertimeRange();
    if(range.hours<=0) return setMessage("추가근무 시간을 확인해주세요.");
    if(!window.confirm(`${range.start_time}~${range.end_time} 추가근무가 맞습니까?\n관리자 승인 후 보상휴가로 적립됩니다.`)) return;
    setBusy(true);
    const {error}=await supabase.from("comp_time_requests").insert({employee_id:employee.id,work_date:localDateStr(todayLog.check_in_time),start_time:range.start_time,end_time:range.end_time,hours:range.hours,converted_days:Number((range.hours/8).toFixed(4)),reason:lateCheckoutText.trim()||"퇴근 지연 추가근무",status:"pending"});
    setBusy(false);
    if(error) return setMessage(error.message);
    setLateCheckoutAsk(null);
    await checkOut({sendKpi:true});
    setMessage("추가근무 신청이 저장되었습니다. 관리자 승인 후 보상휴가로 적립됩니다.");
  }
  async function skipLateOvertime() {
    setLateCheckoutAsk(null);
    await checkOut({sendKpi:true});
    setMessage("퇴근은 처리했습니다. 추가근무가 아니라 늦게 누른 경우 실제 퇴근시각으로 출퇴근 기록 정정을 요청해주세요.");
  }
  function closeEarlyLeaveNotice() {
    const today=todayIso();
    try { localStorage.setItem(`lupl_early_leave_notice_${today.slice(0,7)}`,"1"); } catch {/**/}
    setEarlyLeaveNotice(false);
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
  const reminderTarget=checkoutReminderTarget(todayLog,employee,todayOverrides,compTimeRows,workTimeChanges,todayLeaveRequests);
  const reminderTargetTime=reminderTarget?.getTime() ?? null;
  const activeCompRows=compTimeRows.filter((request:any)=>request.status==="approved");
  const reminderOffsets=[-5,5,15,30];
  const monthlyLateCount=monthLogs.filter((log:any)=>attendanceDisplay(employee,log,todayOverrides,workTimeChanges).lateMinutes>0||String(log.status??"").includes("지각")).length;
  const monthlyLateLevel=monthlyLateCount>=3?"danger":monthlyLateCount>=2?"warn":"normal";

  async function continueCheckoutAfterKpi() {
    if(!checkedIn) {
      if(openLogs[0]) await closeSpecificLog(openLogs[0]);
      return;
    }
    if(reminderTargetTime&&Date.now()<reminderTargetTime) {
      setEarlyCheckoutAsk({targetTime:new Date(reminderTargetTime).toISOString()});
      return;
    }
    if(reminderTargetTime&&Date.now()>=reminderTargetTime+10*60000) {
      const nowDate=new Date();
      setLateCheckoutText(`추가근무 ${hhmmFromDate(new Date(reminderTargetTime))}~${hhmmFromDate(nowDate)}`);
      setLateCheckoutAsk({targetTime:new Date(reminderTargetTime).toISOString(),nowTime:nowDate.toISOString()});
      return;
    }
    await checkOut({sendKpi:true});
  }
  function handleCheckoutClick() {
    if(!checkedIn) {
      if(openLogs[0]) closeSpecificLog(openLogs[0]);
      return;
    }
    if(!checkoutKpiReady()) {
      openCheckoutKpiModal();
      return;
    }
    continueCheckoutAfterKpi();
  }
  async function confirmEarlyCheckout() {
    setEarlyCheckoutAsk(null);
    await checkOut({sendKpi:true});
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
      {attendanceRuleChecked&&!attendanceRuleConsent&&<AttendanceRuleConsentModal employee={employee} onDone={load} />}
      {attendanceCorrectionRequests[0]&&<AttendanceCorrectionSignModal employee={employee} request={attendanceCorrectionRequests[0]} onDone={handleAttendanceCorrectionDone} />}
      {earlyLeaveNotice&&<ConfirmModal title="오늘은 마지막 금요일 조기 퇴근일입니다" confirmText="확인" cancelText="닫기" busy={busy} onCancel={closeEarlyLeaveNotice} onConfirm={closeEarlyLeaveNotice}>
        <p style={{margin:0}}>조기 퇴근 대상자는 안내된 기준 시각에 맞춰 퇴근 처리해주세요.</p>
      </ConfirmModal>}
      {kpiModal&&(
        <div className="modal-backdrop" onClick={()=>setKpiModal(null)}>
          <div className="modal-box kpi-modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="card-title" style={{margin:0}}>{kpiModal.mode==="check_in"?"오늘 KPI 입력":"퇴근 전 KPI 마감"}</h2>
              <button className="modal-close" onClick={()=>setKpiModal(null)}>✕</button>
            </div>
            {kpiModal.mode==="checkout_review" ? (
              <>
                <p className="body-text">퇴근 전 오늘 KPI마다 완료 또는 미완료를 선택해야 퇴근할 수 있습니다.</p>
                <div className="kpi-review-list">
                  {todayKpis.map((entry:any)=>(
                    <div className="kpi-review-row" key={entry.id}>
                      <span>{entry.title}</span>
                      <div>
                        <button className={`button compact ${kpiReview[entry.id]==="done"?"success":"ghost"}`} disabled={busy} onClick={()=>setKpiReview({...kpiReview,[entry.id]:"done"})}>완료</button>
                        <button className={`button compact ${kpiReview[entry.id]==="missed"?"danger":"ghost"}`} disabled={busy} onClick={()=>setKpiReview({...kpiReview,[entry.id]:"missed"})}>미완료</button>
                      </div>
                    </div>
                  ))}
                </div>
                {kpiNotice&&<div className="alert error" style={{marginTop:12}}>{kpiNotice}</div>}
                <div className="modal-actions">
                  <button className="button ghost" disabled={busy} onClick={()=>setKpiModal(null)}>취소</button>
                  <button className="button" disabled={busy} onClick={saveCheckoutKpiReview}>확인 후 퇴근</button>
                </div>
              </>
            ) : (
              <>
                <p className="body-text">{kpiModal.mode==="checkout_create"?"오늘 KPI가 없어 퇴근 전 먼저 입력해야 합니다. 입력 후 완료 여부를 체크합니다.":"저장하면 출근 버튼을 누른 시간 기준으로 웍스방에 출근 완료 메시지가 전송됩니다."}</p>
                {weeklyKpiOptions.length>0&&(
                  <div className="form-row" style={{marginTop:12}}>
                    <label className="label">연결 주간 KPI</label>
                    <select className="select" value={kpiParentId} onChange={e=>setKpiParentId(e.target.value)}>
                      <option value="">연결 안 함</option>
                      {weeklyKpiOptions.map((goal:any)=><option key={goal.id} value={goal.id}>{goal.title}</option>)}
                    </select>
                  </div>
                )}
                <div className="form-row" style={{marginTop:12}}>
                  <label className="label">오늘의 KPI</label>
                  <textarea className="textarea kpi-textarea" value={kpiDraftText} onChange={e=>setKpiDraftText(e.target.value)} placeholder={"예:\n하나유니브 운영진 미팅\nCoffee Chat with 유니\n주간회의 with 소현"} />
                </div>
                {kpiNotice&&<div className="alert error" style={{marginTop:12}}>{kpiNotice}</div>}
                <div className="modal-actions">
                  <button className="button ghost" disabled={busy} onClick={()=>setKpiModal(null)}>취소</button>
                  <button className="button" disabled={busy} onClick={()=>saveCheckInKpis(kpiModal.mode==="checkout_create")}>{kpiModal.mode==="checkout_create"?"저장 후 마감 체크":"저장하고 웍스 전송"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <section className="card">
        <div className="summer-holiday-banner">
          <div><b>{COMPANY_SUMMER_HOLIDAY.title}</b><span>{companySummerHolidayLabel()}</span></div>
          <small>{COMPANY_SUMMER_HOLIDAY.description}</small>
        </div>
        <p className="date-line">{now.toLocaleDateString("ko-KR",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</p>
        <div className="clock">{clockText(now)}</div>
        <div className="today-times">
          <div className="today-time-item"><span className="today-time-label">출근</span><span className="today-time-val">{checkedIn?timeOnly(todayLog.check_in_time):"--:--"}</span></div>
          <div className="today-time-item"><span className="today-time-label">퇴근</span><span className="today-time-val">{checkedOut?timeOnly(todayLog.check_out_time):"--:--"}</span></div>
          {worked!=null&&<div className="today-time-item"><span className="today-time-label">실근무</span><span className="today-time-val" style={{fontSize:17}}>{fmtMin(worked)}</span></div>}
        </div>
        <div className={`attendance-month-summary ${monthlyLateLevel}`}>
          <div><span>이번 달 지각 확인</span><b>{monthlyLateCount}회</b></div>
          <p>{monthlyLateCount>=3?"반복 사유 확인 및 경위서 작성 대상이 될 수 있습니다.":monthlyLateCount>=2?"2회 이상 지각 확인 기록이 있습니다. 출근 기록을 바로 남겨주세요.":"이번 달 출근 기록을 기준으로 표시됩니다."}</p>
        </div>
        {roleGuideEntries.length>0&&(
          <div className="role-guide-card">
            <div><b>내 업무 안내</b><span>{roleGuideEntries[0].position||roleGuideEntries[0].department||"역할"} 기준으로 정리된 업무가 있습니다.</span></div>
            <ul>{roleGuideEntries.slice(0,3).map((entry:any)=><li key={entry.id}><span>{entry.title}</span>{Array.isArray(entry.attachments)&&entry.attachments.length>0&&<div className="rnr-attachments mini readonly">{entry.attachments.map((attachment:any,index:number)=>isImageAttachment(attachment)?<a key={attachment.id??index} href={attachment.data_url} target="_blank" rel="noreferrer"><img src={attachment.data_url} alt={attachment.name??"첨부 이미지"} /></a>:null)}</div>}</li>)}</ul>
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
        <p className="subtle" style={{marginTop:6,textAlign:"center"}}>출퇴근 기록은 근무시간 확인 기준입니다. 출근·퇴근 시 바로 기록해 주세요.</p>
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
            <h3 style={{marginTop:0}}>주말 근무 보상휴가</h3>
            <p className="body-text">오늘 주말 근무 {weekendAsk.hours}시간이 기록되었습니다. 회사 확인 후 보상휴가 적립 대상으로 등록하시겠습니까?</p>
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
          <p style={{margin:0}}>재출근하면 현재 시각으로 출근 시간이 갱신되며, 지각 확인 필요 등 근태 상태가 다시 판정될 수 있습니다.</p>
        </ConfirmModal>)}
        {earlyCheckoutAsk&&(<ConfirmModal title="아직 퇴근 시간이 아닙니다" confirmText="퇴근 처리" cancelText="취소" busy={busy} onCancel={()=>setEarlyCheckoutAsk(null)} onConfirm={confirmEarlyCheckout}>
          <p style={{margin:"0 0 8px"}}>오늘 퇴근 기준 시각은 <b>{timeOnly(earlyCheckoutAsk.targetTime)}</b>입니다.</p>
          <p style={{margin:0}}>지금 퇴근하면 현재 시각으로 퇴근 기록이 저장됩니다.</p>
        </ConfirmModal>)}
        {lateCheckoutAsk&&(
          <div className="modal-backdrop" onClick={()=>setLateCheckoutAsk(null)}>
            <div className="modal-box" onClick={e=>e.stopPropagation()}>
              <div className="modal-header"><h2 className="card-title" style={{margin:0}}>퇴근 시간이 10분 넘게 지났습니다</h2><button className="modal-close" onClick={()=>setLateCheckoutAsk(null)}>✕</button></div>
              <p className="body-text">퇴근 기준 시각은 <b>{timeOnly(lateCheckoutAsk.targetTime)}</b>입니다. 실제 추가근무가 있었나요?</p>
              <input className="input" value={lateCheckoutText} onChange={e=>setLateCheckoutText(e.target.value)} />
              <div className="actions" style={{justifyContent:"flex-end",marginTop:12}}>
                <button className="button ghost" disabled={busy} onClick={()=>setLateCheckoutAsk(null)}>닫기</button>
                <button className="button secondary" disabled={busy} onClick={skipLateOvertime}>추가근무 아님</button>
                <button className="button" disabled={busy} onClick={confirmLateOvertime}>추가근무 신청</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="home-side-stack">
      <section className="card kpi-today-card">
        <div className="kpi-card-head">
          <h2 className="card-title"><i className="ti ti-target-arrow" aria-hidden="true"></i>오늘 KPI</h2>
          {checkedIn&&!checkedOut&&<button className="button ghost compact" onClick={()=>openCheckInKpiModal(todayLog?.id)}>수정</button>}
        </div>
        {todayKpis.length>0 ? (
          <div className="kpi-today-list">
            {todayKpis.map((entry:any,index:number)=>(
              <div className={`kpi-today-row ${entry.status==="done"?"done":entry.status==="missed"?"missed":""}`} key={entry.id}>
                <span>{index+1}</span>
                <b>{entry.title}</b>
                <em>{kpiStatusLabel(entry.status)}</em>
              </div>
            ))}
          </div>
        ) : (
          <div className="kpi-empty">
            <p className="body-text">오늘 등록된 KPI가 없습니다.</p>
            {checkedIn&&!checkedOut&&<button className="button secondary full" onClick={()=>openCheckInKpiModal(todayLog?.id)}>오늘 KPI 입력</button>}
          </div>
        )}
      </section>
      {(employee.role==="admin"||todayTask)&&(
        <section className="card today-task-desktop">
          <h2 className="card-title"><i className="ti ti-clipboard-list" aria-hidden="true"></i>오늘의 할일</h2>
          {todoMessage&&<div className="alert" style={{marginTop:10}}>{todoMessage}</div>}
          {employee.role==="admin" ? (
            <div className="today-task-editor">
              <div className="form-row">
                <label className="label">대상 직원</label>
                <select className="select" value={todoTargetEmployeeId} onChange={e=>selectTodoTarget(e.target.value)}>
                  <option value="">전체 직원</option>
                  {todoEmployees.map(e=><option key={e.id} value={e.id}>{e.name}{e.employee_no?` · ${e.employee_no}`:""}</option>)}
                </select>
              </div>
              <div className="grid two">
                <div className="form-row"><label className="label">제목</label><input className="input" value={todoDraft.title} onChange={e=>setTodoDraft({...todoDraft,title:e.target.value})} placeholder="예: 오늘 오전 준비사항" /></div>
                <div className="form-row"><label className="label">기한</label><input className="input" type="date" value={todoDraft.due_date} onChange={e=>setTodoDraft({...todoDraft,due_date:e.target.value})} /></div>
              </div>
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
                      {task.due_date&&<small>기한 {String(task.due_date).slice(0,10)}</small>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : todayTask ? (
            <div className="today-task-view">
              <h3>{todayTask.title}</h3>
              {todayTask.due_date&&<span className="today-task-due">기한 {String(todayTask.due_date).slice(0,10)}</span>}
              <p>{todayTask.content}</p>
              {Array.isArray(todayTask.attachments)&&todayTask.attachments.length>0&&<div className="rnr-attachments readonly">{todayTask.attachments.map((attachment:any,index:number)=>isImageAttachment(attachment)?<a key={attachment.id??index} href={attachment.data_url} target="_blank" rel="noreferrer"><img src={attachment.data_url} alt={attachment.name??"첨부 이미지"} /></a>:null)}</div>}
              <div className="actions">
                <button className="button success compact" disabled={busy} onClick={()=>completeTodayTask(todayTask)}><i className="ti ti-check" aria-hidden="true"></i>완료</button>
              </div>
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

function KpiDashboardPage({ currentEmployee }: { currentEmployee:any }) {
  const [month,setMonth]=useState(todayIso().slice(0,7));
  const [employees,setEmployees]=useState<any[]>([]);
  const [entries,setEntries]=useState<any[]>([]);
  const [message,setMessage]=useState("");
  const [saving,setSaving]=useState(false);
  const [goalDraft,setGoalDraft]=useState({scope:"monthly",employee_id:"",parent_id:"",title:""});
  const [quickDrafts,setQuickDrafts]=useState({monthly:"",weekly:"",daily:""});
  const [quickEmployeeId,setQuickEmployeeId]=useState("");
  const [quickMonthlyParentId,setQuickMonthlyParentId]=useState("");
  const [quickWeeklyParentId,setQuickWeeklyParentId]=useState("");
  const [kpiSuggestion,setKpiSuggestion]=useState<any|null>(null);
  const [editingKpi,setEditingKpi]=useState<any|null>(null);
  const [editKpiDraft,setEditKpiDraft]=useState({title:"",admin_note:""});
  const [rnrEntries,setRnrEntries]=useState<any[]>([]);
  const [guideOpen,setGuideOpen]=useState(false);
  const isAdmin=currentEmployee.role==="admin";
  const today=todayIso();
  const weekStart=weekStartIso(today);
  const weekEnd=weekEndIso(today);
  const monthStart=monthStartIso(month);
  const monthEnd=monthEndIso(month);

  async function load() {
    setMessage("");
    const employeeQuery=supabase.from("employees").select("id,name,employee_no,is_active,employment_status,department,position").order("employee_no",{ascending:true});
    const [entryResult,employeeResult,rnrResult]=await Promise.all([
      supabase.from("kpi_entries").select("*").eq("is_active",true).gte("work_date",monthStart).lte("work_date",monthEnd).order("work_date",{ascending:false}).order("sort_order",{ascending:true}),
      isAdmin ? employeeQuery : employeeQuery.eq("id",currentEmployee.id),
      supabase.from("rnr_entries").select("*").eq("is_active",true).order("created_at",{ascending:false}).limit(200),
    ]);
    if(entryResult.error) setMessage("KPI 테이블이 아직 반영되지 않았습니다. Supabase SQL 패치를 먼저 실행해주세요.");
    setEntries(entryResult.data??[]);
    setEmployees(employeeResult.data??[]);
    setRnrEntries(rnrResult.data??[]);
  }
  useEffect(()=>{ load(); },[month,currentEmployee.id]);

  const employeeMap=new Map<string,any>();
  employees.forEach((employee:any)=>employeeMap.set(employee.id,employee));
  entries.forEach((entry:any)=>{
    if(entry.employee_id&&!employeeMap.has(entry.employee_id)) {
      employeeMap.set(entry.employee_id,{id:entry.employee_id,name:entry.employee_name||"직원",employee_no:""});
    }
  });
  const scorePeople=Array.from(employeeMap.values())
    .filter((employee:any)=>employee.id&&((employee.is_active&&employee.employment_status==="active")||entries.some((entry:any)=>entry.employee_id===employee.id)))
    .sort((a:any,b:any)=>String(a.employee_no??a.name).localeCompare(String(b.employee_no??b.name)));
  function employeeSortValue(id:string) {
    const employee=employeeMap.get(id);
    return String(employee?.employee_no??employee?.name??id);
  }
  function kpiEmployeeColor(employeeId?:string|null) {
    if(!employeeId||employeeId==="team") return EMPLOYEE_COLORS[0];
    return employeeColorFromList(scorePeople,employeeId);
  }
  function kpiCardStyle(employeeId?:string|null, rate=0) {
    const safeRate=Math.max(0,Math.min(100,Number(rate)||0));
    return {"--employee-color":kpiEmployeeColor(employeeId),"--kpi-rate":`${safeRate}%`} as React.CSSProperties;
  }
  const dailyEntries=entries.filter((entry:any)=>entry.scope==="daily");
  const todayEntries=dailyEntries.filter((entry:any)=>entry.work_date===today);
  const weekDailyEntries=dailyEntries.filter((entry:any)=>entry.work_date>=weekStart&&entry.work_date<=weekEnd);
  const weeklyGoals=entries.filter((entry:any)=>entry.scope==="weekly"&&entry.work_date>=weekStart&&entry.work_date<=weekEnd);
  const monthlyGoals=entries.filter((entry:any)=>entry.scope==="monthly");
  function personName(id?:string|null) {
    if(!id) return "전체";
    return employeeMap.get(id)?.name ?? entries.find((entry:any)=>entry.employee_id===id)?.employee_name ?? "직원";
  }
  function entriesByEmployee(list:any[]) {
    const groups=new Map<string,any[]>();
    list.forEach((entry:any)=>{
      const key=entry.employee_id??"team";
      groups.set(key,[...(groups.get(key)??[]),entry]);
    });
    return Array.from(groups.entries()).sort(([a],[b])=>employeeSortValue(a).localeCompare(employeeSortValue(b)));
  }
  function scoreForEmployee(employeeId:string) {
    const list=weekDailyEntries.filter((entry:any)=>entry.employee_id===employeeId);
    const rate=kpiCompletionRate(list);
    return {rate:rate??0,total:list.length,done:list.filter((entry:any)=>entry.status==="done").length};
  }
  function quickTargetEmployee() {
    const employeeId=isAdmin ? quickEmployeeId : currentEmployee.id;
    return employeeId ? employees.find((employee:any)=>employee.id===employeeId) : null;
  }
  function relevantRnrEntries() {
    const target=quickTargetEmployee()??currentEmployee;
    const targetDept=normalizeDepartmentName(target?.department);
    const targetPosition=String(target?.position??"").trim();
    return rnrEntries.filter((entry:any)=>{
      if(entry.assigned_employee_id) return entry.assigned_employee_id===target?.id;
      return (!!targetDept&&normalizeDepartmentName(entry.department)===targetDept) || (!!targetPosition&&String(entry.position??"").trim()===targetPosition) || rnrTargetScope(entry)==="common";
    });
  }
  function kpiStepCandidates(title:string) {
    const query=title.trim().toLowerCase();
    const related=relevantRnrEntries().find((entry:any)=>{
      const text=[rnrPublicTitle(entry),entry.summary,entry.work_group,entry.category,rnrFlowLines(entry).join(" ")].join(" ").toLowerCase();
      return query && (text.includes(query) || query.split(/\s+/).some(word=>word.length>1&&text.includes(word)));
    });
    const fromRnr=related?rnrFlowLines(related):[];
    const fallback=[
      `${title} 목표와 완료 기준 확인`,
      "필요 자료와 담당자 확인",
      "우선순위에 따라 실행 순서 정리",
      "진행 결과와 막힌 점 공유",
      "완료 산출물 점검 및 기록",
    ];
    return (fromRnr.length?fromRnr:fallback).slice(0,8).map((step:string,index:number)=>({
      id:`step-${index}`,
      title:step,
      source_rnr_entry_id:related?.id??null,
    }));
  }
  function openKpiSuggestion(scope:string) {
    const title=quickDrafts[scope as keyof typeof quickDrafts].trim();
    if(!title) return setMessage(`${scope==="monthly"?"월간":scope==="weekly"?"주간":"데일리"} KPI를 먼저 입력해주세요.`);
    const steps=kpiStepCandidates(title);
    setKpiSuggestion({
      scope,
      title,
      steps,
      selected:steps.reduce((map:Record<string,boolean>,step:any)=>({...map,[step.id]:true}),{}),
    });
  }
  async function insertKpiRows(scope:string, titles:string[], options:any={}) {
    if(titles.length===0) return;
    const target=quickTargetEmployee();
    const employeeId=target?.id ?? (isAdmin ? null : currentEmployee.id);
    const employeeName=target?.name ?? (employeeId ? currentEmployee.name : "전체");
    const workDate=scope==="monthly" ? monthStart : scope==="weekly" ? weekStart : today;
    const parentId=scope==="weekly" ? (quickMonthlyParentId||null) : scope==="daily" ? (quickWeeklyParentId||null) : null;
    const payloads=titles.map((title,index)=>({
      employee_id:employeeId,
      employee_name:employeeName,
      parent_id:parentId,
      scope,
      work_date:workDate,
      title,
      description:options.description??null,
      source_rnr_entry_id:options.source_rnr_entry_id??null,
      status:"pending",
      sort_order:entries.filter((entry:any)=>entry.scope===scope).length+index+1,
      is_public:true,
      is_active:true,
      created_by:currentEmployee.id,
      updated_by:currentEmployee.id,
    }));
    let result=await supabase.from("kpi_entries").insert(payloads);
    if(result.error&&/description|source_rnr_entry_id|updated_by|schema cache/i.test(result.error.message)){
      const fallbackPayloads=payloads.map(({description,source_rnr_entry_id,updated_by,...fallbackPayload}:any)=>fallbackPayload);
      result=await supabase.from("kpi_entries").insert(fallbackPayloads);
    }
    if(result.error) throw result.error;
  }
  async function saveQuickKpi(scope:string) {
    const title=quickDrafts[scope as keyof typeof quickDrafts].trim();
    if(!title) return setMessage("KPI 내용을 입력해주세요.");
    setSaving(true); setMessage("");
    try {
      await insertKpiRows(scope,[title]);
      setQuickDrafts({...quickDrafts,[scope]:""});
      await load();
      setMessage("KPI를 저장했습니다. 아래에서 업무 순서와 단계 추천도 받을 수 있습니다.");
    } catch(e:any) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function addSuggestedSteps(targetScope:string) {
    if(!kpiSuggestion) return;
    const checkedSteps=kpiSuggestion.steps.filter((step:any)=>kpiSuggestion.selected[step.id]);
    if(checkedSteps.length===0) return setMessage("추가할 단계를 하나 이상 체크해주세요.");
    setSaving(true); setMessage("");
    try {
      await insertKpiRows(targetScope,checkedSteps.map((step:any)=>step.title),{
        description:`${kpiSuggestion.title}에서 추천된 단계`,
        source_rnr_entry_id:checkedSteps.find((step:any)=>step.source_rnr_entry_id)?.source_rnr_entry_id??null,
      });
      setKpiSuggestion(null);
      await load();
      setMessage(`${targetScope==="daily"?"데일리":"주간"} KPI에 추천 단계를 추가했습니다.`);
    } catch(e:any) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  }
  function beginEditKpi(entry:any) {
    setEditingKpi(entry);
    setEditKpiDraft({title:entry.title??"",admin_note:entry.admin_note??""});
  }
  async function saveEditedKpi() {
    if(!editingKpi?.id) return;
    const title=editKpiDraft.title.trim();
    if(!title) return setMessage("KPI 내용을 입력해주세요.");
    const previousTitle=editingKpi.title;
    const note=editKpiDraft.admin_note.trim();
    const historyEntry={at:new Date().toISOString(),by:currentEmployee.id,from:previousTitle,to:title,note};
    const changeLog=Array.isArray(editingKpi.change_log)?[...editingKpi.change_log,historyEntry]:[historyEntry];
    setSaving(true); setMessage("");
    try {
      let result=await supabase.from("kpi_entries").update({
        title,
        admin_note:isAdmin?note:null,
        updated_by:currentEmployee.id,
        change_log:changeLog,
        updated_at:new Date().toISOString(),
      }).eq("id",editingKpi.id);
      if(result.error&&/admin_note|updated_by|change_log|schema cache/i.test(result.error.message)){
        result=await supabase.from("kpi_entries").update({title,updated_at:new Date().toISOString()}).eq("id",editingKpi.id);
      }
      if(result.error) throw result.error;
      setEditingKpi(null);
      await load();
      setMessage(isAdmin?"관리자 수정 내용을 저장했습니다.":"KPI를 수정했습니다.");
    } catch(e:any) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function saveGoal() {
    if(!isAdmin) return;
    const title=goalDraft.title.trim();
    if(!title) return setMessage("KPI 제목을 입력해주세요.");
    setSaving(true); setMessage("");
    try {
      const target=employees.find((employee:any)=>employee.id===goalDraft.employee_id);
      const workDate=goalDraft.scope==="monthly"?monthStart:weekStart;
      const {error}=await supabase.from("kpi_entries").insert({
        employee_id:goalDraft.employee_id||null,
        employee_name:target?.name || (goalDraft.employee_id ? null : "전체"),
        parent_id:goalDraft.scope==="weekly" ? (goalDraft.parent_id||null) : null,
        scope:goalDraft.scope,
        work_date:workDate,
        title,
        status:"pending",
        sort_order:entries.filter((entry:any)=>entry.scope===goalDraft.scope).length+1,
        is_public:true,
        is_active:true,
        created_by:currentEmployee.id,
      });
      if(error) throw error;
      setGoalDraft({...goalDraft,title:""});
      await load();
      setMessage("KPI 목표를 저장했습니다.");
    } catch(e:any) {
      setMessage(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kpi-dashboard-page">
      <section className="card kpi-hero-card">
        <div className="kpi-dashboard-head">
          <div>
            <h2 className="card-title"><i className="ti ti-target-arrow" aria-hidden="true"></i>KPI 대시보드</h2>
            <p className="body-text">월별 목표를 주간으로 쪼개고, 직원 출퇴근 흐름에서 데일리 KPI 완료 상태를 쌓아 봅니다.</p>
          </div>
          <select className="select kpi-month-select" value={month} onChange={e=>setMonth(e.target.value)}>
            {monthSelectOptions(today,8,2).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <button type="button" className={`kpi-guide-toggle ${guideOpen?"open":""}`} onClick={()=>setGuideOpen(!guideOpen)}>
          <span><i className="ti ti-info-circle" aria-hidden="true"></i>KPI 사용 방법</span>
          <i className={`ti ${guideOpen?"ti-chevron-up":"ti-chevron-down"}`} aria-hidden="true"></i>
        </button>
        {guideOpen&&(
          <div className="kpi-guide-panel">
            <p><b>1. 월별 KPI</b>에서 이번 달 큰 목표를 먼저 내려줍니다.</p>
            <p><b>2. 주간 KPI</b>를 만들 때 연결할 월별 KPI를 선택하면 아래 월별 지도에 이어집니다.</p>
            <p><b>3. 데일리 KPI</b>는 출근한 직원이 오늘 할 일을 적고, 퇴근 전 완료/미완료를 체크합니다.</p>
          </div>
        )}
        {message&&<div className="alert" style={{marginTop:12}}>{message}</div>}
        <div className="kpi-score-strip">
          {scorePeople.length>0 ? scorePeople.map((employee:any)=>{
            const score=scoreForEmployee(employee.id);
            return (
              <div className="kpi-score-card" key={employee.id} style={kpiCardStyle(employee.id,score.rate)}>
                <i aria-hidden="true"></i>
                <b>{employee.name}</b>
                <strong>{score.rate}<small>%</small></strong>
                <span>완료 {score.done} / 전체 {score.total}</span>
                <div className="kpi-progress-track"><em></em></div>
              </div>
            );
          }) : <p className="body-text">이번 달 KPI 기록이 아직 없습니다.</p>}
        </div>
      </section>

      <section className="card kpi-section-card kpi-flow-editor">
        <div className="section-head"><h2 className="card-title">KPI 입력</h2><span className="subtle">월간 · 주간 · 데일리 한 줄 연결</span></div>
        <div className="kpi-flow-controls">
          {isAdmin&&(
            <select className="select" value={quickEmployeeId} onChange={e=>setQuickEmployeeId(e.target.value)}>
              <option value="">전체</option>
              {employees.map((employee:any)=><option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          )}
          <select className="select" value={quickMonthlyParentId} onChange={e=>setQuickMonthlyParentId(e.target.value)}>
            <option value="">주간 KPI 연결 월간 목표</option>
            {monthlyGoals.map((goal:any)=><option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select>
          <select className="select" value={quickWeeklyParentId} onChange={e=>setQuickWeeklyParentId(e.target.value)}>
            <option value="">데일리 KPI 연결 주간 목표</option>
            {weeklyGoals.map((goal:any)=><option key={goal.id} value={goal.id}>{goal.title}</option>)}
          </select>
        </div>
        <div className="kpi-quick-grid">
          {(["monthly","weekly","daily"] as const).map(scope=>(
            <div className="kpi-quick-row" key={scope}>
              <label>{scope==="monthly"?"월간 KPI":scope==="weekly"?"주간 KPI":"데일리 KPI"}</label>
              <input className="input" value={quickDrafts[scope]} onChange={e=>setQuickDrafts({...quickDrafts,[scope]:e.target.value})} placeholder={scope==="monthly"?"이번 달 큰 목표":scope==="weekly"?"이번 주 실행 목표":"오늘 할 일 한 줄"} />
              <button className="button compact" disabled={saving} onClick={()=>saveQuickKpi(scope)}>저장</button>
              <button className="button ghost compact" disabled={saving} onClick={()=>openKpiSuggestion(scope)}>단계 추천</button>
            </div>
          ))}
        </div>
        {kpiSuggestion&&(
          <div className="kpi-ai-steps">
            <div className="kpi-ai-steps-head">
              <b>업무 순서와 단계를 추천받으시겠습니까?</b>
              <button className="icon-button" title="닫기" onClick={()=>setKpiSuggestion(null)}><i className="ti ti-x" aria-hidden="true"></i></button>
            </div>
            <p>{kpiSuggestion.title}</p>
            <div className="kpi-step-list">
              {kpiSuggestion.steps.map((step:any)=>(
                <label key={step.id}>
                  <input type="checkbox" checked={!!kpiSuggestion.selected[step.id]} onChange={e=>setKpiSuggestion({...kpiSuggestion,selected:{...kpiSuggestion.selected,[step.id]:e.target.checked}})} />
                  <span>{step.title}</span>
                </label>
              ))}
            </div>
            <div className="actions">
              <button className="button secondary compact" disabled={saving} onClick={()=>addSuggestedSteps("weekly")}>주간으로 넣기</button>
              <button className="button compact" disabled={saving} onClick={()=>addSuggestedSteps("daily")}>데일리로 넣기</button>
            </div>
          </div>
        )}
      </section>

      {editingKpi&&(
        <div className="modal-backdrop" onClick={()=>setEditingKpi(null)}>
          <div className="modal-box kpi-modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header"><h2 className="card-title" style={{margin:0}}>KPI 수정</h2><button className="modal-close" onClick={()=>setEditingKpi(null)}>×</button></div>
            <div className="form-row"><label className="label">내용</label><input className="input" value={editKpiDraft.title} onChange={e=>setEditKpiDraft({...editKpiDraft,title:e.target.value})} /></div>
            {isAdmin&&<div className="form-row"><label className="label">관리자 변경 메모</label><textarea className="textarea compact-textarea" value={editKpiDraft.admin_note} onChange={e=>setEditKpiDraft({...editKpiDraft,admin_note:e.target.value})} placeholder="변경 이유나 직원에게 전달할 말을 적어주세요." /></div>}
            <div className="actions" style={{justifyContent:"flex-end"}}>
              <button className="button ghost" disabled={saving} onClick={()=>setEditingKpi(null)}>취소</button>
              <button className="button" disabled={saving} onClick={saveEditedKpi}>수정 저장</button>
            </div>
          </div>
        </div>
      )}

      <section className="card kpi-section-card">
        <div className="section-head"><h2 className="card-title">데일리 KPI</h2><span className="subtle">오늘 직원별 KPI</span></div>
        <div className="kpi-grid four">
          {entriesByEmployee(todayEntries).length>0 ? entriesByEmployee(todayEntries).map(([employeeId,list])=>(
            <div className="kpi-person-card" key={employeeId} style={kpiCardStyle(employeeId,kpiCompletionRate(list)??0)}>
              <div className="kpi-person-head"><b>{personName(employeeId)}</b><span>{kpiCompletionRate(list)??0}%</span></div>
              <ul>{list.map((entry:any)=><li key={entry.id} className={entry.status==="done"?"done":entry.status==="missed"?"missed":""}><span>{kpiStatusLabel(entry.status)}</span><div><b>{entry.title}</b>{entry.updated_by&&entry.updated_by!==entry.created_by&&<small>관리자가 변경하였습니다{entry.admin_note?` · ${entry.admin_note}`:""}</small>}</div><button className="icon-button" title="수정" onClick={()=>beginEditKpi(entry)}><i className="ti ti-edit" aria-hidden="true"></i></button></li>)}</ul>
            </div>
          )) : <p className="body-text">오늘 등록된 데일리 KPI가 없습니다.</p>}
        </div>
      </section>

      <section className="card kpi-section-card">
        <div className="section-head"><h2 className="card-title">주간 KPI</h2><span className="subtle">{weekStart}~{weekEnd}</span></div>
        <div className="kpi-grid four">
          {scorePeople.length>0 ? scorePeople.map((employee:any)=>{
            const list=weekDailyEntries.filter((entry:any)=>entry.employee_id===employee.id);
            const done=list.filter((entry:any)=>entry.status==="done").length;
            const missed=list.filter((entry:any)=>entry.status==="missed").length;
            const pending=list.length-done-missed;
            const rate=kpiCompletionRate(list)??0;
            return (
              <div className="kpi-person-card kpi-week-card" key={employee.id} style={kpiCardStyle(employee.id,rate)}>
                <div className="kpi-person-head"><b>{employee.name}</b><span>{rate}%</span></div>
                <div className="kpi-week-stats">
                  <span>완료 <b>{done}</b></span>
                  <span>미완료 <b>{missed}</b></span>
                  <span>확인 전 <b>{pending}</b></span>
                </div>
                {weeklyGoals.filter((goal:any)=>!goal.employee_id||goal.employee_id===employee.id).slice(0,3).map((goal:any)=><p className="kpi-linked-goal" key={goal.id}>{goal.title}</p>)}
              </div>
            );
          }) : <p className="body-text">이번 주 KPI가 아직 없습니다.</p>}
        </div>
      </section>

      <section className="card kpi-section-card">
        <div className="section-head"><h2 className="card-title">월별 KPI</h2><span className="subtle">월 목표 → 주간 → 데일리</span></div>
        <div className="kpi-month-map">
          {monthlyGoals.length>0 ? monthlyGoals.map((goal:any)=>(
            <div className="kpi-month-node" key={goal.id} style={kpiCardStyle(goal.employee_id)}>
              <b>{goal.title}</b>
              <span>{personName(goal.employee_id)}</span>
              <div>
                {weeklyGoals.filter((weekly:any)=>weekly.parent_id===goal.id).map((weekly:any)=><em key={weekly.id}>{weekly.title}</em>)}
                {weeklyGoals.filter((weekly:any)=>weekly.parent_id===goal.id).length===0&&<em>주간 KPI 연결 전</em>}
              </div>
            </div>
          )) : <p className="body-text">월별 KPI를 먼저 등록하면 주간·데일리 KPI가 이어집니다.</p>}
        </div>
      </section>
    </div>
  );
}

function sameDays(a:string[] = [], b:string[] = []) {
  const left=ALL_DAYS.filter(d=>a.includes(d)).join("|");
  const right=ALL_DAYS.filter(d=>b.includes(d)).join("|");
  return left===right;
}
function workChangePeriodLabel(request:any) {
  return (request?.periods??[]).map(periodRangeLabel).join(" / ") || "-";
}
function periodRangeLabel(period:any) {
  if(!period?.start_date) return "-";
  if(period.open_ended||period.end_date==="2099-12-31") return `${period.start_date}부터`;
  return `${period.start_date}~${period.end_date}`;
}
const WORK_CHANGE_NO_WORK_RE=/출근\s*안|근무\s*안|일\s*안|안\s*함|휴무|쉬는|쉼/;
function workChangeStoredDays(request:any) {
  return orderedDays(request?.new_work_days??[]);
}
function inferredWorkChangeDays(request:any) {
  const stored=workChangeStoredDays(request);
  return stored.length>0 ? stored : daysFromPeriods(request?.periods??[]);
}
function isNoWorkChange(request:any) {
  if(workChangeStoredDays(request).length>0) return false;
  if((request?.periods??[]).some((period:any)=>period?.open_ended||period?.end_date==="2099-12-31")) return true;
  return WORK_CHANGE_NO_WORK_RE.test(`${request?.reason??""} ${request?.document_text??""}`);
}
function workChangeEffectiveDays(request:any) {
  return isNoWorkChange(request) ? [] : inferredWorkChangeDays(request);
}
function workChangeDailyHours(request:any) {
  return isNoWorkChange(request)?0:netDailyHours(request?.new_work_start,request?.new_work_end,request?.new_break_start,request?.new_break_end);
}
function workChangeWorkDaysCount(request:any) {
  if(isNoWorkChange(request)) return 0;
  const stored=Number(request?.total_work_days||0);
  if(stored>0) return stored;
  return summarizePeriods(request?.periods??[],workChangeEffectiveDays(request)).workDays;
}
function workChangeWeeklyHours(request:any) {
  if(isNoWorkChange(request)) return 0;
  const stored=Number(request?.weekly_work_hours||0);
  if(stored>0) return Math.round(stored*10)/10;
  return Math.round(workChangeDailyHours(request)*workChangeEffectiveDays(request).length*10)/10;
}
function workChangeKind(request:any) {
  if(isNoWorkChange(request)) return "출근 안 함";
  const dayChanged=!sameDays(request?.old_work_days??[], workChangeEffectiveDays(request));
  const timeChanged=timeLabel(request?.old_work_start)!==timeLabel(request?.new_work_start) || timeLabel(request?.old_work_end)!==timeLabel(request?.new_work_end);
  if(dayChanged&&timeChanged) return "근무요일·시간 변경";
  if(dayChanged) return "근무요일 변경";
  if(timeChanged) return "근무시간 변경";
  return "근무조건 변경";
}
function workChangeConditionLabel(request:any) {
  if(isNoWorkChange(request)) return "출근 안 함";
  return [
    `근무요일 ${daysLabel(workChangeEffectiveDays(request))}`,
    `근무시간 ${timeRangeLabel(request?.new_work_start,request?.new_work_end)}`,
    `휴게 ${timeRangeLabel(request?.new_break_start,request?.new_break_end)}`,
  ].join("\n");
}
function workChangePreviousLabel(request:any) {
  return `기존: ${daysLabel(request?.old_work_days??[])} · ${timeRangeLabel(request?.old_work_start,request?.old_work_end)} · 휴게 ${timeRangeLabel(request?.old_break_start,request?.old_break_end)}`;
}
function workChangeWorkloadLabel(request:any) {
  const daily=workChangeDailyHours(request);
  const weekly=workChangeWeeklyHours(request);
  const totalWorkDays=workChangeWorkDaysCount(request);
  const totalHours=Math.round(daily*totalWorkDays*10)/10;
  return [
    `근무 ${totalWorkDays}일`,
    `실근무 ${formatHourValue(totalHours)}시간`,
    `주 ${formatHourValue(weekly)}시간`,
  ].join("\n");
}
function workChangeSummaryLine(employee:any,request:any) {
  const totalWorkDays=workChangeWorkDaysCount(request);
  const totalHours=Math.round(workChangeDailyHours(request)*totalWorkDays*10)/10;
  const period=workChangePeriodLabel(request);
  const reason=String(request?.reason??"").trim();
  return [
    `${employee?.name??"직원"}님 ${period}`,
    workChangeKind(request),
    `최종 근무 ${totalWorkDays}일, ${formatHourValue(totalHours)}시간`,
    reason?`사유 ${reason}`:"",
  ].filter(Boolean).join("\n");
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
  if(request?.request_type==="company_holiday") return COMPANY_SUMMER_HOLIDAY.title;
  if(isCompLeaveUsageRequest(request)) return "보상휴가 시간 사용";
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
    {re:/계약서/, title:"계약서 검토 및 보관 관리"},
    {re:/공문/, title:"공문 작성 및 제출 관리"},
    {re:/양식/, title:"업무 양식 정리 관리"},
    {re:/근태|휴가|연차|채용|근로계약|급여/, title:"인사·근태 자료 관리"},
    {re:/학교.*(제출|서류|자료)|제출.*학교/, title:"학교 제출 서류 정리"},
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
function rnrTitleFromText(text:any) {
  return String(text??"").trim().split(/\r?\n/).map(line=>line.trim()).find(Boolean)||"";
}
function rnrDisplayTitle(entry:any) {
  return String(entry?.display_title??"").trim()||String(entry?.title??"").trim()||rnrTitleFromText(entry?.raw_input)||rnrTitleFromText(entry?.summary)||"업무 R&R";
}
function normalizeDepartmentName(value:any) {
  const raw=String(value??"").trim();
  if(!raw) return "";
  if(raw==="공통") return "공통";
  const compact=raw.replace(/\s+/g,"");
  const matched=DEPARTMENT_OPTIONS.filter(Boolean).find(option=>option.replace(/\s+/g,"")===compact);
  return matched||raw;
}
function allRnrWorkGroupOptions() {
  return Array.from(new Set([
    ...Object.values(RNR_DEPARTMENT_WORK_GROUPS).flat(),
    ...RNR_FALLBACK_WORK_GROUPS,
  ].filter(Boolean)));
}
function normalizeRnrWorkGroup(value:any,text:any="",category:any="",department:any="") {
  const raw=String(value??"").trim();
  if(!raw&&!String(text??"").trim()&&!String(category??"").trim()) return "";
  const known=allRnrWorkGroupOptions();
  if(raw&&known.includes(raw)) return raw;
  const source=[raw,text,category].filter(Boolean).join("\n");
  const normalizedDepartment=normalizeDepartmentName(department);
  if(/신규|신입|온보딩|입사|사번|계정|웍스|works|권한|OJT/i.test(source)) return normalizedDepartment==="경영지원부서" ? "인사·온보딩 관리" : "온보딩 및 교육";
  if(/지원사업|정부지원|사업비|보조금|메일\s*관리|이메일\s*관리/.test(source)) return "지원사업 관리";
  if(/부가가치세|부가세|국세|지방세|원천세|세금|신고|정산|증빙|현금영수증|강사|프리랜서|급여|지급/.test(source)) return "세무·정산 관리";
  if(/계약|계약서|협약|문서|서류|제출|자료|노션|파일|양식/.test(source)) return normalizedDepartment==="경영지원부서" ? "계약 및 문서 관리" : "문서 및 자료 관리";
  if(/매뉴얼|가이드|운영\s*규칙|업무\s*절차/.test(source)) return "운영 매뉴얼 관리";
  if(/교육|강의|수업|커리큘럼|교안|연수|멘토링/.test(source)) return normalizedDepartment==="기획부서" ? "교육 기획" : normalizedDepartment==="AI부서" ? "AI 교육 콘텐츠" : "온보딩 및 교육";
  if(/행사|워크숍|캠프|사생대회|퍼실|운영진/.test(source)) return normalizedDepartment==="기획부서" ? "행사 기획" : "프로그램 기획·운영";
  if(/전시|작품|갤러리|큐레이션|도슨트/.test(source)) return "전시 기획";
  if(/프로그램|운영안|운영\s*계획/.test(source)) return normalizedDepartment==="기획부서" ? "프로그램 기획·운영" : "일정 및 진행 관리";
  if(/파트너|협력|대외|제휴|기관/.test(source)) return "파트너십·대외협력";
  if(/시장|리서치|조사|신규\s*사업|사업\s*기획/.test(source)) return "시장 조사·신규사업";
  if(/블로그|인스타|SNS|소셜|채널/.test(source)) return "SNS·블로그 운영";
  if(/기사|언론|보도|송부/.test(source)) return "언론·보도 관리";
  if(/홍보자료|검수|브랜드|카드뉴스|콘텐츠|마케팅/.test(source)) return "콘텐츠 기획·제작";
  if(/개발|기능|버그|이슈|배포|장애/.test(source)) return /버그|이슈|장애/.test(source) ? "기능 개선·이슈 관리" : "서비스 개발";
  if(/홈페이지|웹사이트|랜딩/.test(source)) return "홈페이지 운영";
  if(/SaaS|사스|시스템|연동|자동화/.test(source)) return normalizedDepartment==="AI부서" ? "AI 자동화 기획" : "내부 시스템 관리";
  if(/데이터|분석|정리|시트|엑셀/.test(source)) return normalizedDepartment==="AI부서" ? "데이터 정리·분석" : "문서 및 자료 관리";
  if(/디자인|시안|이미지|UI|화면/.test(source)) return /UI|화면/.test(source) ? "UI·화면 디자인" : "콘텐츠 디자인";
  return raw||String(category??"업무").trim()||"업무";
}
function rnrWorkGroupOptionsForDepartment(department:any,current:any="") {
  const normalized=normalizeDepartmentName(department)||"공통";
  const options=[
    ...(RNR_DEPARTMENT_WORK_GROUPS[normalized]??[]),
    ...(normalized!=="공통" ? RNR_DEPARTMENT_WORK_GROUPS.공통 : []),
    ...RNR_FALLBACK_WORK_GROUPS,
  ];
  const currentValue=normalizeRnrWorkGroup(current,"","",normalized);
  return Array.from(new Set([currentValue,...options].filter(Boolean)));
}
function rnrTitleSearchText(entry:any) {
  return [
    entry?.display_title,
    entry?.title,
    entry?.summary,
    entry?.raw_input,
    entry?.work_group,
    entry?.category,
    ...stringListFromUnknown(entry?.flow_notes),
    ...(Array.isArray(entry?.checklist)?entry.checklist:[]),
  ].filter(Boolean).join(" ");
}
function polishedRnrTitle(entry:any) {
  const source=rnrTitleSearchText(entry);
  if(/부가가치세|부가세/.test(source)) return "부가가치세 확정 서류 준비";
  if(/국세|지방세|세금\s*납부|납부\s*확인/.test(source)) return "국세·지방세 납부 확인";
  if(/현금영수증|강사|프리랜서/.test(source)) return "프리랜서 급여 지급 및 서류 처리";
  if(/공개.*노션|노션.*페이지|내부\s*자료/.test(source)) return "회사 내부 자료 관리";
  if(/블로그.*홍보.*검수|홍보.*자료.*검수/.test(source)) return "홍보자료 검수";
  if(/인스타|SNS|콘텐츠.*업로드/.test(source)) return "SNS 콘텐츠 업로드 관리";
  if(/기사.*송부|언론|보도자료/.test(source)) return "언론 보도 자료 관리";
  if(/시장.*명단|사생대회/.test(source)) return "사생대회 운영 명단 관리";
  if(/OJT|온보딩|신입.*사무보조/.test(source)) return "신입 사무보조 OJT 자료 제작";
  if(/웍스|works|사번|계정.*생성|계정.*공유/.test(source)) return "신규 직원 계정 및 사번 안내";
  if(/SaaS|메일자동화|영수증.*연동|시스템.*접근/.test(source)) return "내부 SaaS 연동 관리";
  if(/디자인|현수막|시안|이미지|제작\s*자료/.test(source)) return "디자인 제작 자료 관리";
  return "";
}
function rnrCategory(entry:any) {
  return String(entry?.category??"").trim()||classifyRnrCategory(rnrTitleSearchText(entry));
}
function rnrIsSensitive(entry:any) {
  return /세무|급여|임금|정산|회계|개인정보|계약|계좌|주민|원천세|부가세|민감|비밀/.test([
    entry?.title,
    entry?.display_title,
    entry?.summary,
    entry?.raw_input,
    entry?.work_group,
    entry?.public_note,
    entry?.category,
    ...stringListFromUnknown(entry?.flow_notes),
    ...(Array.isArray(entry?.checklist)?entry.checklist:[]),
  ].filter(Boolean).join(" "));
}
function rnrDutyLine(text:any) {
  const cleaned=String(text||"").trim().replace(/[.!?。]+$/,"");
  return cleaned;
}
function rnrDescriptionLines(entry:any) {
  const title=rnrDisplayTitle(entry);
  const summary=String(entry?.summary??entry?.raw_input??"").trim();
  const descriptionLines=summary
    .split(/\s*(?:\r?\n+|[.;。]\s*)\s*/)
    .map(rnrDutyLine)
    .filter(Boolean)
    .filter(line=>line!==title)
    .slice(0,4);
  const checklist=Array.isArray(entry?.checklist) ? entry.checklist.map(rnrDutyLine).filter(Boolean) : [];
  const merged=[...(descriptionLines.length?descriptionLines:[title]),...checklist.filter((item:string)=>!descriptionLines.includes(item))];
  return merged.filter(Boolean);
}
const RNR_TARGET_SCOPE_LABELS:Record<string,string>={common:"공통",department:"부서",role:"직책",employee:"담당자"};
const WORK_MAP_ACCENTS=["#2563eb","#12b76a","#f97316","#7c3aed","#06b6d4","#ef4444","#64748b"];
function stringListFromUnknown(value:any) {
  if(Array.isArray(value)) return value.map(item=>String(item??"").trim()).filter(Boolean);
  if(typeof value==="string") return value.split(/\r?\n|[,;]+/).map(item=>item.trim()).filter(Boolean);
  return [];
}
function inferRnrWorkGroup(text:any, category:any, department:any="") {
  const source=String(text??"");
  return normalizeRnrWorkGroup("",source,category,department);
}
function inferRnrFlowLines(text:any, category:any) {
  const source=String(text??"").trim();
  const lines=source.split(/\r?\n|[.;]/).map(rnrDutyLine).filter(Boolean);
  if(/부가가치세|부가세/.test(source)) return ["부가가치세 확정을 위한 세부 서류 준비","국세·지방세 납부 확인과 증빙 정리","납부 결과를 내부 문서 관리와 연계"];
  if(/국세|지방세|납부/.test(source)) return ["세금 납부 대상과 기한 확인","납부 처리 및 영수증 보관","회계·문서 관리 내역에 연결"];
  if(/현금영수증|강사|프리랜서/.test(source)) return ["강사별 지급 내역 확인","현금영수증 발급 및 증빙 수집","프리랜서 급여 지급 서류로 보관"];
  if(/OJT|온보딩|신입|사무보조/.test(source)) return ["신입이 반복 업무를 따라 할 수 있게 자료 구성","부서별 체크리스트와 담당자 연결","공통 교육 자료로 배포 후 보완"];
  if(/블로그|인스타|SNS|홍보/.test(source)) return ["홍보 자료의 목적과 채널 확인","블로그·인스타 등 채널별 검수","게시 후 성과와 수정 필요사항 기록"];
  if(/기사|언론|송부/.test(source)) return ["보도자료 핵심 메시지 정리","언론 송부 대상 확인","송부 결과와 후속 응대 기록"];
  if(/시장|명단|사생대회/.test(source)) return ["대상 명단 수집 기준 정리","운영 일정과 담당자 연결","행사 운영 자료로 반영"];
  return (lines.length?lines:stringListFromUnknown(category)).slice(0,3);
}
function inferRnrTargetScope(text:any, assigneeName:any) {
  const source=String(text??"");
  if(/공통|모두|전체|전 직원|신입|OJT|온보딩/.test(source)) return "common";
  if(String(assigneeName??"").trim()) return "employee";
  return "department";
}
function enrichRnrSuggestion(suggestion:any, text:string) {
  const category=suggestion?.category||classifyRnrCategory(text);
  const title=String(suggestion?.title??"").trim()||professionalRnrTitle(text,category);
  const summary=String(suggestion?.summary??text??title).trim();
  const displayTitle=String(suggestion?.display_title??suggestion?.public_title??"").trim()||title;
  const department=normalizeDepartmentName(suggestion?.department);
  const suggestedWorkGroup=String(suggestion?.work_group??suggestion?.category_group??"").trim();
  const workGroup=normalizeRnrWorkGroup(suggestedWorkGroup,`${text}\n${summary}`,category,department);
  const flowNotes=stringListFromUnknown(suggestion?.flow_notes).length
    ? stringListFromUnknown(suggestion?.flow_notes)
    : inferRnrFlowLines(`${text}\n${summary}`,category);
  const targetScope=String(suggestion?.target_scope??inferRnrTargetScope(`${text}\n${summary}`,suggestion?.assigned_person_name)).trim();
  const draft={...suggestion,title,summary,display_title:displayTitle,work_group:workGroup,flow_notes:flowNotes,target_scope:targetScope,category};
  return {...draft,is_public:suggestion?.is_public===false?false:!rnrIsSensitive(draft),public_note:String(suggestion?.public_note??"").trim()};
}
function localRnrSuggestionFromText(text:string, employee?:any) {
  const normalized=text.toLowerCase();
  const employeeDepartment=normalizeDepartmentName(employee?.department);
  const picked=RNR_BASELINE_ROLES.find(role=>employeeDepartment&&normalizeDepartmentName(role.department)===employeeDepartment)
    ?? RNR_BASELINE_ROLES.find(role=>role.keywords.some(keyword=>normalized.includes(keyword.toLowerCase())))
    ?? RNR_BASELINE_ROLES[0];
  const category=classifyRnrCategory(text);
  const department=employeeDepartment||picked.department;
  const position=employee?.position||picked.position;
  return enrichRnrSuggestion({
    title:professionalRnrTitle(text,category),
    summary:text.trim(),
    department,
    position,
    category,
    priority:"normal",
    checklist:picked.duties,
    assigned_person_name:employee?.name||"",
    assigned_employee_id:employee?.id||"",
    target_scope:employee?.id?"employee":"employee",
  }, text);
}
function rnrPublicTitle(entry:any) {
  const manual=String(entry?.display_title??"").trim();
  if(manual) return manual;
  const saved=rnrDisplayTitle(entry);
  const shouldPolish=!saved||saved.length>18||/(의\s*건|해줘|해주세요|공유|가입|정리|내역|송부)/.test(saved);
  return shouldPolish ? (polishedRnrTitle(entry)||saved) : saved;
}
function rnrWorkGroup(entry:any) {
  return normalizeRnrWorkGroup(entry?.work_group, rnrTitleSearchText(entry), entry?.category, entry?.department);
}
function rnrTargetScope(entry:any) {
  const scope=String(entry?.target_scope??"").trim();
  return RNR_TARGET_SCOPE_LABELS[scope]?scope:(entry?.assigned_employee_id?"employee":entry?.department?"department":"common");
}
function rnrPublicDepartment(entry:any) {
  return rnrTargetScope(entry)==="common" ? "공통" : (normalizeDepartmentName(entry?.department)||"공통");
}
function rnrFlowLines(entry:any) {
  const lines=stringListFromUnknown(entry?.flow_notes);
  return (lines.length?lines:rnrDescriptionLines(entry)).filter(Boolean);
}
function rnrIsPublicBoardEntry(entry:any) {
  return entry?.is_active!==false && entry?.is_public!==false;
}
function splitWorkTimePromptSegments(text:string) {
  return text.split(/\s*(?:[,，、;；]|\r?\n+|\s+\/\s+|\s+그리고\s+|\s+또는\s+)\s*/).map(part=>part.trim()).filter(Boolean);
}
function datePartsToIso(year:number,month:number,day:number) {
  if(year<2000||year>2100) return null;
  if(month<1||month>12||day<1||day>31) return null;
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function hasDateIntent(text:string) {
  return /(?:\d{1,2}\s*월|\d{1,2}\s*일|20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}|부터|이후|까지|매\s*주)/.test(text);
}
function hasWeeklyRepeatIntent(text:string) {
  return /매\s*주|주마다/.test(text);
}
function hasOpenEndedDateSuffix(text:string,endIndex:number) {
  return /^\s*(?:부터는|부터|이후)/.test(text.slice(endIndex));
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
  const numericDatePattern="(?<![\\d.])(?:(\\d{4})[./-])?(\\d{1,2})[./-](\\d{1,2})(?![\\d.]|\\s*(?:시간|시|분))";
  const numericRange=text.match(new RegExp(`${numericDatePattern}\\s*(?:부터|에서|~|-)\\s*(?:(?:(\\d{4})[./-])?(\\d{1,2})[./-])?(\\d{1,2})(?![\\d.]|\\s*(?:시간|시|분))(?:까지)?`));
  if(numericRange){
    const y1=Number(numericRange[1]??year);
    const m1=Number(numericRange[2]);
    const d1=Number(numericRange[3]);
    const y2=Number(numericRange[4]??y1);
    const m2=Number(numericRange[5]??m1);
    const d2=Number(numericRange[6]);
    const start=datePartsToIso(y1,m1,d1);
    const end=datePartsToIso(y2,m2,d2);
    if(start&&end) return {id:`p${Date.now()}-${index}`,start_date:start,end_date:end};
  }
  const compactRange=text.match(/(?<!\d)(?:(\d{4})?(\d{2})(\d{2}))\s*(?:부터|에서|~|-)\s*(?:(\d{4})?(\d{2})(\d{2}))(?!\d)/);
  if(compactRange){
    const y1=Number(compactRange[1]??year);
    const y2=Number(compactRange[4]??y1);
    const start=datePartsToIso(y1,Number(compactRange[2]),Number(compactRange[3]));
    const end=datePartsToIso(y2,Number(compactRange[5]),Number(compactRange[6]));
    if(start&&end) return {id:`p${Date.now()}-${index}`,start_date:start,end_date:end};
  }
  const matches=Array.from(text.matchAll(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/g));
  const dates=matches.filter(match=>!hasOpenEndedDateSuffix(text,(match.index??0)+match[0].length)).map(match=>{
    const y=Number(match[1]??year);
    const m=String(Number(match[2])).padStart(2,"0");
    const d=String(Number(match[3])).padStart(2,"0");
    return `${y}-${m}-${d}`;
  });
  Array.from(text.matchAll(new RegExp(numericDatePattern,"g"))).forEach(match=>{
    if(hasOpenEndedDateSuffix(text,(match.index??0)+match[0].length)) return;
    const iso=datePartsToIso(Number(match[1]??year),Number(match[2]),Number(match[3]));
    if(iso) dates.push(iso);
  });
  Array.from(text.matchAll(/(?<!\d)(?:(\d{4})?(\d{2})(\d{2}))(?!\d)/g)).forEach(match=>{
    if(hasOpenEndedDateSuffix(text,(match.index??0)+match[0].length)) return;
    const iso=datePartsToIso(Number(match[1]??year),Number(match[2]),Number(match[3]));
    if(iso) dates.push(iso);
  });
  if(dates.length>=2) return {id:`p${Date.now()}-${index}`,start_date:dates[0],end_date:dates[1]};
  if(dates.length===1) return {id:`p${Date.now()}-${index}`,start_date:dates[0],end_date:dates[0]};
  return null;
}
function parseOpenEndedDateRange(text:string, index=0) {
  const year=new Date().getFullYear();
  const monthOnly=text.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(?:부터|이후|부터는)/);
  if(monthOnly){
    const start=datePartsToIso(Number(monthOnly[1]??year),Number(monthOnly[2]),1);
    return start?{id:`p${Date.now()}-${index}`,start_date:start,end_date:"2099-12-31",open_ended:true}:null;
  }
  const dateOnly=text.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일?\s*(?:부터|이후|부터는)(?!\s*(?:\d{1,2}월|\d{4}[./-]|\d{1,2}[./-]|\d{1,2}일?))/);
  if(dateOnly){
    const start=datePartsToIso(Number(dateOnly[1]??year),Number(dateOnly[2]),Number(dateOnly[3]));
    return start?{id:`p${Date.now()}-${index}`,start_date:start,end_date:"2099-12-31",open_ended:true}:null;
  }
  const numeric=text.match(/(?<![\d.])(?:(\d{4})[./-])?(\d{1,2})[./-](\d{1,2})\s*(?:부터|이후|부터는)(?!\s*(?:\d{1,2}월|\d{4}[./-]|\d{1,2}[./-]|\d{1,2}일?))/);
  if(numeric){
    const start=datePartsToIso(Number(numeric[1]??year),Number(numeric[2]),Number(numeric[3]));
    return start?{id:`p${Date.now()}-${index}`,start_date:start,end_date:"2099-12-31",open_ended:true}:null;
  }
  return null;
}
function parseKoreanDateRanges(text:string) {
  const segments=splitWorkTimePromptSegments(text);
  const ranges=segments.map((segment,index)=>parseKoreanDateRange(segment,index)).filter(Boolean);
  if(ranges.length>0) return ranges;
  return null;
}
function parseScheduleCommandDateRanges(text:string) {
  const source=(text.split(/(?:아니라|정정|수정)/).pop()||text).trim();
  const year=new Date().getFullYear();
  const firstMonth=source.match(/(?:(\d{4})년\s*)?(\d{1,2})월/);
  const initialYear=Number(firstMonth?.[1]??year);
  const initialMonth=firstMonth ? Number(firstMonth[2]) : null;
  const ranges:any[]=[];
  const occupied:{start:number;end:number}[]=[];
  const seen=new Set<string>();
  function addRange(start:string|null,end:string|null,span?:{start:number;end:number}) {
    if(!start||!end||end<start) return;
    const key=`${start}|${end}`;
    if(seen.has(key)) return;
    seen.add(key);
    ranges.push({id:`p${Date.now()}-${ranges.length}`,start_date:start,end_date:end});
    if(span) occupied.push(span);
  }
  let currentYear=initialYear;
  let currentMonth=initialMonth;
  const rangePattern=/(?:(\d{4})년\s*)?(?:(\d{1,2})월\s*)?(\d{1,2})일?\s*(?:부터|에서|~|-)\s*(?:(?:(\d{4})년\s*)?(\d{1,2})월\s*)?(\d{1,2})일?/g;
  Array.from(source.matchAll(rangePattern)).forEach(match=>{
    const y1=Number(match[1]??currentYear??year);
    const m1=Number(match[2]??currentMonth??match[5]);
    const d1=Number(match[3]);
    const y2=Number(match[4]??y1);
    const m2=Number(match[5]??m1);
    const d2=Number(match[6]);
    const start=datePartsToIso(y1,m1,d1);
    const end=datePartsToIso(y2,m2,d2);
    addRange(start,end,{start:match.index??0,end:(match.index??0)+match[0].length});
    currentYear=y2;
    currentMonth=m2;
  });
  currentYear=initialYear;
  currentMonth=initialMonth;
  const singlePattern=/(?:(\d{4})년\s*)?(?:(\d{1,2})월\s*)?(\d{1,2})일/g;
  Array.from(source.matchAll(singlePattern)).forEach(match=>{
    const start=match.index??0;
    const end=start+match[0].length;
    if(hasOpenEndedDateSuffix(source,end)) return;
    if(occupied.some(span=>start>=span.start&&end<=span.end)) {
      if(match[1]) currentYear=Number(match[1]);
      if(match[2]) currentMonth=Number(match[2]);
      return;
    }
    const y=Number(match[1]??currentYear??year);
    const m=Number(match[2]??currentMonth);
    const d=Number(match[3]);
    const iso=datePartsToIso(y,m,d);
    addRange(iso,iso);
    currentYear=y;
    currentMonth=m;
  });
  if(ranges.length===0) return null;
  return ranges.sort((a:any,b:any)=>String(a.start_date).localeCompare(String(b.start_date))||String(a.end_date).localeCompare(String(b.end_date)));
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
  const minute=minuteText==="반"?30:(minuteText?koreanNumberToInt(minuteText):0);
  if(hour==null||minute==null||hour<0||hour>24||minute<0||minute>59) return null;
  const marker=(meridiem??"").trim();
  if(["오후","저녁","밤","낮"].includes(marker)&&hour<12) hour+=12;
  if(["오전","아침"].includes(marker)&&hour===12) hour=0;
  if(hour===24) hour=0;
  return `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
}
function normalizeKoreanTimeText(text:string) {
  return text.replace(/시\s*반/g,"시 30분");
}
function parsePromptTimeRange(text:string) {
  const normalized=normalizeKoreanTimeText(text);
  const timeWord="(?:\\d{1,2}|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|스무|스물(?:한|두|세|네)?|일|이|삼|사|오|육|칠|팔|구|십|이십(?:일|이|삼|사)?)";
  const timePoint=`(?:(오전|오후|아침|낮|저녁|밤)\\s*)?(${timeWord})\\s*(?:시\\s*(?:(\\d{1,2}|[가-힣]{1,4})\\s*분)?|:\\s*(\\d{1,2}))`;
  const re=new RegExp(`${timePoint}\\s*(?:부터|에서|~|-)\\s*${timePoint}`);
  const match=normalized.match(re);
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
function parsePromptSingleTime(text:string) {
  const normalized=normalizeKoreanTimeText(text);
  const timeWord="(?:\\d{1,2}|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|스무|스물(?:한|두|세|네)?|일|이|삼|사|오|육|칠|팔|구|십|이십(?:일|이|삼|사)?)";
  const re=new RegExp(`(?:(오전|오후|아침|낮|저녁|밤)\\s*)?(${timeWord})\\s*(?:시\\s*(?:(\\d{1,2}|[가-힣]{1,4})\\s*분)?|:\\s*(\\d{1,2}))`);
  const match=normalized.match(re);
  return match ? parsePromptTime(match[1],match[2],match[3]??match[4]) : null;
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
  if(WORK_CHANGE_NO_WORK_RE.test(normalized)) parsed.mode="no_work";
  if(parsed.mode==="no_work"&&!parsed.periods) {
    const openEnded=parseOpenEndedDateRange(normalized,0);
    if(openEnded) parsed.periods=[openEnded];
  }
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
  const afterRows=changeMode==="no_work"
    ? [
      "- 근무요일: 출근하지 않음",
      "- 근무시간: 해당 기간 출근하지 않음",
      "- 주 소정근로시간: 0.0시간",
    ]
    : [
      `- 근무요일: ${daysLabel(newDays)}`,
      `- 근무시간: ${timeRangeLabel(newStart,newEnd)}`,
      `- 휴게시간: ${timeRangeLabel(newBreakStart,newBreakEnd)}`,
      `- 주 소정근로시간: ${(netDailyHours(newStart,newEnd,newBreakStart,newBreakEnd)*newDays.length).toFixed(1)}시간`,
    ];
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
    `- 적용기간: ${periods.map((p:any)=>`${periodRangeLabel(p)} (${p.open_ended?"계속 적용":`${p.total_days}일`}, 근무 예정 ${p.work_days_count}일)`).join(" / ")}`,
    ...afterRows,
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
  const [showOldConditions,setShowOldConditions]=useState(false);
  const [msg,setMsg]=useState("");
  const [busy,setBusy]=useState(false);
  const canvasRef=useRef<HTMLCanvasElement|null>(null);
  const selectedEmployee=selectableEmployees.find(e=>e.id===selectedEmployeeId)??employee;
  const oldDays=selectedEmployee.work_days??["mon","tue","wed","thu","fri"];
  const oldStart=timeLabel(selectedEmployee.work_start??"09:00");
  const oldEnd=timeLabel(selectedEmployee.work_end??"18:00");
  const oldContractStart=employeeContractStart(selectedEmployee);
  const oldContractEnd=employeeContractEnd(selectedEmployee);
  const parsedNatural=naturalText.trim()?parseWorkTimeChangePrompt(naturalText,oldDays):{};
  const displayChangeMode=parsedNatural.mode??changeMode;
  const displayPeriods=parsedNatural.periods?.length?parsedNatural.periods:periods;
  const displayManualDays=parsedNatural.mode==="no_work"?[]:(parsedNatural.newDays??manualDays);
  const periodDays=daysFromPeriods(displayPeriods);
  const newDays=displayManualDays??periodDays;
  const effectiveNewDays=displayChangeMode==="no_work"?[]:(newDays.length>0?newDays:oldDays);
  const displayNewStart=parsedNatural.start??newStart;
  const displayNewEnd=parsedNatural.end??newEnd;
  const periodPayload=displayPeriods.map(p=>{const s=countDaysInRange(p.start_date,p.end_date,effectiveNewDays); return {...p,total_days:s.totalDays,work_days_count:s.workDays};});
  const totals=summarizePeriods(displayPeriods,effectiveNewDays);
  const weeklyHours=Math.round(netDailyHours(displayNewStart,displayNewEnd,newBreakStart,newBreakEnd)*effectiveNewDays.length*10)/10;
  const periodLabel=periodPayload.map((p:any)=>p.start_date===p.end_date?p.start_date:periodRangeLabel(p)).join(" / ");
  const hasOpenEndedPeriod=periodPayload.some((p:any)=>p.open_ended||p.end_date==="2099-12-31");
  const changePreview=displayChangeMode==="no_work"
    ? `${periodLabel || "-"} · 출근 안 함${hasOpenEndedPeriod?"":" · 총 "+totals.totalDays+"일"}`
    : `${periodLabel || "-"} · ${daysLabel(effectiveNewDays)} · ${timeRangeLabel(displayNewStart,displayNewEnd)} · 휴게 ${timeRangeLabel(newBreakStart,newBreakEnd)} · 주 ${weeklyHours.toFixed(1)}시간`;

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
    setShowOldConditions(false);
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
  async function cancelWorkTimeRequest(id:string) {
    if(!window.confirm("승인 대기 중인 근무시간 변경 요청을 철회할까요?")) return;
    const {error}=await supabase.rpc("cancel_work_time_change_request",{p_request_id:id});
    if(error) setMsg(`요청 철회 실패: ${error.message}`);
    else { setMsg("근무시간 변경 요청을 철회했습니다."); await load(); }
  }
  async function submit() {
    setMsg("");
    if(!naturalText.trim()) return setMsg("변경 내용을 한 줄로 적어주세요.");
    const hasDraft=parsedNatural.mode||parsedNatural.periods||parsedNatural.newDays||parsedNatural.start||parsedNatural.end;
    if(!hasDraft) return setMsg("날짜, 시간, 근무 안함, 요일 변경 중 하나를 포함해 적어주세요.");
    if(displayChangeMode!=="no_work"&&effectiveNewDays.length===0) return setMsg("변경 후 근무요일을 확인해주세요.");
    if(displayPeriods.some((p:any)=>!p.start_date||!p.end_date||p.end_date<p.start_date)) return setMsg("적용기간의 시작일과 종료일을 확인해주세요.");
    if(!displayNewStart||!displayNewEnd) return setMsg("변경 후 근무시간을 입력해주세요.");
    if(breakMinutes(newBreakStart,newBreakEnd) < 0) return setMsg("휴게시간을 확인해주세요.");
    const noScheduleChange=sameDays(effectiveNewDays,oldDays)&&displayNewStart===oldStart&&displayNewEnd===oldEnd&&newBreakStart==="12:00"&&newBreakEnd==="13:00";
    if(displayChangeMode!=="no_work"&&noScheduleChange) return setMsg("변경된 근무조건이 없습니다. 날짜, 근무요일, 근무시간 중 변경 내용을 입력해주세요.");
    const signature=signatureData(canvasRef);
    if(!signature||signature.length<1200) return setMsg("자필 서명을 입력해주세요.");
    setBusy(true);
    const documentText=buildWorkTimeChangeDocument(selectedEmployee,periodPayload,effectiveNewDays,displayNewStart,displayNewEnd,newBreakStart,newBreakEnd,reason,displayChangeMode);
    const {error}=await supabase.from("work_time_change_requests").insert({
      employee_id:selectedEmployee.id,
      old_work_days:oldDays,
      old_work_start:oldStart,
      old_work_end:oldEnd,
      old_break_start:"12:00",
      old_break_end:"13:00",
      new_work_days:effectiveNewDays,
      new_work_start:displayNewStart,
      new_work_end:displayNewEnd,
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

        <div className="work-change-layout">
          <div className="work-change-main">
            <div className="form-row">
              <label className="label">직원 이름</label>
              {isAdmin ? (
                <select className="select" value={selectedEmployeeId} onChange={e=>setSelectedEmployeeId(e.target.value)}>
                  {selectableEmployees.map(e=><option key={e.id} value={e.id}>{e.name}{e.employee_no?` · ${e.employee_no}`:""}</option>)}
                </select>
              ) : (
                <input className="input" value={`${selectedEmployee.name}${selectedEmployee.employee_no?` · ${selectedEmployee.employee_no}`:""}`} readOnly />
              )}
            </div>

            <label className="label">변경 내용</label>
            <div className="schedule-command-bar worktime-command-bar">
              <i className="ti ti-sparkles" aria-hidden="true"></i>
              <input className="input" value={naturalText} onChange={e=>setNaturalText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&applyNaturalDraft()} placeholder="예: 7월 10일부터 12일까지 근무 안함 / 8월 7일부터 10일까지 오전 열한시부터 오후 여덟시까지 근무" />
              <button className="button secondary" onClick={applyNaturalDraft}>내용 확인</button>
            </div>
            <p className="subtle schedule-command-help">날짜와 시간을 한 줄로 적으면 아래 확인 내용에 자동 반영됩니다. 여러 기간은 쉼표로 이어 적을 수 있습니다.</p>

            <button className="collapsible-btn work-old-toggle" type="button" onClick={()=>setShowOldConditions(v=>!v)}>
              <span>기존 근무조건</span>
              <small>{daysLabel(oldDays)} · {timeRangeLabel(oldStart,oldEnd)} · 휴게 12:00 ~ 13:00</small>
              <i className={`ti ${showOldConditions?"ti-chevron-up":"ti-chevron-down"}`} aria-hidden="true"></i>
            </button>
            {showOldConditions&&<div className="readonly-grid work-old-grid">
              <div className="readonly-field"><span>기준</span><b>근로계약서 기준</b></div>
              <div className="readonly-field"><span>근무 시작일</span><b>{oldContractStart}</b></div>
              <div className="readonly-field"><span>근무 종료일</span><b>{oldContractEnd??"정해진 종료일 없음"}</b></div>
              <div className="readonly-field"><span>근무요일</span><b>{daysLabel(oldDays)}</b></div>
              <div className="readonly-field"><span>근무시간</span><b>{timeRangeLabel(oldStart,oldEnd)}</b></div>
              <div className="readonly-field"><span>휴게시간</span><b>12:00 ~ 13:00</b></div>
            </div>}

            <div className="form-row"><label className="label">변경 사유</label><textarea className="textarea" value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 학업 일정, 개인 사정, 매장 운영 일정 조정 등" /></div>

            <div className="work-section-head">
              <h3>상세 설명</h3>
            </div>
            <WorkTimeDetailBlock className="work-time-detail-space" />

            <div style={{marginTop:16}}>
              <label className="label">자필 서명</label>
              <SignaturePad canvasRef={canvasRef} />
            </div>
            <div className="actions" style={{marginTop:16}}>
              <button className="button full" disabled={busy} onClick={submit}>확인하고 서명하기</button>
              <button className="button ghost" disabled={busy} onClick={()=>clearSignature(canvasRef)}>서명 다시 쓰기</button>
            </div>
          </div>

          <aside className="work-change-history">
            <div className="work-change-history-head">
              <h3><i className="ti ti-list-details" aria-hidden="true"></i>요청 내역</h3>
              <span>{requests.length}건</span>
            </div>
            {requests.length===0 ? <p className="subtle">요청 내역이 없습니다.</p> : (
              <div className="grid">
                {requests.map(r=>(
                  <div className="list-row work-change-history-row" key={r.id}>
                    <div>
                      <b>{(r.periods??[]).map((p:any)=>p.start_date===p.end_date?p.start_date:periodRangeLabel(p)).join(" / ") || "-"}</b>
                      <div className="subtle">{workChangeKind(r)}</div>
                    </div>
                    <div className="actions">
                      <span className={`badge ${badgeClass(r.status)}`}>{String(r.review_note??"").includes("철회")?"철회":r.status==="pending"?"승인 대기":r.status==="approved"?"승인":"반려"}</span>
                      {r.status==="pending"&&<button className="button ghost compact" onClick={()=>cancelWorkTimeRequest(r.id)}>철회</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
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
      const [logResult,overrideResult,changeResult,leaveResult]=await Promise.all([
        supabase.from("attendance_logs").select("check_in_time,check_out_time").eq("employee_id",employee.id).gte("check_in_time",dayStart).lte("check_in_time",dayEnd).order("check_in_time",{ascending:false}).limit(1).maybeSingle(),
        supabase.from("weekly_schedule_overrides").select("*").eq("employee_id",employee.id).eq("week_start",weekStartIso(date)).maybeSingle(),
        supabase.from("work_time_change_requests").select("*").eq("employee_id",employee.id).eq("status","approved").order("created_at",{ascending:false}).limit(100),
        supabase.from("attendance_requests").select("*").eq("employee_id",employee.id).eq("status","approved").lte("start_date",date).gte("end_date",date).order("created_at",{ascending:false}),
      ]);
      const schedule=getScheduleForDate(employee,date,overrideResult.data?[overrideResult.data]:[],changeResult.data??[]);
      const checkIn=logResult.data?.check_in_time?new Date(logResult.data.check_in_time):null;
      const checkOut=logResult.data?.check_out_time?new Date(logResult.data.check_out_time):null;
      const {expectedEnd,shiftMinutes,leaveMinutes}=expectedWorkEndForDate(date,schedule,leaveResult.data??[],checkIn);
      if(cancelled) return;
      const expectedEndHHMM=kstHHMM(expectedEnd);
      const actualCheckoutHHMM=checkOut?kstHHMM(checkOut):null;
      setCompBaseline({hasCheckIn:!!checkIn,checkInTime:checkIn?.toISOString()??null,hasCheckOut:!!checkOut,checkOutTime:checkOut?.toISOString()??null,actualCheckoutHHMM,expectedEndTime:expectedEnd.toISOString(),expectedEndHHMM,shiftMinutes,leaveMinutes});
      setCompForm(current=>{
        if(current.work_date!==date||(timeToMinutes(current.start_time)??0)>=(timeToMinutes(expectedEndHHMM)??0)) return current;
        if(actualCheckoutHHMM&&(timeToMinutes(actualCheckoutHHMM)??0)>(timeToMinutes(expectedEndHHMM)??0)) {
          return {...current,start_time:expectedEndHHMM,end_time:actualCheckoutHHMM,hours:timeDiffHours(expectedEndHHMM,actualCheckoutHHMM)};
        }
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
  const compEarnedHours=Math.round(compEarned*8*100)/100;
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
  function handleLeaveStartDate(value:string){
    setForm(current=>({
      ...current,
      start_date:value,
      end_date:!current.end_date||current.end_date<value?value:current.end_date,
    }));
  }
  function handleLeaveEndDate(value:string){
    setForm(current=>({
      ...current,
      end_date:value<current.start_date?current.start_date:value,
    }));
  }

  async function submitLeave() {
    setMessage("");
    if(!form.start_date||!form.end_date||form.end_date<form.start_date) return setMessage("휴가 종료일은 시작일과 같거나 이후여야 합니다.");
    const requestedHours=isHourly?Number(form.amount_hours||0):0;
    const effectiveRequestType=isHourly&&compRemainHours>0?"comp_leave_use":form.request_type;
    const m=LEAVE_TYPE_META[effectiveRequestType]??LEAVE_TYPE_META[form.request_type];
    const requestedDays = m?.fixedDays ?? (isHourly ? requestedHours/8 : 1);
    // 잔여 검증 — 휴가 차감형 전체 (연차/반차/시간차/특별/대체/보상)
    if (isHourly && (!requestedHours || requestedHours<=0)) return setMessage("시간차 사용 시간을 입력해주세요.");
    if (effectiveRequestType==="comp_leave_use") {
      if(requestedHours>compRemainHours+1e-9) return setMessage(`보상휴가 잔여 시간(${formatHourValue(compRemainHours)}시간)이 부족합니다.`);
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
    if(error) setMessage(error.message); else{setMessage(effectiveRequestType==="comp_leave_use"?"보상휴가 시간 사용 신청이 저장되었습니다.":"휴가 신청이 저장되었습니다.");await load();}
  }

  async function useCompLeave() {
    setMessage(""); const hours=Number(form.amount_hours||0);
    if(!hours||hours<=0) return setMessage("사용할 시간을 입력해주세요.");
    if(hours>compRemainHours+1e-9) return setMessage(`보상휴가 잔여 시간(${formatHourValue(compRemainHours)}시간)이 부족합니다.`);
    const {error}=await supabase.from("attendance_requests").insert({employee_id:employee.id,request_type:"comp_leave_use",start_date:form.start_date,end_date:form.start_date,amount_hours:hours,amount_days:hours/8,reason:form.reason||"보상휴가 시간 사용",status:"pending"});
    if(error) setMessage(error.message); else{setMessage("보상휴가 시간 사용 신청이 저장되었습니다.");await load();}
  }

  function handleCompTimeChange(field:"start_time"|"end_time",val:string){
    let next={...compForm,[field]:val};
    if(field==="start_time"){
      const oldStart=timeToMinutes(compForm.start_time);
      const oldEnd=timeToMinutes(compForm.end_time);
      const newStart=timeToMinutes(val);
      if(oldStart!=null&&oldEnd!=null&&newStart!=null&&oldEnd>oldStart) {
        next={...next,end_time:minutesToTime(newStart+(oldEnd-oldStart))};
      }
    }
    const h=timeDiffHours(next.start_time,next.end_time);
    setCompForm({...next,hours:h>0?h:compForm.hours});
  }
  async function submitCompTime() {
    setMessage("");
    if(!compForm.hours||compForm.hours<=0) return setMessage("추가 근무 시간을 입력해주세요.");
    if(!compBaseline) return setMessage("소정근로 종료 기준을 계산 중입니다. 잠시 후 다시 신청해주세요.");
    const requestedStart=timeToMinutes(compForm.start_time)??0;
    const overtimeStart=timeToMinutes(compBaseline.expectedEndHHMM)??0;
    if(requestedStart<overtimeStart){
      const basis=compBaseline.hasCheckIn
        ? `${timeOnly(compBaseline.checkInTime)} 출근 기준 소정근로 종료 시각은 ${compBaseline.expectedEndHHMM}입니다.`
        : `출근기록이 없어 등록된 스케줄 기준 소정근로 종료 시각은 ${compBaseline.expectedEndHHMM}입니다.`;
      return setMessage(`${basis} ${compBaseline.expectedEndHHMM} 이후 시간만 추가근무로 신청할 수 있습니다.`);
    }
    const startAt=new Date(`${compForm.work_date}T${compForm.start_time}:00`);
    const hasActualOvertime=(timeToMinutes(compBaseline.actualCheckoutHHMM)??0)>(timeToMinutes(compBaseline.expectedEndHHMM)??0);
    if(!hasActualOvertime&&new Date().getTime()>=startAt.getTime()) return setMessage("추가근무 신청은 원칙적으로 시작 시간 전에만 가능합니다. 이미 퇴근 기록이 있고 기준 종료보다 늦게 퇴근한 날짜는 실제 퇴근시간 기준으로 신청할 수 있습니다.");
    const duplicate=compRequests.find(r=>r.work_date===compForm.work_date&&r.start_time===compForm.start_time&&r.end_time===compForm.end_time&&["pending","approved"].includes(r.status));
    if(duplicate) return setMessage("이미 신청한 시간입니다. 관리자의 승인을 기다려주세요.");
    const normalHours=Math.round((compBaseline.shiftMinutes/60)*10)/10;
    const leaveText=compBaseline.leaveMinutes ? ` · 승인 휴가 ${formatHourValue(Math.round((compBaseline.leaveMinutes/60)*10)/10)}시간 반영` : "";
    const basis=compBaseline.hasCheckIn
      ? `실제 출근 ${timeOnly(compBaseline.checkInTime)} · 소정근로 ${formatHourValue(normalHours)}시간${leaveText} · 기준 종료 ${compBaseline.expectedEndHHMM}`
      : `출근 전이므로 등록 스케줄 기준 종료 ${compBaseline.expectedEndHHMM}${leaveText}`;
    if(!window.confirm(`${basis}\n${compBaseline.expectedEndHHMM} 이후부터 추가근무로 인정됩니다.\n\n추가근무를 신청하시겠습니까?\n신청 후 수정이 불가능합니다.`)) return;
    const {error}=await supabase.from("comp_time_requests").insert({employee_id:employee.id,work_date:compForm.work_date,start_time:compForm.start_time,end_time:compForm.end_time,hours:compForm.hours,converted_days:Number((compForm.hours/8).toFixed(4)),reason:compForm.reason,status:"pending"});
    if(error) setMessage(error.message); else{setMessage("추가근무 신청이 저장되었습니다. 관리자 승인 후 보상휴가로 적립됩니다.");await load();}
  }

  async function cancelCompRequest(id:string) {
    if(!window.confirm("추가근무 신청을 취소할까요?")) return;
    const {error}=await supabase.from("comp_time_requests").delete().eq("id",id).eq("employee_id",employee.id).eq("status","pending");
    if(error) setMessage(error.message); else { setMessage("추가근무 신청이 취소되었습니다."); await load(); }
  }

  return (
    <div className="grid">
      {message&&<div className="alert">{message}</div>}
      {showLeave&&<div className="summer-holiday-banner leave">
        <div><b>{COMPANY_SUMMER_HOLIDAY.title}</b><span>{companySummerHolidayLabel()}</span></div>
        <small>{COMPANY_SUMMER_HOLIDAY.description}</small>
      </div>}
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
              <div className="leave-chip leave-chip-highlight"><span>보상휴가 잔여</span><b>{formatHourValue(compRemainHours)}시간</b></div>
            </div>
            <p className="subtle leave-period-text">근무 시작일 {employee.joined_at??"-"} · {automaticAnnual>0?ent.description:"자동 연차 미발생"}<br />{automaticAnnual>0?`산정기간 ${ent.periodStart??"-"} ~ ${ent.periodEnd??"-"} (근로기준법 제60조)`:isAnnualLeaveDisabled(employee)?ANNUAL_LEAVE_LEGAL_NOTE:"관리자가 별도로 부여한 특별·대체·보상휴가는 사용할 수 있습니다."}</p>
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
              시간차 휴가는 승인된 추가근무 보상휴가 잔여시간 {formatHourValue(compRemainHours)}시간에서 자동 차감됩니다.
            </div>
          )}

          {isSingle ? (
            <div className="form-row"><label className="label">사용일</label><input className="input" type="date" value={form.start_date} onChange={e=>handleLeaveStartDate(e.target.value)} /></div>
          ) : (
            <div className="grid two">
              <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={form.start_date} onChange={e=>handleLeaveStartDate(e.target.value)} /></div>
              <div className="form-row"><label className="label">종료일</label><input className="input" type="date" min={form.start_date} value={form.end_date} onChange={e=>handleLeaveEndDate(e.target.value)} /></div>
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
            <div className="metric"><div className="metric-value">{formatHourValue(compEarnedHours)}시간</div><div className="metric-label">승인 적립시간</div></div>
            <div className="metric"><div className="metric-value">{formatHourValue(compRemainHours)}시간</div><div className="metric-label">사용 가능</div></div>
            <div className="metric"><div className="metric-value">{compRequests.filter(r=>r.status==="pending").length}건</div><div className="metric-label">승인 대기</div></div>
          </div>
          <div className="body-text" style={{marginBottom:14}}>
            <p>추가근무는 사전 신청 및 회사 승인 후 진행하는 것을 원칙으로 합니다.<br/>다만 실제 근로 제공 여부가 회사 확인을 통해 인정되는 경우, 해당 시간은 법정 기준에 따라 추가근무로 처리됩니다.</p>
            <p>승인 또는 확인된 추가근무 시간은 앱에서 보상휴가 적립·사용 내역으로 관리됩니다.<br/>보상휴가제는 근로기준법 제57조에 따른 서면합의 기준에 따라 운영되며, 연장·야간·휴일근로에 해당하는 경우 법정 가산 기준을 반영합니다.</p>
          </div>
          <div className="alert">※ 추가근무는 시작 시간 전에만 신청할 수 있습니다.<br/>※ 한 번 신청하면 수정이 불가능합니다. 수정이 필요하면 승인 전 취소 후 다시 신청해주세요.</div>
          {compBaseline&&<div className="alert overtime-baseline-alert">
            <b>추가근무 인정 시작: {compBaseline.expectedEndHHMM} 이후</b>
            <span>{compBaseline.hasCheckIn
              ? `${timeOnly(compBaseline.checkInTime)} 출근 · 소정근로 ${formatHourValue(Math.round((compBaseline.shiftMinutes/60)*10)/10)}시간${compBaseline.leaveMinutes?` · 승인 휴가 ${formatHourValue(Math.round((compBaseline.leaveMinutes/60)*10)/10)}시간 반영`:""} · 기준 종료 ${compBaseline.expectedEndHHMM}`
              : `아직 출근기록이 없어 등록된 출근 스케줄 기준으로 계산했습니다.${compBaseline.leaveMinutes?` 승인 휴가 ${formatHourValue(Math.round((compBaseline.leaveMinutes/60)*10)/10)}시간 반영`:""}`}</span>
            {compBaseline.actualCheckoutHHMM&&(timeToMinutes(compBaseline.actualCheckoutHHMM)??0)>(timeToMinutes(compBaseline.expectedEndHHMM)??0)&&<span>실제 퇴근 기록 {compBaseline.actualCheckoutHHMM} 기준으로 종료 시간이 자동 입력되었습니다. 이 시간이 맞나요?</span>}
          </div>}
          <div className="form-row"><label className="label">추가근무일</label><input className="input" type="date" value={compForm.work_date} onChange={e=>setCompForm({...compForm,work_date:e.target.value})} /></div>
          <div className="comp-time-grid">
            <div className="form-row"><label className="label">시작</label><input className="input" type="time" value={compForm.start_time} onChange={e=>handleCompTimeChange("start_time",e.target.value)} /></div>
            <div className="form-row"><label className="label">종료</label><input className="input" type="time" value={compForm.end_time} onChange={e=>handleCompTimeChange("end_time",e.target.value)} /></div>
            <div className="form-row"><label className="label">시간(자동)</label><input className="input" type="number" min="0.01" step="0.01" value={compForm.hours} onChange={e=>setCompForm({...compForm,hours:Number(e.target.value)})} /></div>
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
                <div><b>{r.work_date} {r.start_time?.slice(0,5)}~{r.end_time?.slice(0,5)}</b><div className="subtle">신청 시간 {r.hours}시간 · {r.reason??"-"}</div></div>
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
  useEffect(()=>{supabase.from("employees").select("id,name,employee_no,employment_status").eq("employment_status","active").order("employee_no",{ascending:true}).then(({data})=>setEmployees(data??[]));},[]);
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
    if(!window.confirm(`${empName(form.employee_id)} 직원에게 ${formatHourValue(form.hours)}시간 추가근무를 승인 등록할까요?`)) return;
    const {error}=await supabase.rpc("admin_grant_comp_time",{
      p_employee_id:form.employee_id,
      p_work_date:form.work_date,
      p_start_time:form.start_time,
      p_end_time:form.end_time,
      p_hours:form.hours,
      p_reason:form.reason.trim(),
    });
    if(error) setMessage(`추가근무 등록 실패: ${error.message}`);
    else{setMessage(`${empName(form.employee_id)} 직원의 추가근무를 승인 등록하고 보상휴가 적립 내역에 반영했습니다.`);setForm({...form,reason:""});onChanged?.();}
  }
  return <section className="card">
    <h2 className="card-title"><i className="ti ti-user-plus" aria-hidden="true"></i>직원 추가근무 직접 등록</h2>
    <p className="subtle" style={{marginBottom:14}}>대표 또는 관리자가 사후 확인한 추가근무를 직원별로 직접 등록합니다. 저장 즉시 승인되며 보상휴가 적립 내역에 반영됩니다.</p>
    {message&&<div className={`alert ${message.includes("실패")?"error":"success"}`}>{message}</div>}
    <div className="grid four">
      <div className="form-row"><label className="label">직원</label><select className="select" value={form.employee_id} onChange={e=>setForm({...form,employee_id:e.target.value})}><option value="">직원 선택</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name} · {e.employee_no}</option>)}</select></div>
      <div className="form-row"><label className="label">근무일</label><input className="input" type="date" value={form.work_date} onChange={e=>setForm({...form,work_date:e.target.value})} /></div>
      <div className="form-row"><label className="label">시작</label><input className="input" type="time" value={form.start_time} onChange={e=>updateTime("start_time",e.target.value)} /></div>
      <div className="form-row"><label className="label">종료</label><input className="input" type="time" value={form.end_time} onChange={e=>updateTime("end_time",e.target.value)} /></div>
    </div>
    <div className="grid two">
      <div className="form-row"><label className="label">시간</label><input className="input" type="number" min="0.01" step="0.01" value={form.hours} onChange={e=>setForm({...form,hours:Number(e.target.value)})} /></div>
      <div className="form-row"><label className="label">보상휴가 관리시간</label><div className="readonly-field input-like">{formatHourValue(form.hours || 0)}시간</div></div>
    </div>
    <div className="form-row"><label className="label">등록 사유</label><textarea className="textarea" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="예: 행사 종료 후 정리, 사후 확인된 연장근무" /></div>
    <button className="button" onClick={grant}><i className="ti ti-check" aria-hidden="true"></i>승인 등록</button>
  </section>;
}

function WorkplacePage({ employee }: { employee: any }) {
  const [query,setQuery]=useState(""); const [places,setPlaces]=useState<any[]>([]); const [workplaces,setWorkplaces]=useState<any[]>([]); const [message,setMessage]=useState("");
  const [reqType,setReqType]=useState("special_school"); const [reqPrivate,setReqPrivate]=useState(false);
  const [editing,setEditing]=useState<any|null>(null);
  const [openPlaceTypes,setOpenPlaceTypes]=useState<Record<string,boolean>>({});
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
  function placeTypeOpen(type:string) {
    return openPlaceTypes[type] ?? true;
  }
  function togglePlaceType(type:string) {
    setOpenPlaceTypes(current=>({...current,[type]:!(current[type]??true)}));
  }
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
            <button type="button" className="workplace-category-toggle" onClick={()=>togglePlaceType(group.type)}>
              <span>{group.label}</span>
              <small>{group.items.length}곳</small>
              <i className={`ti ${placeTypeOpen(group.type)?"ti-chevron-up":"ti-chevron-down"}`} aria-hidden="true"></i>
            </button>
            {placeTypeOpen(group.type)&&group.items.map(w=>(
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

function WorkMapBoard({ entries, employees=[], onOpen }: { entries:any[]; employees?:any[]; onOpen?:(entry:any)=>void }) {
  const publicEntries=entries.filter(rnrIsPublicBoardEntry);
  const cards:any[]=Array.from(publicEntries.reduce((deptMap:Map<string,any>,entry:any)=>{
    const department=rnrPublicDepartment(entry);
    const groupName=rnrWorkGroup(entry);
    if(!deptMap.has(department)) deptMap.set(department,{department,entries:[],groups:new Map<string,any>()});
    const dept=deptMap.get(department);
    dept.entries.push(entry);
    if(!dept.groups.has(groupName)) dept.groups.set(groupName,{name:groupName,entries:[]});
    dept.groups.get(groupName).entries.push(entry);
    return deptMap;
  },new Map<string,any>()).values()).sort((a:any,b:any)=>{
    if(a.department==="공통") return -1;
    if(b.department==="공통") return 1;
    return String(a.department).localeCompare(String(b.department));
  });
  if(cards.length===0) return <p className="rnr-empty-work">아직 공개된 업무 분장표가 없습니다. 관리자 업무 R&R에서 공개 항목을 저장하면 이곳에 표시됩니다.</p>;
  const groupCount=cards.reduce((sum:number,card:any)=>sum+card.groups.size,0);
  return <>
    <div className="work-map-overview">
      <div><span>공개 부서</span><b>{cards.length}</b></div>
      <div><span>업무 묶음</span><b>{groupCount}</b></div>
      <div><span>업무 카드</span><b>{publicEntries.length}</b></div>
    </div>
    <div className="work-map-board">
    {cards.map((card:any,index:number)=>(
      <article className="work-map-card" key={card.department} style={{"--dept-accent":WORK_MAP_ACCENTS[index%WORK_MAP_ACCENTS.length]} as any}>
        <div className="work-map-card-head">
          <div>
            <span>Department</span>
            <b>{card.department}</b>
            <small className="work-map-card-members">
              담당자 {
                card.department==="공통"
                  ? "전체 직원"
                  : (employees
                    .filter((employee:any)=>normalizeDepartmentName(employee.department)===card.department)
                    .map((employee:any)=>employee.name)
                    .filter(Boolean)
                    .slice(0,5)
                    .join(", ") || "미배정")
              }
            </small>
          </div>
          <em>{card.entries.length}개 업무</em>
        </div>
        <div className="work-map-groups">
          {Array.from(card.groups.values()).map((group:any)=>(
            <div className="work-map-group" key={`${card.department}-${group.name}`}>
              <div className="work-map-group-title"><b>{group.name}</b><span>{group.entries.length}건</span></div>
              {group.entries.map((entry:any)=> {
                const task=<div className="work-map-task">
                  <strong>{rnrPublicTitle(entry)}</strong>
                </div>;
                return onOpen
                  ? <button type="button" className="work-map-task-button" key={entry.id} onClick={()=>onOpen(entry)}>{task}</button>
                  : <div key={entry.id}>{task}</div>;
              })}
            </div>
          ))}
        </div>
      </article>
    ))}
    </div>
  </>;
}

function PublicWorkMapPage({ currentEmployee }: { currentEmployee:any }) {
  const [entries,setEntries]=useState<any[]>([]);
  const [employees,setEmployees]=useState<any[]>([]);
  const [reviewTitle,setReviewTitle]=useState("");
  const [reviewMemo,setReviewMemo]=useState("");
  const [reviewSuggestion,setReviewSuggestion]=useState<any|null>(null);
  const [reviewRequests,setReviewRequests]=useState<any[]>([]);
  const [reviewBusy,setReviewBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  async function loadWorkMap(){
    setLoading(true); setMessage("");
    let result=await supabase
      .from("rnr_entries")
      .select("*")
      .eq("is_active",true)
      .eq("is_public",true)
      .order("department",{ascending:true})
      .order("work_group",{ascending:true})
      .order("created_at",{ascending:false})
      .limit(300);
    if(result.error&&/is_public|is_sensitive|work_group|schema cache/i.test(result.error.message)){
      result=await supabase
        .from("rnr_entries")
        .select("*")
        .eq("is_active",true)
        .order("created_at",{ascending:false})
        .limit(300);
    }
    const {data,error}=result;
    if(error) setMessage(error.message);
    setEntries(data??[]);
    const [empResult,reviewResult]=await Promise.all([
      supabase.from("employees").select("id,name,department,is_active,employment_status").eq("is_active",true).order("created_at",{ascending:false}),
      supabase.from("rnr_review_requests").select("*").eq("requester_id",currentEmployee.id).order("created_at",{ascending:false}).limit(10),
    ]);
    setEmployees(empResult.data??[]);
    if(reviewResult.error&&/rnr_review_requests|schema cache|relation/i.test(reviewResult.error.message)) {
      setReviewRequests([]);
    } else {
      setReviewRequests(reviewResult.data??[]);
    }
    setLoading(false);
  }
  useEffect(()=>{
    let alive=true;
    async function load(){
      if(!alive) return;
      await loadWorkMap();
    }
    load();
    return ()=>{alive=false;};
  },[currentEmployee?.id]);
  async function previewReviewSuggestion() {
    const source=[reviewTitle,reviewMemo].filter(Boolean).join("\n").trim();
    if(!source) return setMessage("제안할 업무 내용을 입력해주세요.");
    setReviewBusy(true); setMessage("");
    try {
      const {data:sessionData}=await supabase.auth.getSession();
      const token=sessionData.session?.access_token;
      if(!token) throw new Error("로그인이 필요합니다.");
      const response=await fetch("/api/rnr-suggest",{
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({
          input:source,
          employees:[{id:currentEmployee.id,name:currentEmployee.name,department:currentEmployee.department,position:currentEmployee.position,role:currentEmployee.role}],
          existing:entries.slice(0,40).map((entry:any)=>({title:entry.title,department:entry.department,position:entry.position,category:entry.category,work_group:rnrWorkGroup(entry)})),
          categories:RNR_CATEGORY_OPTIONS.filter(Boolean),
          work_groups:allRnrWorkGroupOptions(),
          baseline:RNR_BASELINE_ROLES,
        }),
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error||"AI 정리 실패");
      setReviewSuggestion({...enrichRnrSuggestion(data?.suggestion??localRnrSuggestionFromText(source,currentEmployee),source),target_scope:"employee",assigned_employee_id:currentEmployee.id,assigned_person_name:currentEmployee.name});
    } catch(e:any) {
      setReviewSuggestion(localRnrSuggestionFromText(source,currentEmployee));
      setMessage(`AI 호출 대신 기본 추천으로 정리했습니다. ${e.message}`);
    } finally {
      setReviewBusy(false);
    }
  }
  async function submitReviewRequest() {
    const source=[reviewTitle,reviewMemo].filter(Boolean).join("\n").trim();
    if(!source) return setMessage("관리자에게 넘길 업무 내용을 입력해주세요.");
    const suggestion=reviewSuggestion??localRnrSuggestionFromText(source,currentEmployee);
    const title=String(reviewTitle||suggestion.display_title||suggestion.title||"업무 R&R 제안").trim();
    const payload={
      requester_id:currentEmployee.id,
      raw_input:source,
      title,
      summary:String(suggestion.summary||source).trim(),
      suggestion:{...suggestion,target_scope:"employee",assigned_employee_id:currentEmployee.id,assigned_person_name:currentEmployee.name},
      status:"pending",
    };
    const {error}=await supabase.from("rnr_review_requests").insert(payload);
    if(error) return setMessage(error.message.includes("rnr_review_requests")?"R&R 검토함 테이블이 아직 없습니다. 관리자에게 Supabase SQL 패치 실행을 요청해주세요.":error.message);
    setMessage("관리자 검토 요청을 보냈습니다.");
    setReviewTitle(""); setReviewMemo(""); setReviewSuggestion(null);
    await loadWorkMap();
  }
  const recentReviews=reviewRequests.slice(0,3);
  return <section className="card work-map-page">
    <div className="work-map-hero">
      <div>
        <span>LUPl Role Map</span>
        <h2><i className="ti ti-hierarchy-3" aria-hidden="true"></i>업무 분장표</h2>
        <p className="subtle">부서별로 해야 할 일과 연결 업무 흐름을 공개용으로 정리해 둔 화면입니다.</p>
      </div>
      <i className="ti ti-route-square-2" aria-hidden="true"></i>
    </div>
    {message&&<div className={`alert ${message.includes("보냈")?"success":"error"}`}>{message}</div>}
    <div className="rnr-employee-submit">
      <div className="rnr-section-title rnr-panel-title">
        <b>내 업무 제안</b>
        <span>직원이 직접 적고 관리자 검토 후 업무분장표에 반영합니다.</span>
      </div>
      <div className="rnr-review-grid">
        <div className="rnr-review-write">
          <div className="form-row"><label className="label">한줄 정리</label><input className="input" value={reviewTitle} onChange={e=>setReviewTitle(e.target.value)} placeholder="예: 지원사업 정산 자료 정리" /></div>
          <div className="form-row"><label className="label">업무 메모</label><textarea className="textarea compact-textarea" value={reviewMemo} onChange={e=>setReviewMemo(e.target.value)} placeholder="무슨 일을 하는지, 누구와 연결되는지 편하게 적어주세요." /></div>
          <div className="actions"><button className="button secondary compact" disabled={reviewBusy} onClick={previewReviewSuggestion}><i className="ti ti-sparkles" aria-hidden="true"></i>{reviewBusy?"정리 중":"자동 정리"}</button><button className="button compact" onClick={submitReviewRequest}><i className="ti ti-send" aria-hidden="true"></i>관리자 검토 요청</button></div>
        </div>
        <div className="rnr-review-preview">
          <b>AI 자동 정리 결과</b>
          {reviewSuggestion ? (
            <div className="rnr-review-result">
              <strong>{reviewSuggestion.display_title||reviewSuggestion.title}</strong>
              <span>{reviewSuggestion.department||"부서 미정"} · {reviewSuggestion.position||"직책 미정"} · {reviewSuggestion.work_group||"업무 묶음 미정"}</span>
              <p>{reviewSuggestion.summary}</p>
            </div>
          ) : <p>한줄 정리와 업무 메모를 입력하고 자동 정리를 누르면 이곳에 검토용 초안이 표시됩니다.</p>}
        </div>
      </div>
      {recentReviews.length>0&&<div className="rnr-review-history">
        {recentReviews.map((row:any)=><span key={row.id}>{row.status==="pending"?"검토 대기":row.status==="approved"?"승인됨":"반려됨"} · {row.title}</span>)}
      </div>}
    </div>
    {loading ? <p className="subtle">불러오는 중...</p> : <WorkMapBoard entries={entries} employees={employees} />}
  </section>;
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
  const [rnrReviewRequests,setRnrReviewRequests]=useState<any[]>([]);
  const [dailyTasks,setDailyTasks]=useState<any[]>([]);
  const [rnrInput,setRnrInput]=useState("");
  const [rnrAttachments,setRnrAttachments]=useState<any[]>([]);
  const [rnrSuggestion,setRnrSuggestion]=useState<any|null>(null);
  const [rnrAssigneeId,setRnrAssigneeId]=useState("");
  const [selectedRnr,setSelectedRnr]=useState<any|null>(null);
  const [editingRnr,setEditingRnr]=useState<any|null>(null);
  const [editingRnrTask,setEditingRnrTask]=useState<any|null>(null);
  const [rnrTaskDate,setRnrTaskDate]=useState(todayIso());
  const [rnrTaskDueDate,setRnrTaskDueDate]=useState(todayIso());
  const [rnrDepartmentFilter,setRnrDepartmentFilter]=useState("all");
  const [rnrOrgDraft,setRnrOrgDraft]=useState<Record<string,{employeeId:string;position:string}>>({});
  const [rnrChecklistDone,setRnrChecklistDone]=useState<Record<string,boolean>>(()=>{try{return JSON.parse(localStorage.getItem("lupl_rnr_checklist_done")??"{}");}catch{return {};}});
  const [rnrBusy,setRnrBusy]=useState(false);
  const [rnrMsg,setRnrMsg]=useState("");
  const [message,setMessage]=useState("");
  const [settledCompIds,setSettledCompIds]=useState<Set<string>>(()=>{
    try { return new Set(JSON.parse(localStorage.getItem("lupl_settled_comp_ids")??"[]")); }
    catch { return new Set(); }
  });
  const [selectedDetailEmployeeId,setSelectedDetailEmployeeId]=useState("");
  const [selectedEmployeeCopyIds,setSelectedEmployeeCopyIds]=useState<string[]>([]);
  const [hiddenRejectedIds,setHiddenRejectedIds]=useState<string[]>(()=>{
    try { return JSON.parse(localStorage.getItem("lupl_hidden_rejected_archive")??"[]"); }
    catch { return []; }
  });
  const [showRejectedArchive,setShowRejectedArchive]=useState(false);
  const [newEmployee,setNewEmployee]=useState({name:"",employee_no:"",phone:"",joined_at:todayIso(),work_start_date:todayIso(),role:"employee",device_limit:3,department:"",position:"",no_annual_leave:false,is_unpaid:false,work_days:["mon","tue","wed","thu","fri"]});
  const [bulkEmployeeText,setBulkEmployeeText]=useState("");
  const [bulkEmployeeRows,setBulkEmployeeRows]=useState<any[]>([]);
  const [bulkCreating,setBulkCreating]=useState(false);
  const [scheduleEmpId,setScheduleEmpId]=useState("");
  const [scheduleMsg,setScheduleMsg]=useState("");
  const [leaveModalEmp,setLeaveModalEmp]=useState<any|null>(null);
  const [leaveUsageEmpId,setLeaveUsageEmpId]=useState("all");
  const [correctionDraft,setCorrectionDraft]=useState<any|null>(null);
  const [approvalCommand,setApprovalCommand]=useState("");
  const [approvalCommandMsg,setApprovalCommandMsg]=useState("");
  const [approvalTab,setApprovalTab]=useState<"received"|"mine"|"history">("received");

  async function load() {
    const {data:emps}=await supabase.from("employees").select("*").order("created_at",{ascending:false});
    const list=emps??[]; const map:Record<string,any>={};
    list.forEach((e:any)=>{map[e.id]=e;});
    setEmployees(list); setEmpMap(map);
    const [d,w,r,c,wt,ac,a,ov,ab,lg,rn,rr,dt]=await Promise.all([
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
      supabase.from("rnr_review_requests").select("*").order("created_at",{ascending:false}).limit(100),
      supabase.from("daily_tasks").select("*").eq("is_active",true).order("task_date",{ascending:false}).order("created_at",{ascending:false}).limit(200),
    ]);
    setDevices(d.data??[]); setWorkplaces(w.data??[]); setRequests(r.data??[]); setCompRequests(c.data??[]); setWorkTimeRequests(wt.data??[]); setAttendanceCorrectionRequests(ac.error?[]:ac.data??[]); setAdjustments(a.data??[]); setOverrides(ov.data??[]); setAbsences(ab.data??[]); setAllLogs(lg.data??[]); setRnrEntries(rn.data??[]); setRnrReviewRequests(rr.error?[]:rr.data??[]); setDailyTasks(dt.data??[]);
  }
  useEffect(()=>{load();},[]);
  const empName=(id?:string|null)=>id?(empMap[id]?.name??"-"):"-";
  const rnrAssigneeName=(entry:any)=>rnrTargetScope(entry)==="common"?"공통":rnrTargetScope(entry)==="department"?`${entry?.department||"부서"} 공동`:(entry?.assigned_person_name||(
    entry?.assigned_employee_id&&empMap[entry.assigned_employee_id]?.name
      ? empMap[entry.assigned_employee_id].name
      : "직책 기준"
  ));
  const rnrTitleSet=new Set(rnrEntries.map((entry:any)=>rnrDisplayTitle(entry)));
  const rnrTodayTaskRows=dailyTasks
    .filter((task:any)=>task.source_rnr_entry_id||(
      task.created_by===currentEmployee.id
      && rnrTitleSet.has(String(task.title??""))
    ))
    .sort((a:any,b:any)=>String(b.task_date??"").localeCompare(String(a.task_date??""))||String(b.created_at??"").localeCompare(String(a.created_at??"")));
  function dailyTaskTargetLabel(task:any) {
    return task?.target_employee_id ? empName(task.target_employee_id) : "전체 직원";
  }
  function dailyTaskSourceLabel(task:any) {
    const source=task?.source_rnr_entry_id ? rnrEntries.find((entry:any)=>entry.id===task.source_rnr_entry_id) : null;
    return source ? `${rnrPublicDepartment(source)} · ${rnrWorkGroup(source)}` : "R&R에서 보낸 할일";
  }
  function dailyTaskDueLabel(task:any) {
    const due=String(task?.due_date??"").slice(0,10);
    return due ? `기한 ${due}` : "";
  }
  const pendingRnrReviewRequests=rnrReviewRequests.filter((row:any)=>row.status==="pending");
  function rnrReviewRequester(row:any) {
    return empMap[row.requester_id]??employees.find((employee:any)=>employee.id===row.requester_id)??null;
  }
  function rnrSuggestionFromReview(row:any) {
    const requester=rnrReviewRequester(row);
    return enrichRnrSuggestion({
      ...(row.suggestion??{}),
      title:row.title,
      summary:row.summary,
      assigned_employee_id:row.requester_id,
      assigned_person_name:requester?.name??"",
      department:requester?.department||row.suggestion?.department,
      position:requester?.position||row.suggestion?.position,
      target_scope:"employee",
    }, row.raw_input);
  }

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
    const compH=Math.round(compEarned*8*100)/100;
    const compUsedH=reqs.filter(r=>isCompLeaveUsageRequest(r)&&r.status==="approved").reduce((s,r)=>s+(r.amount_hours??(r.amount_days??0)*8),0);
    const pendingComp=comps.filter(c=>c.status==="pending").reduce((s,c)=>s+compRequestHours(c)/8,0);
    return {total,used,remain,compEarned,compUsedH,compRemainH:Math.max(0,compH-compUsedH),pendingComp};
  }

  async function createEmployee() {
    setMessage("");
    const duplicate=employees.find((employee:any)=>String(employee.employee_no??"").trim().toLowerCase()===newEmployee.employee_no.trim().toLowerCase());
    if(duplicate) return setMessage(`이미 등록된 사번입니다. ${duplicate.name} 직원의 기존 근태·동의 기록과 섞이지 않도록 다른 사번을 입력해주세요.`);
    const {data,error}=await supabase.functions.invoke("admin-create-employee",{body:newEmployee});
    if(error) setMessage(error.message); else if(data?.error) setMessage(data.error);
    else{
      await updateEmployeeMetadataByNo(newEmployee.employee_no,{department:newEmployee.department,position:newEmployee.position,no_annual_leave:newEmployee.no_annual_leave,is_unpaid:newEmployee.is_unpaid});
      setMessage(`직원 계정이 생성되었습니다. 초기 비밀번호: ${data.initial_password}`);
      setNewEmployee({name:"",employee_no:"",phone:"",joined_at:todayIso(),work_start_date:todayIso(),role:"employee",device_limit:3,department:"",position:"",no_annual_leave:false,is_unpaid:false,work_days:["mon","tue","wed","thu","fri"]});
      await load();onChanged();
    }
  }
  async function updateEmployee(id:string,patch:Record<string,any>){
    const {error}=await supabase.from("employees").update(patch).eq("id",id);
    if(error&&/is_unpaid|schema cache|column/i.test(error.message)) {
      const {is_unpaid,...fallbackPatch}=patch;
      if(Object.keys(fallbackPatch).length===0) return setMessage("무급 체크 컬럼이 아직 DB에 없습니다. Supabase 패치를 적용한 뒤 다시 저장해주세요.");
      const fallback=await supabase.from("employees").update(fallbackPatch).eq("id",id);
      if(fallback.error) setMessage(fallback.error.message);
      else { setMessage("기본 직원 정보는 저장했습니다. 무급 체크는 Supabase 패치 적용 후 저장됩니다."); await load(); onChanged(); }
      return;
    }
    if(error)setMessage(error.message);else{await load();onChanged();}
  }
  async function updateEmployeeMetadataByNo(employeeNo:string,patch:Record<string,any>){
    const {error}=await supabase.from("employees").update(patch).eq("employee_no",employeeNo);
    if(error&&/is_unpaid|schema cache|column/i.test(error.message)){
      const {is_unpaid,...fallbackPatch}=patch;
      if(Object.keys(fallbackPatch).length>0) await supabase.from("employees").update(fallbackPatch).eq("employee_no",employeeNo);
    }
  }
  async function toggleEmployee(id:string,cur:string){const n=cur!=="active";await updateEmployee(id,{is_active:n,employment_status:n?"active":"inactive"});}
  const orgDepartmentValue=(department:string)=>department==="공통"?"":department;
  const employeeDepartmentLabel=(employee:any)=>normalizeDepartmentName(employee?.department)||"공통";
  const rnrOrgDraftFor=(department:string)=>rnrOrgDraft[department]??{employeeId:"",position:"매니저"};
  function setRnrOrgDraftValue(department:string,patch:Partial<{employeeId:string;position:string}>){
    setRnrOrgDraft(current=>({...current,[department]:{...(current[department]??{employeeId:"",position:"매니저"}),...patch}}));
  }
  async function assignRnrOrgEmployee(department:string){
    const draft=rnrOrgDraftFor(department);
    const employee=employees.find((e:any)=>e.id===draft.employeeId);
    if(!employee) return setRnrMsg("조직도에 넣을 직원을 선택해주세요.");
    const nextPosition=draft.position||employee.position||"매니저";
    const {error}=await supabase.from("employees").update({department:orgDepartmentValue(department),position:nextPosition}).eq("id",employee.id);
    if(error) return setRnrMsg(error.message);
    setRnrMsg(`${employee.name}님을 ${department} · ${nextPosition}(으)로 배치했습니다.`);
    setRnrOrgDraft(current=>({...current,[department]:{employeeId:"",position:nextPosition}}));
    await load(); onChanged();
  }
  async function updateRnrOrgEmployee(employee:any,patch:Record<string,any>){
    const next={...patch};
    if("department" in next) next.department=orgDepartmentValue(next.department);
    const {error}=await supabase.from("employees").update(next).eq("id",employee.id);
    if(error) return setRnrMsg(error.message);
    setRnrMsg(`${employee.name}님의 조직도 정보를 변경했습니다.`);
    await load(); onChanged();
  }
  function localRnrSuggestion(text:string) {
    return localRnrSuggestionFromText(text);
  }
  async function handleRnrPaste(event:any) {
    const files=Array.from(event.clipboardData?.files??[]).filter((file:any)=>String(file.type??"").startsWith("image/")) as File[];
    if(!files.length) return;
    event.preventDefault();
    const added=await Promise.all(files.slice(0,5).map(file=>imageFileToAttachment(file,"rnr")));
    setRnrAttachments(current=>[...current,...added].slice(0,8));
    setRnrMsg(`${added.length}개 이미지가 첨부되었습니다.`);
  }
  async function suggestRnr() {
    const raw=rnrInput.trim();
    if(!raw&&!rnrAttachments.length) return setRnrMsg("정리할 업무 내용이나 이미지를 입력해주세요.");
    if(!raw&&rnrAttachments.length){
      setRnrSuggestion({...localRnrSuggestion("이미지 첨부 업무"),target_scope:"employee"});
      return setRnrMsg("이미지 첨부 업무로 정리했습니다. 제목과 담당자를 확인해주세요.");
    }
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
          existing:rnrEntries.slice(0,80).map((e:any)=>({title:e.title,department:e.department,position:e.position,category:e.category,work_group:rnrWorkGroup(e)})),
          categories:RNR_CATEGORY_OPTIONS.filter(Boolean),
          work_groups:allRnrWorkGroupOptions(),
          baseline:RNR_BASELINE_ROLES,
        }),
      });
      const data=await response.json();
      if(!response.ok) throw new Error(data?.error||"AI 정리 실패");
      const suggestion={...enrichRnrSuggestion(data?.suggestion??localRnrSuggestion(raw),raw),target_scope:"employee"};
      setRnrSuggestion(suggestion);
      const matched=employees.find((e:any)=>e.name&&suggestion.assigned_person_name&&String(suggestion.assigned_person_name).includes(e.name));
      if(matched) setRnrAssigneeId(matched.id);
    } catch(e:any) {
      setRnrSuggestion({...localRnrSuggestion(raw),target_scope:"employee"});
      setRnrMsg(`AI 호출 대신 기본 추천으로 정리했습니다. ${e.message}`);
    } finally {
      setRnrBusy(false);
    }
  }
  async function saveRnrEntry() {
    if(!rnrSuggestion) return setRnrMsg("먼저 업무를 정리해주세요.");
    const assignee=employees.find((e:any)=>e.id===rnrAssigneeId);
    const category=rnrSuggestion.category||classifyRnrCategory(`${rnrInput} ${rnrSuggestion.summary??""}`);
    const rawTitle=rnrTitleFromText(rnrInput)||String(rnrSuggestion.title??"").trim()||"이미지 첨부 업무";
    const summary=String(rnrSuggestion.summary||rnrInput.trim()||rawTitle).trim();
    const targetScope=String(rnrSuggestion.target_scope??"employee").trim();
    if(targetScope==="employee"&&!assignee) return setRnrMsg("담당자 업무로 저장하려면 담당 직원을 선택해주세요. 부서 업무라면 배정 대상을 부서로 바꿔주세요.");
    if(targetScope==="department"&&!String(rnrSuggestion.department??"").trim()) return setRnrMsg("부서 업무로 저장하려면 부서를 선택해주세요.");
    const displayTitleSeed=String(rnrSuggestion.display_title??rnrSuggestion.title??rawTitle).trim()||rawTitle;
    const displayTitle=displayTitleSeed;
    const department=normalizeDepartmentName(targetScope==="common"?"공통":targetScope==="employee"?(assignee?.department||rnrSuggestion.department||""):(rnrSuggestion.department||""));
    const position=targetScope==="common"?"":targetScope==="employee"?(assignee?.position||rnrSuggestion.position||""):(rnrSuggestion.position||"");
    const workGroup=normalizeRnrWorkGroup(rnrSuggestion.work_group,`${rnrInput}\n${summary}`,category,department);
    const payload={
      raw_input:rnrInput.trim()||rawTitle,
      title:rawTitle,
      summary,
      display_title:displayTitle,
      work_group:workGroup,
      flow_notes:stringListFromUnknown(rnrSuggestion.flow_notes).length?stringListFromUnknown(rnrSuggestion.flow_notes):inferRnrFlowLines(`${rnrInput}\n${summary}`,category),
      target_scope:targetScope,
      is_public:rnrSuggestion.is_public!==false,
      public_note:String(rnrSuggestion.public_note??"").trim()||null,
      department,
      position,
      category,
      priority:rnrSuggestion.priority||"normal",
      checklist:Array.isArray(rnrSuggestion.checklist)?rnrSuggestion.checklist:[],
      assigned_employee_id:targetScope==="employee"?(rnrAssigneeId||null):null,
      assigned_person_name:targetScope==="common"?"공통":targetScope==="employee"?(assignee?.name||rnrSuggestion.assigned_person_name||""):"",
      created_by:currentEmployee.id,
      source:"admin_note",
      attachments:rnrAttachments,
      is_active:true,
    };
    const sensitive=rnrIsSensitive(payload);
    (payload as any).is_sensitive=sensitive;
    if(sensitive&&!window.confirm("이 업무에는 급여, 개인정보, 세무 또는 계약 자료가 포함될 수 있습니다.\n공개 업무분장표 표시 여부를 다시 확인해주세요.\n이대로 저장할까요?")) return;
    let result=await supabase.from("rnr_entries").insert(payload);
    if(result.error&&/attachments|is_sensitive|display_title|work_group|flow_notes|target_scope|is_public|public_note|schema cache/i.test(result.error.message)){
      const {attachments,is_sensitive,display_title,work_group,flow_notes,target_scope,is_public,public_note,...fallbackPayload}=payload as any;
      result=await supabase.from("rnr_entries").insert(fallbackPayload);
    }
    const {error}=result;
    if(error) setRnrMsg(error.message);
    else { setRnrMsg("업무 R&R이 저장되었습니다."); setRnrInput(""); setRnrAttachments([]); setRnrSuggestion(null); setRnrAssigneeId(""); await load(); }
  }
  async function approveRnrReview(row:any) {
    const requester=rnrReviewRequester(row);
    const suggestion=rnrSuggestionFromReview(row);
    const category=suggestion.category||classifyRnrCategory(`${row.title} ${row.summary}`);
    const department=normalizeDepartmentName(requester?.department||suggestion.department||"");
    const position=requester?.position||suggestion.position||"";
    const workGroup=normalizeRnrWorkGroup(suggestion.work_group,`${row.raw_input}\n${row.summary}`,category,department);
    const payload={
      raw_input:String(row.raw_input??row.title??"").trim(),
      title:String(row.title??suggestion.title??"업무 R&R 제안").trim(),
      summary:String(row.summary??suggestion.summary??row.raw_input??"").trim(),
      display_title:String(suggestion.display_title??row.title??suggestion.title??"업무 R&R").trim(),
      work_group:workGroup,
      flow_notes:stringListFromUnknown(suggestion.flow_notes).length?stringListFromUnknown(suggestion.flow_notes):inferRnrFlowLines(`${row.raw_input}\n${row.summary}`,category),
      target_scope:"employee",
      is_public:suggestion.is_public!==false,
      public_note:String(suggestion.public_note??"").trim()||null,
      department,
      position,
      category,
      priority:suggestion.priority||"normal",
      checklist:Array.isArray(suggestion.checklist)?suggestion.checklist:[],
      assigned_employee_id:row.requester_id,
      assigned_person_name:requester?.name||suggestion.assigned_person_name||"",
      created_by:currentEmployee.id,
      source:"employee_review_request",
      attachments:Array.isArray(suggestion.attachments)?suggestion.attachments:[],
      is_active:true,
    };
    const sensitive=rnrIsSensitive(payload);
    (payload as any).is_sensitive=sensitive;
    const insertResult=await supabase.from("rnr_entries").insert(payload).select("id").single();
    if(insertResult.error) return setRnrMsg(insertResult.error.message);
    const updateResult=await supabase.from("rnr_review_requests").update({
      status:"approved",
      reviewed_by:currentEmployee.id,
      reviewed_at:new Date().toISOString(),
      rnr_entry_id:insertResult.data?.id,
      updated_at:new Date().toISOString(),
    }).eq("id",row.id);
    if(updateResult.error) setRnrMsg(updateResult.error.message);
    else { setRnrMsg("직원 제안을 승인해 업무분장표에 반영했습니다."); await load(); onChanged(); }
  }
  async function rejectRnrReview(row:any) {
    const note=window.prompt("반려 사유를 입력해주세요.", row.review_note||"업무 묶음 또는 담당 범위를 다시 확인해주세요.");
    if(note===null) return;
    const {error}=await supabase.from("rnr_review_requests").update({
      status:"rejected",
      review_note:note,
      reviewed_by:currentEmployee.id,
      reviewed_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
    }).eq("id",row.id);
    if(error) setRnrMsg(error.message);
    else { setRnrMsg("직원 제안을 반려했습니다."); await load(); onChanged(); }
  }
  function openRnr(entry:any){
    setSelectedRnr(entry);
    setEditingRnr(null);
    const nextDate=nextTaskDateForRnr(entry);
    setRnrTaskDate(nextDate);
    setRnrTaskDueDate(nextDate);
  }
  function beginEditRnr(entry:any){
    setEditingRnr({
      ...entry,
      title:rnrPublicTitle(entry),
      summary:String(entry.summary??entry.raw_input??""),
      category:rnrCategory(entry),
      assigned_employee_id:entry.assigned_employee_id??"",
      checklistText:Array.isArray(entry.checklist)?entry.checklist.join("\n"):"",
      display_title:rnrPublicTitle(entry),
      work_group:rnrWorkGroup(entry),
      flowNotesText:rnrFlowLines(entry).join("\n"),
      target_scope:rnrTargetScope(entry),
      is_public:entry.is_public!==false,
      public_note:String(entry.public_note??""),
    });
  }
  async function saveEditedRnr(){
    if(!editingRnr?.id) return;
    const assignee=employees.find((e:any)=>e.id===editingRnr.assigned_employee_id);
    const checklist=String(editingRnr.checklistText??"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const category=editingRnr.category||classifyRnrCategory(`${editingRnr.title} ${editingRnr.summary}`);
    const title=String(editingRnr.title??"").trim()||rnrDisplayTitle(editingRnr);
    const summary=String(editingRnr.summary??"").trim()||title;
    const targetScope=String(editingRnr.target_scope??inferRnrTargetScope(`${title}\n${summary}`,editingRnr.assigned_person_name)).trim();
    if(targetScope==="employee"&&!assignee) return setRnrMsg("담당자 업무로 수정하려면 담당 직원을 선택해주세요. 부서 업무라면 배정 대상을 부서로 바꿔주세요.");
    if(targetScope==="department"&&!String(editingRnr.department??"").trim()) return setRnrMsg("부서 업무로 수정하려면 부서를 선택해주세요.");
    const flowNotes=String(editingRnr.flowNotesText??"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const department=normalizeDepartmentName(targetScope==="common"?"공통":targetScope==="employee"?(assignee?.department||editingRnr.department||""):(editingRnr.department||""));
    const position=targetScope==="common"?"":targetScope==="employee"?(assignee?.position||editingRnr.position||""):(editingRnr.position||"");
    const workGroup=normalizeRnrWorkGroup(editingRnr.work_group,`${title}\n${summary}`,category,department);
    const payload={
      raw_input:title,
      title,
      summary,
      display_title:String(editingRnr.display_title??title).trim()||title,
      work_group:workGroup,
      flow_notes:flowNotes.length?flowNotes:inferRnrFlowLines(`${title}\n${summary}`,category),
      target_scope:targetScope,
      is_public:editingRnr.is_public!==false,
      public_note:String(editingRnr.public_note??"").trim()||null,
      department,
      position,
      category,
      checklist,
      attachments:Array.isArray(editingRnr.attachments)?editingRnr.attachments:[],
      assigned_employee_id:targetScope==="employee"?(editingRnr.assigned_employee_id||null):null,
      assigned_person_name:targetScope==="common"?"공통":targetScope==="employee"?(assignee?.name||editingRnr.assigned_person_name||""):"",
      updated_at:new Date().toISOString(),
    };
    const sensitive=rnrIsSensitive(payload);
    (payload as any).is_sensitive=sensitive;
    if(sensitive&&!window.confirm("이 업무에는 급여, 개인정보, 세무 또는 계약 자료가 포함될 수 있습니다.\n공개 업무분장표 표시 여부를 다시 확인해주세요.\n이대로 수정할까요?")) return;
    let result=await supabase.from("rnr_entries").update(payload).eq("id",editingRnr.id).select().single();
    if(result.error&&/attachments|is_sensitive|display_title|work_group|flow_notes|target_scope|is_public|public_note|schema cache/i.test(result.error.message)){
      const {attachments,is_sensitive,display_title,work_group,flow_notes,target_scope,is_public,public_note,...fallbackPayload}=payload as any;
      result=await supabase.from("rnr_entries").update(fallbackPayload).eq("id",editingRnr.id).select().single();
    }
    const {data,error}=result;
    if(error) setRnrMsg(error.message);
    else { setRnrMsg("업무 R&R을 수정했습니다."); setSelectedRnr(data); setEditingRnr(null); await load(); }
  }
  function toggleRnrChecklist(entryId:string,index:number,checked:boolean) {
    const key=`${entryId}:${index}`;
    setRnrChecklistDone(current=>{
      const next={...current,[key]:checked};
      localStorage.setItem("lupl_rnr_checklist_done",JSON.stringify(next));
      return next;
    });
  }
  function isFullDayApprovedLeave(employeeId:string,dateIso:string) {
    return requests.some((request:any)=>
      request.employee_id===employeeId
      && request.status==="approved"
      && request.start_date<=dateIso
      && request.end_date>=dateIso
      && !request.start_time
      && !request.end_time
    );
  }
  function nextTaskDateForRnr(entry:any) {
    const employee=entry.assigned_employee_id?empMap[entry.assigned_employee_id]:null;
    for(let i=0;i<=45;i++){
      const date=addIsoDays(todayIso(),i);
      if(employee){
        const schedule=getScheduleForDate(employee,date,overrides,approvedWorkTimeChanges);
        if((schedule.work_days??[]).includes(dayKeyFromDate(dateFromIso(date)))&&!isFullDayApprovedLeave(employee.id,date)) return date;
      } else if(["mon","tue","wed","thu","fri"].includes(dayKeyFromDate(dateFromIso(date)))) {
        return date;
      }
    }
    return addIsoDays(todayIso(),1);
  }
  async function sendRnrToTodayTask(entry:any, dateOverride?:string, dueOverride?:string){
    const contentLines=rnrFlowLines(entry).map((item:string)=>`- ${item}`).join("\n");
    let taskDate=dateOverride||(selectedRnr?.id===entry.id?rnrTaskDate:"")||nextTaskDateForRnr(entry);
    let dueDate=dueOverride||(selectedRnr?.id===entry.id?rnrTaskDueDate:"")||taskDate;
    if(taskDate===todayIso()&&isAfterBusinessClose()&&window.confirm("오후 6시 이후입니다. 이 할일을 내일로 넘기겠습니까?")){
      taskDate=addIsoDays(todayIso(),1);
      if(!dueDate||dueDate===todayIso()) dueDate=taskDate;
    }
    const targetScope=rnrTargetScope(entry);
    const department=normalizeDepartmentName(entry.department);
    const departmentTargets=targetScope==="department"
      ? activeEmployees.filter((employee:any)=>normalizeDepartmentName(employee.department)===department).map((employee:any)=>employee.id)
      : [];
    const targetEmployeeIds=targetScope==="employee"&&entry.assigned_employee_id
      ? [entry.assigned_employee_id]
      : departmentTargets.length>0
        ? departmentTargets
        : [null];
    const payloads=targetEmployeeIds.map((targetEmployeeId:string|null)=>({
      task_date:taskDate,
      due_date:dueDate||null,
      title:rnrPublicTitle(entry)||"오늘의 할일",
      content:contentLines,
      is_active:true,
      created_by:currentEmployee.id,
      target_employee_id:targetEmployeeId,
      source_rnr_entry_id:entry.id,
      attachments:Array.isArray(entry.attachments)?entry.attachments:[],
    }));
    let result=await supabase.from("daily_tasks").insert(payloads);
    if(result.error&&/attachments|source_rnr_entry_id|due_date|schema cache/i.test(result.error.message)){
      const fallbackPayloads=payloads.map(({attachments,source_rnr_entry_id,due_date,...fallbackPayload})=>fallbackPayload);
      result=await supabase.from("daily_tasks").insert(fallbackPayloads);
    }
    const {error}=result;
    if(error) setRnrMsg(error.message);
    else {
      await load(); onChanged();
      const dateLabel=taskDate===todayIso()?"오늘":taskDate;
      const targetLabel=targetScope==="department"&&departmentTargets.length>0
        ? `${department} ${departmentTargets.length}명`
        : targetEmployeeIds[0]
          ? rnrAssigneeName(entry)
          : "전체 직원";
      setRnrMsg(`${targetLabel} ${dateLabel} 할일로 보냈습니다.`);
    }
  }
  function beginEditRnrTask(task:any) {
    setEditingRnrTask({
      ...task,
      task_date:String(task.task_date??todayIso()).slice(0,10),
      due_date:String(task.due_date??"").slice(0,10),
      target_employee_id:task.target_employee_id??"",
    });
  }
  async function saveEditedRnrTask() {
    if(!editingRnrTask?.id) return;
    const title=String(editingRnrTask.title??"").trim();
    const content=String(editingRnrTask.content??"").trim();
    if(!title||!content) return setRnrMsg("오늘의 할일 제목과 내용을 입력해주세요.");
    const patch={
      task_date:editingRnrTask.task_date||todayIso(),
      due_date:editingRnrTask.due_date||null,
      title,
      content,
      target_employee_id:editingRnrTask.target_employee_id||null,
      updated_at:new Date().toISOString(),
    };
    let result=await supabase.from("daily_tasks").update(patch).eq("id",editingRnrTask.id);
    if(result.error&&/due_date|schema cache/i.test(result.error.message)){
      const {due_date,...fallbackPatch}=patch;
      result=await supabase.from("daily_tasks").update(fallbackPatch).eq("id",editingRnrTask.id);
    }
    const {error}=result;
    if(error) return setRnrMsg(error.message);
    setEditingRnrTask(null);
    setRnrMsg("오늘의 할일을 수정했습니다.");
    await load(); onChanged();
  }
  async function hideRnrTask(task:any) {
    if(!window.confirm(`${task.title} 할일을 삭제할까요?`)) return;
    const {error}=await supabase.from("daily_tasks").update({is_active:false,updated_at:new Date().toISOString()}).eq("id",task.id);
    if(error) return setRnrMsg(error.message);
    if(editingRnrTask?.id===task.id) setEditingRnrTask(null);
    setRnrMsg("오늘의 할일을 삭제했습니다.");
    await load(); onChanged();
  }
  async function deleteRnrEntry(entry:any) {
    if(!entry?.id) return;
    if(!window.confirm(`${rnrPublicTitle(entry)} 업무를 업무분장표에서 삭제할까요?`)) return;
    const {error}=await supabase.from("rnr_entries").update({is_active:false,updated_at:new Date().toISOString()}).eq("id",entry.id);
    if(error) return setRnrMsg(error.message);
    setSelectedRnr(null);
    setEditingRnr(null);
    setRnrMsg("업무분장표에서 삭제했습니다.");
    await load(); onChanged();
  }
  async function sendRnrToMonthlyKpi(entry:any) {
    if(!entry?.id) return;
    const targetScope=rnrTargetScope(entry);
    const department=normalizeDepartmentName(entry.department);
    const departmentTargets=targetScope==="department"
      ? activeEmployees.filter((employee:any)=>normalizeDepartmentName(employee.department)===department)
      : [];
    const employeeTargets=targetScope==="employee"&&entry.assigned_employee_id
      ? [activeEmployees.find((employee:any)=>employee.id===entry.assigned_employee_id)].filter(Boolean)
      : departmentTargets;
    const monthValue=String(rnrTaskDate||todayIso()).slice(0,7);
    const workDate=monthStartIso(monthValue);
    const baseTitle=rnrPublicTitle(entry)||"월간 KPI";
    const targetRows=employeeTargets.length>0
      ? employeeTargets.map((employee:any)=>({employee_id:employee.id,employee_name:employee.name,title:baseTitle}))
      : [{employee_id:null,employee_name:targetScope==="department"&&department?department:"전체",title:targetScope==="department"&&department?`${department} · ${baseTitle}`:baseTitle}];
    const payloads=targetRows.map((row:any,index:number)=>({
      ...row,
      parent_id:null,
      scope:"monthly",
      work_date:workDate,
      description:rnrFlowLines(entry).join("\n"),
      source_rnr_entry_id:entry.id,
      status:"pending",
      sort_order:index+1,
      is_public:true,
      is_active:true,
      created_by:currentEmployee.id,
    }));
    let result=await supabase.from("kpi_entries").insert(payloads);
    if(result.error&&/description|source_rnr_entry_id|schema cache/i.test(result.error.message)){
      const fallbackPayloads=payloads.map(({description,source_rnr_entry_id,...fallbackPayload}:any)=>fallbackPayload);
      result=await supabase.from("kpi_entries").insert(fallbackPayloads);
    }
    const {error}=result;
    if(error) return setRnrMsg(error.message);
    const label=employeeTargets.length>0 ? `${employeeTargets.length}명` : targetRows[0].employee_name;
    setRnrMsg(`${label} ${monthValue} 월간 KPI로 보냈습니다.`);
  }
  async function resetEmployeeNo(emp:any){
    const nw=window.prompt(`${emp.name}의 새 사번(로그인 아이디)을 입력하세요.`, emp.employee_no);
    const nextNo=String(nw??"").trim();
    if(!nextNo||nextNo===emp.employee_no) return;
    const duplicate=employees.find((employee:any)=>employee.id!==emp.id&&String(employee.employee_no??"").trim().toLowerCase()===nextNo.toLowerCase());
    if(duplicate) return setMessage(`이미 ${duplicate.name} 직원이 사용 중인 사번입니다. 다른 사번을 입력해주세요.`);
    const {data,error}=await supabase.functions.invoke("admin-create-employee",{body:{action:"reset_employee_no",employee_id:emp.id,new_employee_no:nextNo}});
    if(!error&&!data?.error) {
      setMessage(data?.auth_updated===false
        ? `사번 표시는 ${data.employee_no}(으)로 변경했습니다. 로그인 아이디는 기존 사번일 수 있습니다. 함수 오류: ${data.auth_error??"Auth 이메일 미변경"}`
        : `사번이 ${data.employee_no}(으)로 변경되었습니다. 새 로그인 아이디로 안내해주세요.`);
      await load();
      return;
    }
    const reason=error?.message||data?.error||"Edge Function 처리 실패";
    const fallback=await supabase.from("employees").update({employee_no:nextNo,internal_email:internalEmail(nextNo)}).eq("id",emp.id);
    if(fallback.error) return setMessage(`${reason} / DB 사번 변경도 실패했습니다: ${fallback.error.message}`);
    setMessage(`사번 표시는 ${nextNo}(으)로 변경했습니다. 단, 로그인 아이디까지 바꾸려면 Supabase 함수 배포/시크릿 확인이 필요합니다. 함수 오류: ${reason}`);
    await load();
  }
  async function resetPassword(emp:any){
    if(!window.confirm(`${emp.name}의 비밀번호를 초기화할까요? (lupl + 휴대폰 뒤4자리)`)) return;
    const {data,error}=await supabase.functions.invoke("admin-create-employee",{body:{action:"reset_password",employee_id:emp.id}});
    if(error) setMessage(error.message); else if(data?.error) setMessage(data.error); else setMessage(`${emp.name} 비밀번호가 초기화되었습니다. 초기 비밀번호: ${data.initial_password}`);
  }
  async function deleteInactiveEmployee(emp:any){
    if(emp.employment_status==="active"||emp.is_active) return setMessage("재직 중인 직원은 먼저 비활성화한 뒤 삭제할 수 있습니다.");
    if(emp.id===currentEmployee.id) return setMessage("현재 로그인한 관리자 계정은 삭제할 수 없습니다.");
    const preview=await supabase.functions.invoke("admin-create-employee",{body:{action:"delete_employee",employee_id:emp.id,dry_run:true}});
    if(preview.error) return setMessage(preview.error.message);
    if(preview.data?.error) return setMessage(preview.data.error);
    const count=Number(preview.data?.related_count??0);
    const details=Array.isArray(preview.data?.related_counts)
      ? preview.data.related_counts.filter((row:any)=>Number(row.count)>0).map((row:any)=>`${row.label} ${row.count}건`).join(" / ")
      : "";
    const warning=[
      `${emp.name} 비활성 직원을 완전히 삭제할까요?`,
      "",
      "로그인 계정과 연결된 직원 데이터가 함께 삭제됩니다.",
      count>0?`연결 기록: ${details||`${count}건`}`:"연결 기록은 확인되지 않았습니다.",
      "",
      "테스트/오등록 계정 정리용으로만 사용해주세요.",
    ].join("\n");
    if(!window.confirm(warning)) return;
    const {data,error}=await supabase.functions.invoke("admin-create-employee",{body:{action:"delete_employee",employee_id:emp.id}});
    if(error) setMessage(error.message);
    else if(data?.error) setMessage(data.error);
    else {
      setSelectedEmployeeCopyIds(current=>current.filter(id=>id!==emp.id));
      if(selectedDetailEmployeeId===emp.id) setSelectedDetailEmployeeId("");
      setMessage(`${emp.name} 비활성 직원 계정을 삭제했습니다.`);
      await load();
      onChanged();
    }
  }
  async function reviewWorkplace(id:string,status:string,type?:string){
    const patch:any={approval_status:status,is_active:status==="approved",updated_at:new Date().toISOString()};
    if(status==="approved") patch.approved_by=currentEmployee.id;
    if(type) patch.type=type;
    const {error}=await supabase.from("workplaces").update(patch).eq("id",id);if(error)setMessage(error.message);else{await load();onChanged();}
  }
  async function setWorkplaceType(id:string,type:string){const {error}=await supabase.from("workplaces").update({type}).eq("id",id);if(error)setMessage(error.message);else await load();}
  function rejectionNoteOrNull(typeLabel:string) {
    const note=window.prompt(`${typeLabel} 반려 사유를 입력해주세요.`, "");
    if(note===null) return null;
    const trimmed=note.trim();
    if(!trimmed) {
      setMessage("반려 사유는 필수입니다.");
      return null;
    }
    return trimmed;
  }
  async function reviewRequest(id:string,status:string){
    const reviewNote=status==="rejected"?rejectionNoteOrNull("휴가 신청"):"";
    if(status==="rejected"&&reviewNote===null) return;
    const {error}=await supabase.rpc("review_attendance_request",{p_request_id:id,p_status:status,p_review_note:reviewNote});
    if(error)setMessage(error.message);else{setMessage(status==="approved"?"휴가 신청을 승인했고 관련 일정에 반영됩니다.":"휴가 신청을 반려했습니다.");await load();onChanged();}
  }
  function compAttendance(request:any){
    return allLogs.find((log:any)=>log.employee_id===request.employee_id&&localDateStr(log.check_in_time)===request.work_date);
  }
  function compSchedule(request:any){
    return getScheduleForDate(empMap[request.employee_id],request.work_date,overrides,workTimeRequests.filter(r=>r.status==="approved"));
  }
  function expectedCompCheckout(request:any, log=compAttendance(request)){
    const schedule=compSchedule(request);
    const leaveRows=requests.filter((row:any)=>row.employee_id===request.employee_id);
    const baseline=log?.check_in_time
      ? expectedWorkEndForDate(request.work_date,schedule,leaveRows,new Date(log.check_in_time)).expectedEnd
      : expectedWorkEndForDate(request.work_date,schedule,leaveRows,null).expectedEnd;
    if(compRequestExcludesDinner(request)){
      const requestEnd=dateTimeForWorkDateTime(request.work_date,request.end_time,baseline);
      const actualEnd=log?.check_out_time ? new Date(log.check_out_time) : null;
      return addMinutes(baseline,dinnerBreakOverlapMinutes(baseline,actualEnd??requestEnd));
    }
    const requestStart=dateTimeForWorkDateTime(request.work_date,request.start_time,null);
    return requestStart&&requestStart.getTime()>baseline.getTime()?requestStart:baseline;
  }
  function estimatedOvertime(request:any){
    const log=compAttendance(request);
    if(!log?.check_out_time) return null;
    const scheduledEnd=expectedCompCheckout(request,log);
    return Math.max(0,Math.round(((new Date(log.check_out_time).getTime()-scheduledEnd.getTime())/3600000)*100)/100);
  }
  function companyConfirmedComp(request:any){
    return /관리자 한 줄|회사 확인|원문:|저녁시간 처리:|근무 인정 사유:/.test(`${request.reason??""}\n${request.review_note??""}`);
  }
  function actualOvertimeLabel(actual:any){
    if(actual==null) return "퇴근기록 확인 전";
    return Number(actual)>0 ? `실제기록 기준 ${formatHourValue(actual)}시간` : "실제기록 기준 인정 전";
  }
  async function reviewCompRequest(request:any,status:string){
    const rejectionNote=status==="rejected"?rejectionNoteOrNull("추가근무 신청"):null;
    if(status==="rejected"&&rejectionNote===null) return;
    const usesActualCheckout=request.work_date>="2026-06-24";
    const relatedLog=compAttendance(request);
    const completedLog=relatedLog?.check_out_time?relatedLog:null;
    const scheduledEnd=expectedCompCheckout(request,relatedLog);
    const companyConfirmed=companyConfirmedComp(request);
    const result=usesActualCheckout&&completedLog&&!companyConfirmed
      ? await supabase.rpc("review_comp_time_attendance",{p_request_id:request.id,p_status:status,p_scheduled_end:kstHHMM(scheduledEnd),p_review_note:status==="approved"?"실제 퇴근시간 기준 승인":rejectionNote})
      : companyConfirmed
      ? await supabase.rpc("review_comp_time_request",{p_request_id:request.id,p_status:status,p_review_note:status==="approved"?"회사 확인 사유 기준 승인":rejectionNote})
      : await supabase.from("comp_time_requests").update({
          status,
          reviewed_by:currentEmployee.id,
          reviewed_at:new Date().toISOString(),
          review_note:status==="approved"?"퇴근 전 추가근무 사전 승인":rejectionNote,
        }).eq("id",request.id);
    if(result.error) setMessage(result.error.message);
    else{
      if(completedLog) setSettledCompIds(previous=>{
        const next=new Set(previous).add(request.id);
        localStorage.setItem("lupl_settled_comp_ids",JSON.stringify(Array.from(next)));
        return next;
      });
      setMessage(status==="approved"
        ? companyConfirmed?"회사 확인 사유 기준으로 추가근무가 승인되어 보상휴가로 적립되었습니다.":completedLog?"실제 초과근무가 승인되어 보상휴가로 적립되었습니다.":"추가근무를 사전 승인했습니다. 승인 종료시간까지 퇴근 기준이 연장됩니다."
        : companyConfirmed?"회사 확인 사유 기준 추가근무를 반려했습니다.":completedLog?"초과근무를 반려하고 예정 퇴근시간으로 근태를 마감했습니다.":"추가근무를 반려했습니다.");
      await load();
      onChanged();
    }
  }
  async function reviewWorkTimeRequest(id:string,status:string){const {error}=await supabase.rpc("review_work_time_change_request",{p_request_id:id,p_status:status,p_review_note:""});if(error)setMessage(error.message);else{setMessage(status==="approved"?"근무시간 변경 요청을 승인했습니다.":"근무시간 변경 요청을 반려했습니다.");await load();onChanged();}}
  async function reviewDevice(id:string,status:string){const {error}=await supabase.from("registered_devices").update({status}).eq("id",id);if(error)setMessage(error.message);else{await load();onChanged();}}
  async function confirmAttendanceLog(id:string){const {error}=await supabase.rpc("confirm_attendance_log",{p_log_id:id,p_status:"확인 완료"});if(error)setMessage(error.message);else{setMessage("근태 기록을 확인 완료 처리했습니다.");await load();onChanged();}}
  async function forceClockOut(id:string){if(!window.confirm("이 미퇴근 기록을 현재 시각 기준으로 마감할까요?")) return; const {error}=await supabase.rpc("close_attendance_log",{p_log_id:id,p_status:"관리자 강제퇴근",p_device_fingerprint_hash:null,p_device_info:{}});if(error)setMessage(error.message);else{setMessage("미퇴근 기록을 마감했습니다.");await load();onChanged();}}
  function hasPendingAttendanceCorrection(employeeId:string){
    return attendanceCorrectionRequests.some((request:any)=>request.employee_id===employeeId&&request.status==="pending");
  }
  function openAttendanceCorrection(employee:any, log:any|null) {
    if(hasPendingAttendanceCorrection(employee?.id)) {
      setMessage(`${employee?.name??"직원"}에게 이미 서명 대기 중인 출퇴근 기록 정정 요청이 있습니다.`);
      return;
    }
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
      const dayLog=allLogs.find((log:any)=>log.employee_id===draft.employee_id&&localDateStr(log.check_in_time)===workDate);
      return {
        ...draft,
        attendance_log_id:dayLog?.id??null,
        work_date:workDate,
        old_check_in_time:dayLog?.check_in_time??null,
        old_check_out_time:dayLog?.check_out_time??null,
        requested_check_in_time:dayLog?.check_in_time ? dateTimeLocalValue(dayLog.check_in_time) : defaultDateTimeLocal(workDate,schedule.work_start),
        requested_check_out_time:dayLog?.check_out_time ? dateTimeLocalValue(dayLog.check_out_time) : "",
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
  async function createAttendanceCorrectionRequestFromValues({
    employee,
    log,
    workDate,
    requestedInLocal,
    requestedOutLocal,
    reason,
    evidenceNote,
    successMessage,
  }:{employee:any;log:any|null;workDate:string;requestedInLocal?:string|null;requestedOutLocal?:string|null;reason:string;evidenceNote?:string|null;successMessage?:string}) {
    setMessage("");
    if(!employee?.id) return setApprovalCommandMsg("직원 정보를 찾지 못했습니다.");
    if(hasPendingAttendanceCorrection(employee.id)) return setApprovalCommandMsg(`${employee.name}님에게 이미 서명 대기 중인 출퇴근 기록 정정 요청이 있습니다.`);
    const requestedIn=dateTimeLocalToIso(requestedInLocal);
    const requestedOut=dateTimeLocalToIso(requestedOutLocal);
    const oldIn=log?.check_in_time??null;
    const oldOut=log?.check_out_time??null;
    const changedIn=!!requestedIn && (!oldIn || Math.abs(new Date(requestedIn).getTime()-new Date(oldIn).getTime())>59000);
    const changedOut=!!requestedOut && (!oldOut || Math.abs(new Date(requestedOut).getTime()-new Date(oldOut).getTime())>59000);
    if(!changedIn&&!changedOut) return setApprovalCommandMsg("정정할 출근 또는 퇴근 시각이 기존 기록과 같습니다.");
    if(!log?.id&&!requestedIn) return setApprovalCommandMsg("출근 기록이 없는 날은 정정 출근 시각도 필요합니다.");
    const effectiveIn=requestedIn||oldIn;
    const effectiveOut=requestedOut||oldOut;
    if(effectiveIn&&effectiveOut&&new Date(effectiveOut).getTime()<=new Date(effectiveIn).getTime()) return setApprovalCommandMsg("퇴근 시각은 출근 시각보다 늦어야 합니다.");
    const correction_type=changedIn&&changedOut?"both":changedIn?"check_in":"check_out";
    const row={
      employee_id:employee.id,
      attendance_log_id:log?.id??null,
      work_date:workDate,
      correction_type,
      old_check_in_time:oldIn,
      old_check_out_time:oldOut,
      requested_check_in_time:requestedIn,
      requested_check_out_time:requestedOut,
      reason:String(reason??"").trim()||"출퇴근 버튼 누락 또는 오입력 정정",
      evidence_note:String(evidenceNote??"").trim()||null,
      legal_notice_version:ATTENDANCE_CORRECTION_LEGAL_NOTICE_VERSION,
      requested_by:currentEmployee.id,
      status:"pending",
    };
    const {error}=await supabase.from("attendance_correction_requests").insert({
      ...row,
      document_text:attendanceCorrectionDocumentText(employee,row),
    });
    if(error) return setApprovalCommandMsg(friendlySignatureDbError(error));
    setApprovalCommand("");
    setApprovalCommandMsg(successMessage??`${employee.name}님에게 출퇴근 기록 정정 확인을 요청했습니다.`);
    await load();
    onChanged();
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
  const filtered=employees
    .filter(e=>employeeFilter==="all"?true:employeeFilter==="inactive"?e.employment_status!=="active":e.employment_status==="active")
    .sort(sortEmployeesBySeniority);
  const selectedCopyEmployees=filtered.filter((employee:any)=>selectedEmployeeCopyIds.includes(employee.id));
  function toggleEmployeeCopySelection(employeeId:string, checked:boolean) {
    setSelectedEmployeeCopyIds(current=>checked ? Array.from(new Set([...current,employeeId])) : current.filter(id=>id!==employeeId));
  }
  async function copySelectedEmployeeInfo() {
    if(selectedCopyEmployees.length===0) return setMessage("복사할 직원을 선택해주세요.");
    const text=[
      "이름\t부서\t직책\t사번\t휴대전화",
      ...selectedCopyEmployees.map((employee:any)=>[
        employee.name??"",
        employee.department??"",
        employee.position??"",
        employee.employee_no??"",
        employee.phone??"",
      ].join("\t")),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${selectedCopyEmployees.length}명 직원 정보를 복사했습니다.`);
    } catch {
      setMessage("자동 복사에 실패했습니다. 브라우저 권한을 확인해주세요.");
    }
  }
  function normalizeBulkHeader(header:string) {
    const key=header.replace(/\s/g,"").toLowerCase();
    if(/이름|성명|name/.test(key)) return "name";
    if(/부서|department|dept/.test(key)) return "department";
    if(/직책|직함|역할|position|title/.test(key)) return "position";
    if(/사번|employee.?no|id/.test(key)) return "employee_no";
    if(/휴대|전화|연락|phone|mobile/.test(key)) return "phone";
    return "";
  }
  function emptyBulkEmployeeRow(source:string,index:number) {
    return {name:"",department:"",position:"",employee_no:"",phone:"",joined_at:todayIso(),work_start_date:todayIso(),role:"employee",device_limit:3,no_annual_leave:false,is_unpaid:false,work_days:["mon","tue","wed","thu","fri"],source,index};
  }
  function finalizeBulkEmployeeRow(row:any) {
    const next={...row};
    next.name=String(next.name??"").trim();
    next.department=String(next.department??"").trim();
    next.position=String(next.position??"").trim();
    next.employee_no=String(next.employee_no??"").replace(/\D/g,"").slice(0,8);
    next.phone=formatPhone(String(next.phone??""));
    if(next.position==="인턴") {
      next.is_unpaid=true;
      next.no_annual_leave=true;
    }
    next.valid=!!next.name&&!!next.department&&!!next.position&&/^\d{8}$/.test(next.employee_no)&&String(next.phone??"").replace(/\D/g,"").length>=10;
    return next;
  }
  function bulkLineLabelValue(line:string) {
    const match=line.match(/^(이름|성명|부서|소속|직책|직함|역할|사번|휴대전화|휴대폰|전화번호|연락처|전화|name|department|dept|position|title|employee\s*no|id|phone|mobile)\s*[:：-]?\s*(.+)$/i);
    if(!match) return null;
    const key=normalizeBulkHeader(match[1]);
    const value=match[2].trim();
    return key&&value ? {[key]:key==="phone"?formatPhone(value):key==="employee_no"?value.replace(/\D/g,"").slice(0,8):value} : null;
  }
  function parseBulkEmployeeFreeformLine(line:string) {
    const labeled=bulkLineLabelValue(line);
    if(labeled) return labeled;
    const parts=line.split(/\t|,|\s+/).map(part=>part.trim()).filter(Boolean);
    const remaining=[...parts];
    const row:any={};
    const employeeNoIndex=remaining.findIndex(part=>/^\d{8}$/.test(part.replace(/\D/g,"")));
    if(employeeNoIndex>=0) row.employee_no=remaining.splice(employeeNoIndex,1)[0].replace(/\D/g,"").slice(0,8);
    const phoneIndex=remaining.findIndex(part=>{
      const digits=part.replace(/\D/g,"");
      return /^0\d{9,10}$/.test(digits);
    });
    if(phoneIndex>=0) row.phone=formatPhone(remaining.splice(phoneIndex,1)[0]);
    const positionIndex=remaining.findIndex(part=>POSITION_OPTIONS.filter(Boolean).includes(part)||/대표|본부장|책임|선임|매니저|인턴|담당자|팀장|실장|부장|차장|과장|대리|주임|사원/.test(part));
    if(positionIndex>=0) row.position=remaining.splice(positionIndex,1)[0];
    const departmentIndex=remaining.findIndex(part=>DEPARTMENT_OPTIONS.filter(Boolean).includes(part)||/부서$/.test(part));
    if(departmentIndex>=0) row.department=remaining.splice(departmentIndex,1)[0];
    if(remaining.length>0) row.name=remaining.join(" ");
    return row;
  }
  function bulkRowHasAny(row:any) {
    return !!(row?.name||row?.department||row?.position||row?.employee_no||row?.phone);
  }
  function bulkRowIsComplete(row:any) {
    return !!row?.name&&!!row?.department&&!!row?.position&&/^\d{8}$/.test(String(row.employee_no??""))&&String(row.phone??"").replace(/\D/g,"").length>=10;
  }
  function parseBulkEmployeeRows(text:string) {
    const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if(lines.length===0) return [];
    const splitLine=(line:string)=>line.split(/\t|,|\s+/).map(part=>part.trim()).filter(Boolean);
    const first=splitLine(lines[0]);
    const headerKeys=first.map(normalizeBulkHeader);
    const hasHeader=headerKeys.filter(Boolean).length>=2;
    const dataLines=hasHeader?lines.slice(1):lines;
    if(hasHeader) return dataLines.map((line,index)=>{
      const parts=splitLine(line);
      const row:any=emptyBulkEmployeeRow(line,index);
      parts.forEach((part,i)=>{const key=headerKeys[i]; if(key) row[key]=key==="phone"?formatPhone(part):key==="employee_no"?part.replace(/\D/g,"").slice(0,8):part;});
      return finalizeBulkEmployeeRow(row);
    });
    const rows:any[]=[];
    let current:any|null=null;
    dataLines.forEach((line,index)=>{
      const partial=parseBulkEmployeeFreeformLine(line);
      if(!bulkRowHasAny(partial)) return;
      if(bulkRowIsComplete(partial)) {
        if(current&&bulkRowHasAny(current)) rows.push(finalizeBulkEmployeeRow(current));
        rows.push(finalizeBulkEmployeeRow({...emptyBulkEmployeeRow(line,index),...partial}));
        current=null;
        return;
      }
      if(partial.name&&current&&bulkRowHasAny(current)&&bulkRowIsComplete(current)) {
        rows.push(finalizeBulkEmployeeRow(current));
        current=null;
      }
      current={...(current??emptyBulkEmployeeRow(line,index)),...partial,source:[current?.source,line].filter(Boolean).join("\n")};
    });
    if(current&&bulkRowHasAny(current)) rows.push(finalizeBulkEmployeeRow(current));
    return rows;
  }
  function changeBulkEmployeeText(text:string) {
    setBulkEmployeeText(text);
    setBulkEmployeeRows(parseBulkEmployeeRows(text));
  }
  async function createBulkEmployees() {
    const validRows=bulkEmployeeRows.filter(row=>row.valid);
    if(validRows.length===0) return setMessage("생성할 직원 정보를 붙여넣어 주세요. 이름, 부서, 직함/직책, 사번 8자리, 휴대전화가 모두 필요합니다.");
    setBulkCreating(true);
    const results:string[]=[];
    for(const row of validRows) {
      const duplicate=employees.find((employee:any)=>String(employee.employee_no??"").trim()===String(row.employee_no).trim());
      if(duplicate) { results.push(`${row.name}: 이미 등록된 사번`); continue; }
      const {data,error}=await supabase.functions.invoke("admin-create-employee",{body:row});
      if(error||data?.error) results.push(`${row.name}: ${error?.message??data?.error}`);
      else results.push(`${row.name}: 생성 완료`);
    }
    setBulkCreating(false);
    setMessage(results.join(" / "));
    setBulkEmployeeText("");
    setBulkEmployeeRows([]);
    await load();
    onChanged();
  }
  const activeEmployees=employees.filter(e=>isEmployeeActive(e)&&!isTestEmployee(e)).sort(sortEmployeesBySeniority);
  useEffect(()=>{
    if(activeEmployees.length===0) { if(selectedDetailEmployeeId) setSelectedDetailEmployeeId(""); return; }
    if(!selectedDetailEmployeeId || !activeEmployees.some((employee:any)=>employee.id===selectedDetailEmployeeId)) {
      setSelectedDetailEmployeeId(activeEmployees[0].id);
    }
  },[employees,selectedDetailEmployeeId]);
  const leaveUsageRows=requests
    .filter((request:any)=>requestTypeLabels[request.request_type])
    .filter((request:any)=>!isTestEmployee(empMap[request.employee_id])&&String(request.reason??"").trim().toLowerCase()!=="test")
    .filter((request:any)=>leaveUsageEmpId==="all"||request.employee_id===leaveUsageEmpId)
    .sort((a:any,b:any)=>sortEmployeesBySeniority(empMap[a.employee_id],empMap[b.employee_id])||String(b.created_at??"").localeCompare(String(a.created_at??"")));
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
      || (r.status==="approved"&&!!r.reviewed_at)
      || r.actual_overtime_hours !== null && r.actual_overtime_hours !== undefined
      || String(r.review_note??"").includes("실제 퇴근시간 기준");
  }
  const pC=compRequests.filter(r=>{
    if(actualCompSettled(r)) return false;
    if(r.status==="pending") return true;
    return r.status==="approved"&&r.work_date>="2026-06-24"&&!!compAttendance(r)?.check_out_time;
  });
  const pT=workTimeRequests.filter(r=>r.status==="pending");
  const pA=attendanceCorrectionRequests
    .filter(r=>["pending","objected"].includes(r.status))
    .sort((a:any,b:any)=>{
      const order:Record<string,number>={objected:0,pending:1,signed:2};
      return (order[a.status]??9)-(order[b.status]??9)||String(b.updated_at??b.signed_at??b.created_at??"").localeCompare(String(a.updated_at??a.signed_at??a.created_at??""));
    });
  const pAActionCount=pA.filter((r:any)=>r.status!=="signed").length;
  const pendingCorrectionLogIds=new Set(pA.filter((r:any)=>r.status==="pending"&&r.attendance_log_id).map((r:any)=>r.attendance_log_id));
  const pR=requests.filter(r=>r.status==="pending");
  const pD=devices.filter(d=>d.status==="pending");
  const reviewStatuses=["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음"];
  const pL=allLogs.filter((l:any)=>{
    if(l.status==="확인 완료") return false;
    if(pendingCorrectionLogIds.has(l.id)) return false;
    if(!l.check_out_time) return false;
    return reviewStatuses.includes(l.status);
  });
  const attendanceCorrectionCandidates=[
    ...allLogs
      .filter((log:any)=>log?.check_in_time&&!log.check_out_time&&!pendingCorrectionLogIds.has(log.id))
      .map((log:any)=>{
        const employee=empMap[log.employee_id];
        if(!employee) return null;
        const target=checkoutReminderTarget(log,employee,overrides,compRequests,approvedWorkTimeChanges,requests);
        const overdue=localDateStr(log.check_in_time)<todayIso() || (!!target&&Date.now()>target.getTime()+30*60000);
        if(!overdue) return null;
        return {
          key:`checkout-${log.id}`,
          employee,
          log,
          kind:"퇴근 미기록",
          workDate:localDateStr(log.check_in_time),
          detail:`출근 ${formatDateTime(log.check_in_time)} · 기준 퇴근 ${target?timeOnly(target.toISOString()):"-"}`,
        };
      })
      .filter(Boolean),
    ...activeEmployees
      .filter((employee:any)=>!todayLogByEmployee[employee.id]&&!hasPendingAttendanceCorrection(employee.id))
      .map((employee:any)=>{
        const workDate=todayIso();
        const schedule=getScheduleForDate(employee,workDate,overrides,approvedWorkTimeChanges);
        const workday=(schedule.work_days??[]).includes(dayKeyFromDate(dateFromIso(workDate)));
        const startAt=kstDateTime(workDate,schedule.work_start??employee.work_start??"09:00");
        if(!workday || Date.now()<startAt.getTime()+30*60000) return null;
        return {
          key:`checkin-${employee.id}-${workDate}`,
          employee,
          log:null,
          kind:"출근 미기록",
          workDate,
          detail:`예정 출근 ${String(schedule.work_start??employee.work_start??"09:00").slice(0,5)} · 예정 퇴근 ${String(schedule.work_end??employee.work_end??"18:00").slice(0,5)}`,
        };
      })
      .filter(Boolean),
  ];
  const attendanceCorrectionActionCount=pAActionCount+attendanceCorrectionCandidates.length;
  const approvalPendingTotal=pC.length+attendanceCorrectionActionCount+pR.length;
  const pendingTotal=approvalPendingTotal;
  const checkedInCount=dailyRows.filter(x=>x.log?.check_in_time).length;
  const checkedOutCount=dailyRows.filter(x=>x.log?.check_out_time).length;
  const openClockOutCount=dailyRows.filter(x=>x.log?.check_in_time&&!x.log?.check_out_time).length;
  const attentionTotal=attendanceCorrectionActionCount;
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
  const myApprovalRows=[
    ...requests.map((r:any)=>({key:`leave-${r.id}`,employeeId:r.employee_id,type:"휴가",employee:empName(r.employee_id),title:leaveTypeDisplayLabel(r),status:statusLabel(r.status),createdAt:r.created_at,detail:`${r.start_date}${r.end_date!==r.start_date?"~"+r.end_date:""}`})),
    ...compRequests.map((r:any)=>({key:`comp-${r.id}`,employeeId:r.employee_id,type:"추가근무",employee:empName(r.employee_id),title:`${r.work_date} ${String(r.start_time??"").slice(0,5)}~${String(r.end_time??"").slice(0,5)}`,status:statusLabel(r.status),createdAt:r.created_at,detail:`${formatHourValue(r.hours)}시간 · ${displayOvertimeReason(r.reason)}`})),
    ...attendanceCorrectionRequests.map((r:any)=>({key:`correction-${r.id}`,employeeId:r.employee_id,type:"출퇴근 정정",employee:empName(r.employee_id),title:`${r.work_date} · ${attendanceCorrectionTypeLabel(r.correction_type)}`,status:attendanceCorrectionStatusLabel(r.status),createdAt:r.created_at,detail:r.reason||"-"})),
  ].filter((row:any)=>row.employeeId===currentEmployee.id).sort((a:any,b:any)=>String(b.createdAt??"").localeCompare(String(a.createdAt??"")));
  const completedApprovalRows=[
    ...requests.filter((r:any)=>r.status!=="pending").map((r:any)=>({key:`leave-${r.id}`,type:"휴가",employee:empName(r.employee_id),title:leaveTypeDisplayLabel(r),status:statusLabel(r.status),createdAt:r.reviewed_at??r.created_at,detail:r.review_note||r.reason||"-"})),
    ...compRequests.filter((r:any)=>r.status!=="pending").map((r:any)=>({key:`comp-${r.id}`,type:"추가근무",employee:empName(r.employee_id),title:`${r.work_date} · ${formatHourValue(r.hours)}시간`,status:statusLabel(r.status),createdAt:r.reviewed_at??r.created_at,detail:r.review_note||displayOvertimeReason(r.reason)})),
    ...attendanceCorrectionRequests.filter((r:any)=>r.status!=="pending").map((r:any)=>({key:`correction-${r.id}`,type:"출퇴근 정정",employee:empName(r.employee_id),title:`${r.work_date} · ${attendanceCorrectionTypeLabel(r.correction_type)}`,status:attendanceCorrectionStatusLabel(r.status),createdAt:r.signed_at??r.updated_at??r.created_at,detail:r.reason||"-"})),
  ].sort((a:any,b:any)=>String(b.createdAt??"").localeCompare(String(a.createdAt??"")));
  function renderApprovalRow(row:any) {
    return <div className="approval-history-row" key={row.key}><span>{row.type}</span><b>{row.employee} · {row.title}</b><small>{row.detail}</small><em>{row.status} · {formatDateTime(row.createdAt)}</em></div>;
  }
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
  const baseRnrDepartments=DEPARTMENT_OPTIONS.filter(Boolean);
  const rnrDepartmentNames=Array.from(new Set([
    ...baseRnrDepartments,
    ...activeEmployees.map((employee:any)=>normalizeDepartmentName(employee.department)).filter(Boolean),
    ...rnrEntries.map((entry:any)=>rnrPublicDepartment(entry)).filter(Boolean),
    ...(rnrEntries.some((entry:any)=>!String(entry.department??"").trim())||activeEmployees.some((employee:any)=>!String(employee.department??"").trim())?["공통"]:[]),
  ])).sort((a:string,b:string)=>{
    const ai=baseRnrDepartments.indexOf(a);
    const bi=baseRnrDepartments.indexOf(b);
    if(ai>=0&&bi>=0) return ai-bi;
    if(ai>=0) return -1;
    if(bi>=0) return 1;
    if(a==="공통") return 1;
    if(b==="공통") return -1;
    return a.localeCompare(b);
  });
  const rnrDepartmentCards=rnrDepartmentNames.map((department:string)=>{
    const members=activeEmployees
      .filter((employee:any)=>employeeDepartmentLabel(employee)===department)
      .sort((a:any,b:any)=>String(a.name??"").localeCompare(String(b.name??"")));
    const entries=rnrEntries.filter((entry:any)=>rnrPublicDepartment(entry)===department);
    const workGroups=Array.from(entries.reduce((map:Map<string,any>,entry:any)=>{
      const category=rnrWorkGroup(entry);
      const key=`${department}|${category}`;
      if(!map.has(key)) map.set(key,{key,category,entries:[]});
      map.get(key).entries.push(entry);
      return map;
    },new Map<string,any>()).values()).sort((a:any,b:any)=>String(a.category).localeCompare(String(b.category)));
    return {department,members,entries,workGroups};
  });
  const visibleRnrDepartmentCards=rnrDepartmentFilter==="all"
    ? rnrDepartmentCards
    : rnrDepartmentCards.filter((card:any)=>card.department===rnrDepartmentFilter);
  const selectedDetailEmployee=activeEmployees.find((employee:any)=>employee.id===selectedDetailEmployeeId)??activeEmployees[0]??null;
  const selectedBreakStart=selectedDetailEmployee?.break_start??"12:00";
  const selectedBreakEnd=selectedDetailEmployee?.break_end??"13:00";
  const selectedDailyHours=selectedDetailEmployee?netDailyHours(selectedDetailEmployee.work_start??"09:00",selectedDetailEmployee.work_end??"18:00",selectedBreakStart,selectedBreakEnd):0;
  const selectedWeeklyHours=selectedDetailEmployee?Math.round(selectedDailyHours*(selectedDetailEmployee.work_days??["mon","tue","wed","thu","fri"]).length*10)/10:0;
  const selectedMonthStats=selectedDetailEmployee?payrollScheduledWorkStats(selectedDetailEmployee,payrollMonth.start,payrollMonth.end,overrides,approvedWorkTimeChanges,[]):null;
  function toggleDay(arr:string[],day:string){return arr.includes(day)?arr.filter(d=>d!==day):[...arr,day];}
  async function updateEmployeeContract(emp:any, patch:Record<string,any>) {
    const next={...emp,...patch};
    const derived:any={};
    if("work_days" in patch || "work_start" in patch || "work_end" in patch) {
      const dailyHours=netDailyHours(next.work_start??"09:00",next.work_end??"18:00",next.break_start??"12:00",next.break_end??"13:00");
      const weeklyDays=(next.work_days??[]).length;
      derived.weekly_work_days=weeklyDays;
      derived.daily_work_hours=dailyHours;
      derived.monthly_standard_hours=monthlyPaidHours(weeklyDays,dailyHours);
    }
    await updateEmployee(emp.id,{...patch,...derived});
  }
  function approvalCommandTargetEmployee(text:string){
    const compact=text.replace(/\s/g,"");
    return [...activeEmployees]
      .sort((a,b)=>String(b.name??"").length-String(a.name??"").length)
      .find(employee=>compact.includes(String(employee.name??"").replace(/\s/g,""))||compact.includes(String(employee.employee_no??"").replace(/\s/g,"")));
  }
  async function applyApprovalOvertimeCommand(raw:string, employee:any, dateRange:any){
    const parsedTime=parsePromptTimeRanges(raw)[0]??parsePromptTimeRange(raw);
    const durationMinutes=parseDurationMinutes(raw)??(parsedTime?timeSpanMinutes(parsedTime.start,parsedTime.end):null);
    if(!durationMinutes) return setApprovalCommandMsg("추가근무 시간을 찾지 못했습니다. 예: 이희은 7월 14일 추가근무 3시간");
    if(dateRange.start_date!==dateRange.end_date) return setApprovalCommandMsg("추가근무 한 줄 처리는 하루 단위로 입력해주세요.");
    const workDate=dateRange.start_date;
    const log=allLogs.find((row:any)=>row.employee_id===employee.id&&localDateStr(row.check_in_time)===workDate);
    const schedule=getScheduleForDate(employee,workDate,overrides,approvedWorkTimeChanges);
    const leaveRows=requests.filter((row:any)=>row.employee_id===employee.id);
    const baseline=expectedWorkEndForDate(workDate,schedule,leaveRows,log?.check_in_time?new Date(log.check_in_time):null).expectedEnd;
    const baselineHHMM=kstHHMM(baseline);
    const durationText=`${formatHourValue(durationMinutes/60)}시간`;
    const defaultDinnerAsWork=/외부|미팅|거래처|식사|저녁\s*근무|저녁.*인정/.test(raw);
    const choice=window.prompt([
      `${employee.name}님의 ${workDate} 기준 퇴근시간은 ${baselineHHMM}입니다.`,
      parsedTime
        ? `신청 시간 ${parsedTime.start}~${parsedTime.end} · ${durationText}을(를) 승인 대기함에 추가합니다.`
        : `이후 추가근무 ${durationText}을(를) 더해 처리합니다.`,
      "",
      "1 = 저녁시간 휴게 제외(기본, 일반 야근)",
      "2 = 외부 미팅/업무상 식사로 저녁시간 근무 인정",
      "",
      "실제 출퇴근 기록 또는 회사 확인 사유를 기준으로 승인됩니다."
    ].join("\n"),defaultDinnerAsWork?"2":"1");
    if(choice==null) return;
    const dinnerAsWork=String(choice).trim().startsWith("2");
    const defaultReason=cleanOvertimeReasonText(compactOvertimeReason(raw,employee,dateRange))||(dinnerAsWork?"외부 미팅":"추가근무");
    const reasonInput=window.prompt(
      dinnerAsWork
        ? "추가근무 신청 사유를 입력해주세요.\n외부 미팅/업무상 식사를 근무시간으로 인정하는 경우, 회사가 확인 가능한 사유로 남겨주세요."
        : "추가근무 신청 사유를 입력해주세요.",
      defaultReason
    );
    const reason=cleanOvertimeReasonText(reasonInput);
    if(!reason) return setApprovalCommandMsg("추가근무 신청 사유가 필요합니다.");
    const expectedEnd=addOvertimeMinutes(baseline,durationMinutes,!dinnerAsWork);
    const startHHMM=parsedTime?.start??baselineHHMM;
    const endHHMM=parsedTime?.end??kstHHMM(expectedEnd);
    const preview=[
      `${employee.name}님의 ${workDate} 추가근무 신청을 승인 대기 목록에 추가합니다.`,
      `기준 퇴근시간: ${baselineHHMM}`,
      parsedTime
        ? `신청 시간: ${startHHMM}~${endHHMM} · ${durationText}`
        : dinnerAsWork
        ? `외부 미팅 식사를 근무시간으로 인정하여 ${endHHMM}까지 ${durationText} 처리`
        : `저녁 휴게시간을 제외하여 ${endHHMM}까지 ${durationText} 처리`,
      `신청 사유: ${reason}`,
      "",
      "최종 적립은 승인함에서 실제 퇴근기록 또는 회사 확인 사유를 기준으로 처리됩니다.",
      "이대로 추가할까요?"
    ].join("\n");
    if(!window.confirm(preview)) return;
    const duplicate=compRequests.find((request:any)=>request.employee_id===employee.id&&request.work_date===workDate&&["pending","approved"].includes(request.status)&&String(request.start_time??"").slice(0,5)===startHHMM&&String(request.end_time??"").slice(0,5)===endHHMM);
    if(duplicate) return setApprovalCommandMsg("이미 같은 날짜와 시간의 추가근무 신청이 있습니다.");
    const {error}=await supabase.from("comp_time_requests").insert({
      employee_id:employee.id,
      work_date:workDate,
      start_time:startHHMM,
      end_time:endHHMM,
      hours:Number((durationMinutes/60).toFixed(4)),
      converted_days:Number((durationMinutes/60/8).toFixed(4)),
      reason,
      status:"pending",
      review_note:"관리자 한 줄 입력 · 회사 확인 사유 기준 승인 대기",
    });
    if(error) return setApprovalCommandMsg(`추가근무 신청 저장 실패: ${error.message}`);
    setApprovalCommand("");
    setApprovalCommandMsg(`${employee.name} ${workDate} 추가근무 ${durationText}을 승인 대기 목록에 추가했습니다.`);
    await load();
    onChanged();
  }
  function looksLikeAttendanceCorrectionCommand(raw:string) {
    if(looksLikeOvertimeCommand(raw)) return false;
    const hasTime=!!parsePromptSingleTime(raw)||!!parsePromptTimeRange(raw);
    if(!hasTime) return false;
    if(/퇴근|종료|마감/.test(raw)) return true;
    return /출근/.test(raw)&&/기록|정정|누락|못|안|찍|처리/.test(raw);
  }
  async function applyAttendanceCorrectionCommand(raw:string, employee:any, dateRange:any) {
    if(dateRange.start_date!==dateRange.end_date) return setApprovalCommandMsg("출퇴근 기록 정정은 하루 단위로 입력해주세요.");
    const workDate=dateRange.start_date;
    const parsedRange=parsePromptTimeRange(raw);
    const singleTime=parsedRange?null:parsePromptSingleTime(raw);
    const log=allLogs.find((row:any)=>row.employee_id===employee.id&&localDateStr(row.check_in_time)===workDate)??null;
    const schedule=getScheduleForDate(employee,workDate,overrides,approvedWorkTimeChanges);
    const isCheckout=/퇴근|종료|마감/.test(raw);
    const isCheckin=/출근/.test(raw)&&!isCheckout;
    let requestedInLocal:string|null=null;
    let requestedOutLocal:string|null=null;
    if(parsedRange){
      requestedInLocal=defaultDateTimeLocal(workDate,parsedRange.start);
      requestedOutLocal=defaultDateTimeLocal(workDate,parsedRange.end);
    } else if(singleTime&&isCheckout) {
      requestedOutLocal=defaultDateTimeLocal(workDate,singleTime);
    } else if(singleTime&&isCheckin) {
      requestedInLocal=defaultDateTimeLocal(workDate,singleTime);
    } else if(isCheckout) {
      requestedOutLocal=log?.check_out_time ? dateTimeLocalValue(log.check_out_time) : defaultDateTimeLocal(workDate,schedule.work_end??employee.work_end??"18:00");
    } else {
      requestedInLocal=log?.check_in_time ? dateTimeLocalValue(log.check_in_time) : defaultDateTimeLocal(workDate,schedule.work_start??employee.work_start??"09:00");
    }
    const correctionLabel=parsedRange?"출퇴근":isCheckout?"퇴근":"출근";
    const preview=[
      `${employee.name}님의 ${workDate} ${correctionLabel} 기록 정정 요청을 만듭니다.`,
      `기존 출근: ${formatDateTime(log?.check_in_time)}`,
      `기존 퇴근: ${formatDateTime(log?.check_out_time)}`,
      `정정 출근: ${requestedInLocal?formatDateTime(dateTimeLocalToIso(requestedInLocal)):"변경 없음"}`,
      `정정 퇴근: ${requestedOutLocal?formatDateTime(dateTimeLocalToIso(requestedOutLocal)):"변경 없음"}`,
      "",
      "직원이 서명하면 기록에 반영됩니다. 이대로 요청할까요?"
    ].join("\n");
    if(!window.confirm(preview)) return;
    await createAttendanceCorrectionRequestFromValues({
      employee,
      log,
      workDate,
      requestedInLocal,
      requestedOutLocal,
      reason:"출퇴근 버튼 누락 또는 오입력 정정",
      evidenceNote:"관리자 한 줄 입력",
      successMessage:`${employee.name} ${workDate} ${correctionLabel} 기록 정정 서명 요청을 만들었습니다.`,
    });
  }
  async function applyApprovalScheduleCommand(){
    const raw=approvalCommand.trim();
    if(!raw) return setApprovalCommandMsg("한 줄로 입력해주세요. 예: 이희은 7월 14일 추가근무 3시간");
    const employee=approvalCommandTargetEmployee(raw);
    if(!employee) return setApprovalCommandMsg("직원 이름 또는 사번을 찾지 못했습니다.");
    const noWork=/출근\s*(?:안|못|불가)|근무\s*(?:안|못|불가)|일\s*(?:안|못)|안\s*함|못\s*(?:나오|나|함)|휴무|쉬는|쉼/.test(raw);
    const openEndedDateRange=noWork?parseOpenEndedDateRange(raw,0):null;
    const dateRange=openEndedDateRange??parseKoreanDateRange(raw,0);
    if(!dateRange) return setApprovalCommandMsg("적용할 날짜를 함께 적어주세요. 예: 이희은 7월 14일 추가근무 3시간");
    if(looksLikeOvertimeCommand(raw)) return applyApprovalOvertimeCommand(raw,employee,dateRange);
    if(looksLikeAttendanceCorrectionCommand(raw)) return applyAttendanceCorrectionCommand(raw,employee,dateRange);
    const parsedTime=parsePromptTimeRanges(raw)[0]??parsePromptTimeRange(raw);
    const singleTime=parsedTime?null:parsePromptSingleTime(raw);
    const schedule=getScheduleForDate(employee,dateRange.start_date,overrides,approvedWorkTimeChanges);
    let nextStart=String(schedule.work_start??employee.work_start??"09:00").slice(0,5);
    let nextEnd=String(schedule.work_end??employee.work_end??"18:00").slice(0,5);
    if(parsedTime){ nextStart=parsedTime.start; nextEnd=parsedTime.end; }
    else if(singleTime){ /퇴근|종료|마감|끝/.test(raw) ? nextEnd=singleTime : nextStart=singleTime; }
    const startMin=timeToMinutes(nextStart);
    const endMin=timeToMinutes(nextEnd);
    if(!noWork&&startMin!=null&&endMin!=null&&endMin<=startMin) nextEnd=minutesToTime(startMin+8*60);
    const periodLabel=dateRange.start_date===dateRange.end_date?dateRange.start_date:periodRangeLabel(dateRange);
    const preview=[
      `${employee.name} 직원의 ${periodLabel} 일정 예외를 저장합니다.`,
      noWork ? "변경: 출근 안 함" : `변경: ${timeLabel(nextStart)}~${timeLabel(nextEnd)} 근무`,
      "",
      "기본 주간 근무조건은 바꾸지 않습니다.",
      "이대로 반영할까요?"
    ].join("\n");
    if(!window.confirm(preview)) return;
    const {data:existingRows,error:findError}=await supabase
      .from("employee_schedule_events")
      .select("*")
      .eq("employee_id",employee.id)
      .eq("start_date",dateRange.start_date)
      .eq("end_date",dateRange.end_date);
    if(findError) return setApprovalCommandMsg(`일정 확인 실패: ${findError.message}`);
    const payload={
      employee_id:employee.id,
      title:noWork?"출근 안 함":"시간 변경 근무",
      event_type:noWork?"unavailable":"work",
      start_date:dateRange.start_date,
      end_date:dateRange.end_date,
      start_time:noWork?"09:00":nextStart,
      end_time:noWork?"19:00":nextEnd,
      note:null,
      updated_at:new Date().toISOString(),
    };
    const existing=(existingRows??[]).find((event:any)=>["hidden","unavailable","work","am_only","pm_only"].includes(event.event_type));
    const result=existing?.id
      ? await supabase.from("employee_schedule_events").update(payload).eq("id",existing.id)
      : await supabase.from("employee_schedule_events").insert({...payload,created_by:currentEmployee.id});
    if(result.error) return setApprovalCommandMsg(`일정 변경 실패: ${result.error.message}`);
    setApprovalCommand("");
    setApprovalCommandMsg(`${employee.name} ${periodLabel} 일정 예외를 저장했습니다.`);
    await load();
    onChanged();
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
            <p>오늘 출근 상태, 미퇴근 기록, 승인 대기, 예외 확인만 먼저 보고 아래 상세에서 바로 처리합니다.</p>
          </div>
        </div>
        <div className="admin-command-metrics">
          <div><span>출근</span><b>{checkedInCount}/{activeEmployees.length}</b><small>오늘 출근 기록</small></div>
          <div><span>퇴근 미완료</span><b>{openClockOutCount}</b><small>미퇴근 기록 확인 대상</small></div>
          <div><span>승인 대기</span><b>{pendingTotal}</b><small>휴가·추가근무·출퇴근 정정</small></div>
          <div><span>근태 확인</span><b>{attentionTotal}</b><small>누락·정정 서명 대상</small></div>
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
                const correctionPending=hasPendingAttendanceCorrection(e.id);
                return (
                <tr key={e.id}>
                  <td><b>{e.name}</b><br /><span className="subtle">{e.employee_no}</span></td>
                  <td>{log?.workplaces?.name ?? "-"}</td>
                  <td>{log ? formatDateTime(log.check_in_time) : "-"}</td>
                  <td>{log?.check_out_time ? formatDateTime(log.check_out_time) : "-"}</td>
                  <td><div className="status-badges"><span className={`badge ${display.primaryClass}`}>{display.primary}</span>{display.workType&&<span className="badge work-type">{display.workType}</span>}</div>{display.primary.includes("지각")&&<span className="late-detail">{display.lateMinutes}분 지각 · 기준 {String(display.scheduleStart).slice(0,5)}</span>}</td>
                  <td><div className="actions">{log&&!log.check_out_time&&<button className="button danger compact" onClick={()=>forceClockOut(log.id)}>기록 마감</button>}<button className="button secondary compact" disabled={correctionPending} title={correctionPending?"이미 서명 대기 중인 기록 정정 요청이 있습니다.":undefined} onClick={()=>openAttendanceCorrection(e,log)}>{correctionPending?"정정 요청중":log?"기록 정정":"출근 정정"}</button></div></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>}

      {showsApprovals&&<section className="card approval-tabs-card">
        <div className="tabs approval-tabs">
          <button className={`tab ${approvalTab==="received"?"active":""}`} onClick={()=>setApprovalTab("received")}>받은 승인 {approvalPendingTotal>0&&<span>{approvalPendingTotal}</span>}</button>
          <button className={`tab ${approvalTab==="mine"?"active":""}`} onClick={()=>setApprovalTab("mine")}>내가 올린 요청 {myApprovalRows.length>0&&<span>{myApprovalRows.length}</span>}</button>
          <button className={`tab ${approvalTab==="history"?"active":""}`} onClick={()=>setApprovalTab("history")}>완료 이력 {completedApprovalRows.length>0&&<span>{completedApprovalRows.length}</span>}</button>
        </div>
        {approvalTab==="mine"&&<div className="approval-history-list">{myApprovalRows.slice(0,30).map(renderApprovalRow)}{myApprovalRows.length===0&&<p className="subtle">내가 올린 요청이 없습니다.</p>}</div>}
        {approvalTab==="history"&&<div className="approval-history-list">{completedApprovalRows.slice(0,50).map(renderApprovalRow)}{completedApprovalRows.length===0&&<p className="subtle">완료 이력이 없습니다.</p>}</div>}
      </section>}

      {showsApprovals&&approvalTab==="received"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-sparkles" aria-hidden="true"></i>승인함 한 줄 입력</h2>
        <div className="schedule-command-bar approval-command-bar">
          <input className="input" value={approvalCommand} onChange={e=>setApprovalCommand(e.target.value)} onKeyDown={e=>e.key==="Enter"&&applyApprovalScheduleCommand()} placeholder="예: 홍준기 7월 20일 오후 10시 퇴근 / 이희은 7월 14일 추가근무 3시간" />
          <button className="button secondary compact" onClick={applyApprovalScheduleCommand}>처리</button>
        </div>
        <p className="subtle schedule-command-help">퇴근·출근 누락 문장은 직원 서명 대기 정정 요청으로 남기고, 추가근무는 승인 대기 신청으로 저장합니다. 일정 변경 문장은 캘린더 예외로 저장합니다.</p>
        {approvalCommandMsg&&<div className={`alert ${approvalCommandMsg.includes("실패")||approvalCommandMsg.includes("찾지")||approvalCommandMsg.includes("적용")?"error":"success"}`} style={{marginTop:12}}>{approvalCommandMsg}</div>}
      </section>}

      {showsApprovals&&approvalTab==="received"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-inbox" aria-hidden="true"></i>승인 대기{pendingTotal>0&&<span className="count-badge">{pendingTotal}</span>}</h2>
        <div className="grid two approval-glass-grid">
          <div>
            <h3 className="approval-section-title">추가근무 {pC.length>0&&<span className="count-badge">{pC.length}</span>}</h3>
            {pC.length===0&&<p className="subtle">없음</p>}
            {pC.map(r=>{
              const log=compAttendance(r);
              const actual=estimatedOvertime(r);
              const usesActualCheckout=r.work_date>="2026-06-24";
              const companyConfirmed=companyConfirmedComp(r);
              const requestHoursText=`${formatHourValue(r.hours)}시간`;
              return <div className="list-row" key={r.id}>
                <div>
                  <b>{empName(r.employee_id)}</b>
                  <div className="subtle">{r.work_date} · 신청 {r.start_time?.slice(0,5)}~{r.end_time?.slice(0,5)} · {requestHoursText}</div>
                  <div className="type-desc" style={{marginTop:6}}>신청 사유: {displayOvertimeReason(r.reason)}</div>
                  {usesActualCheckout&&<div className="type-desc" style={{marginTop:6}}>예정 퇴근 {log?timeOnly(expectedCompCheckout(r,log)):String(compSchedule(r).work_end??"18:00").slice(0,5)} · 실제 퇴근 {log?.check_out_time?timeOnly(log.check_out_time):"아직 퇴근 전"} · {companyConfirmed?`회사 확인 기준 ${requestHoursText} · ${actualOvertimeLabel(actual)}`:`인정 확인 ${actualOvertimeLabel(actual)}`}</div>}
                </div>
                <div className="actions">
                  <button className="button secondary" onClick={()=>reviewCompRequest(r,"approved")}>{companyConfirmed?"회사확인 승인":log?.check_out_time?"실제시간 정산":"초과근무 승인"}</button>
                  <button className="button danger" onClick={()=>reviewCompRequest(r,"rejected")}>반려</button>
                </div>
              </div>;
            })}
          </div>
          <div>
            <h3 className="approval-section-title">출퇴근 기록 정정 {attendanceCorrectionActionCount>0&&<span className="count-badge">{attendanceCorrectionActionCount}</span>}</h3>
            {attendanceCorrectionCandidates.length===0&&pA.length===0&&<p className="subtle">없음</p>}
            {attendanceCorrectionCandidates.length>0&&<div className="correction-candidate-stack">
              <div className="approval-subhead"><b>정정 필요 직원</b><span>출근 또는 퇴근 기록이 비어있는 직원입니다.</span></div>
              {attendanceCorrectionCandidates.map((candidate:any)=>(
                <div className="list-row correction-candidate-row" key={candidate.key} style={{flexDirection:"column",alignItems:"stretch"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                    <div><b>{candidate.employee.name}</b><div className="subtle">{candidate.workDate} · {candidate.kind}</div></div>
                    <span className="badge warn">{candidate.kind}</span>
                  </div>
                  <div className="type-desc" style={{marginTop:8}}>{candidate.detail}</div>
                  <div className="actions">
                    <button className="button secondary compact" onClick={()=>openAttendanceCorrection(candidate.employee,candidate.log)}>직원 서명 요청</button>
                  </div>
                </div>
              ))}
            </div>}
            {pA.length>0&&<div className="correction-record-stack">
              <div className="approval-subhead"><b>관련 서명 기록</b><span>직원 서명 대기, 이의제기, 완료 기록입니다.</span></div>
            {pA.map((r:any)=>{
              const signed=r.status==="signed";
              const objected=r.status==="objected";
              return (
                <div className="list-row" key={r.id} style={{flexDirection:"column",alignItems:"stretch"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                    <div><b>{empName(r.employee_id)}</b><div className="subtle">{r.work_date} · {attendanceCorrectionTypeLabel(r.correction_type)} · {signed?"서명 완료 · 기록 반영 완료":objected?"직원 이의제기":"직원 서명 대기"}</div></div>
                    <span className={`badge ${signed?"good":objected?"bad":"warn"}`}>{attendanceCorrectionStatusLabel(r.status)}</span>
                  </div>
                  <div className="type-desc" style={{marginTop:8}}>{attendanceCorrectionTimeLine(r)}<br/>사유 {r.reason||"-"}</div>
                  {r.status==="pending"&&<div className="actions"><button className="button danger" onClick={()=>cancelAttendanceCorrection(r.id)}>요청 취소</button></div>}
                </div>
              );
            })}
            </div>}
          </div>
          <div>
            <h3 className="approval-section-title">휴가 신청 {pR.length>0&&<span className="count-badge">{pR.length}</span>}</h3>
            {pR.length===0&&<p className="subtle">없음</p>}
            {pR.map(r=>(<div className="list-row" key={r.id}><div><b>{empName(r.employee_id)}</b><div className="subtle">{leaveTypeDisplayLabel(r)} · {r.start_date}{r.end_date!==r.start_date?"~"+r.end_date:""}{r.start_time?` ${r.start_time.slice(0,5)}~${r.end_time?.slice(0,5)}`:""}</div></div><div className="actions"><button className="button secondary" onClick={()=>reviewRequest(r.id,"approved")}>승인</button><button className="button danger" onClick={()=>reviewRequest(r.id,"rejected")}>반려</button></div></div>))}
          </div>
        </div>
      </section>}

      {view==="approvals"&&<section className="card rejected-archive-card">
        <div className="section-head">
          <div>
            <h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-archive" aria-hidden="true"></i>반려 기록 정리{rejectedArchiveRows.length>0&&<span className="count-badge">{rejectedArchiveRows.length}</span>}</h2>
            <p className="subtle">근태 이력은 보존하고, 확인 끝난 반려 항목만 관리자 화면에서 숨깁니다.</p>
          </div>
          <div className="actions">
            {hiddenRejectedIds.length>0&&<button className="button ghost compact" onClick={restoreRejectedArchiveRows}>숨김 초기화</button>}
            <button className="button ghost compact" onClick={()=>setShowRejectedArchive(v=>!v)}>{showRejectedArchive?"접기":"보기"}</button>
          </div>
        </div>
        {showRejectedArchive&&<div className="rejected-archive-list">
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
        </div>}
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
        <p className="subtle" style={{marginBottom:12}}>반차·연차는 연차 차감으로, 보상휴가 시간 사용은 추가근무 적립분 차감으로 구분해서 표시합니다.</p>
        <div className="comp-employee-filter leave-usage-filter">
          <button className={leaveUsageEmpId==="all"?"active":""} onClick={()=>setLeaveUsageEmpId("all")}>
            <b>전체</b>
            <span>직원별 소진 내역 전체 보기</span>
          </button>
          {activeEmployees.map((employee:any)=>{
            const lv=leaveForEmployee(employee.id);
            return <button key={employee.id} className={leaveUsageEmpId===employee.id?"active":""} onClick={()=>setLeaveUsageEmpId(employee.id)}>
              <b>{employee.name}</b>
              <span>{employee.no_annual_leave?"연차 없음":`연차 사용 ${lv?.used.toFixed(1)??"0.0"}일`} · 보상휴가 사용 {formatHourValue(lv?.compUsedH||0)}시간</span>
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
            <thead><tr><th>직원</th><th>총 부여</th><th>사용</th><th>잔여</th><th>보상휴가</th><th>관리</th></tr></thead>
            <tbody>
              {employees.filter(isEmployeeActive).map(e=>{
                const lv=leaveForEmployee(e.id); if(!lv) return null;
                return (<tr key={e.id}><td><b>{e.name}</b><br /><span className="subtle">{e.employee_no}</span>{e.no_annual_leave&&<><br/><span className="badge warn">연차 없음</span></>}</td><td>{lv.total.toFixed(1)}일</td><td>{lv.used.toFixed(1)}일</td><td><b style={{color:lv.remain<3?"var(--red)":"inherit"}}>{lv.remain.toFixed(1)}일</b></td><td>{formatHourValue(lv.compRemainH)}시간</td><td><button className="button secondary" onClick={()=>setLeaveModalEmp(e)}>연차 관리</button></td></tr>);
              })}
            </tbody>
          </table>
        </div>
      </section>}

      {view==="rnr"&&<section className="card rnr-card">
        <h2 className="card-title"><i className="ti ti-sitemap" aria-hidden="true"></i>업무 R&R 정리</h2>
        <p className="subtle" style={{marginBottom:12}}>업무를 편하게 적으면 부서/직책/업무명으로 정리해서 누적합니다. 다음 직원이 같은 역할을 맡을 때 기준 업무로 볼 수 있습니다.</p>
        {rnrMsg&&<div className={`alert ${rnrMsg.includes("저장")?"success":""}`}>{rnrMsg}</div>}
        <div className="rnr-review-panel">
          <div className="rnr-section-title rnr-panel-title">
            <b>직원 제출 검토 {pendingRnrReviewRequests.length>0&&<span className="count-badge">{pendingRnrReviewRequests.length}</span>}</b>
            <span>직원이 올린 업무 제안을 승인하면 공개 업무분장표에 반영됩니다.</span>
          </div>
          {pendingRnrReviewRequests.length===0 ? (
            <p className="rnr-empty-work">검토 대기 중인 직원 업무 제안이 없습니다.</p>
          ) : (
            <div className="rnr-review-list">
              {pendingRnrReviewRequests.map((row:any)=>{
                const requester=rnrReviewRequester(row);
                const suggestion=rnrSuggestionFromReview(row);
                return <div className="rnr-review-row" key={row.id}>
                  <div>
                    <span>{requester?.name??"직원"} · {normalizeDepartmentName(requester?.department)||suggestion.department||"부서 미정"} · {formatDateTime(row.created_at)}</span>
                    <b>{suggestion.display_title||row.title}</b>
                    <p>{row.summary}</p>
                    <small>{suggestion.work_group||"업무 묶음 미정"} · {suggestion.position||requester?.position||"직책 미정"}</small>
                  </div>
                  <div className="actions rnr-review-actions">
                    <button className="button compact" onClick={()=>approveRnrReview(row)}><i className="ti ti-check" aria-hidden="true"></i>승인</button>
                    <button className="button danger ghost compact" onClick={()=>rejectRnrReview(row)}><i className="ti ti-x" aria-hidden="true"></i>반려</button>
                  </div>
                </div>;
              })}
            </div>
          )}
        </div>
        <div className="rnr-today-panel">
          <div className="rnr-section-title rnr-panel-title">
            <b>오늘의 할일 모음</b>
            <span>R&R에서 오늘의 할일로 올린 항목만 모아봅니다.</span>
          </div>
          {rnrTodayTaskRows.length===0 ? (
            <p className="rnr-empty-work">아직 R&R에서 올린 오늘의 할일이 없습니다. 부서별 업무의 <i className="ti ti-clipboard-plus" aria-hidden="true"></i> 버튼으로 보낼 수 있습니다.</p>
          ) : (
            <div className="rnr-today-list">
              {rnrTodayTaskRows.map((task:any)=>editingRnrTask?.id===task.id ? (
                <div className="rnr-today-edit" key={task.id}>
                  <div className="grid four">
                    <div className="form-row"><label className="label">날짜</label><input className="input" type="date" value={editingRnrTask.task_date} onChange={e=>setEditingRnrTask({...editingRnrTask,task_date:e.target.value})} /></div>
                    <div className="form-row"><label className="label">기한</label><input className="input" type="date" value={editingRnrTask.due_date??""} onChange={e=>setEditingRnrTask({...editingRnrTask,due_date:e.target.value})} /></div>
                    <div className="form-row"><label className="label">대상</label><select className="select" value={editingRnrTask.target_employee_id??""} onChange={e=>setEditingRnrTask({...editingRnrTask,target_employee_id:e.target.value})}><option value="">전체 직원</option>{employees.filter(isEmployeeActive).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
                    <div className="form-row"><label className="label">제목</label><input className="input" value={editingRnrTask.title??""} onChange={e=>setEditingRnrTask({...editingRnrTask,title:e.target.value})} /></div>
                  </div>
                  <div className="form-row"><label className="label">내용</label><textarea className="textarea compact-textarea" value={editingRnrTask.content??""} onChange={e=>setEditingRnrTask({...editingRnrTask,content:e.target.value})} /></div>
                  <div className="actions rnr-today-actions"><button className="button ghost compact" onClick={()=>setEditingRnrTask(null)}>취소</button><button className="button compact" onClick={saveEditedRnrTask}>수정 저장</button></div>
                </div>
              ) : (
                <div className="rnr-today-row" key={task.id}>
                  <div>
                    <span>{task.task_date} · {dailyTaskTargetLabel(task)}{dailyTaskDueLabel(task)?` · ${dailyTaskDueLabel(task)}`:""}</span>
                    <b>{task.title}</b>
                    <p>{task.content}</p>
                    <small>{dailyTaskSourceLabel(task)}</small>
                    {Array.isArray(task.attachments)&&task.attachments.length>0&&<div className="rnr-attachments mini readonly">{task.attachments.map((attachment:any,index:number)=>isImageAttachment(attachment)?<a key={attachment.id??index} href={attachment.data_url} target="_blank" rel="noreferrer"><img src={attachment.data_url} alt={attachment.name??"첨부 이미지"} /></a>:null)}</div>}
                  </div>
                  <div className="actions rnr-today-actions"><button className="button ghost compact" onClick={()=>beginEditRnrTask(task)}>수정</button><button className="button danger compact" onClick={()=>hideRnrTask(task)}>삭제</button></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid two rnr-ai-grid">
          <div className="rnr-input-box">
            <div className="form-row"><label className="label">업무 메모</label><textarea className="textarea rnr-textarea" value={rnrInput} onChange={e=>setRnrInput(e.target.value)} onPaste={handleRnrPaste} placeholder="예: 내일 오전에 학교 제출용 서류 정리하고, 영수증은 민지한테 맡기고, 교육장 비품은 사무보조가 체크하게 해줘." /></div>
            <p className="subtle rnr-paste-hint">이미지는 업무 메모 칸에 Ctrl+V로 여러 장 붙여넣을 수 있습니다.</p>
            {rnrAttachments.length>0&&<div className="rnr-attachments">{rnrAttachments.map((attachment:any)=><button type="button" key={attachment.id} onClick={()=>setRnrAttachments(current=>current.filter(item=>item.id!==attachment.id))} title="첨부 삭제"><img src={attachment.data_url} alt={attachment.name} /></button>)}</div>}
            <button className="button" disabled={rnrBusy} onClick={suggestRnr}><i className="ti ti-sparkles" aria-hidden="true"></i>{rnrBusy?"정리 중":"AI로 정리"}</button>
          </div>
          <div className="rnr-suggestion-box">
            {rnrSuggestion ? (
              <>
                <div className="rnr-result-head"><b>{professionalRnrTitle(rnrSuggestion.title||rnrInput,rnrSuggestion.category||classifyRnrCategory(rnrInput))}</b><span>{rnrSuggestion.department||"부서 미정"} · {rnrSuggestion.position||"직책 미정"} · {rnrSuggestion.work_group||"업무 묶음 미정"}</span></div>
                <p>{rnrSuggestion.summary}</p>
                <div className="grid two">
                  <div className="form-row"><label className="label">공개 업무명</label><input className="input" value={rnrSuggestion.display_title??""} onChange={e=>setRnrSuggestion({...rnrSuggestion,display_title:e.target.value})} /></div>
                  <div className="form-row rnr-workgroup-field">
                    <label className="label">업무 묶음</label>
                    <div className="rnr-workgroup-toggle">
                      {rnrWorkGroupOptionsForDepartment(rnrSuggestion.department,rnrSuggestion.work_group).map(option=>(
                        <button type="button" key={option} className={`rnr-workgroup-chip ${rnrSuggestion.work_group===option?"active":""}`} onClick={()=>setRnrSuggestion({...rnrSuggestion,work_group:option})}>{option}</button>
                      ))}
                    </div>
                    <input className="input rnr-workgroup-input" value={rnrSuggestion.work_group??""} onChange={e=>setRnrSuggestion({...rnrSuggestion,work_group:e.target.value})} placeholder="필요하면 직접 입력" />
                  </div>
                </div>
                <div className="rnr-assignment-box">
                  <label className="checkbox rnr-common-check"><input type="checkbox" checked={(rnrSuggestion.target_scope??"employee")==="common"} onChange={e=>{setRnrSuggestion({...rnrSuggestion,target_scope:e.target.checked?"common":"employee",department:e.target.checked?"공통":rnrSuggestion.department,assigned_person_name:e.target.checked?"공통":""}); if(e.target.checked) setRnrAssigneeId("");}} /> 공통 업무</label>
                  <label className="checkbox rnr-common-check"><input type="checkbox" checked={rnrSuggestion.is_public!==false} onChange={e=>setRnrSuggestion({...rnrSuggestion,is_public:e.target.checked})} /> 공개 업무 분장표에 표시</label>
                  {(rnrSuggestion.target_scope??"employee")!=="common"&&<>
                    <div className="form-row"><label className="label">배정 대상</label><select className="select" value={(rnrSuggestion.target_scope??"employee")==="department"?"department":"employee"} onChange={e=>{setRnrSuggestion({...rnrSuggestion,target_scope:e.target.value}); if(e.target.value==="department") setRnrAssigneeId("");}}><option value="employee">담당자</option><option value="department">부서</option></select></div>
                    {(rnrSuggestion.target_scope??"employee")==="department" ? (
                      <div className="form-row"><label className="label">담당 부서</label><select className="select" value={rnrSuggestion.department??""} onChange={e=>setRnrSuggestion({...rnrSuggestion,department:e.target.value})}>{DEPARTMENT_OPTIONS.filter(Boolean).map(option=><option key={option} value={option}>{option}</option>)}</select></div>
                    ) : (
                      <div className="form-row"><label className="label">담당 직원</label>
                        <select className="select" value={rnrAssigneeId} onChange={e=>setRnrAssigneeId(e.target.value)}>
                          <option value="">직원 선택</option>
                          {employees.filter(isEmployeeActive).map(e=><option key={e.id} value={e.id}>{e.name} {e.department||e.position?`· ${e.department??""} ${e.position??""}`:""}</option>)}
                        </select>
                      </div>
                    )}
                  </>}
                </div>
                <div className="form-row"><label className="label">업무 흐름</label><textarea className="textarea compact-textarea" value={stringListFromUnknown(rnrSuggestion.flow_notes).join("\n")} onChange={e=>setRnrSuggestion({...rnrSuggestion,flow_notes:e.target.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)})} /></div>
                <ul className="rnr-checklist">{(rnrSuggestion.checklist??[]).map((item:string,index:number)=><li key={index}>{item}</li>)}</ul>
                <button className="button full" onClick={saveRnrEntry}>R&R에 저장</button>
              </>
            ) : (
              <div className="type-desc rnr-ai-empty">
                <b>AI 정리 결과</b>
                <p>업무 메모를 입력하고 AI로 정리를 누르면 부서, 직책, 담당자, 체크리스트가 이곳에 표시됩니다.</p>
              </div>
            )}
          </div>
        </div>
        <div className="rnr-section-title"><b>공개 업무 분장표 미리보기</b><span>직원들에게 보이는 부서별 업무 흐름입니다.</span></div>
        <WorkMapBoard entries={rnrEntries} employees={activeEmployees} onOpen={openRnr} />
        <div className="rnr-section-title"><b>조직도와 부서별 업무</b><span>직원을 바로 배치하고, 부서 안에서 업무 묶음별 R&R을 확인합니다.</span></div>
        <div className="rnr-department-tabs">
          <button className={rnrDepartmentFilter==="all"?"active":""} onClick={()=>setRnrDepartmentFilter("all")}>전체</button>
          {rnrDepartmentNames.map((department:string)=><button key={department} className={rnrDepartmentFilter===department?"active":""} onClick={()=>setRnrDepartmentFilter(department)}>{department}</button>)}
        </div>
        <div className="rnr-hierarchy-chart">
          <div className="rnr-hierarchy-root">
            <b>대표</b>
            <span>{currentEmployee.name}</span>
          </div>
          <div className="rnr-hierarchy-branches">
            {visibleRnrDepartmentCards.map((card:any)=>(
              <div className="rnr-hierarchy-dept" key={`hierarchy-${card.department}`}>
                <div className="rnr-hierarchy-dept-head">
                  <b>{card.department}</b>
                  <span>{card.members.length}명 · 업무 {card.entries.length}건</span>
                </div>
                <div className="rnr-hierarchy-members">
                  {card.members.slice(0,4).map((member:any)=><span key={member.id}>{member.name}<small>{member.position||"역할 미지정"}</small></span>)}
                  {card.members.length>4&&<span>외 {card.members.length-4}명</span>}
                  {card.members.length===0&&<span>배치 대기</span>}
                </div>
                <div className="rnr-hierarchy-tasks">
                  {card.entries.slice(0,3).map((entry:any)=>(
                    <button key={entry.id} type="button" onClick={()=>openRnr(entry)}>
                      <b>{rnrPublicTitle(entry)}</b>
                      {rnrIsSensitive(entry)&&<em>민감 권한 확인</em>}
                    </button>
                  ))}
                  {card.entries.length===0&&<p>업무 등록 대기</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rnr-org-board">
          {visibleRnrDepartmentCards.map((card:any)=>{
            const draft=rnrOrgDraftFor(card.department);
            return (
            <div className="rnr-org-card" key={card.department}>
              <div className="rnr-org-head">
                <div><b>{card.department}</b><span>{card.members.length}명 · 업무 {card.entries.length}건</span></div>
                <i className="ti ti-sitemap" aria-hidden="true"></i>
              </div>
              <div className="rnr-member-list">
                {card.members.length===0&&<p className="rnr-empty-work">배치된 직원이 없습니다.</p>}
                {card.members.map((member:any)=>(
                  <div className="rnr-member-row" key={member.id}>
                    <div className="rnr-member-name"><b>{member.name}</b><span>{member.employee_no}</span></div>
                    <select className="select compact-select" value={employeeDepartmentLabel(member)} onChange={e=>updateRnrOrgEmployee(member,{department:e.target.value})}>
                      {rnrDepartmentNames.map((department:string)=><option key={department} value={department}>{department}</option>)}
                    </select>
                    <select className="select compact-select" value={member.position??""} onChange={e=>updateRnrOrgEmployee(member,{position:e.target.value})}>
                      {POSITION_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"직책 없음"}</option>)}
                      {member.position&&!POSITION_OPTIONS.includes(member.position)&&<option value={member.position}>{member.position}</option>}
                    </select>
                  </div>
                ))}
              </div>
              <div className="rnr-org-add">
                <select className="select compact-select" value={draft.employeeId} onChange={e=>setRnrOrgDraftValue(card.department,{employeeId:e.target.value})}>
                  <option value="">직원 선택</option>
                  {activeEmployees.map((employee:any)=><option key={employee.id} value={employee.id}>{employee.name} · {employeeDepartmentLabel(employee)}</option>)}
                </select>
                <select className="select compact-select" value={draft.position} onChange={e=>setRnrOrgDraftValue(card.department,{position:e.target.value})}>
                  {POSITION_OPTIONS.filter(Boolean).map(option=><option key={option} value={option}>{option}</option>)}
                </select>
                <button className="button secondary compact" onClick={()=>assignRnrOrgEmployee(card.department)}><i className="ti ti-user-plus" aria-hidden="true"></i>넣기</button>
              </div>
              <div className="rnr-department-workgroups">
                {card.workGroups.length===0&&<p className="rnr-empty-work">등록된 업무 R&R이 없습니다.</p>}
                {card.workGroups.map((group:any)=>(
                  <div className="rnr-work-category" key={group.key}>
                    <div className="rnr-work-category-head"><b>{group.category}</b><span>{group.entries.length}건</span></div>
                    <div className="rnr-work-list">
                      {group.entries.slice(0,6).map((entry:any)=>(
                        <div className="rnr-work-item" key={entry.id}>
                          <button className="rnr-person-task" onClick={()=>openRnr(entry)}>
                            <b>{rnrPublicTitle(entry)}</b>
                          </button>
                          <button className="icon-button rnr-task-send" title="할일로 보내기" onClick={()=>sendRnrToTodayTask(entry)}><i className="ti ti-clipboard-plus" aria-hidden="true"></i></button>
                        </div>
                      ))}
                    </div>
                    {group.entries.length>6&&<small className="subtle">외 {group.entries.length-6}건</small>}
                  </div>
                ))}
              </div>
            </div>
          )})}
        </div>
      </section>}

      {selectedRnr&&<div className="modal-backdrop" onClick={()=>setSelectedRnr(null)}>
        <div className="modal-box rnr-modal-box" onClick={e=>e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="card-title" style={{margin:0}}><i className="ti ti-sitemap" aria-hidden="true"></i>{rnrPublicTitle(selectedRnr)}</h2>
            <button className="modal-close" title="닫기" onClick={()=>setSelectedRnr(null)}><i className="ti ti-x" aria-hidden="true"></i></button>
          </div>
          {editingRnr ? (
            <div className="rnr-edit-form">
              <div className="form-row"><label className="label">업무명</label><input className="input" value={editingRnr.title??""} onChange={e=>setEditingRnr({...editingRnr,title:e.target.value})} /></div>
              <div className="grid two">
                <div className="form-row"><label className="label">부서</label><select className="select" value={editingRnr.department??""} onChange={e=>setEditingRnr({...editingRnr,department:e.target.value})}>{DEPARTMENT_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"공통"}</option>)}</select></div>
                <div className="form-row"><label className="label">직책</label><select className="select" value={editingRnr.position??""} onChange={e=>setEditingRnr({...editingRnr,position:e.target.value})}>{POSITION_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"공통"}</option>)}</select></div>
              </div>
              <div className="grid two">
                <div className="form-row"><label className="label">공개 업무명</label><input className="input" value={editingRnr.display_title??""} onChange={e=>setEditingRnr({...editingRnr,display_title:e.target.value})} /></div>
                <div className="form-row rnr-workgroup-field">
                  <label className="label">업무 묶음</label>
                  <div className="rnr-workgroup-toggle">
                    {rnrWorkGroupOptionsForDepartment(editingRnr.department,editingRnr.work_group).map(option=>(
                      <button type="button" key={option} className={`rnr-workgroup-chip ${editingRnr.work_group===option?"active":""}`} onClick={()=>setEditingRnr({...editingRnr,work_group:option})}>{option}</button>
                    ))}
                  </div>
                  <input className="input rnr-workgroup-input" value={editingRnr.work_group??""} onChange={e=>setEditingRnr({...editingRnr,work_group:e.target.value})} placeholder="필요하면 직접 입력" />
                </div>
              </div>
              <div className="rnr-assignment-box">
                <label className="checkbox rnr-common-check"><input type="checkbox" checked={(editingRnr.target_scope??"employee")==="common"} onChange={e=>setEditingRnr({...editingRnr,target_scope:e.target.checked?"common":"employee",department:e.target.checked?"공통":editingRnr.department,assigned_employee_id:e.target.checked?"":editingRnr.assigned_employee_id,assigned_person_name:e.target.checked?"공통":""})} /> 공통 업무</label>
                <label className="checkbox rnr-common-check"><input type="checkbox" checked={editingRnr.is_public!==false} onChange={e=>setEditingRnr({...editingRnr,is_public:e.target.checked})} /> 공개 업무 분장표에 표시</label>
                {(editingRnr.target_scope??"employee")!=="common"&&<>
                  <div className="form-row"><label className="label">배정 대상</label><select className="select" value={(editingRnr.target_scope??"employee")==="department"?"department":"employee"} onChange={e=>setEditingRnr({...editingRnr,target_scope:e.target.value,assigned_employee_id:e.target.value==="department"?"":editingRnr.assigned_employee_id})}><option value="employee">담당자</option><option value="department">부서</option></select></div>
                  {(editingRnr.target_scope??"employee")==="department" ? (
                    <div className="form-row"><label className="label">담당 부서</label><select className="select" value={editingRnr.department??""} onChange={e=>setEditingRnr({...editingRnr,department:e.target.value})}>{DEPARTMENT_OPTIONS.filter(Boolean).map(option=><option key={option} value={option}>{option}</option>)}</select></div>
                  ) : (
                    <div className="form-row"><label className="label">담당 직원</label><select className="select" value={editingRnr.assigned_employee_id??""} onChange={e=>setEditingRnr({...editingRnr,assigned_employee_id:e.target.value})}><option value="">직원 선택</option>{employees.filter(isEmployeeActive).map(e=><option key={e.id} value={e.id}>{e.name} {e.department||e.position?`· ${e.department??""} ${e.position??""}`:""}</option>)}</select></div>
                  )}
                </>}
              </div>
              <div className="form-row"><label className="label">업무 설명</label><textarea className="textarea" value={editingRnr.summary??""} onChange={e=>setEditingRnr({...editingRnr,summary:e.target.value})} /></div>
              <div className="form-row"><label className="label">업무 흐름</label><textarea className="textarea compact-textarea" value={editingRnr.flowNotesText??""} onChange={e=>setEditingRnr({...editingRnr,flowNotesText:e.target.value})} placeholder={"한 줄에 하나씩 입력"} /></div>
              <div className="form-row"><label className="label">체크리스트</label><textarea className="textarea compact-textarea" value={editingRnr.checklistText??""} onChange={e=>setEditingRnr({...editingRnr,checklistText:e.target.value})} placeholder={"한 줄에 하나씩 입력"} /></div>
            </div>
          ) : (
            <div className="consent-preview">
              <dl>
                <div><dt>담당</dt><dd>{rnrAssigneeName(selectedRnr)}</dd></div>
                <div><dt>부서</dt><dd>{selectedRnr.department||"공통"}</dd></div>
                <div><dt>직책</dt><dd>{selectedRnr.position||"-"}</dd></div>
                <div><dt>업무 묶음</dt><dd>{rnrWorkGroup(selectedRnr)}</dd></div>
                <div><dt>공개 여부</dt><dd>{rnrIsPublicBoardEntry(selectedRnr)?"공개":"비공개"}</dd></div>
              </dl>
              <div className="type-desc"><b>업무 흐름</b><ul className="rnr-duty-list detail checkable">{rnrFlowLines(selectedRnr).map((line:string,index:number)=><li key={index}><label><input type="checkbox" checked={!!rnrChecklistDone[`${selectedRnr.id}:${index}`]} onChange={event=>toggleRnrChecklist(selectedRnr.id,index,event.target.checked)} /> <span>{line}</span></label></li>)}</ul></div>
              {Array.isArray(selectedRnr.attachments)&&selectedRnr.attachments.length>0&&<div className="rnr-attachments readonly">{selectedRnr.attachments.map((attachment:any,index:number)=>isImageAttachment(attachment)?<a key={attachment.id??index} href={attachment.data_url} target="_blank" rel="noreferrer"><img src={attachment.data_url} alt={attachment.name??"첨부 이미지"} /></a>:null)}</div>}
            </div>
          )}
          <div className="actions rnr-modal-actions" style={{justifyContent:"flex-end",marginTop:16}}>
            {editingRnr ? <><button className="button danger ghost" onClick={()=>deleteRnrEntry(selectedRnr)}>삭제</button><button className="button ghost" onClick={()=>setEditingRnr(null)}>취소</button><button className="button" onClick={saveEditedRnr}>수정 저장</button></> : <><div className="rnr-task-date-control"><label className="label">지정 날짜</label><input className="input" type="date" value={rnrTaskDate} onChange={e=>{const value=e.target.value||todayIso(); setRnrTaskDate(value); if(!rnrTaskDueDate) setRnrTaskDueDate(value);}} /></div><div className="rnr-task-date-control"><label className="label">기한</label><input className="input" type="date" value={rnrTaskDueDate} onChange={e=>setRnrTaskDueDate(e.target.value)} /></div><button className="button secondary" onClick={()=>sendRnrToTodayTask(selectedRnr,rnrTaskDate,rnrTaskDueDate)}><i className="ti ti-clipboard-plus" aria-hidden="true"></i>할일</button><button className="button secondary" onClick={()=>sendRnrToMonthlyKpi(selectedRnr)}><i className="ti ti-target-arrow" aria-hidden="true"></i>월간 KPI</button><button className="button ghost" onClick={()=>beginEditRnr(selectedRnr)}><i className="ti ti-edit" aria-hidden="true"></i>수정</button><button className="button danger ghost" onClick={()=>deleteRnrEntry(selectedRnr)}>삭제</button><button className="button" onClick={()=>setSelectedRnr(null)}>확인</button></>}
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
            <div className="form-row"><label className="label">직책/역할</label><select className="select nowrap-select" value={newEmployee.position} onChange={e=>setNewEmployee(current=>({...current,position:e.target.value,is_unpaid:e.target.value==="인턴"?true:current.is_unpaid,no_annual_leave:e.target.value==="인턴"?true:current.no_annual_leave}))}>{POSITION_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"없음"}</option>)}</select></div>
            <label className="checkbox no-wrap-checkbox" style={{alignSelf:"end",marginBottom:10}}><input type="checkbox" checked={newEmployee.no_annual_leave} onChange={e=>{const checked=e.target.checked; setNewEmployee({...newEmployee,no_annual_leave:checked}); if(checked) setMessage(annualLeaveEligibilityNote({...newEmployee,work_start:"09:00",work_end:"18:00"}));}} /> 연차 없음</label>
          </div>
          <label className="checkbox no-wrap-checkbox" style={{margin:"2px 0 12px"}}><input type="checkbox" checked={newEmployee.is_unpaid} onChange={e=>setNewEmployee({...newEmployee,is_unpaid:e.target.checked})} /> 무급 인력/지원 인턴</label>
          <div className="form-row"><label className="label">출근 요일</label>
            <div className="days-grid">{ALL_DAYS.map(d=><button key={d} type="button" className={`day-btn ${newEmployee.work_days.includes(d)?"active":""}`} onClick={()=>setNewEmployee(current=>({...current,work_days:toggleDay(current.work_days,d)}))}>{DAY_LABELS[d]}</button>)}</div>
          </div>
          {newEmployee.no_annual_leave&&<div className="alert">{annualLeaveEligibilityNote({...newEmployee,work_start:"09:00",work_end:"18:00"})}</div>}
          <button className="button" onClick={createEmployee}><i className="ti ti-plus" aria-hidden="true"></i>직원 생성</button>
          <div className="bulk-employee-box">
            <div className="section-head">
              <div>
                <h3 className="mini-title">여러 직원 붙여넣기 생성</h3>
                <p className="subtle">한 줄에 직원 1명으로 붙여넣거나, 이름/직함/사번/전화번호를 한 줄씩 적어도 자동으로 묶어서 생성합니다.</p>
              </div>
              <button className="button secondary compact" disabled={bulkCreating||bulkEmployeeRows.filter(row=>row.valid).length===0} onClick={createBulkEmployees}>{bulkCreating?"생성 중":`${bulkEmployeeRows.filter(row=>row.valid).length}명 생성`}</button>
            </div>
            <textarea className="textarea compact-textarea" value={bulkEmployeeText} onChange={e=>changeBulkEmployeeText(e.target.value)} placeholder={"배병윤 개발부서 매니저 25110301 01025153673\n\n또는\n홍길동 디자인부서\n직함 담당자\n사번 22061201\n전화번호 01012345678"} />
            {bulkEmployeeRows.length>0&&<div className="bulk-employee-preview">
              {bulkEmployeeRows.slice(0,8).map(row=><div className={`bulk-employee-row ${row.valid?"":"invalid"}`} key={`${row.index}-${row.employee_no||row.name}`}>
                <b>{row.name||"이름 없음"}</b><span>{row.department||"부서 없음"} · {row.position||"직책 없음"}{row.is_unpaid?" · 무급":""}</span><small>{row.employee_no||"사번 없음"} · {row.phone||"휴대전화 없음"}</small>
              </div>)}
              {bulkEmployeeRows.length>8&&<p className="subtle">외 {bulkEmployeeRows.length-8}명</p>}
            </div>}
          </div>
        </CollapsibleSection>
      </section>}

      {view==="employees"&&<section className="card">
        <h2 className="card-title"><i className="ti ti-users" aria-hidden="true"></i>직원 관리</h2>
        <div className="tabs">
          <button className={`tab ${employeeFilter==="active"?"active":""}`} onClick={()=>setEmployeeFilter("active")}>재직</button>
          <button className={`tab ${employeeFilter==="inactive"?"active":""}`} onClick={()=>setEmployeeFilter("inactive")}>비활성</button>
          <button className={`tab ${employeeFilter==="all"?"active":""}`} onClick={()=>setEmployeeFilter("all")}>전체</button>
        </div>
        <div className="employee-copy-toolbar">
          <div><b>여러 직원 붙여넣기용 복사</b><span>이름, 부서, 사번, 휴대전화를 탭 구분 형식으로 복사합니다.</span></div>
          <div className="actions">
            <button className="button ghost compact" onClick={()=>setSelectedEmployeeCopyIds(filtered.map((employee:any)=>employee.id))}>현재 목록 전체 선택</button>
            <button className="button secondary compact" onClick={copySelectedEmployeeInfo} disabled={selectedCopyEmployees.length===0}><i className="ti ti-copy" aria-hidden="true"></i>{selectedCopyEmployees.length}명 복사</button>
          </div>
        </div>
        <div className="table-wrap employee-table-wrap">
          <table className="employee-admin-table">
            <thead><tr><th>선택</th><th>직원</th><th>부서/직책</th><th>권한</th><th>상태</th><th>입사일</th><th>출근 시작일</th><th>연차</th><th>계정</th><th>처리</th></tr></thead>
            <tbody>
              {filtered.map(e=>(
                <tr key={e.id}>
                  <td data-label="선택"><input type="checkbox" checked={selectedEmployeeCopyIds.includes(e.id)} onChange={event=>toggleEmployeeCopySelection(e.id,event.target.checked)} /></td>
                  <td data-label="직원"><div className="employee-identity"><b>{e.name}</b><span>{e.employee_no}</span><small>{e.phone||"-"}</small></div></td>
                  <td data-label="부서/직책"><div className="grid" style={{gap:6}}>
                    <select className="select nowrap-select" value={e.department??""} onChange={ev=>updateEmployee(e.id,{department:ev.target.value})}>
                      {DEPARTMENT_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"없음"}</option>)}
                      {e.department&&!DEPARTMENT_OPTIONS.includes(e.department)&&<option value={e.department}>{e.department}</option>}
                    </select>
                    <select className="select nowrap-select" value={e.position??""} onChange={ev=>updateEmployee(e.id,{position:ev.target.value,is_unpaid:ev.target.value==="인턴"?true:!!e.is_unpaid,no_annual_leave:ev.target.value==="인턴"?true:!!e.no_annual_leave})}>
                      {POSITION_OPTIONS.map(option=><option key={option||"none"} value={option}>{option||"없음"}</option>)}
                      {e.position&&!POSITION_OPTIONS.includes(e.position)&&<option value={e.position}>{e.position}</option>}
                    </select>
                    <label className="checkbox no-wrap-checkbox employee-unpaid-check"><input type="checkbox" checked={!!e.is_unpaid} onChange={ev=>updateEmployee(e.id,{is_unpaid:ev.target.checked})} /> 무급</label>
                  </div></td>
                  <td data-label="권한"><select className="select" value={e.role} onChange={ev=>updateEmployee(e.id,{role:ev.target.value})}><option value="admin">관리자</option><option value="employee">직원</option></select></td>
                  <td data-label="상태"><span className={`badge employee-status-badge ${badgeClass(e.employment_status)}`}>{e.employment_status==="active"?"재직":"비활성"}</span></td>
                  <td data-label="입사일"><input className="input" type="date" value={e.joined_at??""} onChange={ev=>updateEmployee(e.id,{joined_at:ev.target.value})} /></td>
                  <td data-label="출근 시작일"><input className="input" type="date" value={e.work_start_date??e.joined_at??""} onChange={ev=>updateEmployee(e.id,{work_start_date:ev.target.value})} /></td>
                  <td data-label="연차"><label className="checkbox no-wrap-checkbox" title={annualLeaveEligibilityNote(e)} style={{margin:0}}><input type="checkbox" checked={!!e.no_annual_leave} onChange={ev=>{if(ev.target.checked) setMessage(annualLeaveEligibilityNote(e)); updateEmployee(e.id,{no_annual_leave:ev.target.checked});}} /> 없음</label></td>
                  <td data-label="계정"><div className="employee-account-actions"><button className="button ghost compact" onClick={()=>resetEmployeeNo(e)}>사번 변경</button><button className="button ghost compact" onClick={()=>resetPassword(e)}>비번 초기화</button></div></td>
                  <td data-label="처리"><div className="employee-row-actions"><button className={`${e.employment_status==="active"?"button danger":"button secondary"} compact employee-status-action`} onClick={()=>toggleEmployee(e.id,e.employment_status)}>{e.employment_status==="active"?"비활성화":"활성화"}</button>{e.employment_status!=="active"&&<button className="button danger compact employee-delete-action" onClick={()=>deleteInactiveEmployee(e)}><i className="ti ti-trash" aria-hidden="true"></i>삭제</button>}</div></td>
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


function AdminPermissionSettings({ currentEmployee, onChanged }: { currentEmployee:any; onChanged:()=>void }) {
  const [employees,setEmployees]=useState<any[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [permissions,setPermissions]=useState<Record<string,string>>({});
  const [msg,setMsg]=useState("");
  const [sealPreview,setSealPreview]=useState(()=>{try{return localStorage.getItem(COMPANY_SEAL_STORAGE_KEY)??"";}catch{return "";}});
  const selected=employees.find(employee=>employee.id===selectedId);
  const activeEmployees=employees.filter(employee=>employee.is_active!==false&&employee.employment_status!=="inactive");
  async function loadEmployees() {
    const {data,error}=await supabase.from("employees").select("id,name,employee_no,role,is_active,employment_status,department,position").order("employee_no",{ascending:true});
    if(error) return setMsg(`직원 목록을 불러오지 못했습니다: ${error.message}`);
    const list=data??[];
    setEmployees(list);
    setSelectedId(prev=>prev||currentEmployee?.id||list[0]?.id||"");
  }
  async function loadPermissions(employeeId:string) {
    const base=ADMIN_PERMISSION_MENUS.reduce((map:Record<string,string>,menu)=>{
      map[menu.id]="none";
      return map;
    },{});
    const {data,error}=await supabase.from("admin_menu_permissions").select("menu_id, access_level").eq("employee_id",employeeId);
    if(error) {
      setPermissions(base);
      setMsg(`권한 설정 DB 패치를 먼저 실행해주세요: ${error.message}`);
      return;
    }
    (data??[]).forEach((row:any)=>{base[row.menu_id]=row.access_level??"none";});
    setPermissions(base);
    setMsg("");
  }
  useEffect(()=>{loadEmployees();},[]);
  useEffect(()=>{
    if(selectedId) loadPermissions(selectedId);
    else setPermissions({});
  },[selectedId]);
  function updatePermission(menuId:Tab, level:string) {
    setPermissions(prev=>({...prev,[menuId]:level}));
  }
  async function savePermissions() {
    if(!selectedId) return setMsg("직원을 선택해주세요.");
    const normalized={...permissions};
    if(selectedId===currentEmployee?.id) normalized["admin-settings"]="all";
    const rows=ADMIN_PERMISSION_MENUS.map(menu=>({
      employee_id:selectedId,
      menu_id:menu.id,
      access_level:normalized[menu.id]??"none",
      created_by:currentEmployee?.id??null,
      updated_by:currentEmployee?.id??null,
    }));
    const {error}=await supabase.from("admin_menu_permissions").upsert(rows,{onConflict:"employee_id,menu_id"});
    if(error) return setMsg(`권한 저장 실패: ${error.message}`);
    const hasAny=rows.some(row=>row.access_level!=="none");
    if(hasAny&&selected?.role!=="admin") {
      const {error:roleError}=await supabase.from("employees").update({role:"admin"}).eq("id",selectedId);
      if(roleError) return setMsg(`권한은 저장했지만 관리자 역할 변경에 실패했습니다: ${roleError.message}`);
    }
    setPermissions(normalized);
    setMsg("관리자 권한 설정을 저장했습니다.");
    await loadEmployees();
    onChanged();
  }
  async function saveCompanySeal(file?:File|null) {
    if(!file) return;
    if(!String(file.type??"").startsWith("image/")) return setMsg("이미지 파일만 등록할 수 있습니다.");
    const attachment=await imageFileToAttachment(file,"company-seal");
    try {
      localStorage.setItem(COMPANY_SEAL_STORAGE_KEY,attachment.data_url);
      setSealPreview(attachment.data_url);
      setMsg("법인 도장 이미지를 이 브라우저에 저장했습니다. 이후 공식 문서 PDF에 자동으로 표시됩니다.");
    } catch {
      setMsg("도장 이미지를 저장하지 못했습니다. 파일 크기를 줄여 다시 시도해주세요.");
    }
  }
  function clearCompanySeal() {
    localStorage.removeItem(COMPANY_SEAL_STORAGE_KEY);
    setSealPreview("");
    setMsg("법인 도장 이미지를 제거했습니다.");
  }
  return (
    <div className="grid">
    <section className="card admin-permission-card">
      <div className="section-head">
        <div>
          <h2 className="card-title"><i className="ti ti-shield-lock" aria-hidden="true"></i>관리자 권한 설정</h2>
          <p className="subtle" style={{margin:0}}>직원을 선택한 뒤 메뉴별로 없음, 읽기, 편집, 전체 허용을 지정합니다. 권한이 하나라도 있으면 관리자 메뉴 접근 대상이 됩니다.</p>
        </div>
        <button className="button secondary" onClick={savePermissions}><i className="ti ti-device-floppy" aria-hidden="true"></i>권한 저장</button>
      </div>
      <div className="grid two">
        <div className="form-row">
          <label className="label">직원 선택</label>
          <select className="select" value={selectedId} onChange={event=>setSelectedId(event.target.value)}>
            <option value="">직원 선택</option>
            {activeEmployees.map(employee=><option key={employee.id} value={employee.id}>{employee.name} · {employee.employee_no||"-"} · {employee.role==="admin"?"관리자":"직원"}</option>)}
          </select>
        </div>
        <div className="admin-permission-summary">
          <b>{selected?.name??"직원을 선택해주세요"}</b>
          <span>{selected?`${selected.department||"부서 없음"} · ${selected.position||"직책 없음"} · ${selected.role==="admin"?"관리자":"직원"}`:"권한을 저장하면 해당 직원의 관리자 화면 노출 범위가 정리됩니다."}</span>
        </div>
      </div>
      <div className="permission-setting-list">
        {ADMIN_PERMISSION_MENUS.map(menu=>(
          <div className="permission-setting-row" key={menu.id}>
            <div>
              <b>{menu.label}</b>
              <span>{menu.description}</span>
            </div>
            <div className="permission-level-buttons" role="group" aria-label={`${menu.label} 권한`}>
              {ADMIN_PERMISSION_LEVELS.map(level=>(
                <button
                  key={level.id}
                  type="button"
                  className={`button ghost compact ${(permissions[menu.id]??"none")===level.id?"active":""}`}
                  onClick={()=>updatePermission(menu.id,level.id)}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {msg&&<div className={`alert ${msg.includes("실패")||msg.includes("패치")?"error":""}`} style={{marginTop:12}}>{msg}</div>}
    </section>
    <section className="card seal-settings-card">
      <div className="section-head">
        <div>
          <h2 className="card-title"><i className="ti ti-stamp" aria-hidden="true"></i>법인 도장 이미지</h2>
          <p className="subtle" style={{margin:0}}>동의서, 근태 기준, 세무사 제출용 문서 등 공식 문서형 PDF의 회사 확인란에 표시됩니다.</p>
        </div>
        {sealPreview&&<button className="button danger compact" onClick={clearCompanySeal}><i className="ti ti-trash" aria-hidden="true"></i>제거</button>}
      </div>
      <div className="seal-upload-row">
        <label className="button secondary compact">
          <i className="ti ti-upload" aria-hidden="true"></i>도장 이미지 선택
          <input type="file" accept="image/*" hidden onChange={event=>saveCompanySeal(event.target.files?.[0])} />
        </label>
        <div className="seal-preview-box">{sealPreview?<img src={sealPreview} alt="법인 도장 미리보기" />:<span>도장 이미지 없음</span>}</div>
      </div>
    </section>
    </div>
  );
}


function SettingsPage({ currentEmployee, section="schedule", readOnly=false }: { currentEmployee:any; section?:"schedule"|"payroll"; readOnly?:boolean }) {
  const [employees,setEmployees]=useState<any[]>([]);
  const [empMap,setEmpMap]=useState<Record<string,any>>({});
  const [overrides,setOverrides]=useState<any[]>([]);
  const [workTimeChanges,setWorkTimeChanges]=useState<any[]>([]);
  const [absences,setAbsences]=useState<any[]>([]);
  const [scheduleEvents,setScheduleEvents]=useState<any[]>([]);
  const [leaveRequests,setLeaveRequests]=useState<any[]>([]);
  const [compTimeRequests,setCompTimeRequests]=useState<any[]>([]);
  const [msg,setMsg]=useState("");
  function applyScheduleData(data:any){
    const list=data?.employees??[];
    const map:Record<string,any>={};
    list.forEach((x:any)=>{map[x.id]=x;});
    setEmployees(list);
    setEmpMap(map);
    setOverrides(data?.weekly_schedule_overrides??[]);
    setWorkTimeChanges(data?.work_time_change_requests??[]);
    setAbsences(data?.employee_absences??[]);
    setScheduleEvents(data?.employee_schedule_events??[]);
    setLeaveRequests(data?.attendance_requests??[]);
    setCompTimeRequests(data?.comp_time_requests??[]);
  }
  async function load(){
    if(readOnly&&section==="schedule"){
      const {data,error}=await supabase.rpc("team_schedule_snapshot");
      if(error){
        setMsg(`팀 일정 데이터를 불러오지 못했습니다. Supabase 팀 일정 패치를 먼저 실행해주세요. (${error.message})`);
        return;
      }
      setMsg("");
      applyScheduleData(data);
      return;
    }
    const [e,ov,wt,ab,se,lr,cr]=await Promise.all([
      supabase.from("employees").select("*").order("employee_no",{ascending:true}),
      supabase.from("weekly_schedule_overrides").select("*").order("week_start",{ascending:false}).limit(200),
      supabase.from("work_time_change_requests").select("*").order("created_at",{ascending:false}).limit(300),
      supabase.from("employee_absences").select("*").order("start_date",{ascending:false}),
      supabase.from("employee_schedule_events").select("*").order("start_date",{ascending:true}),
      supabase.from("attendance_requests").select("*").eq("status","approved").order("start_date",{ascending:true}),
      supabase.from("comp_time_requests").select("*").in("status",["pending","approved"]).order("work_date",{ascending:true}),
    ]);
    applyScheduleData({
      employees:e.data??[],
      weekly_schedule_overrides:ov.data??[],
      work_time_change_requests:wt.data??[],
      employee_absences:ab.data??[],
      employee_schedule_events:se.data??[],
      attendance_requests:lr.data??[],
      comp_time_requests:cr.data??[],
    });
  }
  useEffect(()=>{load();},[section,readOnly]);
  function empName(id?:string|null){return id&&empMap[id]?empMap[id].name:"-";}
  return <div className="grid">
    {section==="schedule"&&<>
      {readOnly&&msg&&<div className="alert error">{msg}</div>}
      <TeamScheduleBoard employees={employees} events={scheduleEvents} overrides={overrides} workTimeChanges={workTimeChanges} absences={absences} leaveRequests={leaveRequests} compTimeRequests={compTimeRequests} currentEmployee={currentEmployee} onChanged={load} readOnly={readOnly} />
      {!readOnly&&<ScheduleCard employees={employees} empMap={empMap} overrides={overrides} absences={absences} currentEmployee={currentEmployee} empName={empName} onChanged={load} setMsg={setMsg} msg={msg} />}
    </>}
    {section==="payroll"&&<PayrollCard employees={employees} absences={absences} overrides={overrides} workTimeChanges={workTimeChanges} scheduleEvents={scheduleEvents} readOnly={readOnly} />}
  </div>;
}

function TeamScheduleBoard({employees,events,overrides,workTimeChanges,absences,leaveRequests,compTimeRequests,currentEmployee,onChanged,readOnly=false}:{employees:any[];events:any[];overrides:any[];workTimeChanges:any[];absences:any[];leaveRequests:any[];compTimeRequests:any[];currentEmployee:any;onChanged:()=>void;readOnly?:boolean}) {
  const [employeeOrder,setEmployeeOrder]=useState<string[]>(()=>{
    try{return JSON.parse(localStorage.getItem("lupl_schedule_employee_order")??"[]");}catch{return [];}
  });
  const [weekAnchor,setWeekAnchor]=useState(todayIso());
  const weekStart=weekStartIso(weekAnchor);
  const dates=Array.from({length:5},(_,i)=>addIsoDays(weekStart,i));
  const weekEnd=dates[4];
  const monthRange=monthRangeFor(weekAnchor);
  const monthIssueDates=monthDates(monthRange.start);
  const sortScheduleEmployee=(a:any,b:any)=>{
    const ai=employeeOrder.indexOf(a.id),bi=employeeOrder.indexOf(b.id);
    if(ai>=0||bi>=0) return (ai<0?9999:ai)-(bi<0?9999:bi);
    return String(a.employee_no??"").localeCompare(String(b.employee_no??""));
  };
  const activeEmployees=employees
    .filter(employee=>employeeVisibleInScheduleWeek(employee,dates,events,overrides,workTimeChanges,leaveRequests,compTimeRequests))
    .sort(sortScheduleEmployee);
  const employeeHasMonthIssue=(employee:any)=>!isTestEmployee(employee)&&(
    events.some((event:any)=>event.employee_id===employee.id&&dateRangesOverlap(monthRange.start,monthRange.end,event.start_date,event.end_date))
    || absences.some((absence:any)=>absence.employee_id===employee.id&&dateRangesOverlap(monthRange.start,monthRange.end,absence.start_date,absence.end_date))
    || leaveRequests.some((request:any)=>request.employee_id===employee.id&&request.status==="approved"&&dateRangesOverlap(monthRange.start,monthRange.end,request.start_date,request.end_date))
    || compTimeRequests.some((request:any)=>request.employee_id===employee.id&&dateInRange(request.work_date,monthRange.start,monthRange.end))
  );
  const monthIssueEmployees=employees
    .filter(employee=>employeeVisibleInScheduleWeek(employee,monthIssueDates,events,overrides,workTimeChanges,leaveRequests,compTimeRequests)||employeeHasMonthIssue(employee))
    .sort(sortScheduleEmployee);
  const [selectedEmpId,setSelectedEmpId]=useState("all");
  const [scheduleViewMode,setScheduleViewMode]=useState<"week"|"month">("week");
  const [editing,setEditing]=useState<any|null>(null);
  const [message,setMessage]=useState("");
  const [draggingId,setDraggingId]=useState<string|null>(null);
  const [draggingEmployeeId,setDraggingEmployeeId]=useState<string|null>(null);
  const [movingBase,setMovingBase]=useState<{employeeId:string;employeeName:string;sourceDate:string}|null>(null);
  const [timeDrag,setTimeDrag]=useState<any|null>(null);
  const [scheduleCommand,setScheduleCommand]=useState("");
  const [focusEmployeeId,setFocusEmployeeId]=useState("");
  const timeDragRef=useRef<any|null>(null);
  const timeDragClickGuard=useRef(0);
  const showAdminScheduleDetails=currentEmployee.role==="admin"&&!readOnly;
  const isAll=selectedEmpId==="all";
  const employeeCount=Math.max(1,activeEmployees.length);
  const teamColumnCount=dates.length*employeeCount;
  const selectedEmployee=isAll?null:(activeEmployees.find(e=>e.id===selectedEmpId)??activeEmployees[0]??null);
  const focusActive=isAll&&!!focusEmployeeId;
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
    if((!isAll&&focusEmployeeId)||(focusEmployeeId&&!activeEmployees.some(e=>e.id===focusEmployeeId))) setFocusEmployeeId("");
  },[isAll,activeEmployees.length,focusEmployeeId]);
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
    const cleaned=text
      .replace(/(?:(?:20\d{2})년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일?/g," ")
      .replace(/(?<![가-힣])\d{1,2}\s*월/g," ")
      .replace(/요일|일정|일자|오전|오후|아침|낮|저녁|밤|부터|까지|에서|근무|출근|퇴근|변경|매\s*주|매주/g," ");
    if(/평일|월\s*~\s*금|월-금/.test(cleaned)) return ["mon","tue","wed","thu","fri"];
    const found:string[]=[];
    const compact=cleaned.replace(/[^월화수목금토일]/g,"");
    const byLabel:Record<string,string>={월:"mon",화:"tue",수:"wed",목:"thu",금:"fri",토:"sat",일:"sun"};
    Array.from(compact).forEach(label=>{
      const day=byLabel[label];
      if(day&&!found.includes(day)) found.push(day);
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
  function isNoWorkEvent(event:any){
    return /출근\s*안|근무\s*안|출근\s*불가|근무\s*불가|휴무|쉬는|쉼/.test(`${event.title??""} ${event.note??""}`);
  }
  function scheduleEventPriority(event:any){
    if(event.event_type==="hidden"&&isNoWorkEvent(event)) return 60;
    if(event.event_type==="unavailable") return 50;
    if(event.event_type==="work") return 40;
    if(["am_only","pm_only"].includes(event.event_type)) return 30;
    if(event.event_type==="hidden") return 20;
    return 0;
  }
  function displayScheduleEvent(event:any){
    if(event?.event_type==="hidden"&&isNoWorkEvent(event)){
      return {...event,event_type:"unavailable",title:event.title||"출근 안 함",start_time:event.start_time??"09:00",end_time:event.end_time??"19:00"};
    }
    return event;
  }
  function isPrivateEmployeeScheduleEvent(event:any) {
    return !event?.base && !event?.leave && !event?.readonly && ["hidden","unavailable","info"].includes(event?.event_type);
  }
  function scheduleEventTitleForViewer(event:any) {
    if(!showAdminScheduleDetails&&isPrivateEmployeeScheduleEvent(event)) return "개인 사유";
    return event?.title||"일정 확인";
  }
  function scheduleEventNoteForViewer(event:any) {
    if(!showAdminScheduleDetails&&isPrivateEmployeeScheduleEvent(event)) return "휴가/일정 확인";
    return event?.note??"";
  }
  function displayScheduleEventForDate(employee:any,event:any,date:string){
    const shown=displayScheduleEvent(event);
    const change=approvedWorkTimeChangeForDate(workTimeChanges,employee,date);
    const dayKey=dayKeyFromDate(dateFromIso(date));
    if(change&&["work","am_only","pm_only"].includes(shown?.event_type)&&(change.new_work_days??[]).includes(dayKey)){
      return {...shown,start_time:change.new_work_start??shown.start_time,end_time:change.new_work_end??shown.end_time};
    }
    return shown;
  }
  function scheduleEventsForDate(employee:any,date:string){
    return events
      .filter((event:any)=>event.employee_id===employee.id&&date>=event.start_date&&date<=event.end_date&&["hidden","unavailable","work","am_only","pm_only"].includes(event.event_type))
      .sort((a:any,b:any)=>{
        const priority=scheduleEventPriority(b)-scheduleEventPriority(a);
        if(priority) return priority;
        const duration=countDaysInclusive(a.start_date,a.end_date)-countDaysInclusive(b.start_date,b.end_date);
        if(duration) return duration;
        return String(b.updated_at??b.created_at??"").localeCompare(String(a.updated_at??a.created_at??""));
      });
  }
  function explicitScheduleEventFor(employee:any,date:string){
    return displayScheduleEvent(scheduleEventsForDate(employee,date)[0]);
  }
  function workInfoForDate(employee:any,date:string){
    const sched=getScheduleForDate(employee,date,overrides,workTimeChanges);
    const change=approvedWorkTimeChangeForDate(workTimeChanges,employee,date);
    const explicitEvent=explicitScheduleEventFor(employee,date);
    const eventOverridesSchedule=explicitEvent&&!change;
    const eventIsWork=["work","am_only","pm_only"].includes(explicitEvent?.event_type);
    const workday=eventOverridesSchedule ? eventIsWork : (sched.work_days??[]).includes(dayKeyFromDate(dateFromIso(date)));
    const start=eventOverridesSchedule ? explicitEvent?.start_time??sched.work_start : sched.work_start;
    const end=eventOverridesSchedule ? explicitEvent?.end_time??sched.work_end : sched.work_end;
    const scheduleForLeave={...sched,work_start:start,work_end:end};
    const employeeLeaveRequests=leaveRequests.filter((request:any)=>request.employee_id===employee.id&&request.status==="approved"&&date>=request.start_date&&date<=request.end_date);
    const scheduledMinutes=workday?Math.round(netDailyHours(start,end,sched.break_start??"12:00",sched.break_end??"13:00")*60):0;
    const companyHoliday=workday&&isCompanySummerHolidayDate(date)?companyHolidayLeaveObject(date):null;
    const leaveMinutes=companyHoliday?scheduledMinutes:(workday?approvedLeaveMinutesForDate(employeeLeaveRequests,date,scheduleForLeave):0);
    const remainingMinutes=Math.max(0,scheduledMinutes-leaveMinutes);
    const leave=companyHoliday??employeeLeaveRequests.find((request:any)=>request.request_type==="comp_leave_use"||LEAVE_TYPE_META[request.request_type]?.usesLeave)??null;
    const fullLeave=!!leave&&scheduledMinutes>0&&remainingMinutes<=0;
    const hours=workday?Math.round((remainingMinutes/60)*10)/10:0;
    return {workday,start,end,hours,scheduledHours:scheduledMinutes/60,leave,leaveMinutes,fullLeave,event:explicitEvent,change};
  }
  function scheduledWorkStatsWithEvents(employee:any,startIso:string,endIso:string){
    let days=0; let hours=0; let d=dateFromIso(startIso); const end=dateFromIso(endIso);
    while(d<=end){
      const info=workInfoForDate(employee,isoDate(d));
      if(info.workday&&info.hours>0){days++;hours+=info.hours;}
      d=addLocalDays(d,1);
    }
    return {days,hours:Math.round(hours*10)/10};
  }
  async function saveApprovedRecurringWorkChange(employee:any, period:any, newDays:string[], newStart:string, newEnd:string, raw:string) {
    const oldDays=employee.work_days??["mon","tue","wed","thu","fri"];
    const oldStart=timeLabel(employee.work_start??"09:00");
    const oldEnd=timeLabel(employee.work_end??"18:00");
    const startMin=timeToMinutes(newStart);
    const endMinRaw=timeToMinutes(newEnd);
    const endMin=startMin!=null&&endMinRaw!=null&&endMinRaw<=startMin ? endMinRaw+24*60 : endMinRaw;
    const workMinutes=startMin!=null&&endMin!=null ? Math.max(0,endMin-startMin) : 0;
    const hasLunchBreak=workMinutes>4*60 && startMin!=null && endMin!=null && startMin<13*60 && endMin>12*60;
    const nextBreakStart=hasLunchBreak?"12:00":newEnd;
    const nextBreakEnd=hasLunchBreak?"13:00":newEnd;
    const periodStats=countDaysInRange(period.start_date,period.end_date,newDays);
    const periodPayload=[{...period,total_days:periodStats.totalDays,work_days_count:periodStats.workDays}];
    const weeklyHours=Math.round(netDailyHours(newStart,newEnd,nextBreakStart,nextBreakEnd)*newDays.length*10)/10;
    const documentText=buildWorkTimeChangeDocument(employee,periodPayload,newDays,newStart,newEnd,nextBreakStart,nextBreakEnd,raw,"work_time");
    const {error}=await supabase.from("work_time_change_requests").insert({
      employee_id:employee.id,
      old_work_days:oldDays,
      old_work_start:oldStart,
      old_work_end:oldEnd,
      old_break_start:"12:00",
      old_break_end:"13:00",
      new_work_days:newDays,
      new_work_start:newStart,
      new_work_end:newEnd,
      new_break_start:nextBreakStart,
      new_break_end:nextBreakEnd,
      periods:periodPayload,
      total_calendar_days:periodStats.totalDays,
      total_work_days:periodStats.workDays,
      weekly_work_hours:weeklyHours,
      reason:raw,
      legal_notice_version:WORK_TIME_LEGAL_NOTICE_VERSION,
      document_text:documentText,
      status:"approved",
      reviewed_by:currentEmployee.id,
      reviewed_at:new Date().toISOString(),
      review_note:"관리자 한 줄 일정 변경",
    });
    if(error) throw error;
  }
  async function applyScheduleCommand(){
    if(readOnly) return;
    const raw=scheduleCommand.trim();
    if(!raw) return setMessage("변경할 일정을 한 줄로 입력해주세요. 예: 홍준기 월화수 09:00~18:00");
    const employee=commandTargetEmployee(raw);
    if(!employee) return setMessage("직원 이름을 찾지 못했습니다. 예: 홍준기 월화수 09:00~18:00");
    const noWork=/출근\s*(?:안|못|불가)|근무\s*(?:안|못|불가)|일\s*(?:안|못)|안\s*함|못\s*(?:나오|나|함)|휴무|쉬는|쉼/.test(raw);
    const recurringDays=!noWork&&hasWeeklyRepeatIntent(raw)?commandDays(raw,[]):[];
    const openEndedDateRange=(noWork||recurringDays.length>0)?parseOpenEndedDateRange(raw,0):null;
    const parsedDateRanges=openEndedDateRange?null:parseScheduleCommandDateRanges(raw);
    const fallbackDateRange=openEndedDateRange??parseKoreanDateRange(raw,0);
    const commandDateRanges=parsedDateRanges??(fallbackDateRange?[fallbackDateRange]:null);
    const dateRange=commandDateRanges?.[0]??null;
    const parsedTimeRanges=parsePromptTimeRanges(raw);
    const parsedTime=parsedTimeRanges[0]??parsePromptTimeRange(raw);
    const singleTime=parsedTime?null:parsePromptSingleTime(raw);
    if(openEndedDateRange&&recurringDays.length>0){
      const schedule=getScheduleForDate(employee,openEndedDateRange.start_date,overrides,workTimeChanges);
      let nextStart=parsedTime?.start??String(schedule.work_start??employee.work_start??"09:00").slice(0,5);
      let nextEnd=parsedTime?.end??String(schedule.work_end??employee.work_end??"18:00").slice(0,5);
      const startMin=timeToMinutes(nextStart);
      const endMin=timeToMinutes(nextEnd);
      if(startMin!=null&&endMin!=null&&endMin<=startMin) nextEnd=minutesToTime(startMin+8*60);
      const preview=[
        `${employee.name} 직원의 근무조건을 ${periodRangeLabel(openEndedDateRange)} 적용으로 저장합니다.`,
        `변경: 매주 ${daysLabel(recurringDays)} · ${timeLabel(nextStart)}~${timeLabel(nextEnd)}`,
        "",
        "기본 근무일정 전체를 덮어쓰지 않고, 이 기간에만 적용되는 승인된 근무조건으로 저장합니다.",
        "이대로 반영할까요?"
      ].join("\n");
      if(!window.confirm(preview)) return;
      try {
        await saveApprovedRecurringWorkChange(employee,openEndedDateRange,recurringDays,nextStart,nextEnd,raw);
        setScheduleCommand("");
        setMessage(`${employee.name} ${periodRangeLabel(openEndedDateRange)} 매주 ${daysLabel(recurringDays)} 근무조건을 저장했습니다.`);
        await onChanged();
      } catch(error:any) {
        setMessage(`일정 변경 실패: ${error.message}`);
      }
      return;
    }
    if(dateRange){
      const dateRangeList=commandDateRanges??[dateRange];
      const schedule=getScheduleForDate(employee,dateRange.start_date,overrides,workTimeChanges);
      let nextStart=String(schedule.work_start??employee.work_start??"09:00").slice(0,5);
      let nextEnd=String(schedule.work_end??employee.work_end??"18:00").slice(0,5);
      const periodLabel=dateRangeList.map((period:any)=>period.start_date===period.end_date?period.start_date:periodRangeLabel(period)).join(" / ");
      if(!noWork&&parsedTimeRanges.length>1){
        const ranges=parsedTimeRanges.map((range:any,index:number)=>{
          let end=range.end;
          const startMin=timeToMinutes(range.start);
          const endMin=timeToMinutes(end);
          if(startMin!=null&&endMin!=null&&endMin<=startMin) end=minutesToTime(startMin+8*60);
          return {start:range.start,end,title:`시간 변경 근무 ${index+1}`};
        });
        const preview=[
          `${employee.name} 직원의 ${periodLabel} 일정만 변경합니다.`,
          ...ranges.map((range:any,index:number)=>`변경 ${index+1}: ${timeLabel(range.start)}~${timeLabel(range.end)}`),
          "",
          "기본 주간 근무요일은 바꾸지 않습니다.",
          "이 일정대로 반영할까요?"
        ].join("\n");
        if(!window.confirm(preview)) return;
        const existingTimeChanges=events.filter((event:any)=>
          event.employee_id===employee.id
          && dateRangeList.some((period:any)=>event.start_date===period.start_date&&event.end_date===period.end_date)
          && event.event_type==="work"
          && /^시간 변경 근무(?: \d+)?$/.test(String(event.title??""))
        );
        const results=await Promise.all(dateRangeList.flatMap((period:any)=>ranges.map((range:any,index:number)=>{
          const payload={
            employee_id:employee.id,
            title:range.title,
            event_type:"work",
            start_date:period.start_date,
            end_date:period.end_date,
            start_time:range.start,
            end_time:range.end,
            note:null,
            updated_at:new Date().toISOString(),
          };
          const existing=existingTimeChanges.find((event:any)=>event.start_date===period.start_date&&event.end_date===period.end_date&&event.title===range.title)??(index===0?existingTimeChanges.find((event:any)=>event.start_date===period.start_date&&event.end_date===period.end_date&&event.title==="시간 변경 근무"):null);
          return existing?.id
            ? supabase.from("employee_schedule_events").update(payload).eq("id",existing.id)
            : supabase.from("employee_schedule_events").insert({...payload,created_by:currentEmployee.id});
        })));
        const failed=results.find((result:any)=>result.error);
        if(failed?.error) return setMessage(`일정 변경 실패: ${failed.error.message}`);
        const keepTitles=new Set(ranges.map((range:any)=>range.title));
        const extraIds=existingTimeChanges.filter((event:any)=>!keepTitles.has(event.title)).map((event:any)=>event.id);
        if(extraIds.length>0) await supabase.from("employee_schedule_events").delete().in("id",extraIds);
        setScheduleCommand("");
        setMessage(`${employee.name} ${periodLabel} 일정 ${ranges.length}건을 변경했습니다.`);
        await onChanged();
        return;
      }
      if(parsedTime){
        nextStart=parsedTime.start;
        nextEnd=parsedTime.end;
      }else if(singleTime){
        if(/퇴근|종료|마감|끝/.test(raw)) nextEnd=singleTime;
        else nextStart=singleTime;
      }
      const startMin=timeToMinutes(nextStart);
      const endMin=timeToMinutes(nextEnd);
      if(!noWork&&startMin!=null&&endMin!=null&&endMin<=startMin) nextEnd=minutesToTime(startMin+8*60);
      const title=noWork?"출근 안 함":"시간 변경 근무";
      const preview=[
        `${employee.name} 직원의 ${periodLabel} 일정만 변경합니다.`,
        noWork ? "변경: 출근 안 함" : `변경: ${timeLabel(nextStart)}~${timeLabel(nextEnd)}`,
        "",
        "기본 주간 근무요일은 바꾸지 않습니다.",
        "이 일정대로 반영할까요?"
      ].join("\n");
      if(!window.confirm(preview)) return;
      const replaceOverlappingNoWork=noWork;
      const replacedIds=new Set<string>();
      if(replaceOverlappingNoWork){
        const overlapIds=events
          .filter((event:any)=>event.employee_id===employee.id&&["hidden","unavailable"].includes(event.event_type)&&dateRangeList.some((period:any)=>dateRangesOverlap(period.start_date,period.end_date,event.start_date,event.end_date)))
          .map((event:any)=>event.id)
          .filter(Boolean);
        if(overlapIds.length>0){
          const cleanup=await supabase.from("employee_schedule_events").delete().in("id",overlapIds);
          if(cleanup.error) return setMessage(`기존 일정 정리 실패: ${cleanup.error.message}`);
          overlapIds.forEach((id:string)=>replacedIds.add(id));
        }
      }
      const results=await Promise.all(dateRangeList.map((period:any)=>{
        const payload={
          employee_id:employee.id,
          title,
          event_type:noWork?"unavailable":"work",
          start_date:period.start_date,
          end_date:period.end_date,
          start_time:noWork?"09:00":nextStart,
          end_time:noWork?"19:00":nextEnd,
          note:null,
          updated_at:new Date().toISOString(),
        };
        const existing=events.find((event:any)=>!replacedIds.has(event.id)&&event.employee_id===employee.id&&event.start_date===period.start_date&&event.end_date===period.end_date&&["hidden","unavailable","work","am_only","pm_only"].includes(event.event_type));
        return existing?.id
          ? supabase.from("employee_schedule_events").update(payload).eq("id",existing.id)
          : supabase.from("employee_schedule_events").insert({...payload,created_by:currentEmployee.id});
      }));
      const failed=results.find((result:any)=>result.error);
      if(failed?.error) return setMessage(`일정 변경 실패: ${failed.error.message}`);
      setScheduleCommand("");
      setMessage(`${employee.name} ${periodLabel} 일정을 ${dateRangeList.length}건 변경했습니다.`);
      await onChanged();
      return;
    }
    if(hasDateIntent(raw)) return setMessage("날짜·반복 표현을 해석하지 못해 기본 근무일정을 바꾸지 않았습니다. 예: 정혜리 8월 27일부터 매주 화, 목 오전 여덟시 반부터 오후 열두시 반까지 근무");
    const oldDays=employee.work_days??["mon","tue","wed","thu","fri"];
    const nextDays=commandDays(raw,oldDays);
    const nextStart=parsedTime?.start??String(employee.work_start??"09:00").slice(0,5);
    const nextEnd=parsedTime?.end??String(employee.work_end??"18:00").slice(0,5);
    const dailyHours=netDailyHours(nextStart,nextEnd,"12:00","13:00");
    const weeklyWorkDays=nextDays.length;
    const monthlyStandardHours=monthlyPaidHours(weeklyWorkDays,dailyHours);
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
    if(readOnly) return;
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
    if(readOnly) return;
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
    if(readOnly) return;
    if(!editing?.fromBase) return;
    const employee=activeEmployees.find(e=>e.id===editing.employee_id);
    if(!employee) return setMessage("직원을 찾지 못했습니다.");
    const sourceDate=editing.source_date??editing.start_date;
    setMovingBase({employeeId:employee.id,employeeName:employee.name,sourceDate});
    setEditing(null);
    setMessage(`${employee.name} ${DAY_LABELS[dayKeyFromDate(dateFromIso(sourceDate))]}요일 근무를 이동할 날짜 칸을 눌러주세요.`);
  }
  async function moveEvent(targetEmployeeId:string,targetDate:string){
    if(readOnly) return;
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
    if(readOnly) return;
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
    if(readOnly) return;
    if(movingBase) moveBaseWorkday(employeeId,date);
  }
  async function reorderEmployees(targetEmployeeId:string){
    if(readOnly) return;
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
    const companyHoliday=isCompanySummerHolidayDate(date)?[companyHolidayLeaveObject(date)]:[];
    return [...companyHoliday,...leaveRequests
      .filter(request=>request.employee_id===employee.id&&date>=request.start_date&&date<=request.end_date)
    ].map(request=>{
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
          note:request.request_type==="company_holiday"
            ? COMPANY_SUMMER_HOLIDAY.description
            : showAdminScheduleDetails ? request.reason??"" : "개인 사유",
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
  function teamMonthIssueChips(date:string) {
    const chips:any[]=[];
    if(isCompanySummerHolidayDate(date)) chips.push({key:`holiday-${date}`,type:"holiday",kind:"공통",title:COMPANY_SUMMER_HOLIDAY.title,detail:"공통 여름휴가"});
    const issueEmployees=isAll?monthIssueEmployees:visibleEmployees;
    issueEmployees.forEach((employee:any)=>{
      const employeeColor=employeeColorFromList(monthIssueEmployees,employee.id);
      const info=workInfoForDate(employee,date);
      if(info.leave&&info.leave.request_type!=="company_holiday") {
        chips.push({
          key:`leave-${employee.id}-${date}`,
          type:"leave",
          kind:"휴가",
          employeeColor,
          title:`${employee.name} · ${showAdminScheduleDetails?leaveTypeDisplayLabel(info.leave):"개인 사유"}`,
          detail:showAdminScheduleDetails?`${timeLabel(info.start)}~${timeLabel(info.end)} ${info.leave.reason??""}`:"휴가/일정 확인",
        });
      }
      events
        .filter((event:any)=>event.employee_id===employee.id&&date>=event.start_date&&date<=event.end_date&&["hidden","unavailable"].includes(event.event_type))
        .map((event:any)=>displayScheduleEvent(event))
        .filter((event:any)=>event?.event_type==="unavailable")
        .forEach((event:any)=>chips.push({
          key:`unavailable-${event.id}-${date}`,
          type:"gap",
          kind:"공백",
          employeeColor,
          title:`${employee.name} · ${scheduleEventTitleForViewer(event)}`,
          detail:showAdminScheduleDetails?(event.note||`${event.start_date}~${event.end_date}`):"일정 확인이 필요한 날입니다.",
        }));
      absences
        .filter((absence:any)=>absence.employee_id===employee.id&&date>=absence.start_date&&date<=absence.end_date)
        .forEach((absence:any)=>chips.push({
          key:`absence-${absence.id}-${date}`,
          type:"gap",
          kind:"공백",
          employeeColor,
          title:`${employee.name} · 미출근`,
          detail:showAdminScheduleDetails?`${absence.unpaid?"급여 공제":"급여 공제 없음"} · ${absence.reason??"-"}`:"일정 확인이 필요한 날입니다.",
        }));
      overtimeEventsFor(employee,date).forEach((event:any)=>chips.push({
        key:event.id,
        type:event.overtimeStatus==="approved"?"overtime approved":"overtime",
        kind:event.overtimeStatus==="approved"?"승인 추가근무":"추가근무",
        employeeColor,
        title:`${employee.name} · ${event.title}`,
        detail:`${event.start_time}~${event.end_time}`,
      }));
      events.filter((event:any)=>event.employee_id===employee.id&&date>=event.start_date&&date<=event.end_date&&event.event_type==="info").forEach((event:any)=>chips.push({
        key:`info-${event.id}-${date}`,
        type:"info",
        kind:"일정",
        employeeColor,
        title:showAdminScheduleDetails ? event.title||"일정 확인" : `${employee.name} · 개인 사유`,
        detail:showAdminScheduleDetails?event.note??"": "해당일은 일정 확인이 필요한 날입니다.",
      }));
    });
    return chips;
  }
  const teamMonthDayKeys=["sun","mon","tue","wed","thu","fri","sat"];
  const teamMonthDates=monthDates(monthRange.start);
  const teamMonthOffset=teamMonthDayKeys.indexOf(dayKeyFromDate(dateFromIso(teamMonthDates[0]??monthRange.start)));
  const teamMonthCells=Array.from({length:Math.ceil((teamMonthOffset+teamMonthDates.length)/7)*7},(_,index)=>teamMonthDates[index-teamMonthOffset]??null);
  function beginTimeDrag(e:React.PointerEvent,event:any,employee:any,date:string,edge:"move"|"start"|"end"){
    if(readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const [start,end]=eventTime(event,employee);
    const drag={event,employee,date,edge,startY:e.clientY,startMin:timeToMinutes(start)??540,endMin:timeToMinutes(end)??1080};
    timeDragRef.current=drag;
    setTimeDrag(drag);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  async function finishTimeDrag(e:React.PointerEvent){
    if(readOnly) return;
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
          <p className="subtle" style={{margin:0}}>{readOnly?"직원별 근무 일정을 함께 확인합니다. 이름을 누르면 해당 직원 일정만 강조됩니다.":"월요일부터 금요일까지 실제 시간대로 확인합니다. 기본 근무칸을 누른 뒤 이동할 날짜 칸을 누르면 근무요일이 바뀝니다."}</p>
        </div>
      </div>
      {!readOnly&&<>
        <div className="schedule-command-bar">
          <i className="ti ti-sparkles" aria-hidden="true"></i>
          <input className="input" value={scheduleCommand} onChange={e=>setScheduleCommand(e.target.value)} onKeyDown={e=>e.key==="Enter"&&applyScheduleCommand()} placeholder="예: 정혜리 8월 27일부터 매주 화, 목 오전 여덟시 반부터 오후 열두시 반까지 근무" />
          <button className="button secondary" onClick={applyScheduleCommand}>일정 변경</button>
        </div>
        <p className="subtle schedule-command-help">날짜를 쓰면 해당 날짜만, “부터+매주”를 쓰면 기간형 근무조건으로 저장됩니다. 날짜 없이 요일과 시간을 쓰는 경우에만 기본 근무일정을 바꿉니다.</p>
        {message&&<div className={`alert ${message.includes("실패")?"error":"success"}`} style={{marginTop:14}}>{message}</div>}
        {movingBase&&<div className="alert" style={{marginTop:14}}>{movingBase.employeeName}의 {DAY_LABELS[dayKeyFromDate(dateFromIso(movingBase.sourceDate))]}요일 근무를 이동할 날짜 칸을 눌러주세요.</div>}
      </>}
      <div className="schedule-view-switch">
        <button type="button" className={scheduleViewMode==="week"?"active":""} onClick={()=>setScheduleViewMode("week")}><i className="ti ti-layout-grid" aria-hidden="true"></i>주간표</button>
        <button type="button" className={scheduleViewMode==="month"?"active":""} onClick={()=>setScheduleViewMode("month")}><i className="ti ti-calendar-month" aria-hidden="true"></i>월간 이슈 보기</button>
      </div>
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
      {scheduleViewMode==="month"&&(
        <div className="team-month-issue-calendar">
          <div className="team-month-title">
            <b>{dateFromIso(monthRange.start).getFullYear()}년 {dateFromIso(monthRange.start).getMonth()+1}월</b>
            <span>{showAdminScheduleDetails?"휴가·추가근무·운영 공백만 표시합니다.":"휴가·추가근무·일정 확인이 필요한 날만 표시합니다."}</span>
          </div>
          <div className="team-month-grid">
            {teamMonthDayKeys.map(day=><div className={`team-month-head ${day==="sun"||day==="sat"?"weekend":""}`} key={day}>{DAY_LABELS[day]}</div>)}
            {teamMonthCells.map((date,index)=>{
              const chips=date?teamMonthIssueChips(date):[];
              const weekend=date?[0,6].includes(dateFromIso(date).getDay()):false;
              return <div className={`team-month-cell ${date?"":"empty"} ${date===todayIso()?"today":""} ${weekend?"weekend":""}`} key={date??`empty-${index}`}>
                {date&&<><b>{Number(date.slice(8))}</b>{chips.map(chip=><span className={`team-month-chip ${chip.type}`} style={chip.employeeColor?{"--employee-color":chip.employeeColor} as React.CSSProperties:undefined} key={chip.key} title={chip.detail}><em>{chip.kind}</em><strong>{chip.title}</strong><small>{chip.detail}</small></span>)}</>}
              </div>;
            })}
          </div>
        </div>
      )}
      {isAll&&activeEmployees.length>0&&(
        <div className={`team-week-overview ${focusActive?"focusing":""}`}>
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
              const monthStats=scheduledWorkStatsWithEvents(employee,monthRange.start,monthRange.end);
              return [
                <button type="button" className={`team-week-employee ${focusEmployeeId===employee.id?"focused":""} ${focusActive&&focusEmployeeId!==employee.id?"dimmed":""}`} key={`${employee.id}-name`} onClick={()=>setFocusEmployeeId(current=>current===employee.id?"":employee.id)} title={`${employee.name} 일정 집중 보기`}><i style={{background:color}}></i><div><b>{employee.name}</b><small>{[employee.department,employee.position].filter(Boolean).join(" · ")||employee.employee_no}</small>{showAdminScheduleDetails&&<small className="team-week-month">{dateFromIso(monthRange.start).getMonth()+1}월 / 근무일수 {monthStats.days}일 / 근무시간 {formatHourValue(monthStats.hours)}시간</small>}</div></button>,
                ...dates.map(date=>{
                  const info=workInfoForDate(employee,date);
                  const leaveLabel=info.leave?leaveTypeDisplayLabel(info.leave):"";
                  const offLabel=info.fullLeave ? leaveLabel : info.event?.title&&!info.workday?scheduleEventTitleForViewer(info.event):"휴무";
                  const hasWork=info.workday&&info.hours>0;
                  return <div className={`team-week-cell ${hasWork?"":"off"} ${focusActive&&focusEmployeeId!==employee.id?"dimmed":""}`} key={`${employee.id}-${date}`} style={{"--employee-color":color} as React.CSSProperties}>
                    <b>{hasWork?`${timeLabel(info.start)}~${timeLabel(info.end)}`:offLabel}</b>
                    <small>{hasWork?`실근무 ${formatHourValue(info.hours)}시간${leaveLabel?` · ${leaveLabel}`:""}`:info.fullLeave?"근무 없음 · 휴가":"근무 없음"}</small>
                  </div>;
                }),
              ];
            })}
          </div>
        </div>
      )}
      <div className="week-calendar-scroll">
        <div className={`week-calendar ${isAll?"team-view":""} ${focusActive?"employee-focus-active":""}`} style={isAll?{minWidth:78+teamColumnCount*59}:undefined}>
          <div className={`week-calendar-header ${isAll?"team-calendar-header":""}`} style={isAll?{gridTemplateColumns:`78px repeat(${teamColumnCount},59px)`}:undefined}>
            <div className="week-time-head" style={isAll?{gridRow:"1 / span 2"}:undefined}>시간</div>
            {dates.map((date,dateIndex)=>{
              const d=dateFromIso(date);
              return <div key={date} className={`${date===todayIso()?"today":""} ${isAll?"team-day-head":""}`} style={isAll?{gridColumn:`${dateIndex*employeeCount+2} / span ${employeeCount}`,gridRow:1}:undefined}><b>{["일","월","화","수","목","금","토"][d.getDay()]} {d.getMonth()+1}/{d.getDate()}</b>{!isAll&&<span>{d.getMonth()+1}/{d.getDate()}</span>}</div>;
            })}
            {isAll&&dates.flatMap((date,dateIndex)=>activeEmployees.map((employee,employeeIndex)=>{
              const color=employeeColorFromList(activeEmployees,employee.id);
              return <button key={`${date}-${employee.id}-head`} draggable={!readOnly} className={`team-employee-head ${draggingEmployeeId===employee.id?"dragging":""} ${employeeIndex===activeEmployees.length-1?"team-day-end":""} ${focusEmployeeId===employee.id?"focused":""} ${focusActive&&focusEmployeeId!==employee.id?"focus-dimmed":""}`} style={{gridColumn:dateIndex*employeeCount+employeeIndex+2,gridRow:2,"--employee-color":color} as React.CSSProperties} onDragStart={e=>{if(readOnly){e.preventDefault();return;}setDraggingEmployeeId(employee.id);e.dataTransfer.effectAllowed="move";}} onDragOver={e=>{if(!readOnly)e.preventDefault();}} onDrop={()=>!readOnly&&reorderEmployees(employee.id)} onDragEnd={()=>setDraggingEmployeeId(null)} onClick={()=>setFocusEmployeeId(current=>current===employee.id?"":employee.id)} title={readOnly?`${employee.name} 일정 집중 보기`:`${employee.name} 드래그로 순서 변경 · 클릭하면 일정 집중 보기`}><span>{employee.name}</span></button>;
            }))}
          </div>
          {!isAll&&<div className="week-all-day">
            <div className="week-all-day-label">종일</div>
            <div className="week-all-day-track">
              {dates.map(date=><div key={date} className={`week-drop-column ${movingBase?"moving-target":""}`} onClick={()=>!readOnly&&selectedEmployee&&handleScheduleCellClick(selectedEmployee.id,date)} onDragOver={e=>{if(!readOnly)e.preventDefault();}} onDrop={()=>!readOnly&&moveEvent(selectedEmployee?.id??"",date)} onDoubleClick={()=>!readOnly&&setEditing(emptyEvent(selectedEmployee?.id??activeEmployees[0]?.id,date))} />)}
              {allDayEvents.map(event=>{
                const visible=dates.map((date,index)=>({date,index})).filter(x=>x.date>=event.start_date&&x.date<=event.end_date);
                if(!visible.length) return null;
                const owner=activeEmployees.find(emp=>emp.id===event.employee_id);
                const color=owner?employeeColorFromList(activeEmployees,owner.id):selectedColor;
                return <button key={event.id} draggable={!readOnly} className="week-all-day-event" style={{gridColumn:`${visible[0].index+1} / span ${visible.length}`,"--employee-color":color} as React.CSSProperties} onDragStart={e=>{if(readOnly){e.preventDefault();return;}setDraggingId(event.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>setDraggingId(null)} onClick={()=>!readOnly&&setEditing({...event,start_time:event.start_time?.slice(0,5)??"",end_time:event.end_time?.slice(0,5)??""})}><b>{scheduleEventTitleForViewer(event)}</b><span>{scheduleEventNoteForViewer(event)||`${event.start_date}~${event.end_date}`}</span></button>;
              })}
            </div>
          </div>}
          <div className="week-time-grid">
            <div className="week-time-axis" style={{height:calendarHeight}}>{hours.map(hour=><div key={hour}>{String(hour).padStart(2,"0")}:00</div>)}</div>
            <div className={`week-event-grid ${isAll?"team-event-grid":""}`} style={{height:calendarHeight,gridTemplateRows:`repeat(${calendarRows},${calendarRowHeight}px)`,backgroundSize:`100% ${calendarRowHeight}px,100% ${calendarRowHeight*2}px`,...(isAll?{gridTemplateColumns:`repeat(${teamColumnCount},59px)`}:{})}}>
              {isAll
                ? dates.flatMap((date,dateIndex)=>activeEmployees.map((employee,employeeIndex)=><div key={`${date}-${employee.id}-drop`} className={`week-day-column team-employee-column ${employeeIndex===activeEmployees.length-1?"team-day-end":""} ${date===todayIso()?"today":""} ${movingBase?"moving-target":""} ${focusActive&&focusEmployeeId!==employee.id?"focus-dimmed":""}`} style={{gridColumn:dateIndex*employeeCount+employeeIndex+1,gridRow:`1 / span ${calendarRows}`}} onClick={()=>!readOnly&&handleScheduleCellClick(employee.id,date)} onDragOver={e=>{if(!readOnly)e.preventDefault();}} onDrop={()=>!readOnly&&moveEvent(employee.id,date)} onDoubleClick={()=>!readOnly&&setEditing(emptyEvent(employee.id,date))} />))
                : dates.map((date,index)=><div key={date} className={`week-day-column ${date===todayIso()?"today":""} ${movingBase?"moving-target":""}`} style={{gridColumn:index+1,gridRow:`1 / span ${calendarRows}`}} onClick={()=>!readOnly&&selectedEmployee&&handleScheduleCellClick(selectedEmployee.id,date)} onDragOver={e=>{if(!readOnly)e.preventDefault();}} onDrop={()=>!readOnly&&moveEvent(selectedEmployee?.id??"",date)} onDoubleClick={()=>!readOnly&&setEditing(emptyEvent(selectedEmployee?.id??activeEmployees[0]?.id,date))} />)}
              {dates.flatMap((date,index)=>{
                const shownEmployees=isAll?activeEmployees:(selectedEmployee?[selectedEmployee]:[]);
                return shownEmployees.flatMap((employee:any,employeeIndex:number)=>{
                  const rawDayEvents=timedEvents.filter(event=>event.employee_id===employee.id&&date>=event.start_date&&date<=event.end_date);
                  const dayEvents=rawDayEvents.map((event:any)=>displayScheduleEventForDate(employee,event,date));
                  const leaveEvents=leaveEventsFor(employee,date);
                  const overtimeEvents=overtimeEventsFor(employee,date);
                  const shown=[...dayEvents.filter(event=>event.event_type!=="hidden"),...leaveEvents,...overtimeEvents];
                  const fullDayLeaveEvents=leaveEvents.filter(event=>!["hourly","comp_leave_use","half_am","half_pm"].includes(event.request_type));
                  const suppressBase=fullDayLeaveEvents.length>0||rawDayEvents.some(event=>["hidden","work","unavailable","am_only","pm_only"].includes(event.event_type));
                  const schedule=getScheduleForDate(employee,date,overrides,workTimeChanges);
                  const isBaseWorkday=(schedule.work_days??[]).includes(dayKeyFromDate(dateFromIso(date)));
                  const baseWork=!suppressBase&&isBaseWorkday?{id:`base-${employee.id}-${date}`,employee_id:employee.id,title:employee.schedule_title??"기본 근무",event_type:"work",start_time:schedule.work_start,end_time:schedule.work_end,note:employee.schedule_note??"",base:true}:null;
                  const color=employeeColorFromList(activeEmployees,employee.id);
                  return [...shown,...(baseWork?[baseWork]:[])].map((event:any)=>{
                    const pos=timeGridPosition(event,employee);
                    const meta=SCHEDULE_EVENT_META[event.event_type]??SCHEDULE_EVENT_META.info;
                    const gridColumn=isAll?index*employeeCount+employeeIndex+1:index+1;
                    const canEditEvent=!readOnly&&!event.leave&&!event.readonly;
                    const eventTitle=scheduleEventTitleForViewer(event);
                    const eventNote=scheduleEventNoteForViewer(event);
                    const openEditor=()=>{
                      if(!canEditEvent) return;
                      if(Date.now()<timeDragClickGuard.current) return;
                      if(event.base){
                        setMovingBase(null);
                        setEditing({...event,id:undefined,base:undefined,fromBase:true,source_date:date,start_date:date,end_date:date,start_time:String(event.start_time??"09:00").slice(0,5),end_time:String(event.end_time??"18:00").slice(0,5),apply_all:false});
                        return;
                      }
                      setEditing({...event,original_title:event.title,start_time:event.start_time?.slice(0,5)??"",end_time:event.end_time?.slice(0,5)??"",apply_all:false});
                    };
                    return <button key={`${event.id}-${date}`} title={`${employee.name} · ${eventTitle||"빈 일정"} · ${pos.label}${event.leave?" · 승인된 휴가":event.readonly||readOnly?"":" · 눌러서 수정"}`} draggable={canEditEvent&&!event.base} className={`week-time-event event-${event.event_type} ${event.overtimeStatus?`overtime-${event.overtimeStatus}`:""} ${isAll?"team-lane-event":""} ${focusActive&&focusEmployeeId!==employee.id?"focus-dimmed":focusActive?"focus-live":""}`} style={{gridColumn,gridRow:`${pos.row} / span ${pos.span}`,"--employee-color":color} as React.CSSProperties} onDragStart={e=>{if(!canEditEvent||event.base){e.preventDefault();return;}setDraggingId(event.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>setDraggingId(null)} onClick={openEditor}>
                      {canEditEvent&&<><span className="time-resize-handle top" title="시작 시간 드래그" onPointerDown={e=>beginTimeDrag(e,event,employee,date,"start")} onPointerUp={finishTimeDrag}></span>
                      <span className="time-resize-handle move" title="일정 시간 이동" onPointerDown={e=>beginTimeDrag(e,event,employee,date,"move")} onPointerUp={finishTimeDrag}><i className="ti ti-grip-horizontal" aria-hidden="true"></i></span></>}
                      {eventTitle&&<b>{!isAll&&<i className={`ti ${meta.icon}`} aria-hidden="true"></i>}{eventTitle}</b>}<span className="event-time-label"><em>{pos.start}</em><i>~</i><em>{pos.end}</em></span>{eventNote&&<small>{eventNote}</small>}
                      {canEditEvent&&<span className="time-resize-handle bottom" title="종료 시간 드래그" onPointerDown={e=>beginTimeDrag(e,event,employee,date,"end")} onPointerUp={finishTimeDrag}></span>}
                    </button>;
                  });
                });
              })}
            </div>
          </div>
        </div>
      </div>
      <p className="schedule-help"><i className="ti ti-info-circle" aria-hidden="true"></i>{readOnly?"직원 이름을 누르면 해당 직원 일정만 강조됩니다.":isAll?"요일 아래 직원별 열을 표시합니다. 이름을 누르면 개인 일정으로 이동하고, 모든 일정칸은 눌러서 수정할 수 있습니다.":"빈 시간대를 두 번 누르면 일정을 추가하고, 일정칸을 누르면 수정할 수 있습니다."} 토요일과 일요일은 표시하지 않습니다.</p>
      {activeEmployees.length===0&&<p className="subtle">표시할 직원이 없습니다.</p>}
      {!readOnly&&editing&&<div className="modal-backdrop" onClick={()=>setEditing(null)}>
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
  // 주말 + 퇴근 있는 로그 중, 아직 보상휴가 신청 안 된 것
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
      const {data:ins,error}=await supabase.from("comp_time_requests").insert({employee_id:l.employee_id,work_date:wd,hours,converted_days:Number((hours/8).toFixed(4)),reason:"주말 근무 보상휴가(관리자 일괄)",status:"pending"}).select().single();
      if(!error&&ins) await supabase.rpc("review_comp_time_request",{p_request_id:ins.id,p_status:"approved",p_review_note:"관리자 일괄 부여"});
    }
    setMsg(`${picked.length}건 보상휴가를 부여했습니다.`); setSel({}); onChanged();
  }
  if(weekendLogs.length===0) return null;
  return (
    <section className="card">
      <h2 className="card-title"><i className="ti ti-calendar-plus" aria-hidden="true"></i>주말 근무 보상휴가 일괄 부여</h2>
      <p className="subtle" style={{marginBottom:12}}>아직 보상휴가가 적립되지 않은 주말 근무 기록입니다. 선택 후 일괄 부여하면 즉시 적립 내역에 반영됩니다.</p>
      {msg&&<div className={`alert ${msg.includes("부여")?"success":""}`}>{msg}</div>}
      {weekendLogs.map(l=>{
        const mins=workedMinutes(l.check_in_time,l.check_out_time); const hours=mins?Math.round(mins/6)/10:0;
        return (
          <label className="list-row" key={l.id} style={{cursor:"pointer"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="checkbox" checked={!!sel[l.id]} onChange={e=>setSel({...sel,[l.id]:e.target.checked})} style={{width:18,height:18,accentColor:"#3a6df0"}} />
              <div><b>{empMap[l.employee_id]?.name??"-"}</b><div className="subtle">{localDateStr(l.check_in_time)} · {hours}시간</div></div>
            </div>
            <span className="badge">{hours}시간</span>
          </label>
        );
      })}
      <button className="button" style={{marginTop:10}} onClick={grantAll}><i className="ti ti-check" aria-hidden="true"></i>선택 항목 일괄 부여</button>
    </section>
  );
}

function PayrollCard({ employees, absences, overrides, workTimeChanges, scheduleEvents, readOnly=false }: { employees:any[]; absences:any[]; overrides:any[]; workTimeChanges:any[]; scheduleEvents:any[]; readOnly?:boolean }) {
  const [empId,setEmpId]=useState("");
  const [pay,setPay]=useState({monthly:"",hourly:"",annual:"",weeklyDays:"",dailyHours:"",monthlyHours:""});
  const [payFixed,setPayFixed]=useState<Record<string,boolean>>(payrollFixedState(null));
  const [payMsg,setPayMsg]=useState("");
  const [localEmployees,setLocalEmployees]=useState<any[]>(employees);
  const [payrollMonthValue,setPayrollMonthValue]=useState(todayIso().slice(0,7));
  useEffect(()=>{setLocalEmployees(employees);},[employees]);
  const payrollBaseEmployees=localEmployees.filter((employee:any)=>!isTestEmployee(employee)&&!employee.is_unpaid);
  const emp=empId?payrollBaseEmployees.find(e=>e.id===empId):null;
  useEffect(()=>{
    if(empId&&!payrollBaseEmployees.some((employee:any)=>employee.id===empId)) setEmpId("");
  },[empId,localEmployees.length]);
  function recalc(next:any, source:string, fixedOverride?:Record<string,boolean>) {
    const fixed=fixedOverride??payFixed;
    const weeklyDays=numberValue(next.weeklyDays);
    const dailyHours=numberValue(next.dailyHours);
    const calculatedMonthlyHours=weeklyDays>0&&dailyHours>0?monthlyPaidHours(weeklyDays,dailyHours):0;
    const monthlyHours=fixed.monthlyHours&&source!=="monthlyHours"
      ? numberValue(next.monthlyHours)
      : source==="monthlyHours"?numberValue(next.monthlyHours):(calculatedMonthlyHours||numberValue(next.monthlyHours));
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
    const result:any = {
      monthly: monthly?monthly.toLocaleString("ko-KR"):"",
      hourly: hourly?hourly.toLocaleString("ko-KR"):"",
      annual: annual?annual.toLocaleString("ko-KR"):"",
      weeklyDays: next.weeklyDays,
      dailyHours: next.dailyHours,
      monthlyHours: monthlyHours?String(monthlyHours):"",
    };
    PAYROLL_FIXED_FIELDS.forEach(field=>{
      if(fixed[field]&&field!==source) result[field]=next[field]??result[field];
    });
    return result;
  }
  function setPayField(field:string, raw:string) {
    const value=["monthly","hourly","annual"].includes(field)?moneyInput(raw):raw.replace(/[^0-9.]/g,"");
    setPay(p=>recalc({...p,[field]:value},field));
  }
  useEffect(()=>{
    if(emp){
      const fixed=payrollFixedState(emp.payroll_fixed_basis);
      setPayFixed(fixed);
      const weeklyDays=Number(emp.weekly_work_days||emp.work_days?.length||5);
      const dailyHours=Number(emp.daily_work_hours||scheduleHours(emp.work_start,emp.work_end)||8);
      const monthlyHours=Math.max(Number(emp.monthly_standard_hours||0),monthlyPaidHours(weeklyDays,dailyHours));
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
      },"monthly",fixed));
      setPayMsg("");
    }
  },[empId]);
  async function saveSalary() {
    setPayMsg("");
    if(readOnly) return setPayMsg("읽기 권한만 있어 급여 설정을 저장할 수 없습니다.");
    if(!empId) return setPayMsg("직원을 선택해주세요.");
    const monthly=numberValue(pay.monthly);
    const hourly=numberValue(pay.hourly);
    const annual=numberValue(pay.annual)||monthly*12;
    const weeklyDays=numberValue(pay.weeklyDays);
    const dailyHours=numberValue(pay.dailyHours);
    const monthlyHours=numberValue(pay.monthlyHours);
    const fixedBasis=payrollFixedValues(payFixed);
    const payload:any={
      monthly_salary:monthly,
      hourly_wage:hourly,
      annual_salary:annual,
      weekly_work_days:weeklyDays,
      daily_work_hours:dailyHours,
      monthly_standard_hours:monthlyHours,
      payroll_fixed_basis:fixedBasis,
    };
    let fixedBasisSaved=true;
    let {error}=await supabase.from("employees").update(payload).eq("id",empId);
    if(error&&/payroll_fixed_basis|schema cache|column/i.test(error.message)){
      fixedBasisSaved=false;
      const {payroll_fixed_basis,...fallbackPayload}=payload;
      const fallback=await supabase.from("employees").update(fallbackPayload).eq("id",empId);
      error=fallback.error;
    }
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
        payroll_fixed_basis:fixedBasis,
      }:employee));
      setPayMsg(fixedBasisSaved?"급여 설정과 고정 기준이 저장되었습니다.":"급여 설정은 저장되었습니다. 고정 기준은 Supabase 패치 적용 후 저장됩니다.");
    }
  }
  function togglePayFixed(field:string) {
    if(readOnly) return;
    setPayFixed(prev=>({...prev,[field]:!prev[field]}));
  }
  function fixedLabel(field:string,label:string) {
    return (
      <label className="label payroll-fixed-label">
        <input type="checkbox" checked={!!payFixed[field]} disabled={readOnly} onChange={()=>togglePayFixed(field)} />
        <span>{label}</span>
        {payFixed[field]&&<em>고정</em>}
      </label>
    );
  }
  const monthly=numberValue(pay.monthly);
  const hourly=numberValue(pay.hourly);
  const annual=numberValue(pay.annual)||monthly*12;
  const monthlyHours=numberValue(pay.monthlyHours);
  const approvedWorkTimeChanges=workTimeChanges.filter((request:any)=>request.status==="approved");
  const month=monthRangeFromValue(payrollMonthValue);
  const payrollMonthLabel=monthLabel(month.start);
  const payrollMonthOptions=monthSelectOptions(todayIso(),8,2);
  const scheduledDays=emp?countScheduledWorkdays(emp, month.start, month.end, overrides, approvedWorkTimeChanges, scheduleEvents):0;
  const absentDays=emp?countUnpaidAbsenceWorkdays(emp, absences, month.start, month.end, overrides, approvedWorkTimeChanges, scheduleEvents):0;
  const dayRate=scheduledDays>0?monthly/scheduledDays:0;
  const deduction=Math.round(dayRate*absentDays);
  const baseAfterDeduction=Math.max(0,monthly-deduction);
  const ins=calcInsurance(baseAfterDeduction);
  const netPay=baseAfterDeduction-ins.employee;
  const payrollSummaryRows=payrollBaseEmployees.map((employee:any)=>{
    const monthStats=payrollScheduledWorkStats(employee,month.start,month.end,overrides,approvedWorkTimeChanges,scheduleEvents);
    const savedMonthlyHours=Number(employee.monthly_standard_hours||0);
    const baseWeeklyDays=Number(employee.weekly_work_days||employee.work_days?.length||0);
    const baseDailyHours=Number(employee.daily_work_hours||scheduleHours(employee.work_start,employee.work_end)||8);
    const monthlyStandardHours=savedMonthlyHours||monthlyPaidHours(baseWeeklyDays,baseDailyHours)||monthStats.hours;
    const monthlySalary=Number(employee.monthly_salary||0);
    const hourlyWage=Number(employee.hourly_wage||(monthlySalary&&monthlyStandardHours?Math.round(monthlySalary/monthlyStandardHours):0));
    const rowAbsentDays=countUnpaidAbsenceWorkdays(employee, absences, month.start, month.end, overrides, approvedWorkTimeChanges, scheduleEvents);
    const rowDeduction=monthlySalary&&monthStats.days>0?Math.round((monthlySalary/monthStats.days)*rowAbsentDays):0;
    const scheduledGrossPay=hourlyWage?Math.round(hourlyWage*monthStats.hours):0;
    const scheduledNetBase=Math.max(0,scheduledGrossPay-rowDeduction);
    const scheduledNetPay=scheduledNetBase?Math.max(0,scheduledNetBase-calcInsurance(scheduledNetBase).employee):0;
    return {employee,month:monthStats,monthlyStandardHours,monthlySalary,hourlyWage,scheduledGrossPay,scheduledNetPay,rowAbsentDays,rowDeduction};
  }).filter((row:any)=>(Number(row.month?.hours||0)>0||Number(row.month?.days||0)>0)&&(isEmployeeActive(row.employee)||month.end<todayIso()));
  const payrollSummaryEmployeeIds=new Set(payrollSummaryRows.map((row:any)=>row.employee.id));
  const payrollSelectableEmployees=payrollBaseEmployees
    .filter((employee:any)=>isEmployeeActive(employee)||payrollSummaryEmployeeIds.has(employee.id))
    .sort(sortEmployeesBySeniority);
  const payrollScheduledGrossPayTotal=payrollSummaryRows.reduce((sum:number,row:any)=>sum+Number(row.scheduledGrossPay||0),0);
  const payrollScheduledNetPayTotal=payrollSummaryRows.reduce((sum:number,row:any)=>sum+Number(row.scheduledNetPay||0),0);
  const payrollScheduledHoursTotal=payrollSummaryRows.reduce((sum:number,row:any)=>sum+Number(row.month?.hours||0),0);
  const payrollCopyTitle=`[${dateFromIso(month.start).getMonth()+1}월 근무 정리표]`;
  const payrollAccountantText=[
    payrollCopyTitle,
    "이름 / 근무시간 / 세전월급여",
    ...payrollSummaryRows.map((row:any)=>`${row.employee.name} / ${formatHourValue(row.month.hours)}시간 / ${won(row.scheduledGrossPay)}`),
    "",
    `합계 / ${formatHourValue(payrollScheduledHoursTotal)}시간 / ${won(payrollScheduledGrossPayTotal)}`,
  ].join("\n");
  async function copyPayrollAccountantText(){
    try{
      await navigator.clipboard.writeText(payrollAccountantText);
      setPayMsg("세무사 제출용 근무 정리표를 복사했습니다.");
    }catch{
      setPayMsg("자동 복사에 실패했습니다. 아래 정리표를 직접 선택해서 복사해주세요.");
    }
  }
  const payrollAccountantRows=payrollSummaryRows.map((row:any)=>({
    구분:"직원",
    이름:row.employee.name,
    사번:row.employee.employee_no??"-",
    부서:row.employee.department??"-",
    직책:row.employee.position??"-",
    기준월:payrollMonthLabel,
    월예정일수:row.month.days,
    월예정시간:`${formatHourValue(row.month.hours)}시간`,
    시급:row.hourlyWage?won(row.hourlyWage):"-",
    월급기준:row.monthlySalary?won(row.monthlySalary):"-",
    월예정급여세전:row.scheduledGrossPay?won(row.scheduledGrossPay):"-",
    월예정급여세후:row.scheduledNetPay?won(row.scheduledNetPay):"-",
    무급공제일수:row.rowAbsentDays,
    무급공제액:row.rowDeduction?won(row.rowDeduction):"-",
  }));
  function downloadPayrollAccountantExcel(){
    const generatedAt=new Intl.DateTimeFormat("ko-KR",{dateStyle:"long",timeStyle:"short",timeZone:"Asia/Seoul"}).format(new Date());
    const summaryRows=[
      {항목:"기준월",내용:payrollMonthLabel},
      {항목:"대상 인원",내용:`${payrollSummaryRows.length}명`},
      {항목:"월 예정시간 합계",내용:`${formatHourValue(payrollScheduledHoursTotal)}시간`},
      {항목:"월 예정급여 세전 합계",내용:won(payrollScheduledGrossPayTotal)},
      {항목:"월 예정급여 세후 추정 합계",내용:won(payrollScheduledNetPayTotal)},
    ];
    exportWorkbookToXlsx(`lupl_payroll_accountant_${payrollMonthValue}.xlsx`,[
      {name:"표지",rows:[
        {항목:"문서명",내용:`${payrollMonthLabel} 세무사 제출용 근무 정리표`},
        {항목:"생성일시",내용:generatedAt},
        {항목:"회사 확인",내용:"주식회사 러플 근태관리 시스템 기준"},
        {항목:"확인자",내용:"대표 이희은"},
      ]},
      {name:"요약",rows:summaryRows},
      {name:"원자료",rows:[
        ...payrollAccountantRows,
        {
          구분:"합계",
          이름:"합계",
          기준월:payrollMonthLabel,
          월예정시간:`${formatHourValue(payrollScheduledHoursTotal)}시간`,
          월예정급여세전:won(payrollScheduledGrossPayTotal),
          월예정급여세후:won(payrollScheduledNetPayTotal),
        },
      ]},
      {name:"검증 로그",rows:[
        {항목:"산정 기준",내용:"월 예정시간은 직원별 주간 캘린더 요약 기준입니다."},
        {항목:"제외 기준",내용:"비활성, 테스트, 무급 인력은 세무사 제출용 급여 대상에서 제외합니다."},
        {항목:"공제 기준",내용:"급여 공제 등록된 결근/미출근만 예정급여 공제에 반영합니다."},
        {항목:"최종 확인",내용:"세무 신고 전 최종 임금명세서 및 실제 지급 자료와 대조하세요."},
      ]},
    ]);
  }
  function printPayrollAccountantPdf(){
    const rows=payrollAccountantRows.map(row=>`<tr><td>${escapeHtml(row.이름)}</td><td>${escapeHtml(row.사번)}</td><td>${escapeHtml(row.월예정시간)}</td><td>${escapeHtml(row.월예정급여세전)}</td><td>${escapeHtml(row.월예정급여세후)}</td><td>${escapeHtml(row.무급공제액)}</td></tr>`).join("");
    const bodyHtml=[
      `<p>${escapeHtml(payrollMonthLabel)} 근무 정리표입니다. 월 예정시간은 직원별 주간 캘린더 요약 기준으로 산정하며, 연차·시간차·회사 공통 휴가 일정은 급여 기준 확인 후 반영합니다.</p>`,
      `<table class="consent-table"><thead><tr><th>직원</th><th>사번</th><th>월 예정시간</th><th>월 예정급여(세전)</th><th>월 예정급여(세후)</th><th>무급공제</th></tr></thead><tbody>${rows}<tr><th colspan="2">합계</th><th>${escapeHtml(`${formatHourValue(payrollScheduledHoursTotal)}시간`)}</th><th>${escapeHtml(won(payrollScheduledGrossPayTotal))}</th><th>${escapeHtml(won(payrollScheduledNetPayTotal))}</th><th>-</th></tr></tbody></table>`,
    ].join("");
    const ok=openOfficialPrintWindow({
      title:`${payrollMonthLabel} 세무사 제출용 근무 정리표`,
      docNo:`LUPL-PAY-${payrollMonthValue}`,
      bodyHtml,
      metaRows:[
        {label:"기준월",value:payrollMonthLabel},
        {label:"대상인원",value:`${payrollSummaryRows.length}명`},
        {label:"세전 합계",value:won(payrollScheduledGrossPayTotal)},
        {label:"세후 추정 합계",value:won(payrollScheduledNetPayTotal)},
      ],
      footerText:"세무사 제출 전 최종 임금명세서 및 회사 확인 자료와 대조해 주세요.",
    });
    if(!ok) setPayMsg("인쇄 창이 차단되었습니다. 브라우저의 팝업 차단을 해제해주세요.");
  }
  return (
    <section className="card">
      <div className="section-head payroll-head">
        <div>
          <h2 className="card-title"><i className="ti ti-coin" aria-hidden="true"></i>급여 계산</h2>
          <p className="subtle" style={{margin:0}}>시급, 월급, 연봉, 주 근무일, 일 근무시간, 월 급여기준시간 중 값을 바꾸면 나머지 기준값이 자동 계산됩니다. 주 15시간 이상은 주휴시간을 포함하며, 주 5일 8시간은 월 209시간 기준입니다.</p>
          <p className="subtle" style={{margin:"6px 0 0"}}>표시 금액은 근태·휴가·공제 확인 전 예상액이며, 최종 임금은 회사 확인 및 임금명세서 기준으로 확정됩니다.</p>
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
            {payrollSelectableEmployees.map(e=><option key={e.id} value={e.id}>{e.name}{!isEmployeeActive(e)?" · 과거 근무":""}</option>)}
          </select>
        </div>
        <div className="form-row">{fixedLabel("monthly","월급 (원)")}<input className="input" value={pay.monthly} disabled={readOnly} onChange={e=>setPayField("monthly",e.target.value)} placeholder="예: 2,500,000" /></div>
      </div>
      <div className="grid three">
        <div className="form-row">{fixedLabel("hourly","시급 (원)")}<input className="input" value={pay.hourly} disabled={readOnly} onChange={e=>setPayField("hourly",e.target.value)} placeholder="예: 11,000" /></div>
        <div className="form-row">{fixedLabel("annual","연봉 (원)")}<input className="input" value={pay.annual} disabled={readOnly} onChange={e=>setPayField("annual",e.target.value)} placeholder="예: 30,000,000" /></div>
        <div className="form-row">{fixedLabel("monthlyHours","월 급여기준시간")}<input className="input" value={pay.monthlyHours} disabled={readOnly} onChange={e=>setPayField("monthlyHours",e.target.value)} placeholder="예: 209" /></div>
      </div>
      <div className="grid two">
        <div className="form-row">{fixedLabel("weeklyDays","주 근무일")}<input className="input" value={pay.weeklyDays} disabled={readOnly} onChange={e=>setPayField("weeklyDays",e.target.value)} placeholder="예: 5" /></div>
        <div className="form-row">{fixedLabel("dailyHours","일 근무시간")}<input className="input" value={pay.dailyHours} disabled={readOnly} onChange={e=>setPayField("dailyHours",e.target.value)} placeholder="예: 8" /></div>
      </div>
      <div className="actions" style={{marginBottom:10}}><button className="button secondary" disabled={readOnly} onClick={saveSalary}>급여 설정 저장</button>{payMsg&&<span className={`subtle ${payMsg.includes("실패")?"":""}`} style={{color:payMsg.includes("실패")?"var(--red)":"var(--green)"}}>{payMsg}</span>}</div>
      <div className="payroll-summary-list">
        <div className="payroll-summary-head">직원별 급여·월 근무 기준 <span>{payrollMonthLabel} 월 예정시간은 직원별 주간 캘린더 요약과 같은 일정 기준으로 반영하고, 세후 금액은 무급공제와 4대보험 추정 공제를 반영합니다.</span></div>
        <div className="payroll-summary-row payroll-summary-columns"><b>직원</b><span>시급</span><span>월급</span><span>월 예정시간</span><span>월 급여기준</span><span>월 예정급여(세전)</span><span>월 예정급여(세후)</span><small>{payrollMonthLabel} 기준</small></div>
        {payrollSummaryRows.map(({employee,month,monthlyStandardHours,monthlySalary,hourlyWage,scheduledGrossPay,scheduledNetPay,rowAbsentDays,rowDeduction}:any)=>(
          <div className={`payroll-summary-row ${empId===employee.id?"active":""}`} key={employee.id}>
            <button type="button" className="payroll-employee-cell payroll-employee-button" onClick={()=>setEmpId(employee.id)}><b>{employee.name}</b><small>사번 {employee.employee_no||"-"} · {employee.role==="admin"?"관리자":"직원"}</small></button>
            <span>{hourlyWage?won(hourlyWage):"-"}</span>
            <span>{monthlySalary?won(monthlySalary):"-"}</span>
            <span>{formatHourValue(month.hours)}시간</span>
            <span>{formatHourValue(monthlyStandardHours||month.hours)}시간</span>
            <span>{scheduledGrossPay?won(scheduledGrossPay):"-"}</span>
            <span>{scheduledNetPay?won(scheduledNetPay):"-"}</span>
            <small>{payrollMonthLabel} 예정 {month.days}일 · 월 예정 {formatHourValue(month.hours)}시간 × {hourlyWage?won(hourlyWage):"시급 미설정"}{rowAbsentDays>0?` · 무급공제 반영 ${rowAbsentDays}일 ${won(rowDeduction)}`:""}</small>
          </div>
        ))}
        {payrollSummaryRows.length===0&&<p className="subtle" style={{margin:"10px 0"}}>{payrollMonthLabel}에 급여 계산 대상 근무시간이 있는 직원이 없습니다.</p>}
        <div className="payroll-summary-row payroll-summary-total"><b>예정급여 합산</b><span></span><span></span><span></span><span></span><span>{won(payrollScheduledGrossPayTotal)}</span><span>{won(payrollScheduledNetPayTotal)}</span><small>세전/세후 예정급여 합계</small></div>
      </div>
      <div className="payroll-copy-panel">
        <div className="payroll-copy-head">
          <div><b>세무사 제출용 근무 정리표</b><span>{payrollCopyTitle} 형식으로 직원별 근무시간과 세전월급여를 바로 복사합니다.</span></div>
          <div className="actions">
            <button className="button secondary compact" onClick={copyPayrollAccountantText}><i className="ti ti-copy" aria-hidden="true"></i>복사</button>
            <button className="button ghost compact" disabled={!payrollSummaryRows.length} onClick={printPayrollAccountantPdf}><i className="ti ti-file-type-pdf" aria-hidden="true"></i>PDF</button>
            <button className="button ghost compact" disabled={!payrollSummaryRows.length} onClick={downloadPayrollAccountantExcel}><i className="ti ti-file-spreadsheet" aria-hidden="true"></i>XLSX</button>
          </div>
        </div>
        <textarea className="textarea payroll-copy-text" readOnly value={payrollAccountantText} />
      </div>
      {empId&&emp&&<div className="payroll-selected-detail"><b>{emp.name} 급여 세부내역</b><span>{payrollMonthLabel} 기준으로 아래 공제와 예상 실수령액을 계산합니다. 최종 지급액은 회사 확인 후 확정됩니다.</span></div>}
      {empId&&monthly>0&&<div className="alert" style={{marginBottom:10}}>계산 기준: 시급 {won(hourly)} · 월 급여기준시간 {monthlyHours||0}시간 · 월급 {won(monthly)} · 연봉 {won(annual)} · 주휴 포함</div>}
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
    const monthlyStandardHours=monthlyPaidHours(weeklyWorkDays,dailyHours);
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
        <div className="form-row"><label className="label">직원</label><select className="select" value={absEmpId} onChange={e=>setAbsEmpId(e.target.value)}><option value="">선택</option>{employees.filter(isEmployeeActive).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
        <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={absStart} onChange={e=>setAbsStart(e.target.value)} /></div>
        <div className="form-row"><label className="label">종료일</label><input className="input" type="date" value={absEnd} onChange={e=>setAbsEnd(e.target.value)} /></div>
        <div className="form-row"><label className="label">급여 반영</label><select className="select" value={absUnpaid?"unpaid":"paid"} onChange={e=>setAbsUnpaid(e.target.value==="unpaid")}><option value="unpaid">급여 공제</option><option value="paid">급여 공제 없음</option></select></div>
      </div>
      <div className="form-row"><label className="label">사유</label><input className="input" value={absReason} onChange={e=>setAbsReason(e.target.value)} placeholder="예: 개인 사정 장기 미출근" /></div>
      <button className="button secondary" onClick={saveAbsence}><i className="ti ti-plus" aria-hidden="true"></i>미출근 기간 등록</button>
      {absences.length>0&&(<div style={{marginTop:12}}>
        {absences.map(a=>(<div className="list-row" key={a.id}><div><b>{empName(a.employee_id)}</b><div className="subtle">{a.start_date}~{a.end_date} · {a.unpaid?"급여 공제":"급여 공제 없음"} · {a.reason??"-"}</div></div><button className="button danger" onClick={()=>deleteAbsence(a.id)}>삭제</button></div>))}
      </div>)}
      </CollapsibleSection>

      <CollapsibleSection title="주간 스케줄 변경" icon="ti-refresh">
      <p className="subtle" style={{marginBottom:10}}>특정 주에만 출근 요일·시간이 다를 때 사용합니다. 해당 주에만 기본 스케줄을 덮어씁니다.</p>
      <div className="grid two">
        <div className="form-row"><label className="label">직원</label><select className="select" value={ovEmpId} onChange={e=>{setOvEmpId(e.target.value);const emp=empMap[e.target.value];if(emp){setOvDays(emp.work_days??["mon","tue","wed","thu","fri"]);setOvStart(emp.work_start??"09:00");setOvEnd(emp.work_end??"18:00");}}}><option value="">직원 선택</option>{employees.filter(isEmployeeActive).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
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
        <DataTable rows={overrides.slice(0,10).map(o=>({직원:empName(o.employee_id),주:o.week_start,요일:orderedDays(o.work_days??[]).map((d:string)=>DAY_LABELS[d]).join(""),시간:`${o.work_start}~${o.work_end}`,메모:o.note??"-"}))} />
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
  const [selected,setSelected]=useState<{employee:any;record:any;kind:SignedRecordKind}|null>(null);
  const [workRequestFilter,setWorkRequestFilter]=useState("all");
  const [correctionFilter,setCorrectionFilter]=useState("all");
  const [message,setMessage]=useState("");
  const [deletedWorkTimeRequestIds,setDeletedWorkTimeRequestIds]=useState<string[]>(()=>{
    try { return JSON.parse(localStorage.getItem("lupl_deleted_work_time_request_ids")??"[]"); }
    catch { return []; }
  });

  async function load(){
    const [employeeResult,consentResult,workConsentResult,workRequestResult,correctionResult]=await Promise.all([
      supabase.from("employees").select("id,name,employee_no,role,employment_status,is_active,department,position").order("employee_no",{ascending:true}),
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
  workTimeConsents.filter(consent=>consent.consent_version===WORK_TIME_CHANGE_CONSENT_VERSION).forEach(consent=>{if(!latestWorkConsentByEmployee[consent.employee_id]) latestWorkConsentByEmployee[consent.employee_id]=consent;});
  const latestAdminPledgeByEmployee:Record<string,any>={};
  workTimeConsents.filter(consent=>consent.consent_version===ADMIN_CONFIDENTIALITY_CONSENT_VERSION).forEach(consent=>{if(!latestAdminPledgeByEmployee[consent.employee_id]) latestAdminPledgeByEmployee[consent.employee_id]=consent;});
  const latestAttendancePolicyByEmployee:Record<string,any>={};
  workTimeConsents.filter(consent=>consent.consent_version===ATTENDANCE_RULE_CONSENT_VERSION).forEach(consent=>{if(!latestAttendancePolicyByEmployee[consent.employee_id]) latestAttendancePolicyByEmployee[consent.employee_id]=consent;});
  const employeeMap:Record<string,any>={};
  employees.forEach(employee=>{employeeMap[employee.id]=employee;});
  const visibleConsentEmployees=employees.filter(employee=>employee.employment_status==="active"&&employee.is_active!==false);
  const visibleConsentEmployeeIds=new Set(visibleConsentEmployees.map(employee=>employee.id));
  const deletedWorkTimeRequestIdSet=new Set(deletedWorkTimeRequestIds);
  const visibleWorkTimeRequests=workTimeRequests.filter(request=>visibleConsentEmployeeIds.has(request.employee_id)&&!deletedWorkTimeRequestIdSet.has(request.id));
  const visibleAttendanceCorrections=attendanceCorrections.filter(request=>visibleConsentEmployeeIds.has(request.employee_id));
  const signedWorkTimeRequests=visibleWorkTimeRequests.filter(request=>request.signature_data);
  const signedAttendanceCorrections=visibleAttendanceCorrections.filter(request=>request.signature_data);
  const totalSigned=consents.filter(consent=>visibleConsentEmployeeIds.has(consent.employee_id)).length+workTimeConsents.filter(consent=>visibleConsentEmployeeIds.has(consent.employee_id)).length+signedWorkTimeRequests.length+signedAttendanceCorrections.length;
  const workRequestStatusGroups=[
    {key:"all",label:"전체",rows:visibleWorkTimeRequests},
    ...[
      {key:"pending",label:"승인 대기"},
      {key:"approved",label:"승인"},
      {key:"rejected",label:"반려"},
    ].map(group=>({...group,rows:visibleWorkTimeRequests.filter((request:any)=>request.status===group.key)})),
  ];
  const filteredWorkTimeRequests=workRequestFilter==="all"?visibleWorkTimeRequests:visibleWorkTimeRequests.filter((request:any)=>request.status===workRequestFilter);
  const correctionStatusGroups=[
    {key:"all",label:"전체",rows:visibleAttendanceCorrections},
    ...[
      {key:"pending",label:"서명 대기"},
      {key:"signed",label:"서명 완료"},
      {key:"objected",label:"이의제기"},
      {key:"cancelled",label:"취소"},
    ].map(group=>({...group,rows:visibleAttendanceCorrections.filter((request:any)=>request.status===group.key)})),
  ];
  const filteredAttendanceCorrections=correctionFilter==="all"?visibleAttendanceCorrections:visibleAttendanceCorrections.filter((request:any)=>request.status===correctionFilter);

  function signedTitle(kind:SignedRecordKind){
    if(kind==="privacy") return "개인정보 수집·이용 및 위치정보 동의서";
    if(kind==="workTimeConsent") return "근무시간 변경 안내 확인서";
    if(kind==="adminConfidentiality") return ADMIN_CONFIDENTIALITY_NOTICE_TEXT;
    if(kind==="attendanceCorrection") return "출퇴근 기록 정정 확인서";
    if(kind==="attendancePolicy") return "근태 기준 확인서";
    return "근로시간 변경 요청 및 합의서";
  }
  function signedBody(kind:SignedRecordKind,record:any){
    if(kind==="privacy") {
      const body=[
        "주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를 수집·이용합니다.",
        "위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다.",
        "수집 정보는 근태 확인, 임금·휴가 정산, 분쟁 대응 등 필요한 범위에서 보관되고, 보유기간 경과 또는 목적 달성 후 관련 법령과 회사 보존 기준에 따라 파기됩니다.",
        ...CONSENT_TERMS,
      ];
      if(record.consent_version===PRIVACY_CONSENT_VERSION) body.push(OVERTIME_COMP_DETAIL_TEXT, WORK_TIME_CONSENT_TEXT, WORK_TIME_DETAIL_TEXT);
      return body;
    }
    if(kind==="workTimeConsent") return [record.notice_text??WORK_TIME_CONSENT_TEXT, record.detail_text??WORK_TIME_DETAIL_TEXT];
    if(kind==="adminConfidentiality") return [record.notice_text??ADMIN_CONFIDENTIALITY_NOTICE_TEXT, record.detail_text??ADMIN_CONFIDENTIALITY_DETAIL_TEXT];
    if(kind==="attendancePolicy") {
      const detailLines=Array.isArray(record.detail_text)
        ? record.detail_text
        : String(record.detail_text??ATTENDANCE_RULE_DETAIL_TEXT).split("\n");
      return [record.notice_text??"근태 기준 안내", ...detailLines];
    }
    if(kind==="attendanceCorrection") return String(record.document_text??"저장된 문서 내용이 없습니다.").split("\n");
    const lines=String(record.document_text??"저장된 문서 내용이 없습니다.").split("\n");
    const isNoWork=(Array.isArray(record.new_work_days)&&record.new_work_days.length===0)||Number(record.weekly_work_hours||0)===0;
    if(!isNoWork) return lines;
    let inAfter=false;
    return lines.flatMap(line=>{
      if(line.startsWith("2. ")) inAfter=true;
      if(line.startsWith("3. ")) inAfter=false;
      if(!inAfter) return [line];
      if(line.startsWith("- 근무요일:")) return ["- 근무요일: 출근하지 않음"];
      if(line.startsWith("- 근무시간:")) return ["- 근무시간: 해당 기간 출근하지 않음"];
      if(line.startsWith("- 휴게시간:")) return [];
      return [line];
    });
  }
  function printSignedRecord(employee:any,record:any,kind:SignedRecordKind){
    const signature=String(record.signature_data??"").startsWith("data:image/")?record.signature_data:"";
    const title=signedTitle(kind);
    const body=signedBody(kind,record);
    const version=record.consent_version??record.legal_notice_version??"-";
    const status=kind==="attendanceCorrection" ? attendanceCorrectionStatusLabel(record.status) : record.status==="pending"?"승인 대기":record.status==="approved"?"승인":record.status==="rejected"?"반려":"-";
    const bodyHtml=[
      `<p>${body.map(line=>escapeHtml(line)).join("<br>")}</p>`,
      `<table class="consent-table"><tbody>`,
      `<tr><th>제목</th><td>${escapeHtml(title)}</td></tr>`,
      `<tr><th>상태</th><td>${escapeHtml(status)}</td></tr>`,
      `<tr><th>서명 일시</th><td>${escapeHtml(formatDateTime(record.signed_at??record.created_at))}</td></tr>`,
      `</tbody></table>`,
    ].join("");
    const ok=openOfficialPrintWindow({
      title,
      docNo:`LUPL-${String(kind).toUpperCase()}-${String(record.id??record.created_at??Date.now()).slice(0,8)}`,
      employee,
      bodyHtml,
      signatureData:signature,
      metaRows:[
        {label:"문서버전",value:version},
        {label:"상태",value:status},
        {label:"기기",value:record.device_info?.platform??"-"},
      ],
      footerText:`${employee.name} 전자서명 완료`,
      confirmDate:formatDateTime(record.signed_at??record.created_at),
    });
    if(!ok) setMessage("인쇄 창이 차단되었습니다. 브라우저의 팝업 차단을 해제해주세요.");
  }
  async function deleteRejectedWorkTimeRequest(request:any) {
    if(request.status!=="rejected") return setMessage("반려된 근무시간 변경 요청만 삭제할 수 있습니다.");
    if(!window.confirm("반려된 근무시간 변경 요청을 삭제할까요? 저장된 서명 기록도 목록에서 사라집니다.")) return;
    let result:any=await supabase.rpc("delete_rejected_work_time_change_request",{p_request_id:request.id});
    if(result.error&&/schema cache|function|PGRST202/i.test(result.error.message)) result=await supabase.from("work_time_change_requests").delete().eq("id",request.id).eq("status","rejected");
    const {error}=result;
    if(error) setMessage(friendlySignatureDbError(error));
    else {
      setDeletedWorkTimeRequestIds(current=>{
        const next=Array.from(new Set([...current,request.id]));
        localStorage.setItem("lupl_deleted_work_time_request_ids",JSON.stringify(next));
        return next;
      });
      setWorkTimeRequests(current=>current.filter(row=>row.id!==request.id));
      setSelected(current=>current?.record?.id===request.id?null:current);
      setMessage("반려된 근무시간 변경 요청을 삭제했습니다.");
      await load();
    }
  }

  return <div className="grid">
    {message&&<div className="alert error">{message}</div>}
    <section className="card">
      <div className="schedule-board-toolbar">
        <div><h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-file-certificate" aria-hidden="true"></i>직원별 필수 서명</h2><p className="subtle" style={{margin:0}}>개인정보 동의, 근태 기준 확인, 근무시간 변경 안내, 근무시간 변경 요청, 출퇴근 기록 정정 서명을 한 곳에서 확인하고 PDF로 저장합니다.</p></div>
        <span className="badge good">서명 {totalSigned}건</span>
      </div>
      <div className="table-wrap" style={{marginTop:18}}>
        <table>
          <caption className="table-summary">직원별 최신 필수 동의서</caption>
          <thead><tr><th>직원</th><th>개인정보 동의</th><th>근태 기준</th><th>근무시간 변경 안내</th><th>비밀유지</th><th>관리</th></tr></thead>
          <tbody>{visibleConsentEmployees.map(employee=>{
            const consent=latestByEmployee[employee.id];
            const workConsent=latestWorkConsentByEmployee[employee.id];
            const adminPledge=latestAdminPledgeByEmployee[employee.id];
            const attendancePolicy=latestAttendancePolicyByEmployee[employee.id];
            return <tr key={employee.id}>
              <td><b>{employee.name}</b><br/><span className="subtle">{employee.employee_no}</span></td>
              <td><span className={`badge ${consent?"good":"warn"}`}>{consent?"완료":"미동의"}</span><SignedAt value={consent?.created_at} /></td>
              <td><span className={`badge ${attendancePolicy?"good":"warn"}`}>{attendancePolicy?"완료":"미서명"}</span><SignedAt value={attendancePolicy?.created_at} /></td>
              <td><span className={`badge ${workConsent?"good":"warn"}`}>{workConsent?"완료":"미서명"}</span><SignedAt value={workConsent?.created_at} /></td>
              <td><span className={`badge ${adminPledge?"good":"warn"}`}>{adminPledge?"완료":"미서명"}</span><SignedAt value={adminPledge?.created_at} /></td>
              <td><div className="actions">
                <button className="button secondary compact" disabled={!consent} onClick={()=>consent&&setSelected({employee,record:consent,kind:"privacy"})}><i className="ti ti-eye" aria-hidden="true"></i>개인정보</button>
                <button className="button secondary compact" disabled={!attendancePolicy} onClick={()=>attendancePolicy&&setSelected({employee,record:attendancePolicy,kind:"attendancePolicy"})}><i className="ti ti-checkup-list" aria-hidden="true"></i>근태 기준</button>
                <button className="button secondary compact" disabled={!workConsent} onClick={()=>workConsent&&setSelected({employee,record:workConsent,kind:"workTimeConsent"})}><i className="ti ti-clock-edit" aria-hidden="true"></i>근무시간</button>
                <button className="button secondary compact" disabled={!adminPledge} onClick={()=>adminPledge&&setSelected({employee,record:adminPledge,kind:"adminConfidentiality"})}><i className="ti ti-shield-lock" aria-hidden="true"></i>비밀유지</button>
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
      <div className="table-wrap consent-worktime-table">
        <table>
          <thead><tr><th>직원</th><th>적용기간</th><th>변경 내용</th><th>변경 요청 사유</th><th>상태</th><th>서명 일시</th><th>관리</th></tr></thead>
          <tbody>{filteredWorkTimeRequests.map(request=>{
            const employee=employeeMap[request.employee_id]??{name:"알 수 없음",employee_no:"-"};
            const periods=request.periods??[];
            return <tr key={request.id}>
              <td className="nowrap-cell"><b>{employee.name}</b><span>{employee.employee_no}</span></td>
              <td>{periods.length?periods.map((p:any,index:number)=><div className="date-range-cell" key={`${p.start_date}-${index}`}><span>{periodRangeLabel(p)}</span></div>):"-"}</td>
              <td><span className="work-change-kind">{workChangeKind(request)}</span></td>
              <td className="clamp-two">{request.reason||request.review_note||request.note||"-"}</td>
              <td><span className={`badge ${badgeClass(request.status)}`}>{request.status==="pending"?"승인 대기":request.status==="approved"?"승인":"반려"}</span></td>
              <td className="nowrap-cell"><SignedAt value={request.created_at} /></td>
              <td><div className="actions"><button className="button secondary compact" disabled={!request.signature_data} onClick={()=>setSelected({employee,record:request,kind:"workTimeRequest"})}><i className="ti ti-eye" aria-hidden="true"></i>보기</button><button className="button ghost compact" disabled={!request.signature_data} onClick={()=>printSignedRecord(employee,request,"workTimeRequest")}><i className="ti ti-file-type-pdf" aria-hidden="true"></i>PDF</button>{request.status==="rejected"&&<button className="button danger compact" onClick={()=>deleteRejectedWorkTimeRequest(request)}><i className="ti ti-trash" aria-hidden="true"></i>삭제</button>}</div></td>
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
              <td><SignedAt value={request.signed_at} /></td>
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
          <dl><div><dt>사번</dt><dd>{selected.employee.employee_no}</dd></div><div><dt>서명 일시</dt><dd><SignedAt value={selected.record.created_at} /></dd></div><div><dt>버전</dt><dd>{selected.record.consent_version??selected.record.legal_notice_version??"-"}</dd></div></dl>
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
  const [workplaces,setWorkplaces]=useState<any[]>([]);
  const [compRequests,setCompRequests]=useState<any[]>([]);
  const [overrides,setOverrides]=useState<any[]>([]);
  const [workTimeChanges,setWorkTimeChanges]=useState<any[]>([]);
  const [scheduleEvents,setScheduleEvents]=useState<any[]>([]);
  const [leaveRequests,setLeaveRequests]=useState<any[]>([]);
  const [reportError,setReportError]=useState("");
  const [reportMonth,setReportMonth]=useState(todayIso().slice(0,7));
  const [calendarEmployeeId,setCalendarEmployeeId]=useState("");
  const [recordEmployeeFilter,setRecordEmployeeFilter]=useState("all");
  const [recordDateFilter,setRecordDateFilter]=useState("all");

  async function fetchAllAttendanceLogs(){
    const rows:any[]=[];
    const pageSize=1000;
    for(let from=0;;from+=pageSize){
      const {data,error}=await supabase.from("attendance_logs").select("*").order("check_in_time",{ascending:false}).range(from,from+pageSize-1);
      if(error) throw error;
      rows.push(...(data??[]));
      if(!data||data.length<pageSize) break;
    }
    return rows;
  }
  async function load(){
    setReportError("");
    try {
      const [l,e,w,c,ov,wt,se,lr]=await Promise.all([
        fetchAllAttendanceLogs(),
        supabase.from("employees").select("id, name, employee_no, role, employment_status, is_active, joined_at, created_at, work_days, work_start, work_end, work_start_date, contract_type, contract_start, contract_end, department, position").order("created_at",{ascending:false}).limit(1000),
        supabase.from("workplaces").select("id,name,type").limit(1000),
        supabase.from("comp_time_requests").select("*").order("created_at",{ascending:false}).limit(1000),
        supabase.from("weekly_schedule_overrides").select("*").order("week_start",{ascending:false}).limit(1000),
        supabase.from("work_time_change_requests").select("*").order("created_at",{ascending:false}).limit(1000),
        supabase.from("employee_schedule_events").select("*").order("start_date",{ascending:true}).limit(1000),
        supabase.from("attendance_requests").select("*").eq("status","approved").order("created_at",{ascending:false}).limit(1000),
      ]);
      const errors=[e,w,c,ov,wt,se,lr].map((result:any)=>result.error?.message).filter(Boolean);
      if(errors.length) setReportError(`일부 리포트 데이터를 불러오지 못했습니다.\n${errors.join("\n")}`);
      setLogs(l??[]);
      setEmployees(e.data??[]);
      setWorkplaces(w.data??[]);
      setCompRequests(c.data??[]);
      setOverrides(ov.data??[]);
      setWorkTimeChanges(wt.data??[]);
      setScheduleEvents(se.data??[]);
      setLeaveRequests(lr.data??[]);
    } catch(error:any) {
      setReportError(`전체 근태 기록을 불러오지 못했습니다.\n${error?.message??error}`);
      setLogs([]);
    }
  }

  useEffect(()=>{load();},[]);

  function reportEmployeeVisible(employee:any){
    const name=String(employee?.name??"").trim().toLowerCase();
    const no=String(employee?.employee_no??"").trim().toLowerCase();
    return name!=="test"&&!no.startsWith("test");
  }
  const employeeMap=Object.fromEntries(employees.map((employee:any)=>[employee.id,employee]));
  const workplaceMap=Object.fromEntries(workplaces.map((workplace:any)=>[workplace.id,workplace]));
  const logsWithRefs=logs.map((log:any)=>({...log,employees:log.employees??employeeMap[log.employee_id],workplaces:log.workplaces??workplaceMap[log.workplace_id]}));
  function employeeForLog(log:any) {
    return employeeMap[log.employee_id] ?? log.employees ?? {id:log.employee_id??`unknown-${log.id}`,name:"기록 보관 직원",employee_no:"퇴사/삭제 계정"};
  }
  function lateMinutesForLog(log:any) {
    if(!log?.check_in_time) return 0;
    const employee=employeeForLog(log);
    const info=reportScheduleInfoForDate(employee,localDateStr(log.check_in_time));
    if(!info?.workday) return 0;
    const scheduledStart=timeToMinutes(info.start);
    if(scheduledStart==null) return 0;
    const lateThreshold=Math.max(10*60,scheduledStart);
    const checkedIn=kstDate(log.check_in_time);
    const actualMinutes=checkedIn.getUTCHours()*60+checkedIn.getUTCMinutes();
    return Math.max(0,actualMinutes-lateThreshold);
  }
  function attendanceTypeLabelsForLog(log:any) {
    const labels:string[]=[];
    const add=(label:string)=>{if(label&&!labels.includes(label)) labels.push(label);};
    const status=String(log.status??"").trim();
    const workplaceType=workplaceTypeLabels[log.workplaces?.type];
    if(lateMinutesForLog(log)>0||status.includes("지각")) add("지각");
    if(status&&!["정상","정상출근","확인 완료"].includes(status)) add(status);
    add(workplaceType||"일반근무");
    if(!log.check_out_time) add("퇴근 미처리");
    return labels.length?labels:["미분류"];
  }
  function attendanceGroupForLog(log:any) {
    const status=String(log.status??"");
    const type=log.workplaces?.type;
    if(lateMinutesForLog(log)>0||status.includes("지각")) return "late";
    if(type==="remote") return "remote";
    if(["special_school","external_education","other_field"].includes(type)) return "field";
    if(!log.check_out_time||status.includes("확인")||status.includes("결근")) return "exception";
    return "normal";
  }
  function reportWorkedMinutes(log:any) {
    const raw=workedMinutes(log.check_in_time,log.check_out_time);
    if(raw==null) return null;
    const employee=employeeForLog(log);
    const date=localDateStr(log.check_in_time);
    const info=reportScheduleInfoForDate(employee,date);
    const scheduledMinutes=info?.workday ? Math.round(Number(info.hours||0)*60) : 0;
    return scheduledMinutes>0 ? Math.min(raw,scheduledMinutes) : raw;
  }
  const baseVisibleEmployees=employees.filter(reportEmployeeVisible).sort(sortEmployeesBySeniority);
  const visibleLogs=logsWithRefs.filter((log:any)=>reportEmployeeVisible(employeeForLog(log)));
  const extraLogEmployeeMap=new Map<string,any>();
  visibleLogs.forEach((log:any)=>{
    const logEmployee=employeeForLog(log);
    if(logEmployee?.id&&!baseVisibleEmployees.some((visible:any)=>visible.id===logEmployee.id)&&!extraLogEmployeeMap.has(logEmployee.id)) extraLogEmployeeMap.set(logEmployee.id,logEmployee);
  });
  const extraLogEmployees=Array.from(extraLogEmployeeMap.values()).sort(sortEmployeesBySeniority);
  const visibleEmployees=[...baseVisibleEmployees,...extraLogEmployees];
  useEffect(()=>{
    if(visibleEmployees.length&&!visibleEmployees.some((employee:any)=>employee.id===calendarEmployeeId)) setCalendarEmployeeId(visibleEmployees[0].id);
  },[visibleEmployees.length,calendarEmployeeId]);
  const visibleEmployeeIds=new Set(visibleEmployees.map((employee:any)=>employee.id));
  const visibleCompRequests=compRequests.filter((request:any)=>visibleEmployeeIds.has(request.employee_id));
  const recordDateOptions=Array.from(new Set(visibleLogs.map((log:any)=>localDateStr(log.check_in_time)))).sort().reverse();
  const recordFilteredLogs=visibleLogs.filter((log:any)=>{
    const employeeOk=recordEmployeeFilter==="all"||log.employee_id===recordEmployeeFilter;
    const dateOk=recordDateFilter==="all"||localDateStr(log.check_in_time)===recordDateFilter;
    return employeeOk&&dateOk;
  });
  const attendanceReportColumns=["구분","직원","사번","근무지","유형","근태유형","출근","퇴근","실제퇴근원본","인정근무","실제기록시간","상태","초과근무심사"];
  function normalizeAttendanceReportRow(row:any) {
    return Object.fromEntries(attendanceReportColumns.map(column=>[column,row?.[column]??""]));
  }
  const allLogRows = recordFilteredLogs.map(l=>{
    const logEmployee=employeeForLog(l);
    return normalizeAttendanceReportRow({
    구분:"상세",
    직원:logEmployee?.name??"-",
    사번:logEmployee?.employee_no??"-",
    근무지:l.workplaces?.name??"-",
    유형:workplaceTypeLabels[l.workplaces?.type]??"-",
    근태유형:attendanceTypeLabelsForLog(l).join(", "),
    출근:formatDateTime(l.check_in_time),
    퇴근:formatDateTime(l.check_out_time),
    실제퇴근원본:formatDateTime(l.original_check_out_time),
    인정근무:fmtMin(reportWorkedMinutes(l)),
    실제기록시간:fmtMin(workedMinutes(l.check_in_time,l.check_out_time)),
    상태:l.status,
    초과근무심사:l.overtime_review_status==="approved"?"승인":l.overtime_review_status==="rejected"?"미인정":"-",
  });});

  function downloadAll(){
    const rows:any[]=[];
    const sourceLogs=recordFilteredLogs;
    visibleEmployees.forEach((employee:any)=>{
      const employeeLogs=sourceLogs.filter((log:any)=>log.employee_id===employee.id);
      if(!employeeLogs.length) return;
      const counts={normal:0,late:0,field:0,remote:0,exception:0};
      employeeLogs.forEach((log:any)=>{ counts[attendanceGroupForLog(log) as keyof typeof counts]+=1; });
      const minutes=employeeLogs.reduce((sum:number,log:any)=>sum+(reportWorkedMinutes(log)??0),0);
      rows.push(normalizeAttendanceReportRow({
        구분:"직원 요약",
        직원:employee.name,
        사번:employee.employee_no??"-",
        근태유형:`정상 ${counts.normal}건 · 지각 ${counts.late}건 · 외근 ${counts.field}건 · 재택 ${counts.remote}건 · 예외 ${counts.exception}건`,
        인정근무:fmtMin(minutes),
        상태:`총 ${employeeLogs.length}건`,
      }));
      rows.push(...allLogRows.filter(row=>row.직원===employee.name&&row.사번===(employee.employee_no??"-")));
      rows.push(normalizeAttendanceReportRow({}));
    });
    exportRowsToExcel("lupl_attendance_report.xlsx","근태",rows.length?rows:allLogRows,{
      title:"근태 리포트",
      subtitle:"실제기록시간과 초과근무심사 컬럼은 고정 순서로 출력됩니다.",
    });
  }

  const fieldLogs=visibleLogs.filter(l=>["special_school","external_education","other_field"].includes(l.workplaces?.type));
  const exceptions=visibleLogs.filter(l=>["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음","지각","결근"].includes(l.status)||!l.check_out_time||attendanceGroupForLog(l)==="late");
  const monthVisibleLogs=visibleLogs.filter((log:any)=>localDateStr(log.check_in_time).startsWith(reportMonth));
  const statusChartRows=visibleEmployees.map((employee:any)=>{
    const employeeLogs=monthVisibleLogs.filter((log:any)=>log.employee_id===employee.id);
    const counts={normal:0,late:0,field:0,remote:0,exception:0};
    const typeCounts:Record<string,number>={};
    employeeLogs.forEach((log:any)=>{
      attendanceTypeLabelsForLog(log).forEach(label=>{typeCounts[label]=(typeCounts[label]??0)+1;});
      const group=attendanceGroupForLog(log);
      counts[group as keyof typeof counts]+=1;
    });
    const total=Math.max(1,employeeLogs.length);
    const typeRows=Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
    const typeDetails=typeRows.map(([label,count])=>({
      label,
      count,
      logs:employeeLogs.filter((log:any)=>attendanceTypeLabelsForLog(log).includes(label)).slice(0,20),
    }));
    return {employee,counts,typeRows,typeDetails,total,shownTotal:employeeLogs.length};
  });
  const calendarEmployee=visibleEmployees.find((employee:any)=>employee.id===calendarEmployeeId)??visibleEmployees[0]??null;
  const calendarMonthStart=`${reportMonth}-01`;
  const calendarDates=monthDates(calendarMonthStart);
  const calendarLogs=calendarEmployee?visibleLogs.filter((log:any)=>log.employee_id===calendarEmployee.id&&localDateStr(log.check_in_time).startsWith(reportMonth)):[];
  const calendarLogMap=calendarLogs.reduce((map:Record<string,any[]>,log:any)=>{
    const date=localDateStr(log.check_in_time);
    map[date]=[...(map[date]??[]),log];
    return map;
  },{});
  const calendarColor=calendarEmployee?employeeColorFromList(visibleEmployees,calendarEmployee.id):EMPLOYEE_COLORS[0];
  function reportScheduleInfoForDate(employee:any,date:string){
    const info=scheduleInfoForDateWithEvents(employee,date,scheduleEvents,overrides,workTimeChanges);
    const leave=leaveRequests.find((request:any)=>request.employee_id===employee?.id&&date>=request.start_date&&date<=request.end_date);
    return {...info,leave};
  }
  const calendarScheduleMap=calendarEmployee?Object.fromEntries(calendarDates.map(date=>[date,reportScheduleInfoForDate(calendarEmployee,date)])):{};
  function calendarDateHasScheduleSignal(date:string){
    const info:any=(calendarScheduleMap as any)[date];
    const logs=calendarLogMap[date]??[];
    const workEvent=["work","am_only","pm_only"].includes(info?.event?.event_type);
    return logs.length>0||!!info?.workday||!!info?.leave||workEvent;
  }
  const calendarHasWeekendSignal=calendarDates.some(date=>{
    const dayKey=dayKeyFromDate(dateFromIso(date));
    return ["sat","sun"].includes(dayKey)&&calendarDateHasScheduleSignal(date);
  });
  const calendarDayKeys=calendarHasWeekendSignal?ALL_DAYS:ALL_DAYS.slice(0,5);
  const calendarVisibleDates=calendarDates.filter(date=>calendarHasWeekendSignal||!["sat","sun"].includes(dayKeyFromDate(dateFromIso(date))));
  const calendarOffset=Math.max(0,calendarDayKeys.indexOf(dayKeyFromDate(dateFromIso(calendarVisibleDates[0]??calendarMonthStart))));
  const calendarCells=Array.from({length:Math.ceil((calendarOffset+calendarVisibleDates.length)/calendarDayKeys.length)*calendarDayKeys.length},(_,index)=>calendarVisibleDates[index-calendarOffset]??null);
  const calendarToday=todayIso();
  const calendarScheduleEntries=Object.entries(calendarScheduleMap).filter(([date,info]:any)=>calendarVisibleDates.includes(date)&&info.workday&&!info.leave);
  const calendarFutureScheduledDays=calendarScheduleEntries.filter(([date]:any)=>date>calendarToday).length;
  const calendarReportWorkDays=calendarScheduleEntries.length;
  const calendarReportHours=calendarScheduleEntries.reduce((sum:number,[,info]:any)=>sum+Number(info.hours||0),0);
  function dayWorkLabel(dayLogs:any[],info:any,date:string) {
    if(info?.workday&&!info?.leave) return `${formatHourValue(info.hours)}시간`;
    if(!dayLogs.length&&info?.event) return info.event.title || "출근 안 함";
    if(!dayLogs.length) return "미출근";
    const minutes=dayLogs.reduce((sum:number,log:any)=>sum+(reportWorkedMinutes(log)??0),0);
    if(minutes>0) return `${formatHourValue(minutes/60)}시간`;
    return dayLogs.some((log:any)=>!log.check_out_time)?"퇴근 미처리":"0시간";
  }
  function dayPlanLabel(info:any,date:string){
    if(info?.leave) return leaveTypeDisplayLabel(info.leave);
    if(info?.workday) return date>calendarToday?`예정 ${formatHourValue(info.hours)}시간`:`${formatHourValue(info.hours)}시간`;
    return info?.event?.title || "근무 안 함";
  }
  const monthLeaveRequests=leaveRequests.filter((request:any)=>request.start_date<=monthRangeFor(`${reportMonth}-01`).end&&request.end_date>=monthRangeFor(`${reportMonth}-01`).start);
  const leaveReportRows=visibleEmployees.map((employee:any)=>{
    const employeeLeaves=monthLeaveRequests.filter((request:any)=>request.employee_id===employee.id);
    const entitlement=calculateLeaveEntitlement(employee.joined_at);
    const used=calculateUsedDays(leaveRequests.filter((request:any)=>request.employee_id===employee.id),false);
    const total=automaticAnnualLeaveDays(employee,entitlement);
    const remain=Math.max(0,total-used);
    return {
      employee,
      total,
      used,
      remain,
      count:employeeLeaves.length,
      labels:Array.from(new Set(employeeLeaves.map((request:any)=>leaveTypeDisplayLabel(request)))).join(", ")||"-",
    };
  }).filter((row:any)=>row.count>0||row.total>0);
  const leaveCalendarRows=monthLeaveRequests
    .flatMap((request:any)=>{
      const days=dateRangeList(request.start_date,request.end_date);
      return days.map(date=>({date,request,employee:employeeMap[request.employee_id]}));
    })
    .filter((row:any)=>row.employee&&reportEmployeeVisible(row.employee))
    .sort((a:any,b:any)=>a.date.localeCompare(b.date)||String(a.employee.employee_no??"").localeCompare(String(b.employee.employee_no??"")));
  const leaveShortageRows=calendarDates.map(date=>{
    const dayLeaves=leaveCalendarRows.filter((row:any)=>row.date===date);
    const working=visibleEmployees.filter((employee:any)=>reportScheduleInfoForDate(employee,date).workday&&!reportScheduleInfoForDate(employee,date).leave).length;
    const threshold=Math.max(1,Math.floor(visibleEmployees.length/2));
    return {date,leaveCount:dayLeaves.length,working,employees:dayLeaves.map((row:any)=>row.employee.name).join(", ")};
  }).filter(row=>visibleEmployees.length>=5&&row.leaveCount>0&&row.working>0&&row.working<=Math.max(1,Math.floor(visibleEmployees.length/2)));
  function printMonthlyReport(){
    document.body.classList.add("print-monthly-attendance");
    const cleanup=()=>document.body.classList.remove("print-monthly-attendance");
    window.addEventListener("afterprint",cleanup,{once:true});
    window.print();
    window.setTimeout(cleanup,1500);
  }

  return (
    <div className="grid">
      {reportError&&<div className="alert error" style={{whiteSpace:"pre-wrap"}}>{reportError}</div>}
      <section className="grid four">
        <div className="metric"><div className="metric-value">{visibleLogs.length}</div><div className="metric-label">전체 근태</div></div>
        <div className="metric"><div className="metric-value">{visibleEmployees.length}</div><div className="metric-label">전체 직원</div></div>
        <div className="metric"><div className="metric-value">{exceptions.length}</div><div className="metric-label">예외</div></div>
        <div className="metric"><div className="metric-value">{formatHourValue(visibleCompRequests.filter(r=>r.status==="approved").reduce((s,r)=>s+Number(r.hours||0),0))}</div><div className="metric-label">보상휴가 적립시간</div></div>
      </section>

      <section className="card leave-report-card">
        <div className="schedule-board-toolbar">
          <div><h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-beach" aria-hidden="true"></i>휴가 리포트</h2><p className="subtle" style={{margin:0}}>{reportMonth} 기준 휴가 사용, 잔여 연차, 급여 공제 여부, 인력 부족 가능일을 확인합니다.</p></div>
          <span className="badge">{monthLeaveRequests.length}건</span>
        </div>
        <div className="leave-report-metrics">
          <div><span>휴가 사용</span><b>{monthLeaveRequests.length}건</b><small>승인 완료 기준</small></div>
          <div><span>휴가 인원</span><b>{new Set(monthLeaveRequests.map((request:any)=>request.employee_id)).size}명</b><small>{reportMonth} 월간</small></div>
          <div><span>인력 부족 가능일</span><b>{leaveShortageRows.length}일</b><small>관리자 확인용</small></div>
        </div>
        <div className="grid two">
          <div className="table-wrap">
            <table>
              <thead><tr><th>직원</th><th>사용</th><th>잔여 연차</th><th>종류</th></tr></thead>
              <tbody>{leaveReportRows.map((row:any)=><tr key={row.employee.id}><td><b>{row.employee.name}</b><br/><span className="subtle">{row.employee.employee_no}</span></td><td>{row.count}건</td><td>{row.remain.toFixed(1)}일</td><td>{row.labels}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="leave-report-list">
            <b>날짜별 휴가</b>
            {leaveCalendarRows.slice(0,12).map((row:any)=><div className="leave-report-item" key={`${row.date}-${row.request.id}`}><span>{row.date}</span><strong>{row.employee.name}</strong><small>{leaveTypeDisplayLabel(row.request)} · {leaveDeductionLabel(row.request)}</small></div>)}
            {leaveCalendarRows.length===0&&<p className="subtle">이번 달 승인 휴가가 없습니다.</p>}
            {leaveCalendarRows.length>12&&<p className="subtle">외 {leaveCalendarRows.length-12}건</p>}
          </div>
        </div>
        {leaveShortageRows.length>0&&<div className="leave-shortage-strip">
          {leaveShortageRows.slice(0,6).map(row=><span key={row.date}>{row.date} · 근무 {row.working}명 · 휴가 {row.leaveCount}명</span>)}
        </div>}
      </section>

      <section className="card">
        <h2 className="card-title"><i className="ti ti-download" aria-hidden="true"></i>보고서 다운로드</h2>
        <div className="report-filter-bar">
          <div className="form-row"><label className="label">직원별 보기</label><select className="select" value={recordEmployeeFilter} onChange={e=>setRecordEmployeeFilter(e.target.value)}><option value="all">전체 직원</option>{visibleEmployees.map((employee:any)=><option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></div>
          <div className="form-row"><label className="label">날짜별 보기</label><select className="select" value={recordDateFilter} onChange={e=>setRecordDateFilter(e.target.value)}><option value="all">전체 날짜</option>{recordDateOptions.map(date=><option key={date} value={date}>{date}</option>)}</select></div>
        </div>
        <div className="actions"><button className="button" disabled={!allLogRows.length} onClick={downloadAll}><i className="ti ti-file-spreadsheet" aria-hidden="true"></i>전체 근태 Excel</button>{!allLogRows.length&&<span className="subtle">내보낼 근태 기록이 없습니다.</span>}</div>
      </section>

      <section className="card monthly-attendance-report">
        <div className="monthly-report-head">
          <div>
            <h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-calendar-month" aria-hidden="true"></i>직원 월별 근태 리포트</h2>
            <p className="subtle" style={{margin:0}}>직원 한 명을 선택하면 월별 캘린더와 PDF 저장용 화면이 함께 보입니다.</p>
          </div>
          <div className="monthly-report-controls print-hide">
            <input className="input" type="month" value={reportMonth} onChange={e=>setReportMonth(e.target.value||todayIso().slice(0,7))} />
            <button className="button secondary" onClick={printMonthlyReport}><i className="ti ti-file-type-pdf" aria-hidden="true"></i>PDF 저장</button>
          </div>
        </div>
        {calendarEmployee ? (
          <div className="monthly-report-body">
            <div className="monthly-report-people print-hide">
              {visibleEmployees.map((employee:any)=>(
                <button type="button" key={employee.id} className={calendarEmployee.id===employee.id?"active":""} onClick={()=>setCalendarEmployeeId(employee.id)} style={{"--employee-color":employeeColorFromList(visibleEmployees,employee.id)} as React.CSSProperties}>
                  <i></i><b>{employee.name}</b><span>{employee.employee_no??"-"}</span>
                </button>
              ))}
            </div>
            <div className="monthly-report-panel">
              <div className="monthly-report-summary" style={{"--employee-color":calendarColor} as React.CSSProperties}>
                <i></i>
                <div><b>{calendarEmployee.name}</b><span>{calendarEmployee.employee_no??"-"}</span></div>
                <strong>{Number(reportMonth.slice(5))}월 / 출근 {calendarReportWorkDays}일 / 근무시간 {formatHourValue(calendarReportHours)}시간 / 예정 {calendarFutureScheduledDays}일</strong>
              </div>
              <div className="monthly-calendar-grid" style={{"--employee-color":calendarColor,"--calendar-days":calendarDayKeys.length} as React.CSSProperties}>
                {calendarDayKeys.map(day=><div className="monthly-calendar-head" key={day}>{DAY_LABELS[day]}</div>)}
                {calendarCells.map((date,index)=>{
                  const dayLogs=date?calendarLogMap[date]??[]:[];
                  const info=date?(calendarScheduleMap as any)[date]:null;
                  const isWorked=dayLogs.length>0||!!(date&&info?.workday&&date<=calendarToday&&!info?.leave);
                  const typeLabel=dayLogs.flatMap(attendanceTypeLabelsForLog).filter((label:string,index:number,list:string[])=>list.indexOf(label)===index).slice(0,2).join(" · ");
                  return <div className={`monthly-calendar-cell ${date?"":"empty"} ${isWorked?"worked":info?.workday?"scheduled":"off"}`} key={date??`empty-${index}`}>
                    {date&&<><b>{Number(date.slice(8))}</b><span>{isWorked?dayWorkLabel(dayLogs,info,date):dayPlanLabel(info,date)}</span><small>{dayLogs.length?typeLabel:info?.workday?`${timeLabel(info.start)}~${timeLabel(info.end)}`:info?.event?.title||"근무 안 함"}</small></>}
                  </div>;
                })}
              </div>
            </div>
          </div>
        ) : <p className="subtle">표시할 직원이 없습니다.</p>}
      </section>

      <section className="card">
        <div className="monthly-report-head">
          <h2 className="card-title" style={{marginBottom:4}}><i className="ti ti-chart-bar" aria-hidden="true"></i>직원별 근태 유형</h2>
          <input className="input payroll-month-picker" type="month" value={reportMonth} onChange={e=>setReportMonth(e.target.value||todayIso().slice(0,7))} />
        </div>
        <div className="attendance-status-chart">
          {statusChartRows.map(({employee,counts,typeRows,typeDetails,total,shownTotal}:any)=>(
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
                <div className="attendance-type-counts">
                  {typeRows.length===0 ? <span>저장된 유형 없음</span> : typeDetails.map(({label,count,logs}:any)=><details className="attendance-type-detail" key={label}><summary><b>{label}</b>{count}건</summary><div>{logs.map((log:any)=><p key={log.id}>{formatDateOnly(log.check_in_time)} · {log.workplaces?.name??"-"} · {fmtHoursFromMinutes(reportWorkedMinutes(log))}</p>)}</div></details>)}
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
        <DataTable rows={exceptions.map(l=>({직원:employeeForLog(l)?.name,근무지:l.workplaces?.name,출근:formatDateTime(l.check_in_time),퇴근:formatDateTime(l.check_out_time),상태:l.status}))} />
      </section>
    </div>
  );
}

function DataTable({ rows }: { rows: Record<string,any>[] }) {
  if(!rows.length) return <p className="subtle">표시할 데이터가 없습니다.</p>;
  const cols=Object.keys(rows[0]);
  const nowrapCols=new Set(["직원","사번","상태","서명 일시"]);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((row,i)=><tr key={i}>{cols.map(c=><td key={c} data-label={c}><span className={nowrapCols.has(c)?"table-cell-nowrap":""}>{String(row[c]??"-")}</span></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
