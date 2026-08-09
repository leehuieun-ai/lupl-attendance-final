import { parseJsonText, readJsonBody, requireActiveEmployee, send } from "./_shared.js";

const OPENAI_MODEL = "gpt-5.5";
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
    employees: clampList(context.employees, 120).map((employee) => ({
      id: employee.id,
      name: employee.name,
      employee_no: employee.employee_no,
      department: employee.department,
      position: employee.position,
      role: employee.role,
    })),
    kpis: clampList(context.kpis, 220).map((entry) => ({
      id: entry.id,
      title: entry.title,
      scope: entry.scope,
      work_date: entry.work_date,
      employee_id: entry.employee_id,
      employee_name: entry.employee_name,
      mentor_employee_id: entry.mentor_employee_id,
      parent_id: entry.parent_id,
      status: entry.status,
      admin_note: entry.admin_note,
    })),
    daily_tasks: clampList(context.daily_tasks, 100).map((task) => ({
      id: task.id,
      title: task.title,
      task_date: task.task_date,
      due_date: task.due_date,
      target_employee_id: task.target_employee_id,
    })),
    schedule_events: clampList(context.schedule_events, 100).map((event) => ({
      id: event.id,
      title: event.title,
      event_type: event.event_type,
      employee_id: event.employee_id,
      start_date: event.start_date,
      end_date: event.end_date,
      start_time: event.start_time,
      end_time: event.end_time,
    })),
    rnr_entries: clampList(context.rnr_entries, 140).map((entry) => ({
      id: entry.id,
      title: entry.title,
      display_title: entry.display_title,
      summary: entry.summary,
      department: entry.department,
      position: entry.position,
      work_group: entry.work_group,
      assigned_employee_id: entry.assigned_employee_id,
      assigned_person_name: entry.assigned_person_name,
      is_public: entry.is_public,
      is_sensitive: entry.is_sensitive,
    })),
  };
}

function sanitizeAssistant(raw) {
  const assistant = raw && typeof raw === "object" ? raw : {};
  const actions = clampList(assistant.actions, 8)
    .filter((action) => action && ALLOWED_ACTIONS.has(action.type))
    .map((action, index) => ({
      ...action,
      id: String(action.id || `${action.type}-${index + 1}`),
      title: String(action.title || action.type || "AI 비서 제안").slice(0, 80),
      summary: String(action.summary || "").slice(0, 300),
      permission: action.permission === "admin" ? "admin" : "employee",
      confidence: Math.max(0, Math.min(1, Number(action.confidence ?? 0.7))),
      needs_confirmation: action.needs_confirmation !== false,
      payload: action.payload && typeof action.payload === "object" ? action.payload : {},
    }));
  return {
    reply: String(assistant.reply || "요청을 실행 가능한 항목으로 정리했습니다. 반영 전 한 번 확인해주세요.").slice(0, 500),
    actions,
    questions: clampList(assistant.questions, 4).map((item) => String(item).slice(0, 160)),
    fallback_improvement: assistant.fallback_improvement || null,
    model: OPENAI_MODEL,
  };
}

