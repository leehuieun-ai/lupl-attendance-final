import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function internalEmail(no: string) {
  return `${no.trim().toLowerCase()}@lupl.local`;
}
function initialPassword(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  const last4 = digits.slice(-4);
  if (last4.length !== 4) throw new Error("휴대폰 번호 뒷자리 4자리를 확인할 수 없습니다.");
  return `lupl${last4}`;
}
function normalizeWorkDays(value: unknown) {
  const allowed = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
  if (!Array.isArray(value)) return ["mon", "tue", "wed", "thu", "fri"];
  const days = value.map(String).filter((day) => allowed.has(day));
  return days.length > 0 ? Array.from(new Set(days)) : ["mon", "tue", "wed", "thu", "fri"];
}
async function findAuthUserByEmail(adminClient: any, email: string) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data?.users?.find((u: any) => String(u.email || "").toLowerCase() === target);
    if (found) return found;
    if (!data?.users || data.users.length < 1000) break;
  }
  return null;
}
async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: json({ error: "로그인이 필요합니다." }, 401) };

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return { error: json({ error: "Supabase Secret 설정이 부족합니다." }, 500) };
  }

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return { error: json({ error: "로그인 정보를 확인할 수 없습니다." }, 401) };

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: adminEmployee } = await adminClient
    .from("employees")
    .select("id, role, is_active, employment_status")
    .eq("user_id", user.id)
    .single();

  if (!adminEmployee || adminEmployee.role !== "admin" || !adminEmployee.is_active || adminEmployee.employment_status !== "active") {
    return { error: json({ error: "관리자만 직원 계정을 처리할 수 있습니다." }, 403) };
  }
  return { adminClient, adminEmployee };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;
    const adminClient = auth.adminClient;
    const body = await req.json();
    const action = String(body.action || "create_employee");

    if (action === "reset_password") {
      const employeeId = String(body.employee_id || "");
      const { data: emp, error: empError } = await adminClient
        .from("employees")
        .select("id, user_id, name, phone")
        .eq("id", employeeId)
        .single();
      if (empError || !emp) return json({ error: "직원 정보를 찾을 수 없습니다." }, 404);
      if (!emp.user_id) return json({ error: "직원 계정의 Auth 연결 정보가 없습니다." }, 400);
      const password = initialPassword(emp.phone);
      const { error } = await adminClient.auth.admin.updateUserById(emp.user_id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, initial_password: password });
    }

    if (action === "reset_employee_no") {
      const employeeId = String(body.employee_id || "");
      const newEmployeeNo = String(body.new_employee_no || "").trim();
      if (!employeeId || !newEmployeeNo) return json({ error: "직원 ID와 새 사번이 필요합니다." }, 400);
      const email = internalEmail(newEmployeeNo);
      const { data: emp, error: empError } = await adminClient
        .from("employees")
        .select("id, user_id, name, phone")
        .eq("id", employeeId)
        .single();
      if (empError || !emp) return json({ error: "직원 정보를 찾을 수 없습니다." }, 404);
      if (!emp.user_id) return json({ error: "직원 계정의 Auth 연결 정보가 없습니다." }, 400);

      const existingUser = await findAuthUserByEmail(adminClient, email);
      if (existingUser && existingUser.id !== emp.user_id) {
        return json({ error: "이미 사용 중인 사번입니다. 다른 사번을 입력해주세요." }, 400);
      }
      const { error: authError } = await adminClient.auth.admin.updateUserById(emp.user_id, {
        email,
        email_confirm: true,
        user_metadata: { name: emp.name, employee_no: newEmployeeNo, phone: emp.phone },
      });
      if (authError) return json({ error: authError.message }, 400);

      const { error: updateError } = await adminClient
        .from("employees")
        .update({ employee_no: newEmployeeNo, internal_email: email })
        .eq("id", employeeId);
      if (updateError) return json({ error: updateError.message }, 400);
      return json({ ok: true, employee_no: newEmployeeNo });
    }

    const name = String(body.name ?? "").trim();
    const employeeNo = String(body.employee_no ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const joinedAt = String(body.joined_at ?? new Date().toISOString().slice(0, 10));
    const role = body.role === "admin" ? "admin" : "employee";
    const deviceLimit = Math.min(3, Math.max(1, Number(body.device_limit ?? 3)));
    const workDays = normalizeWorkDays(body.work_days);
    if (!name || !employeeNo || !phone) return json({ error: "이름, 사번, 휴대폰 번호는 필수입니다." }, 400);

    const email = internalEmail(employeeNo);
    const password = initialPassword(phone);
    let authUser = await findAuthUserByEmail(adminClient, email);

    if (!authUser) {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, employee_no: employeeNo, phone },
      });
      if (createError || !created.user) return json({ error: createError?.message ?? "직원 계정 생성 실패" }, 400);
      authUser = created.user;
    } else {
      const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(authUser.id, {
        password,
        email_confirm: true,
        user_metadata: { name, employee_no: employeeNo, phone },
      });
      if (updateAuthError) return json({ error: updateAuthError.message }, 400);
    }

    const { error: upsertError } = await adminClient.from("employees").upsert(
      {
        user_id: authUser.id,
        employee_no: employeeNo,
        name,
        phone,
        internal_email: email,
        role,
        device_limit: deviceLimit,
        work_days: workDays,
        joined_at: joinedAt,
        employment_status: "active",
        is_active: true,
      },
      { onConflict: "employee_no" },
    );
    if (upsertError) return json({ error: upsertError.message }, 400);

    return json({ ok: true, employee_no: employeeNo, initial_password: password });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
