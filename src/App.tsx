import { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getDeviceFingerprint } from "./lib/device";
import { getCurrentPositionFast, getPublicIp, distanceMeters } from "./lib/geo";
import {
  calculateAdjustmentDays,
  calculateCompTimeEarnedDays,
  calculateLeaveEntitlement,
  calculateUsedDays,
} from "./lib/leave";
import { exportRowsToExcel } from "./lib/exportExcel";

type Tab = "home" | "leave" | "workplaces" | "admin" | "reports";

const workplaceTypeLabels: Record<string, string> = {
  office: "사무실",
  special_school: "특수학교",
  external_education: "외부 교육장",
  remote: "재택",
  other_field: "기타 외근지",
};

const requestTypeLabels: Record<string, string> = {
  annual: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  hourly: "시간차",
  sick: "병가",
  official: "공가",
  remote: "재택",
  field: "외근",
  special: "특별휴가",
  substitute: "대체휴가",
  compensatory: "보상휴가",
};

function internalEmail(no: string) {
  return `${no.trim().toLowerCase()}@lupl.local`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(v?: string | null) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(v));
}

function badgeClass(s?: string | null) {
  if (!s) return "";
  if (["approved", "정상출근", "외근", "재택", "active"].includes(s)) return "good";
  if (["rejected", "반려", "inactive"].includes(s)) return "bad";
  return "warn";
}

async function fetchCurrentEmployee() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) return { session: null, employee: null };

  const { data } = await supabase
    .from("employees")
    .select("*")
    .eq("user_id", session.user.id)
    .maybeSingle();

  return { session, employee: data };
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [employee, setEmployee] = useState<any | null>(null);
  const [consent, setConsent] = useState<any | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await fetchCurrentEmployee();
    setSession(r.session);
    setEmployee(r.employee);

    if (r.employee) {
      const { data } = await supabase
        .from("privacy_consents")
        .select("*")
        .eq("employee_id", r.employee.id)
        .eq("is_active", true)
        .maybeSingle();

      setConsent(data);
    } else {
      setConsent(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    const { data } = supabase.auth.onAuthStateChange(() => setTimeout(load, 0));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    setEmployee(null);
    setConsent(null);
  }

  if (loading) return <div className="container">불러오는 중입니다.</div>;
  if (!session) return <LoginPage />;

  if (!employee) {
    return (
      <div className="container">
        <section className="card auth-card">
          <h1 className="card-title">직원 정보가 없습니다</h1>
          <p className="subtle">관리자 계정의 employees.user_id 연결을 확인해주세요.</p>
          <button className="button full" onClick={signOut}>로그아웃</button>
        </section>
      </div>
    );
  }

  if (!employee.is_active || employee.employment_status !== "active") {
    return <InactivePage signOut={signOut} />;
  }

  if (!consent) return <ConsentGate employee={employee} onDone={load} signOut={signOut} />;

  const isAdmin = employee.role === "admin";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="logo">L</div>
            <div>
              <h1>러플 근태관리</h1>
              <p>{employee.name} · {isAdmin ? "관리자" : "직원"} · 기기 {employee.device_limit ?? 3}대</p>
            </div>
          </div>
          <button className="button ghost" onClick={signOut}>로그아웃</button>
        </div>
      </header>

      <main className="container">
        <nav className="tabs">
          <button className={`tab ${tab === "home" ? "active" : ""}`} onClick={() => setTab("home")}>출퇴근</button>
          <button className={`tab ${tab === "leave" ? "active" : ""}`} onClick={() => setTab("leave")}>연차·대체휴가</button>
          <button className={`tab ${tab === "workplaces" ? "active" : ""}`} onClick={() => setTab("workplaces")}>근무지</button>
          {isAdmin && <button className={`tab ${tab === "admin" ? "active" : ""}`} onClick={() => setTab("admin")}>관리자</button>}
          {isAdmin && <button className={`tab ${tab === "reports" ? "active" : ""}`} onClick={() => setTab("reports")}>보고서</button>}
        </nav>

        {tab === "home" && <HomePage employee={employee} />}
        {tab === "leave" && <LeavePage employee={employee} />}
        {tab === "workplaces" && <WorkplacePage employee={employee} />}
        {tab === "admin" && isAdmin && <AdminPage />}
        {tab === "reports" && isAdmin && <ReportsPage />}
      </main>
    </div>
  );
}

function LoginPage() {
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function login() {
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email: internalEmail(employeeNo),
      password,
    });

    if (error) setMessage("사번 또는 비밀번호를 확인해주세요.");
  }

  return (
    <div className="container">
      <section className="card auth-card">
        <div className="logo" style={{ marginBottom: 18 }}>L</div>
        <h1 className="card-title">러플 근태관리 로그인</h1>
        <p className="subtle">관리자가 생성한 사번으로 로그인합니다. 초기 비밀번호는 lupl + 휴대폰 뒷번호 4자리입니다.</p>
        {message && <div className="alert error">{message}</div>}
        <div className="form-row">
          <label className="label">사번</label>
          <input className="input" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} placeholder="예: 20220612001" />
        </div>
        <div className="form-row">
          <label className="label">비밀번호</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="button full" onClick={login}>로그인</button>
      </section>
    </div>
  );
}

