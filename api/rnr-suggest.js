import { parseJsonText, readJsonBody, requireActiveEmployee, send } from "./_shared.js";

const OPENAI_MODEL = "gpt-5.5";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST만 지원합니다." });
  try {
    await requireActiveEmployee(req);
    const apiKey = process.env.LUPL_attendance_API_KEY;
    if (!apiKey) return send(res, 500, { error: "LUPL_attendance_API_KEY 환경변수가 없습니다." });

    const body = readJsonBody(req);
    const input = String(body.input || "").trim();
    if (!input) return send(res, 400, { error: "업무 내용이 필요합니다." });

    const prompt = [
      "너는 소규모 조직의 업무 R&R 정리 담당자다.",
      "관리자가 한국어로 주절주절 적은 업무 메모를 읽고, 담당 부서/직책/업무명을 추천한다.",
      "반드시 JSON만 반환한다.",
      "필드: title, summary, display_title, work_group, flow_notes, target_scope, is_public, public_note, department, position, category, priority, checklist, assigned_person_name.",
      "title은 관리자 원문을 그대로 복사하지 말고, 세무/회계/서류/운영 같은 공식 업무명으로 18자 안팎의 명사구로 정리한다.",
      "display_title은 인턴에게 보여줄 공개 업무명이다. 원문 말투를 빼고 짧고 명확하게 쓴다.",
      "work_group은 세부 업무명이 아니라 부서 안에서 묶일 큰 상위 흐름이다.",
      "work_group은 가능한 한 제공된 업무 묶음 목록 중 하나만 고른다.",
      "신입사원 OJT 준비 및 실시, 지원사업 메일 관리 업무, 자료 제출 같은 세부 업무명은 work_group으로 쓰지 말고 각각 인사·온보딩 관리, 지원사업 관리, 문서 및 자료 관리처럼 큰 묶음으로 흡수한다.",
      "flow_notes는 업무가 왜 연결되는지 보이는 2~4개의 한국어 문장 배열이다. 예: '부가가치세 확정을 위한 세부 서류 준비', '국세·지방세 납부 확인과 증빙 정리'.",
      "target_scope는 common, department, role, employee 중 하나다. OJT·신입·모두·공통 업무는 common으로 둔다.",
      "is_public은 급여·개인정보·계약·계좌·세무 민감자료가 직접 보이면 false, 일반 업무 분장표에 보여도 되면 true다.",
      "public_note는 공개 업무 분장표에 덧붙일 짧은 안내문이며 없으면 빈 문자열이다.",
      "category는 가능한 경우 제공된 업무 분류 목록 중 하나를 고른다.",
      "checklist는 3~6개 한국어 문자열 배열이다.",
      "부서와 직책은 기존 직원/기존 R&R/기본 역할 예시를 참고하되, 확실하지 않으면 가장 가까운 일반 역할을 추천한다.",
      "",
      `업무 분류 목록: ${JSON.stringify(body.categories || [])}`,
      `업무 묶음 목록: ${JSON.stringify(body.work_groups || [])}`,
      `기본 역할 예시: ${JSON.stringify(body.baseline || [])}`,
      `직원 목록: ${JSON.stringify(body.employees || [])}`,
      `기존 R&R: ${JSON.stringify(body.existing || [])}`,
      `관리자 메모: ${input}`,
    ].join("\n");

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
          { role: "system", content: "너는 업무분장과 R&R을 간결하게 구조화하는 한국어 HR 운영 보조자다." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) return send(res, openaiRes.status, { error: data?.error?.message || "OpenAI 호출 실패" });
    const content = data?.choices?.[0]?.message?.content || "{}";
    return send(res, 200, { suggestion: parseJsonText(content) });
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || String(error) });
  }
}
