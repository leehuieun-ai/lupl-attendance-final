import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type WorksEventType = "check_in" | "check_out";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function env(name: string) {
  return Deno.env.get(name)?.trim() ?? "";
}

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n");
  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwt(clientId: string, serviceAccount: string, privateKeyPem: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: clientId,
    sub: serviceAccount,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function getWorksToken() {
  const clientId = env("NAVER_WORKS_CLIENT_ID");
  const clientSecret = env("NAVER_WORKS_CLIENT_SECRET");
  const serviceAccount = env("NAVER_WORKS_SERVICE_ACCOUNT");
  const privateKey = env("NAVER_WORKS_PRIVATE_KEY");
  if (!clientId || !clientSecret || !serviceAccount || !privateKey) {
    throw new Error("NAVER WORKS 인증 Secret이 부족합니다.");
  }
  const assertion = await signJwt(clientId, serviceAccount, privateKey);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    client_id: clientId,
    client_secret: clientSecret,
    assertion,
    scope: "bot.message",
  });
  const response = await fetch("https://auth.worksmobile.com/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `NAVER WORKS 토큰 발급 실패(${response.status})`);
  }
  return String(data.access_token);
}

function kstParts(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    stamp: `${map.year}${map.month}${map.day}`,
    weekday: map.weekday,
    time: `${map.hour}:${map.minute}`,
  };
}

function buildMessage(eventType: WorksEventType, employeeName: string, log: any, kpis: any[]) {
  const timeSource = eventType === "check_out" ? log.check_out_time : log.check_in_time;
  const time = kstParts(timeSource);
  const header = `${time.stamp} ${time.weekday} ${time.time} ${employeeName} ${eventType === "check_out" ? "퇴근" : "출근"} 완료`;
  const lines = kpis
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    .map((item, index) => {
      const label = eventType === "check_out"
        ? (item.status === "done" ? "[완료] " : "[미완료] ")
        : "";
      return `${label}${index + 1}. ${item.title}`;
    });
  return [header, "오늘의 KPI", ...(lines.length > 0 ? lines : ["- 등록된 KPI 없음"])].join("\n").slice(0, 2000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST만 지원합니다." }, 405);

  const supabaseUrl = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey) return json({ ok: false, error: "Supabase Secret 설정이 부족합니다." }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const serviceClient = serviceKey ? createClient(supabaseUrl, serviceKey) : userClient;

  try {
    const body = await req.json().catch(() => ({}));
    const eventType = String(body.event_type ?? "") as WorksEventType;
    const attendanceLogId = String(body.attendance_log_id ?? "");
    if (!["check_in", "check_out"].includes(eventType)) return json({ ok: false, error: "event_type이 올바르지 않습니다." }, 400);
    if (!attendanceLogId) return json({ ok: false, error: "attendance_log_id가 필요합니다." }, 400);

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ ok: false, error: "로그인이 필요합니다." }, 401);

    const { data: employee } = await userClient
      .from("employees")
      .select("id, name, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("employment_status", "active")
      .maybeSingle();
    if (!employee) return json({ ok: false, error: "활성화된 직원 정보가 없습니다." }, 403);

    const { data: log } = await userClient
      .from("attendance_logs")
      .select("id, employee_id, check_in_time, check_out_time")
      .eq("id", attendanceLogId)
      .eq("employee_id", employee.id)
      .maybeSingle();
    if (!log) return json({ ok: false, error: "출퇴근 기록을 찾을 수 없습니다." }, 404);
    if (eventType === "check_out" && !log.check_out_time) return json({ ok: false, error: "퇴근 시간이 아직 저장되지 않았습니다." }, 409);

    const workDate = kstParts(log.check_in_time).stamp;
    const isoDate = `20${workDate.slice(0, 2)}-${workDate.slice(2, 4)}-${workDate.slice(4, 6)}`;
    const { data: kpis } = await userClient
      .from("kpi_entries")
      .select("id, title, status, sort_order")
      .eq("employee_id", employee.id)
      .eq("work_date", isoDate)
      .eq("scope", "daily")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    const message = buildMessage(eventType, employee.name, log, kpis ?? []);
    const channelId = env("NAVER_WORKS_KPI_CHANNEL_ID");
    const botId = env("NAVER_WORKS_BOT_ID");
    const entryIds = (kpis ?? []).map((item: any) => item.id);

    async function record(status: string, response: unknown = null, error: string | null = null) {
      await serviceClient.from("kpi_works_notifications").insert({
        employee_id: employee.id,
        attendance_log_id: log.id,
        kpi_entry_ids: entryIds,
        event_type: eventType,
        channel_id: channelId || null,
        message,
        status,
        response,
        error,
      });
    }

    if (!channelId || !botId) {
      await record("skipped", null, "NAVER_WORKS_BOT_ID 또는 NAVER_WORKS_KPI_CHANNEL_ID가 설정되지 않았습니다.");
      return json({ ok: true, sent: false, skipped: true, message });
    }

    const token = await getWorksToken();
    const worksResponse = await fetch(`https://www.worksapis.com/v1.0/bots/${encodeURIComponent(botId)}/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: { type: "text", text: message } }),
    });
    const responseText = await worksResponse.text();
    let responseBody: unknown = responseText;
    try { responseBody = responseText ? JSON.parse(responseText) : {}; } catch { /* keep text */ }
    if (!worksResponse.ok) {
      await record("failed", responseBody, `NAVER WORKS 메시지 전송 실패(${worksResponse.status})`);
      return json({ ok: true, sent: false, error: `NAVER WORKS 메시지 전송 실패(${worksResponse.status})`, detail: responseBody, message });
    }

    await record("sent", responseBody, null);
    return json({ ok: true, sent: true, message });
  } catch (error) {
    return json({ ok: true, sent: false, error: error instanceof Error ? error.message : String(error) });
  }
});