function InactivePage({ signOut }: { signOut: () => void }) {
  return (
    <div className="container">
      <section className="card auth-card">
        <h1 className="card-title">비활성 계정입니다</h1>
        <p className="subtle">관리자에게 계정 활성화를 요청해주세요. 기존 근태 기록은 보존됩니다.</p>
        <button className="button full" onClick={signOut}>로그아웃</button>
      </section>
    </div>
  );
}

function ConsentGate({ employee, onDone, signOut }: { employee: any; onDone: () => void; signOut: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [agree1, setAgree1] = useState(false);
  const [agree2, setAgree2] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [msg, setMsg] = useState("");

  function ctx() {
    const c = canvasRef.current;
    if (!c) return null;
    const x = c.getContext("2d");
    if (!x) return null;
    x.lineWidth = 2.4;
    x.lineCap = "round";
    x.strokeStyle = "#111827";
    return x;
  }

  function point(e: any) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const p = e.touches?.[0] ?? e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }

  function start(e: any) {
    setDrawing(true);
    const c = ctx();
    const p = point(e);
    c?.beginPath();
    c?.moveTo(p.x, p.y);
  }

  function move(e: any) {
    if (!drawing) return;
    e.preventDefault();
    const c = ctx();
    const p = point(e);
    c?.lineTo(p.x, p.y);
    c?.stroke();
  }

  function end() {
    setDrawing(false);
  }

  function clear() {
    const c = canvasRef.current;
    const x = ctx();
    if (c && x) x.clearRect(0, 0, c.width, c.height);
  }

  async function submit() {
    setMsg("");
    if (!agree1 || !agree2) return setMsg("동의 항목을 모두 체크해주세요.");
    const canvas = canvasRef.current;
    const signature = canvas?.toDataURL("image/png");
    if (!signature || signature.length < 1200) return setMsg("서명을 입력해주세요.");

    const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();

    const { error } = await supabase.from("privacy_consents").insert({
      employee_id: employee.id,
      consent_location: true,
      consent_device: true,
      consent_version: "2026-01",
      signature_data: signature,
      device_fingerprint_hash: fingerprintHash,
      device_info: deviceInfo,
      is_active: true,
    });

    if (error) setMsg(error.message);
    else onDone();
  }

  return (
    <div className="container">
      <section className="card" style={{ maxWidth: 860, margin: "28px auto" }}>
        <h1 className="card-title">개인정보 수집·이용 및 위치정보 동의서</h1>
        <p className="subtle">주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를 수집·이용합니다.</p>
        <div className="alert" style={{ marginTop: 16 }}>위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다.</div>
        {msg && <div className="alert error">{msg}</div>}
        <label className="checkbox"><input type="checkbox" checked={agree1} onChange={(e) => setAgree1(e.target.checked)} /> 개인정보 및 위치정보 수집·이용에 동의합니다.</label>
        <label className="checkbox"><input type="checkbox" checked={agree2} onChange={(e) => setAgree2(e.target.checked)} /> 위치·기기 정보는 근태 확인 목적 외로 사용하지 않는다는 설명을 확인했습니다.</label>
        <div style={{ marginTop: 18 }}>
          <label className="label">서명</label>
          <canvas ref={canvasRef} width={760} height={180} className="signature-pad" onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="button" onClick={submit}>동의하고 시작</button>
          <button className="button secondary" onClick={clear}>서명 다시 쓰기</button>
          <button className="button ghost" onClick={signOut}>로그아웃</button>
        </div>
      </section>
    </div>
  );
}

