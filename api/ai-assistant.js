import { readJsonBody, requireActiveEmployee, send } from "./_shared.js";

const ALLOWED_ACTIONS = new Set([
  "create_daily_task",
  "create_schedule_event",
  "create_kpi_entry",
  "link_existing_kpi",
  "create_rnr_entry",
  "create_improvement",
  "ask_clarification",
  "answer_only",
]);

function clampList(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function compactContext(context = {}) {
  return {
    current_page: context.current_page || {},
    current_employee: context.current_employee || {},
    employees: clampList(context.employees, 80).map((employee) => ({
      id: employee.id,
      name: employee.name,
      employee_no: employee.employee_no,
      department: employee.department,
      position: employee.position,
      role: employee.role,
    })),
    kpis: clampList(context.kpis, 160).map((entry) => ({
      id: entry.id,
      title: entry.title,
      scope: entry.scope,
      work_date: entry.work_date,
      employee_id: entry.employee_id,
      employee_name: entry.employee_name,
      mentor_employee_id: entry.mentor_employee_id,
      parent_id: entry.parent_id,
      status: entry.status,
    })),
    daily_tasks: clampList(context.daily_tasks, 80).map((task) => ({
      id: task.id,
      title: task.title,
      task_date: task.task_date,
      due_date: task.due_date,
      target_employee_id: task.target_employee_id,
    })),
    schedule_events: clampList(context.schedule_events, 80).map((event) => ({
      id: event.id,
      title: event.title,
      event_type: event.event_type,
      employee_id: event.employee_id,
      start_date: event.start_date,
      end_date: event.end_date,
      start_time: event.start_time,
      end_time: event.end_time,
    })),
    rnr_entries: clampList(context.rnr_entries, 100).map((entry) => ({
      id: entry.id,
      title: entry.title,
      display_title: entry.display_title,
      summary: entry.summary,
      department: entry.department,
      position: entry.position,
      work_group: entry.work_group,
      assigned_employee_id: entry.assigned_employee_id,
      is_public: entry.is_public,
      is_sensitive: entry.is_sensitive,
    })),
  };
}

function isoDateFromKoreanMonthDay(input, today) {
  const match = input.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (!match) return null;
  const year = String(today || "").slice(0, 4) || "2026";
  const month = match[1].padStart(2, "0");
  const day = match[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function heuristicResult(input, context, employee, today) {
  const compact = compactContext(context);
  const employees = compact.employees || [];
  const targetEmployee = employees.find((item) => input.includes(item.name)) || null;
  const date = isoDateFromKoreanMonthDay(input, today) || today;
  const cleanInput = input.replace(/\s+/g, " ").trim();
  const relatedKpi = (compact.kpis || []).find((entry) => {
    const text = `${entry.title || ""} ${entry.employee_name || ""}`.toLowerCase();
    return input.split(/\s+/).some((word) => word.length >= 2 && text.includes(word.toLowerCase()));
  });
  const isAdmin = employee?.role === "admin";
  const looksLikeSchedule = /일정|멘토링|미팅|회의|상담|방문|교육|면담|설명회/.test(input);
  const looksLikeTask = /할\s*일|todo|체크|확인|준비|처리|등록|업로드/.test(input);
  const looksLikeRnr = /r&r|rnr|업무\s*분장|담당|백업|책임|권한|민감\s*자료/i.test(input);
  const looksLikeImprovement = /개선|오류|버그|안\s*돼|안됨|불편|고쳐|수정|에러/.test(input);
  const actions = [];

  if (looksLikeSchedule && isAdmin && targetEmployee?.id) {
    actions.push({
      id: "schedule-1",
      type: "create_schedule_event",
      title: `${targetEmployee.name} 일정 등록`,
      summary: `${date} 일정으로 등록합니다.`,
      permission: "admin",
      confidence: 0.62,
      needs_confirmation: true,
      payload: {
        employee_id: targetEmployee.id,
        title: cleanInput,
        event_type: "info",
        start_date: date,
        end_date: date,
        note: input,
      },
    });
  }

  if (relatedKpi?.id || /kpi|목표|주간|월간|데일리|일일|분기|로드맵|성과/.test(input)) {
    const explicitMonthly = /월간|월\s*목표|이번\s*달/.test(input);
    const explicitWeekly = /주간|이번\s*주|다음\s*주/.test(input);
    const scope = explicitMonthly ? "monthly" : explicitWeekly ? "weekly" : "daily";
    const parentId = scope === "daily"
      ? (relatedKpi?.scope === "weekly" ? relatedKpi.id : relatedKpi?.parent_id || null)
      : scope === "weekly"
        ? (relatedKpi?.scope === "monthly" ? relatedKpi.id : relatedKpi?.parent_id || null)
        : null;
    actions.push({
      id: "kpi-1",
      type: "create_kpi_entry",
      title: relatedKpi ? `${relatedKpi.title} 하위 목표 추가` : "KPI 항목 추가",
      summary: relatedKpi ? "관련 KPI 아래에 데일리 항목을 연결합니다." : "입력 내용을 KPI 항목으로 남깁니다.",
      permission: isAdmin ? "admin" : "employee",
      confidence: relatedKpi ? 0.64 : 0.54,
      needs_confirmation: true,
      payload: {
        scope,
        work_date: date,
        title: cleanInput,
        employee_id: targetEmployee?.id || employee?.id,
        parent_id: parentId,
        mentor_employee_id: relatedKpi?.mentor_employee_id || null,
        description: relatedKpi ? `AI 비서가 '${relatedKpi.title}'와 연결 추천` : input,
      },
    });
  }

  if (looksLikeRnr && isAdmin) {
    actions.push({
      id: "rnr-1",
      type: "create_rnr_entry",
      title: "업무 R&R 등록",
      summary: "입력 내용을 업무분장 항목 초안으로 등록합니다.",
      permission: "admin",
      confidence: 0.55,
      needs_confirmation: true,
      payload: {
        raw_input: input,
        title: cleanInput.slice(0, 36) || "AI 비서 업무",
        summary: input,
        department: targetEmployee?.department || "",
        position: targetEmployee?.position || "",
        assigned_employee_id: targetEmployee?.id || null,
        assigned_person_name: targetEmployee?.name || "",
        category: "운영",
        checklist: ["담당 범위 확인", "최종 책임자 확인", "백업 담당자 확인"],
      },
    });
  }

  if ((looksLikeTask || looksLikeSchedule) && isAdmin) {
    actions.push({
      id: "task-1",
      type: "create_daily_task",
      title: "오늘의 할일로 등록",
      summary: `${targetEmployee?.name || "전체"} 확인용 할일을 만듭니다.`,
      permission: "admin",
      confidence: 0.58,
      needs_confirmation: true,
      payload: {
        task_date: date,
        due_date: date,
        title: cleanInput.slice(0, 50) || "AI 비서 할일",
        content: input,
        target_employee_id: targetEmployee?.id || null,
      },
    });
  }

  if (looksLikeImprovement) {
    actions.push({
      id: "improvement-1",
      type: "create_improvement",
      title: "개선함에 기록",
      summary: "시스템 개선 또는 오류 제보로 남깁니다.",
      permission: "employee",
      confidence: 0.74,
      needs_confirmation: true,
      payload: { note: input },
    });
  }

  if (!actions.length) {
    actions.push({
      id: "improvement-1",
      type: "create_improvement",
      title: "개선함에 기록",
      summary: "바로 실행 가능한 업무 항목으로 확정하기 어려워 개선 요청으로 남깁니다.",
      permission: "employee",
      confidence: 0.5,
      needs_confirmation: true,
      payload: { note: input },
    });
  }

  return {
    reply: "민감정보 보호를 위해 외부 AI 전송 없이 시스템 내부 규칙으로 정리했습니다. 실행 전 한 번만 확인해주세요.",
    actions,
    questions: [],
    fallback_improvement: { note: input },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST만 지원합니다." });
  try {
    const employee = await requireActiveEmployee(req);
    const body = readJsonBody(req);
    const input = String(body.message || "").trim();
    if (!input) return send(res, 400, { error: "AI 비서에게 전달할 내용이 필요합니다." });

    const context = compactContext(body.context || {});
    const today = String(body.today || "").slice(0, 10) || "2026-08-10";
    return send(res, 200, { assistant: heuristicResult(input, context, employee, today), local: true });
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || String(error) });
  }
}