function assistantPrompt({ input, context, employee, today }) {
  return [
    "너는 주식회사 러플의 근태관리/운영관리 시스템에 붙은 한국어 AI 비서다.",
    "사용자의 자연어를 읽고 앱에서 실행 가능한 항목을 JSON으로만 반환한다.",
    "절대 실제 저장을 했다고 말하지 말고, actions에 제안만 만든다. 저장은 프론트가 권한 확인 후 한다.",
    "",
    "중요 규칙:",
    "- 현재 날짜는 " + today + " (Asia/Seoul) 이다.",
    "- '26년', '26.5', '5월부터 11월까지' 같은 표현은 2026년으로 해석한다.",
    "- 월만 있는 기간은 시작월 1일, 종료월 말일로 변환한다. 예: 26년 5월부터 11월까지 => 2026-05-01 ~ 2026-11-30.",
    "- 직원 이름이 여러 명 나오면 employees에서 정확히 매칭하고, KPI 담당자는 employee_ids 배열로 모두 넣는다.",
    "- 프로젝트/사업/지원사업/캡스톤/운영 목표처럼 기간과 담당자가 있는 요청은 create_kpi_entry action을 만든다.",
    "- 담당자가 따로 나오지 않은 프로젝트/사업 요청도 create_kpi_entry action으로 만들고, 현재 로그인 직원을 employee_id로 넣는다.",
    "- 프로젝트형 KPI는 scope='monthly', work_date는 project_start가 속한 달의 1일, project_start/project_end를 payload에 넣는다.",
    "- 기존 KPI의 기간/담당/메모를 바꾸는 요청이면 context.kpis에서 제목을 찾아 link_existing_kpi action을 만들고, payload.child_id에 해당 KPI id를 반드시 넣는다.",
    "- 기존 KPI id를 확신할 수 없으면 child_id 없는 link_existing_kpi를 만들지 말고 ask_clarification 또는 create_kpi_entry 제안을 만든다.",
    "- 예: '예술창업도약지원사업은 프로젝트 시작일은 26년 5월부터 11월까지야. 담당자는 이희은 정유니야'라면 title='예술창업도약지원사업', scope='monthly', employee_ids=[이희은 id, 정유니 id], project_start='2026-05-01', project_end='2026-11-30'을 반환한다.",
    "- 일정/멘토링/회의/방문은 create_schedule_event, 오늘 확인해야 하는 실행 업무는 create_daily_task로 둔다.",
    "- 업무분장/R&R/담당/백업/민감 권한은 create_rnr_entry로 둔다.",
    "- 시스템 개선/오류/버그/화면 개선은 create_improvement로 둔다.",
    "- 앱 사용법/근태 기준/추가근무/휴가/KPI/오늘의 할일/R&R 사용법을 묻는 단순 문의는 실행 action을 만들지 말고 reply에만 답한다.",
    "- 직원에게 답할 때는 직원이 알아도 되는 범위만 말한다. 다른 직원의 상세 사유, 관리자 전용 기록, 급여 세부 산식, 권한 설정, 내부 처리 메모는 공개하지 말고 관리자에게 문의하라고 안내한다.",
    "- 추가근무 문의에는 '사전 승인된 추가근무만 인정', '긴급 건은 사후 승인 요청 가능', '출퇴근 기록과 승인 시간이 함께 확인됨', '회사는 수당이 아니라 보상휴가 적립 기준으로 운영'을 직원용 표현으로 간단히 설명한다.",
    "- 출퇴근 정정 문의에는 메인 기능처럼 권장하지 말고 기록 이상이 있을 때 관리자 확인을 통해 정정한다고 답한다.",
    "- 관리자만 타인 일정, 타인 KPI, R&R을 직접 반영할 수 있다. 직원이면 자기 KPI 또는 개선함 중심으로 제안한다.",
    "- 확실하지 않으면 ask_clarification을 만든다.",
    "",
    "반환 JSON 스키마:",
    "{",
    '  "reply": "짧은 한국어 응답",',
    '  "questions": ["필요 시 확인 질문"],',
    '  "actions": [',
    "    {",
    '      "id": "stable-id",',
    '      "type": "create_daily_task | create_schedule_event | create_kpi_entry | link_existing_kpi | create_rnr_entry | create_improvement | ask_clarification | answer_only",',
    '      "title": "버튼/카드 제목",',
    '      "summary": "관리자가 확인할 설명",',
    '      "permission": "employee | admin",',
    '      "confidence": 0.0,',
    '      "needs_confirmation": true,',
    '      "payload": {}',
    "    }",
    "  ],",
    '  "fallback_improvement": {"note": "실행 불가 시 개선함에 남길 원문"}',
    "}",
    "",
    "create_kpi_entry payload:",
    "{ scope, work_date, title, employee_id?, employee_ids?, parent_id?, mentor_employee_id?, description?, project_start?, project_end? }",
    "",
    "create_schedule_event payload:",
    "{ employee_id, title, event_type:'info'|'work'|'am_only'|'pm_only'|'unavailable'|'hidden', start_date, end_date, start_time?, end_time?, note? }",
    "",
    "create_daily_task payload:",
    "{ task_date, due_date, title, content, target_employee_id? }",
    "",
    "create_rnr_entry payload:",
    "{ raw_input, title, summary, display_title, work_group, flow_notes, target_scope, is_public, public_note, department, position, category, priority, checklist, assigned_employee_id, assigned_person_name, is_sensitive }",
    "",
    "현재 로그인 직원:",
    JSON.stringify(employee),
    "",
    "앱 맥락:",
    JSON.stringify(context),
    "",
    "사용자 입력:",
    input,
  ].join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST만 지원합니다." });
  try {
    const employee = await requireActiveEmployee(req);
    const apiKey = process.env.LUPL_attendance_API_KEY;
    if (!apiKey) return send(res, 500, { error: "LUPL_attendance_API_KEY 환경변수가 없습니다." });

    const body = readJsonBody(req);
    const input = String(body.message || "").trim();
    if (!input) return send(res, 400, { error: "AI 비서에게 전달할 내용이 필요합니다." });

    const context = compactContext(body.context || {});
    const today = String(body.today || "").slice(0, 10) || "2026-08-10";
    const prompt = assistantPrompt({ input, context, employee, today });

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "너는 한국어 사내 운영 시스템 AI 비서다. 반드시 JSON만 반환한다." },
          { role: "user", content: prompt },
        ],
      }),
    });

    const data = await openaiRes.json();
    if (!openaiRes.ok) return send(res, openaiRes.status, { error: data?.error?.message || "OpenAI 호출 실패" });
    const content = data?.choices?.[0]?.message?.content || "{}";
    return send(res, 200, { assistant: sanitizeAssistant(parseJsonText(content)), local: false, model: OPENAI_MODEL });
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || String(error) });
  }
}