function HomePage({ employee }: { employee: any }) {
  const [now, setNow] = useState(new Date());
  const [workplaces, setWorkplaces] = useState<any[]>([]);
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState("");
  const [todayLog, setTodayLog] = useState<any | null>(null);
  const [breakLog, setBreakLog] = useState<any | null>(null);
  const [openLogs, setOpenLogs] = useState<any[]>([]);
  const [attendanceMode, setAttendanceMode] = useState<"정상출근" | "외근" | "재택">("정상출근");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [detectedPlace, setDetectedPlace] = useState<any | null>(null);
  const [unknownPlaceName, setUnknownPlaceName] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function load() {
    const { data: places } = await supabase.from("workplaces").select("*").neq("approval_status", "rejected").eq("is_active", true).order("name");
    setWorkplaces(places ?? []);

    const { data: logs } = await supabase
      .from("attendance_logs")
      .select("*, workplaces(name,type)")
      .eq("employee_id", employee.id)
      .gte("check_in_time", `${todayIso()}T00:00:00`)
      .order("created_at", { ascending: false })
      .limit(1);

    const log = logs?.[0] ?? null;
    setTodayLog(log);

    if (log?.id && !log.check_out_time) {
      const { data: br } = await supabase.from("break_logs").select("*").eq("attendance_log_id", log.id).is("break_end", null).maybeSingle();
      setBreakLog(br);
    } else {
      setBreakLog(null);
    }

    const { data: open } = await supabase
      .from("attendance_logs")
      .select("*, workplaces(name,type)")
      .eq("employee_id", employee.id)
      .is("check_out_time", null)
      .order("check_in_time", { ascending: false })
      .limit(5);

    setOpenLogs(open ?? []);
  }

  useEffect(() => { load(); }, []);

  async function detectPlace(lat: number, lng: number, ip: string | null) {
    const approved = workplaces.filter((w) => w.approval_status === "approved" && w.lat != null && w.lng != null);
    const withDistance = approved.map((w) => ({ ...w, distance: distanceMeters(lat, lng, w.lat, w.lng) }));
    const gps = withDistance.sort((a, b) => a.distance - b.distance).find((w) => w.distance <= (w.radius_m ?? 100));
    if (gps) return gps;
    if (ip) return approved.find((w) => w.ip_hint && w.ip_hint === ip) || null;
    return null;
  }

  async function checkIn() {
    setBusy(true);
    setMessage("현재 위치를 확인하는 중입니다.");
    setDetectedPlace(null);

    try {
      const { data: open } = await supabase
        .from("attendance_logs")
        .select("*, workplaces(name,type)")
        .eq("employee_id", employee.id)
        .is("check_out_time", null)
        .order("check_in_time", { ascending: false })
        .limit(5);

      if (open && open.length > 0) {
        setOpenLogs(open);
        setMessage("아직 퇴근 처리되지 않은 출근 기록이 있습니다. 아래 미퇴근 기록을 확인해주세요.");
        return;
      }

      const p = await getCurrentPositionFast();
      const ip = await getPublicIp();
      const d = await detectPlace(p.lat, p.lng, ip);

      if (d) {
        setDetectedPlace({ ...d, currentLat: p.lat, currentLng: p.lng, ip });
        setSelectedWorkplaceId(d.id);
        setMessage(`${d.name} 근처로 확인되었습니다. 이 장소가 맞으면 출근 확정을 눌러주세요.`);
      } else {
        setDetectedPlace({ currentLat: p.lat, currentLng: p.lng, ip });
        setMessage("등록된 근무지 반경 안이 아닙니다. 현재 장소명을 입력하면 관리자 승인 대기 근무지로 저장됩니다.");
      }
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCheckIn() {
    setBusy(true);
    setMessage("");

    try {
      const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();
      let workplaceId = selectedWorkplaceId;

      if (!workplaceId && unknownPlaceName && detectedPlace?.currentLat) {
        const { data: newPlace, error: placeError } = await supabase
          .from("workplaces")
          .insert({
            name: unknownPlaceName,
            type: "other_field",
            lat: detectedPlace.currentLat,
            lng: detectedPlace.currentLng,
            ip_hint: detectedPlace.ip,
            radius_m: 100,
            approval_status: "pending",
            requested_by: employee.id,
          })
          .select()
          .single();

        if (placeError) throw placeError;
        workplaceId = newPlace.id;
      }

      if (!workplaceId) throw new Error("근무지 선택 또는 현재 장소명 입력이 필요합니다.");

      const { data, error } = await supabase.rpc("check_in", {
        p_workplace_id: workplaceId,
        p_lat: detectedPlace?.currentLat ?? null,
        p_lng: detectedPlace?.currentLng ?? null,
        p_accuracy_m: null,
        p_ip_address: detectedPlace?.ip ?? null,
        p_device_fingerprint_hash: fingerprintHash,
        p_device_info: deviceInfo,
      });

      if (error) throw error;

      setMessage(`출근 처리 결과: ${data?.attendance_status ?? "저장 완료"}`);
      setDetectedPlace(null);
      setUnknownPlaceName("");
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    setBusy(true);
    setMessage("퇴근 위치를 확인하는 중입니다.");

    try {
      const p = await getCurrentPositionFast();
      const ip = await getPublicIp();
      const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();

      const { data, error } = await supabase.rpc("check_out", {
        p_lat: p.lat,
        p_lng: p.lng,
        p_accuracy_m: p.accuracy,
        p_ip_address: ip,
        p_device_fingerprint_hash: fingerprintHash,
        p_device_info: deviceInfo,
      });

      if (error) throw error;

      setMessage(`퇴근 처리 결과: ${data?.attendance_status ?? "저장 완료"}`);
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startBreak() {
    if (!todayLog?.id) return setMessage("출근 기록이 없습니다.");
    const { error } = await supabase.from("break_logs").insert({ attendance_log_id: todayLog.id, employee_id: employee.id });
    if (error) setMessage(error.message);
    else {
      setMessage("휴게 시작 처리되었습니다.");
      await load();
    }
  }

  async function endBreak() {
    if (!breakLog?.id) return setMessage("진행 중인 휴게가 없습니다.");
    const { error } = await supabase.from("break_logs").update({ break_end: new Date().toISOString() }).eq("id", breakLog.id);
    if (error) setMessage(error.message);
    else {
      setMessage("휴게 종료 처리되었습니다.");
      await load();
    }
  }

  return (
    <div className="grid two">
      <section className="card">
        <p className="subtle">{now.toLocaleDateString("ko-KR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        <div className="clock">{now.toLocaleTimeString("ko-KR", { hour12: false })}</div>
        <div className="card" style={{ boxShadow: "none", margin: "14px 0" }}>
          <h3 className="card-title">오늘의 출근</h3>
          <div className="actions">
            {(["정상출근", "외근", "재택"] as const).map((mode) => (
              <button
                key={mode}
                className={attendanceMode === mode ? "button" : "button ghost"}
                onClick={() => setAttendanceMode(mode)}
                disabled={!!todayLog?.check_in_time}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="subtle" style={{ marginTop: 8 }}>
            선택한 출근 유형은 오늘 근무 확인용으로 표시됩니다. 출근 확정은 GPS/IP 확인 후 진행됩니다.
          </p>
        </div>

        <div className="punch-grid">
          <button className="button punch" disabled={busy || !!todayLog?.check_in_time || openLogs.length > 0} onClick={checkIn}>출근하기</button>
          <button className="button secondary punch" disabled={busy || (!todayLog?.check_in_time && openLogs.length === 0) || !!todayLog?.check_out_time} onClick={checkOut}>퇴근하기</button>
        </div>

        {message && <div className="alert" style={{ marginTop: 16 }}>{message}</div>}

        {openLogs.length > 0 && (
          <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
            <h3 className="card-title">미퇴근 출근 기록</h3>
            <p className="subtle">
              아래 기록이 퇴근 처리되지 않아 새 출근을 진행할 수 없습니다.
              해당 기록을 확인한 뒤 퇴근 처리하거나 관리자 확인을 진행해주세요.
            </p>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>출근시각</th>
                    <th>근무지</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {openLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.check_in_time)}</td>
                      <td>{log.workplaces?.name ?? "-"}</td>
                      <td>{log.status ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {detectedPlace && (
          <div className="card" style={{ marginTop: 16, boxShadow: "none" }}>
            {detectedPlace.id ? (
              <>
                <h3 className="card-title">{detectedPlace.name} 맞나요?</h3>
                <p className="subtle">GPS/IP 기준으로 가장 가까운 승인 근무지를 찾았습니다.</p>
              </>
            ) : (
              <>
                <h3 className="card-title">현재 장소를 입력해주세요</h3>
                <p className="subtle">입력한 장소는 관리자 승인 대기 근무지로 저장됩니다.</p>
                <input className="input" value={unknownPlaceName} onChange={(e) => setUnknownPlaceName(e.target.value)} placeholder="예: 대구○○학교, ○○교육장" />
              </>
            )}
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="button" onClick={confirmCheckIn}>출근 확정</button>
              <button className="button ghost" onClick={() => setDetectedPlace(null)}>취소</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">오늘 근무 요약</h2>
        <div className="grid two">
          <div className="metric"><div className="metric-value">{todayLog?.check_in_time ? formatDateTime(todayLog.check_in_time).split(" ").slice(-1)[0] : "-"}</div><div className="metric-label">출근</div></div>
          <div className="metric"><div className="metric-value">{todayLog?.check_out_time ? formatDateTime(todayLog.check_out_time).split(" ").slice(-1)[0] : "-"}</div><div className="metric-label">퇴근</div></div>
        </div>
        <div style={{ marginTop: 16 }}>
          <span className={`badge ${badgeClass(todayLog?.status)}`}>{todayLog?.status ?? "기록 없음"}</span>
          <p className="subtle">근무지: {todayLog?.workplaces?.name ?? "-"}</p>
          <p className="subtle">기기 상태: {todayLog?.device_status ?? "-"}</p>
        </div>
      </section>
    </div>
  );
}

function LeavePage({ employee }: { employee: any }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [compRequests, setCompRequests] = useState<any[]>([]);
  const [form, setForm] = useState({ request_type: "annual", start_date: todayIso(), end_date: todayIso(), amount_hours: "", reason: "" });
  const [compForm, setCompForm] = useState({ work_date: todayIso(), start_time: "18:00", end_time: "20:00", hours: 2, reason: "" });
  const [message, setMessage] = useState("");

  async function load() {
    const [r, a, c] = await Promise.all([
      supabase.from("attendance_requests").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false }),
      supabase.from("leave_adjustments").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false }),
      supabase.from("comp_time_requests").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false }),
    ]);
    setRequests(r.data ?? []);
    setAdjustments(a.data ?? []);
    setCompRequests(c.data ?? []);
  }

  useEffect(() => { load(); }, []);

  const ent = calculateLeaveEntitlement(employee.joined_at);
  const adj = calculateAdjustmentDays(adjustments);
  const compEarned = calculateCompTimeEarnedDays(adjustments);
  const approvedUsed = calculateUsedDays(requests, false);
  const pendingUsed = calculateUsedDays(requests, true);
  const totalGranted = ent.baseGrantedDays + adj;
  const remaining = Math.max(0, totalGranted - approvedUsed);
  const expectedRemaining = Math.max(0, totalGranted - pendingUsed);

  async function submitLeave() {
    setMessage("");
    const amountHours = form.request_type === "hourly" && form.amount_hours ? Number(form.amount_hours) : null;
    const requestedDays = form.request_type === "hourly" ? Number(form.amount_hours || 0) / 8 : form.request_type === "half_am" || form.request_type === "half_pm" ? 0.5 : 1;

    if (["annual", "half_am", "half_pm", "hourly"].includes(form.request_type) && requestedDays > expectedRemaining) {
      return setMessage("잔여 휴가가 부족하여 신청할 수 없습니다.");
    }

    const { error } = await supabase.from("attendance_requests").insert({
      employee_id: employee.id,
      request_type: form.request_type,
      start_date: form.start_date,
      end_date: form.end_date,
      amount_hours: amountHours,
      amount_days: amountHours ? amountHours / 8 : null,
      reason: form.reason,
      status: "pending",
    });

    if (error) setMessage(error.message);
    else {
      setMessage("근태 신청이 저장되었습니다.");
      await load();
    }
  }

  async function submitCompTime() {
    setMessage("");
    if (!compForm.hours || compForm.hours <= 0) return setMessage("추가 근무 시간을 입력해주세요.");

    const { error } = await supabase.from("comp_time_requests").insert({
      employee_id: employee.id,
      work_date: compForm.work_date,
      start_time: compForm.start_time,
      end_time: compForm.end_time,
      hours: compForm.hours,
      converted_days: Number((compForm.hours / 8).toFixed(2)),
      reason: compForm.reason,
      status: "pending",
    });

    if (error) setMessage(error.message);
    else {
      setMessage("추가 근무 대체휴가 적립 신청이 저장되었습니다. 관리자 승인 후 사용 가능합니다.");
      await load();
    }
  }

  return (
    <div className="grid">
      {message && <div className="alert">{message}</div>}
      <section className="grid four">
        <div className="metric"><div className="metric-value">{totalGranted.toFixed(1)}</div><div className="metric-label">총 사용 가능 휴가</div></div>
        <div className="metric"><div className="metric-value">{approvedUsed.toFixed(1)}</div><div className="metric-label">승인 사용</div></div>
        <div className="metric"><div className="metric-value">{remaining.toFixed(1)}</div><div className="metric-label">잔여</div></div>
        <div className="metric"><div className="metric-value">{compEarned.toFixed(1)}</div><div className="metric-label">추가근무 대체휴가 적립</div></div>
      </section>

      <section className="card">
        <h2 className="card-title">연차 현황</h2>
        <p className="subtle">근무 시작일: {employee.joined_at ?? "-"} · 기본 발생: {ent.baseGrantedDays}일 · 관리자/추가근무 조정: {adj.toFixed(1)}일 · 대기 포함 예상 잔여: {expectedRemaining.toFixed(1)}일</p>
        <p className="subtle">기준: {ent.description} · 산정기간 {ent.periodStart ?? "-"} ~ {ent.periodEnd ?? "-"}</p>
      </section>

      <div className="grid two">
        <section className="card">
          <h2 className="card-title">휴가 신청</h2>
          <div className="alert">
            현재 사용 가능 휴가: <b>{expectedRemaining.toFixed(1)}일</b>
            {" "}({(expectedRemaining * 8).toFixed(1)}시간)
          </div>
          <div className="form-row">
            <label className="label">신청 유형</label>
            <select className="select" value={form.request_type} onChange={(e) => setForm({ ...form, request_type: e.target.value })}>
              {Object.entries(requestTypeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid two">
            <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div className="form-row"><label className="label">종료일</label><input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          </div>
          {form.request_type === "hourly" && <div className="form-row"><label className="label">시간차 사용 시간</label><input className="input" type="number" step="0.5" value={form.amount_hours} onChange={(e) => setForm({ ...form, amount_hours: e.target.value })} /></div>}
          <div className="form-row"><label className="label">사유</label><textarea className="textarea" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          <button className="button full" onClick={submitLeave}>신청하기</button>
        </section>

        <section className="card">
          <h2 className="card-title">추가근무 대체휴가 적립 신청</h2>
          <p className="subtle">추가근무 수당 대신 휴가로 대체 적립합니다. 관리자 승인 후에만 휴가 잔여에 추가됩니다. 환산 기준은 8시간 = 1일입니다.</p>
          <div className="form-row"><label className="label">추가근무일</label><input className="input" type="date" value={compForm.work_date} onChange={(e) => setCompForm({ ...compForm, work_date: e.target.value })} /></div>
          <div className="grid three">
            <div className="form-row"><label className="label">시작</label><input className="input" type="time" value={compForm.start_time} onChange={(e) => setCompForm({ ...compForm, start_time: e.target.value })} /></div>
            <div className="form-row"><label className="label">종료</label><input className="input" type="time" value={compForm.end_time} onChange={(e) => setCompForm({ ...compForm, end_time: e.target.value })} /></div>
            <div className="form-row"><label className="label">시간</label><input className="input" type="number" step="0.5" value={compForm.hours} onChange={(e) => setCompForm({ ...compForm, hours: Number(e.target.value) })} /></div>
          </div>
          <div className="form-row"><label className="label">사유</label><textarea className="textarea" value={compForm.reason} onChange={(e) => setCompForm({ ...compForm, reason: e.target.value })} placeholder="예: 행사 운영, 외부 교육 연장 등" /></div>
          <button className="button full" onClick={submitCompTime}>대체휴가 적립 신청</button>
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">신청 내역</h2>
        <DataTable rows={[
          ...requests.map((r) => ({ 구분: requestTypeLabels[r.request_type] ?? r.request_type, 기간: `${r.start_date}~${r.end_date}`, 환산: r.amount_days ?? "-", 상태: r.status, 사유: r.reason ?? "-" })),
          ...compRequests.map((r) => ({ 구분: "추가근무 대체휴가 적립", 기간: r.work_date, 환산: `${r.hours}시간 → ${r.converted_days}일`, 상태: r.status, 사유: r.reason ?? "-" })),
        ]} />
      </section>
    </div>
  );
}

function WorkplacePage({ employee }: { employee: any }) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<any[]>([]);
  const [workplaces, setWorkplaces] = useState<any[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    const { data } = await supabase.from("workplaces").select("*, requester:employees(name)").order("created_at", { ascending: false });
    setWorkplaces(data ?? []);
  }

  useEffect(() => { load(); }, []);

  async function search() {
    const { data, error } = await supabase.functions.invoke("kakao-place-search", { body: { query } });
    if (error) setMessage(error.message);
    else setPlaces(data?.documents ?? []);
  }

  async function requestPlace(p: any) {
    const { error } = await supabase.from("workplaces").insert({
      name: p.place_name,
      type: "special_school",
      address: p.road_address_name || p.address_name,
      kakao_place_id: p.id,
      lat: Number(p.y),
      lng: Number(p.x),
      radius_m: 100,
      approval_status: "pending",
      requested_by: employee.id,
    });

    if (error) setMessage(error.message);
    else {
      setMessage("근무지 승인 요청이 저장되었습니다.");
      setPlaces([]);
      setQuery("");
      await load();
    }
  }

  const grouped = {
    approved: workplaces.filter((w) => w.approval_status === "approved"),
    pending: workplaces.filter((w) => w.approval_status === "pending"),
    rejected: workplaces.filter((w) => w.approval_status === "rejected"),
  };

  return (
    <div className="grid two">
      <section className="card">
        <h2 className="card-title">근무지 검색·요청</h2>
        <p className="subtle">카카오맵 검색으로 근무지를 등록 요청합니다. 승인이 완료되면 다음 출근 시 자동 후보로 사용됩니다.</p>
        {message && <div className="alert">{message}</div>}
        <div className="form-row"><label className="label">근무지명</label><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 대구광명학교" /></div>
        <button className="button" onClick={search}>검색</button>
        <div className="grid" style={{ marginTop: 14 }}>
          {places.map((p) => <div className="card" style={{ boxShadow: "none" }} key={p.id}><b>{p.place_name}</b><p className="subtle">{p.road_address_name || p.address_name}</p><button className="button secondary" onClick={() => requestPlace(p)}>승인 요청</button></div>)}
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">근무지 목록</h2>
        <h3>승인된 근무지</h3>
        <DataTable rows={grouped.approved.map((w) => ({ 이름: w.name, 유형: workplaceTypeLabels[w.type], 반경: `${w.radius_m}m`, 요청자: w.requester?.name ?? "-" }))} />
        <h3>승인 대기</h3>
        <DataTable rows={grouped.pending.map((w) => ({ 이름: w.name, 유형: workplaceTypeLabels[w.type], 반경: `${w.radius_m}m`, 요청자: w.requester?.name ?? "-" }))} />
      </section>
    </div>
  );
}

function AdminPage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [employeeFilter, setEmployeeFilter] = useState("active");
  const [devices, setDevices] = useState<any[]>([]);
  const [workplaces, setWorkplaces] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [compRequests, setCompRequests] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [newEmployee, setNewEmployee] = useState({ name: "", employee_no: "", phone: "", joined_at: todayIso(), role: "employee", device_limit: 3 });

  async function load() {
    const [e, d, w, r, c] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: false }),
      supabase.from("registered_devices").select("*, employees(name, employee_no)").order("created_at", { ascending: false }),
      supabase.from("workplaces").select("*, requester:employees(name)").order("created_at", { ascending: false }),
      supabase.from("attendance_requests").select("*, employees(name, employee_no)").order("created_at", { ascending: false }),
      supabase.from("comp_time_requests").select("*, employees(name, employee_no)").order("created_at", { ascending: false }),
    ]);

    setEmployees(e.data ?? []);
    setDevices(d.data ?? []);
    setWorkplaces(w.data ?? []);
    setRequests(r.data ?? []);
    setCompRequests(c.data ?? []);
  }

  useEffect(() => { load(); }, []);

  async function createEmployee() {
    setMessage("");
    const { data, error } = await supabase.functions.invoke("admin-create-employee", { body: newEmployee });

    if (error) setMessage(error.message);
    else if (data?.error) setMessage(data.error);
    else {
      setMessage(`직원 계정이 생성되었습니다. 초기 비밀번호: ${data.initial_password}`);
      setNewEmployee({ name: "", employee_no: "", phone: "", joined_at: todayIso(), role: "employee", device_limit: 3 });
      await load();
    }
  }

  async function updateEmployee(id: string, patch: Record<string, any>) {
    const { error } = await supabase.from("employees").update(patch).eq("id", id);
    if (error) setMessage(error.message);
    else await load();
  }

  async function toggleEmployee(id: string, currentStatus: string) {
    const nextActive = currentStatus !== "active";
    await updateEmployee(id, {
      is_active: nextActive,
      employment_status: nextActive ? "active" : "inactive",
    });
  }

  async function reviewWorkplace(id: string, status: string) {
    const { error } = await supabase.from("workplaces").update({ approval_status: status, is_active: status === "approved" }).eq("id", id);
    if (error) setMessage(error.message);
    else await load();
  }

  async function reviewRequest(id: string, status: string) {
    const { error } = await supabase.rpc("review_attendance_request", { p_request_id: id, p_status: status, p_review_note: "" });
    if (error) setMessage(error.message);
    else await load();
  }

  async function reviewCompRequest(id: string, status: string) {
    const { error } = await supabase.rpc("review_comp_time_request", { p_request_id: id, p_status: status, p_review_note: "" });
    if (error) setMessage(error.message);
    else {
      setMessage(status === "approved" ? "추가근무 대체휴가가 승인되어 휴가 잔여에 추가되었습니다." : "추가근무 대체휴가 신청을 반려했습니다.");
      await load();
    }
  }

  async function reviewDevice(id: string, status: string) {
    const { error } = await supabase.from("registered_devices").update({ status }).eq("id", id);
    if (error) setMessage(error.message);
    else await load();
  }

  const filteredEmployees = employees.filter((e) =>
    employeeFilter === "all" ? true : employeeFilter === "inactive" ? e.employment_status !== "active" : e.employment_status === "active"
  );

  return (
    <div className="grid">
      {message && <div className="alert">{message}</div>}

      <section className="card">
        <h2 className="card-title">직원 계정 생성</h2>
        <div className="grid four">
          <div className="form-row"><label className="label">이름</label><input className="input" value={newEmployee.name} onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })} /></div>
          <div className="form-row"><label className="label">사번</label><input className="input" value={newEmployee.employee_no} onChange={(e) => setNewEmployee({ ...newEmployee, employee_no: e.target.value })} /></div>
          <div className="form-row"><label className="label">휴대폰</label><input className="input" value={newEmployee.phone} onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })} placeholder="010-0000-0000" /></div>
          <div className="form-row"><label className="label">근무 시작일</label><input className="input" type="date" value={newEmployee.joined_at} onChange={(e) => setNewEmployee({ ...newEmployee, joined_at: e.target.value })} /></div>
        </div>
        <button className="button" onClick={createEmployee}>직원 생성</button>
      </section>

      <section className="card">
        <h2 className="card-title">직원 관리</h2>
        <div className="tabs">
          <button className={`tab ${employeeFilter === "active" ? "active" : ""}`} onClick={() => setEmployeeFilter("active")}>재직 직원</button>
          <button className={`tab ${employeeFilter === "inactive" ? "active" : ""}`} onClick={() => setEmployeeFilter("inactive")}>비활성 직원</button>
          <button className={`tab ${employeeFilter === "all" ? "active" : ""}`} onClick={() => setEmployeeFilter("all")}>전체</button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>직원</th>
                <th>권한</th>
                <th>상태</th>
                <th>근무 시작일</th>
                <th>기기 제한</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}<br /><span className="subtle">{e.employee_no} · {e.phone}</span></td>
                  <td>
                    <select className="select" value={e.role} onChange={(ev) => updateEmployee(e.id, { role: ev.target.value })}>
                      <option value="admin">관리자</option>
                      <option value="employee">직원</option>
                    </select>
                  </td>
                  <td><span className={`badge ${badgeClass(e.employment_status)}`}>{e.employment_status}</span></td>
                  <td><input className="input" type="date" value={e.joined_at ?? ""} onChange={(ev) => updateEmployee(e.id, { joined_at: ev.target.value })} /></td>
                  <td>
                    <select className="select" value={e.device_limit} onChange={(ev) => updateEmployee(e.id, { device_limit: Number(ev.target.value) })}>
                      <option value={1}>1대</option>
                      <option value={2}>2대</option>
                      <option value={3}>3대</option>
                    </select>
                  </td>
                  <td>
                    <button className={e.employment_status === "active" ? "button danger" : "button secondary"} onClick={() => toggleEmployee(e.id, e.employment_status)}>
                      {e.employment_status === "active" ? "비활성화" : "활성화"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">승인 대기</h2>
        <div className="grid two">
          <div>
            <h3>근무지 승인</h3>
            {workplaces.filter((w) => w.approval_status !== "approved").map((w) => (
              <div className="actions" key={w.id} style={{ marginBottom: 10 }}>
                <b>{w.name}</b>
                <span className={`badge ${badgeClass(w.approval_status)}`}>{w.approval_status}</span>
                <button className="button secondary" onClick={() => reviewWorkplace(w.id, "approved")}>근무지 확정</button>
                <button className="button danger" onClick={() => reviewWorkplace(w.id, "rejected")}>반려</button>
              </div>
            ))}
          </div>

          <div>
            <h3>추가근무 대체휴가 적립 승인</h3>
            {compRequests.filter((r) => r.status === "pending").map((r) => (
              <div className="actions" key={r.id} style={{ marginBottom: 10 }}>
                <b>{r.employees?.name} · {r.hours}h → {r.converted_days}일</b>
                <button className="button secondary" onClick={() => reviewCompRequest(r.id, "approved")}>승인</button>
                <button className="button danger" onClick={() => reviewCompRequest(r.id, "rejected")}>반려</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">근태·기기 승인</h2>
        <h3>휴가 신청</h3>
        <div className="grid">
          {requests.filter((r) => r.status === "pending").map((r) => (
            <div className="actions" key={r.id}>
              <b>{r.employees?.name} · {requestTypeLabels[r.request_type] ?? r.request_type}</b>
              <button className="button secondary" onClick={() => reviewRequest(r.id, "approved")}>승인</button>
              <button className="button danger" onClick={() => reviewRequest(r.id, "rejected")}>반려</button>
            </div>
          ))}
        </div>

        <h3>기기 승인</h3>
        <div className="grid">
          {devices.filter((d) => d.status === "pending").map((d) => (
            <div className="actions" key={d.id}>
              <b>{d.employees?.name} · {d.device_info?.platform}</b>
              <button className="button secondary" onClick={() => reviewDevice(d.id, "approved")}>승인</button>
              <button className="button danger" onClick={() => reviewDevice(d.id, "rejected")}>반려</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReportsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [compRequests, setCompRequests] = useState<any[]>([]);

  async function load() {
    const [l, c] = await Promise.all([
      supabase.from("attendance_logs").select("*, employees(name, employee_no), workplaces(name,type)").order("created_at", { ascending: false }).limit(500),
      supabase.from("comp_time_requests").select("*, employees(name, employee_no)").order("created_at", { ascending: false }).limit(500),
    ]);
    setLogs(l.data ?? []);
    setCompRequests(c.data ?? []);
  }

  useEffect(() => { load(); }, []);

  function downloadAll() {
    exportRowsToExcel("lupl_attendance_report.xlsx", "근태", logs.map((l) => ({
      직원: l.employees?.name,
      사번: l.employees?.employee_no,
      근무지: l.workplaces?.name,
      유형: workplaceTypeLabels[l.workplaces?.type] ?? "-",
      출근: formatDateTime(l.check_in_time),
      퇴근: formatDateTime(l.check_out_time),
      상태: l.status,
      기기: l.device_status,
    })));
  }

  function downloadComp() {
    exportRowsToExcel("lupl_comp_time_report.xlsx", "추가근무대체휴가", compRequests.map((r) => ({
      직원: r.employees?.name,
      사번: r.employees?.employee_no,
      근무일: r.work_date,
      시간: r.hours,
      적립일수: r.converted_days,
      상태: r.status,
      사유: r.reason,
    })));
  }

  const fieldLogs = logs.filter((l) => ["special_school", "external_education", "other_field"].includes(l.workplaces?.type));
  const exceptions = logs.filter((l) => ["위치 확인 필요", "기기 확인 필요", "관리자 확인 필요", "자동 퇴근 후보"].includes(l.status) || !l.check_out_time);

  return (
    <div className="grid">
      <section className="grid four">
        <div className="metric"><div className="metric-value">{logs.length}</div><div className="metric-label">전체 근태</div></div>
        <div className="metric"><div className="metric-value">{fieldLogs.length}</div><div className="metric-label">외근</div></div>
        <div className="metric"><div className="metric-value">{exceptions.length}</div><div className="metric-label">예외</div></div>
        <div className="metric"><div className="metric-value">{compRequests.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.converted_days || 0), 0).toFixed(1)}</div><div className="metric-label">대체휴가 적립</div></div>
      </section>

      <section className="card">
        <h2 className="card-title">보고서 다운로드</h2>
        <div className="actions">
          <button className="button" onClick={downloadAll}>월별 전체 근태 Excel</button>
          <button className="button secondary" onClick={downloadComp}>추가근무 대체휴가 Excel</button>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">예외함</h2>
        <DataTable rows={exceptions.map((l) => ({ 직원: l.employees?.name, 근무지: l.workplaces?.name, 출근: formatDateTime(l.check_in_time), 퇴근: formatDateTime(l.check_out_time), 상태: l.status }))} />
      </section>
    </div>
  );
}

function DataTable({ rows }: { rows: Record<string, any>[] }) {
  if (!rows.length) return <p className="subtle">표시할 데이터가 없습니다.</p>;
  const cols = Object.keys(rows[0]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{cols.map((c) => <td key={c}>{String(row[c] ?? "-")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
