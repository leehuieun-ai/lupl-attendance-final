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
const employeeLinkCounters = [
  { table: "registered_devices", column: "employee_id", label: "등록 기기" },
  { table: "attendance_logs", column: "employee_id", label: "출퇴근 기록" },
  { table: "attendance_requests", column: "employee_id", label: "휴가/근태 신청" },
  { table: "comp_time_requests", column: "employee_id", label: "추가근무" },
  { table: "leave_adjustments", column: "employee_id", label: "휴가 조정" },
  { table: "privacy_consents", column: "employee_id", label: "동의서" },
  { table: "work_time_change_requests", column: "employee_id", label: "근무시간 변경" },
  { table: "weekly_schedule_overrides", column: "employee_id", label: "주간 근무 기준" },
  { table: "employee_absences", column: "employee_id", label: "미출근 기간" },
  { table: "employee_schedule_events", column: "employee_id", label: "직원 일정" },
  { table: "attendance_correction_requests", column: "employee_id", label: "출퇴근 정정" },
  { table: "daily_tasks", column: "target_employee_id", label: "오늘의 할일" },
  { table: "rnr_entries", column: "assigned_employee_id", label: "업무 R&R" },
  { table: "improvement_requests", column: "created_by", label: "개선함" },
];
const nullableEmployeeReferences = [
  { table: "workplaces", columns: ["requested_by", "approved_by"] },
  { table: "attendance_requests", columns: ["reviewed_by"] },
  { table: "comp_time_requests", columns: ["reviewed_by"] },
  { table: "leave_adjustments", columns: ["created_by"] },
  { table: "monthly_closings", columns: ["closed_by"] },
  { table: "audit_logs", columns: ["actor_employee_id"] },
  { table: "weekly_schedule_overrides", columns: ["created_by"] },
  { table: "employee_absences", columns: ["created_by"] },
  { table: "employee_schedule_events", columns: ["created_by"] },
  { table: "work_time_change_requests", columns: ["reviewed_by"] },
  { table: "daily_tasks", columns: ["created_by", "target_employee_id"] },
  { table: "rnr_entries", columns: ["created_by", "assigned_employee_id"] },
  { table: "attendance_correction_requests", columns: ["requested_by"] },
];
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
async function countEmployeeLinks(adminClient: any, employeeId: string) {
  const rows = await Promise.all(employeeLinkCounters.map(async (item) => {
    const { count, error } = await adminClient
      .from(item.table)
      .select("id", { count: "exact", head: true })
      .eq(item.column, employeeId);
    return { ...item, count: error ? 0 : count ?? 0, error: error?.message };
  }));
  return rows;
}
async function clearNullableEmployeeReferences(adminClient: any, employeeId: string) {
  for (const ref of nullableEmployeeReferences) {
    for (const column of ref.columns) {
      const { error } = await adminClient.from(ref.table).update({ [column]: null }).eq(column, employeeId);
      if (error && !/schema cache|column|relation/i.test(error.message)) throw error;
    }
  }
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

      const { data: duplicateEmployee, error: duplicateEmployeeError } = await adminClient
        .from("employees")
        .select("id, name")
        .eq("employee_no", newEmployeeNo)
        .neq("id", employeeId)
        .maybeSingle();
      if (duplicateEmployeeError) return json({ error: duplicateEmployeeError.message }, 400);
      if (duplicateEmployee) return json({ error: `이미 ${duplicateEmployee.name} 직원이 사용 중인 사번입니다. 다른 사번을 입력해주세요.` }, 400);

      const existingUser = await findAuthUserByEmail(adminClient, email);
      if (existingUser && existingUser.id !== emp.user_id) {
        return json({ error: "이미 사용 중인 사번입니다. 다른 사번을 입력해주세요." }, 400);
      }
      if (!emp.user_id) {
        const { error: updateOnlyError } = await adminClient
          .from("employees")
          .update({ employee_no: newEmployeeNo, internal_email: email })
          .eq("id", employeeId);
        if (updateOnlyError) return json({ error: updateOnlyError.message }, 400);
        return json({ ok: true, employee_no: newEmployeeNo, auth_updated: false });
      }
      const { error: authError } = await adminClient.auth.admin.updateUserById(emp.user_id, {
        email,
        email_confirm: true,
        user_metadata: { name: emp.name, employee_no: newEmployeeNo, phone: emp.phone },
      });
      if (authError) {
        const { error: updateOnlyError } = await adminClient
          .from("employees")
          .update({ employee_no: newEmployeeNo, internal_email: email })
          .eq("id", employeeId);
        if (updateOnlyError) return json({ error: `${authError.message} / DB 사번 변경 실패: ${updateOnlyError.message}` }, 400);
        return json({ ok: true, employee_no: newEmployeeNo, auth_updated: false, auth_error: authError.message });
      }

      const { error: updateError } = await adminClient
        .from("employees")
        .update({ employee_no: newEmployeeNo, internal_email: email })
        .eq("id", employeeId);
      if (updateError) return json({ error: updateError.message }, 400);
      return json({ ok: true, employee_no: newEmployeeNo });
    }

    if (action === "delete_employee") {
      const employeeId = String(body.employee_id || "");
      if (!employeeId) return json({ error: "삭제할 직원 ID가 필요합니다." }, 400);
      if (employeeId === auth.adminEmployee.id) return json({ error: "현재 로그인한 관리자 계정은 삭제할 수 없습니다." }, 400);
      const { data: emp, error: empError } = await adminClient
        .from("employees")
        .select("id, user_id, name, employee_no, employment_status, is_active")
        .eq("id", employeeId)
        .single();
      if (empError || !emp) return json({ error: "직원 정보를 찾을 수 없습니다." }, 404);
      if (emp.employment_status === "active" || emp.is_active) {
        return json({ error: "재직 중인 직원은 먼저 비활성화한 뒤 삭제할 수 있습니다." }, 400);
      }
      const relatedCounts = await countEmployeeLinks(adminClient, employeeId);
      const relatedCount = relatedCounts.reduce((sum, row) => sum + Number(row.count || 0), 0);
      if (body.dry_run) return json({ ok: true, employee: emp, related_count: relatedCount, related_counts: relatedCounts });

      await clearNullableEmployeeReferences(adminClient, employeeId);
      if (emp.user_id) {
        const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(emp.user_id);
        if (deleteUserError && !/not found|does not exist/i.test(deleteUserError.message)) {
          return json({ error: deleteUserError.message }, 400);
        }
      }
      const { error: deleteEmployeeError } = await adminClient.from("employees").delete().eq("id", employeeId);
      if (deleteEmployeeError) return json({ error: deleteEmployeeError.message }, 400);
      return json({ ok: true, deleted_employee_id: employeeId, related_count: relatedCount });
    }

    const name = String(body.name ?? "").trim();
    const employeeNo = String(body.employee_no ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const joinedAt = String(body.joined_at ?? new Date().toISOString().slice(0, 10));
    const workStartDate = String(body.work_start_date || joinedAt);
    const role = body.role === "admin" ? "admin" : "employee";
    const deviceLimit = Math.min(3, Math.max(1, Number(body.device_limit ?? 3)));
    const department = String(body.department ?? "").trim();
    const position = String(body.position ?? "").trim();
    const noAnnualLeave = !!body.no_annual_leave;
    const isUnpaid = !!body.is_unpaid || position === "인턴";
    const workDays = normalizeWorkDays(body.work_days);
    if (!name || !employeeNo || !phone) return json({ error: "이름, 사번, 휴대폰 번호는 필수입니다." }, 400);

    const email = internalEmail(employeeNo);
    const password = initialPassword(phone);
    const { data: existingEmployee, error: existingEmployeeError } = await adminClient
      .from("employees")
      .select("id, name, employee_no")
      .eq("employee_no", employeeNo)
      .maybeSingle();
    if (existingEmployeeError) return json({ error: existingEmployeeError.message }, 400);
    if (existingEmployee) {
      return json({ error: `이미 등록된 사번입니다. ${existingEmployee.name} 직원의 기존 근태·동의 기록과 섞이지 않도록 다른 사번을 입력해주세요.` }, 400);
    }

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

    const payload = {
      user_id: authUser.id,
      employee_no: employeeNo,
      name,
      phone,
      internal_email: email,
      role,
      device_limit: deviceLimit,
      department,
      position,
      no_annual_leave: noAnnualLeave || isUnpaid,
      is_unpaid: isUnpaid,
      work_days: workDays,
      joined_at: joinedAt,
      work_start_date: workStartDate,
      employment_status: "active",
      is_active: true,
    };
    let { error: insertError } = await adminClient.from("employees").insert(payload);
    if (insertError && /is_unpaid|schema cache|column/i.test(insertError.message)) {
      const { is_unpaid, ...fallbackPayload } = payload;
      const fallback = await adminClient.from("employees").insert(fallbackPayload);
      insertError = fallback.error;
    }
    if (insertError) return json({ error: insertError.message }, 400);

    return json({ ok: true, employee_no: employeeNo, initial_password: password });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
