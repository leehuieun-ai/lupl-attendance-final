const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 응답을 JSON으로 해석할 수 없습니다.");
    return JSON.parse(match[0]);
  }
}

async function requireAdmin(req) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!supabaseUrl || !anonKey) throw new Error("Supabase 환경변수가 없습니다.");
  if (!token) {
    const error = new Error("로그인이 필요합니다.");
    error.statusCode = 401;
    throw error;
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) {
    const error = new Error("로그인 정보를 확인할 수 없습니다.");
    error.statusCode = 401;
    throw error;
  }
  const user = await userRes.json();
  const empRes = await fetch(`${supabaseUrl}/rest/v1/employees?select=id,role,is_active,employment_status&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!empRes.ok) throw new Error("직원 정보를 확인할 수 없습니다.");
  const rows = await empRes.json();
  const employee = rows[0];
  if (!employee || employee.role !== "admin" || !employee.is_active || employee.employment_status !== "active") {
    const error = new Error("관리자만 사용할 수 있습니다.");
    error.statusCode = 403;
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST만 지원합니다." });
  try {
    await requireAdmin(req);
    const apiKey = process.env.LUPL_attendance_API_KEY;
    if (!apiKey) return send(res, 500, { error: "LUPL_attendance_API_KEY 환경변수가 없습니다." });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const input = String(body.input || "").trim();
    if (!input) return send(res, 400, { error: "업무 내용이 필요합니다." });

    const prompt = [
      "너는 소규모 조직의 업무 R&R 정리 담당자다.",
      "관리자가 한국어로 주절주절 적은 업무 메모를 읽고, 담당 부서/직책/업무명을 추천한다.",
      "반드시 JSON만 반환한다.",
      "필드: title, summary, department, position, category, priority, checklist, assigned_person_name.",
      "checklist는 3~6개 한국어 문자열 배열이다.",
      "부서와 직책은 기존 직원/기존 R&R/기본 역할 예시를 참고하되, 확실하지 않으면 가장 가까운 일반 역할을 추천한다.",
      "",
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
        temperature: 0.2,
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
