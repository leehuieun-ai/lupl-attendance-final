export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 응답을 JSON으로 해석할 수 없습니다.");
    return JSON.parse(match[0]);
  }
}

export function readJsonBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
}

export async function requireAdmin(req) {
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
  const employee = (await empRes.json())[0];
  if (!employee || employee.role !== "admin" || !employee.is_active || employee.employment_status !== "active") {
    const error = new Error("관리자만 사용할 수 있습니다.");
    error.statusCode = 403;
    throw error;
  }
  return employee;
}
