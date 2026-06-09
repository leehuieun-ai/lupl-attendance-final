import { useEffect, useRef, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { getDeviceFingerprint } from "./lib/device";
import { getCurrentPositionFast, getPublicIp, distanceMeters } from "./lib/geo";
import { calculateAdjustmentDays, calculateCompTimeEarnedDays, calculateLeaveEntitlement, calculateUsedDays } from "./lib/leave";
import { exportRowsToExcel } from "./lib/exportExcel";

type Tab = "home" | "leave" | "workplaces" | "admin" | "reports";

const workplaceTypeLabels: Record<string, string> = {
  office: "사무실", special_school: "특수학교",
  external_education: "외부 교육장", remote: "재택", other_field: "기타 외근지",
};
const requestTypeLabels: Record<string, string> = {
  annual: "연차", half_am: "오전 반차", half_pm: "오후 반차",
  hourly: "시간차", sick: "병가", official: "공가",
  remote: "재택", field: "외근", special: "특별휴가",
  substitute: "대체휴가", compensatory: "보상휴가",
  time_fix: "근무시간 수정", comp_leave_use: "대체휴가 시간 사용",
};
const REQUEST_TYPES_UI = ["annual","half_am","half_pm","hourly","sick","official","remote","field","special","substitute","compensatory"];

function internalEmail(no: string) { return `${no.trim().toLowerCase()}@lupl.local`; }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function formatDateTime(v?: string | null) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));
}
function timeOnly(v?: string | null) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(v));
}
function badgeClass(s?: string | null) {
  if (!s) return "";
  if (["approved","정상출근","외근","재택","active"].includes(s)) return "good";
  if (["rejected","반려","inactive"].includes(s)) return "bad";
  return "warn";
}
function workedMinutesWithLunch(inT?: string | null, outT?: string | null) {
  if (!inT || !outT) return null;
  const a = new Date(inT).getTime(), b = new Date(outT).getTime();
  if (b <= a) return 0;
  let min = Math.round((b - a) / 60000);
  const ls = new Date(inT); ls.setHours(12, 0, 0, 0);
  const le = new Date(inT); le.setHours(13, 0, 0, 0);
  min -= Math.round(Math.max(0, Math.min(b, le.getTime()) - Math.max(a, ls.getTime())) / 60000);
  return Math.max(0, min);
}
function fmtMinutes(m: number | null) {
  if (m == null) return "-";
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}시간${mm > 0 ? " " + mm + "분" : ""}`;
}
async function fetchCurrentEmployee() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { session: null, employee: null };
  const { data } = await supabase.from("employees").select("*").eq("user_id", session.user.id).maybeSingle();
  return { session, employee: data };
}

// ── 비밀번호 변경 모달 ─────────────────────────────────────
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
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="card-title" style={{ margin: 0 }}>비밀번호 변경</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {ok ? (
          <div><div className="alert" style={{ background: "#e4f6ee", color: "#0b9b6a" }}>비밀번호가 변경되었습니다.</div><button className="button full" onClick={onClose}>닫기</button></div>
        ) : (
          <div>
            <div className="form-row"><label className="label">새 비밀번호</label><input className="input" type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="6자 이상" /></div>
            <div className="form-row"><label className="label">새 비밀번호 확인</label><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
            {msg && <div className="alert error">{msg}</div>}
            <button className="button full" onClick={save}>변경</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [employee, setEmployee] = useState<any | null>(null);
  const [consent, setConsent] = useState<any | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [showPwModal, setShowPwModal] = useState(false);

  async function load() {
    const r = await fetchCurrentEmployee();
    setSession(r.session); setEmployee(r.employee);
    if (r.employee) {
      const { data } = await supabase.from("privacy_consents").select("*")
        .eq("employee_id", r.employee.id).eq("is_active", true).maybeSingle();
      setConsent(data);
      if (r.employee.role === "admin") {
        const [w, rq, c, d] = await Promise.all([
          supabase.from("workplaces").select("id, approval_status"),
          supabase.from("attendance_requests").select("id, status"),
          supabase.from("comp_time_requests").select("id, status"),
          supabase.from("registered_devices").select("id, status"),
        ]);
        setPendingCount(
          (w.data ?? []).filter((x: any) => x.approval_status === "pending").length +
          (rq.data ?? []).filter((x: any) => x.status === "pending").length +
          (c.data ?? []).filter((x: any) => x.status === "pending").length +
          (d.data ?? []).filter((x: any) => x.status === "pending").length
        );
      } else setPendingCount(0);
    } else setConsent(null);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const { data } = supabase.auth.onAuthStateChange(() => setTimeout(load, 0));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signOut() { await supabase.auth.signOut(); setSession(null); setEmployee(null); setConsent(null); }

  if (loading) return <div className="container" style={{ paddingTop: 48, textAlign: "center", color: "#8b94a6" }}>불러오는 중…</div>;
  if (!session) return <LoginPage />;
  if (!employee) return (
    <div className="container"><section className="card auth-card">
      <h1 className="card-title">직원 정보가 없습니다</h1>
      <p className="subtle">관리자 계정의 employees.user_id 연결을 확인해주세요.</p>
      <button className="button full" onClick={signOut}>로그아웃</button>
    </section></div>
  );
  if (!employee.is_active || employee.employment_status !== "active") return <InactivePage signOut={signOut} />;
  if (!consent) return <ConsentGate employee={employee} onDone={load} signOut={signOut} />;
  const isAdmin = employee.role === "admin";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <div className="logo"><span>근태</span></div>
            <div><h1>러플 근태관리</h1><p>{employee.name} · {isAdmin ? "관리자" : "직원"} · 기기 {employee.device_limit ?? 3}대</p></div>
          </div>
          <div className="actions">
            <button className="button ghost" onClick={() => setShowPwModal(true)}>비밀번호 변경</button>
            <button className="button ghost" onClick={signOut}>로그아웃</button>
          </div>
        </div>
      </header>
      <main className="container">
        <nav className="tabs">
          <button className={`tab ${tab === "home" ? "active" : ""}`} onClick={() => setTab("home")}>출퇴근</button>
          <button className={`tab ${tab === "leave" ? "active" : ""}`} onClick={() => setTab("leave")}>휴가</button>
          <button className={`tab ${tab === "workplaces" ? "active" : ""}`} onClick={() => setTab("workplaces")}>근무지</button>
          {isAdmin && (
            <button className={`tab ${tab === "admin" ? "active" : ""}`} onClick={() => setTab("admin")}>
              관리자{pendingCount > 0 && <span className="count-badge">{pendingCount}</span>}
            </button>
          )}
          {isAdmin && <button className={`tab ${tab === "reports" ? "active" : ""}`} onClick={() => setTab("reports")}>보고서</button>}
        </nav>
        {tab === "home" && <HomePage employee={employee} />}
        {tab === "leave" && <LeavePage employee={employee} />}
        {tab === "workplaces" && <WorkplacePage employee={employee} />}
        {tab === "admin" && isAdmin && <AdminPage currentEmployee={employee} onChanged={load} />}
        {tab === "reports" && isAdmin && <ReportsPage />}
      </main>
      {showPwModal && <PasswordModal onClose={() => setShowPwModal(false)} />}
    </div>
  );
}

function LoginPage() {
  const [employeeNo, setEmployeeNo] = useState(""); const [password, setPassword] = useState(""); const [message, setMessage] = useState("");
  async function login() { setMessage(""); const { error } = await supabase.auth.signInWithPassword({ email: internalEmail(employeeNo), password }); if (error) setMessage("사번 또는 비밀번호를 확인해주세요."); }
  return (
    <div className="container"><section className="card auth-card">
      <div className="logo logo-lg"><span>근태</span></div>
      <h1 className="card-title" style={{ marginTop: 16 }}>러플 근태관리 로그인</h1>
      <p className="subtle">관리자가 생성한 사번으로 로그인합니다. 초기 비밀번호는 lupl + 휴대폰 뒷번호 4자리입니다.</p>
      {message && <div className="alert error">{message}</div>}
      <div className="form-row"><label className="label">사번</label><input className="input" value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} placeholder="예: 20220612001" onKeyDown={(e) => e.key === "Enter" && login()} /></div>
      <div className="form-row"><label className="label">비밀번호</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} /></div>
      <button className="button full" onClick={login}>로그인</button>
    </section></div>
  );
}

function InactivePage({ signOut }: { signOut: () => void }) {
  return <div className="container"><section className="card auth-card"><h1 className="card-title">비활성 계정입니다</h1><p className="subtle">관리자에게 계정 활성화를 요청해주세요.</p><button className="button full" onClick={signOut}>로그아웃</button></section></div>;
}

function ConsentGate({ employee, onDone, signOut }: { employee: any; onDone: () => void; signOut: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [agree1, setAgree1] = useState(false); const [agree2, setAgree2] = useState(false); const [agree3, setAgree3] = useState(false);
  const [drawing, setDrawing] = useState(false); const [msg, setMsg] = useState("");
  function ctx() { const c = canvasRef.current; if (!c) return null; const x = c.getContext("2d"); if (!x) return null; x.lineWidth = 2.4; x.lineCap = "round"; x.strokeStyle = "#161b26"; return x; }
  function point(e: any) { const c = canvasRef.current!; const r = c.getBoundingClientRect(); const p = e.touches?.[0] ?? e; return { x: p.clientX - r.left, y: p.clientY - r.top }; }
  function start(e: any) { setDrawing(true); const c = ctx(); const p = point(e); c?.beginPath(); c?.moveTo(p.x, p.y); }
  function move(e: any) { if (!drawing) return; e.preventDefault(); const c = ctx(); const p = point(e); c?.lineTo(p.x, p.y); c?.stroke(); }
  function end() { setDrawing(false); }
  function clear() { const c = canvasRef.current; const x = ctx(); if (c && x) x.clearRect(0, 0, c.width, c.height); }
  async function submit() {
    setMsg("");
    if (!agree1 || !agree2 || !agree3) return setMsg("동의 항목을 모두 체크해주세요.");
    const signature = canvasRef.current?.toDataURL("image/png");
    if (!signature || signature.length < 1200) return setMsg("서명을 입력해주세요.");
    const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();
    const { error } = await supabase.from("privacy_consents").insert({ employee_id: employee.id, consent_location: true, consent_device: true, consent_version: "2026-02", signature_data: signature, device_fingerprint_hash: fingerprintHash, device_info: deviceInfo, is_active: true });
    if (error) setMsg(error.message); else onDone();
  }
  return (
    <div className="container"><section className="card" style={{ maxWidth: 760, margin: "28px auto" }}>
      <h1 className="card-title">개인정보 수집·이용 및 위치정보 동의서</h1>
      <p className="subtle">주식회사 러플(LUPL)은 근태 관리를 위해 개인정보 및 위치정보를 수집·이용합니다.</p>
      <div className="alert" style={{ marginTop: 16 }}>위치정보는 출근 또는 퇴근 버튼을 누르는 순간에만 1회 수집되며, 실시간 위치 추적은 하지 않습니다.</div>
      {msg && <div className="alert error">{msg}</div>}
      <label className="checkbox"><input type="checkbox" checked={agree1} onChange={(e) => setAgree1(e.target.checked)} /> 개인정보 및 위치정보 수집·이용에 동의합니다.</label>
      <label className="checkbox"><input type="checkbox" checked={agree2} onChange={(e) => setAgree2(e.target.checked)} /> 위치·기기 정보는 근태 확인 목적 외로 사용하지 않는다는 설명을 확인했습니다.</label>
      <label className="checkbox"><input type="checkbox" checked={agree3} onChange={(e) => setAgree3(e.target.checked)} /> 추가근무는 별도 수당이 아니라 대체휴가로 적립되며, 관리자 승인 후 사용 가능하다는 점에 동의합니다.</label>
      <div style={{ marginTop: 18 }}><label className="label">서명</label><canvas ref={canvasRef} width={700} height={170} className="signature-pad" onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end} /></div>
      <div className="actions" style={{ marginTop: 16 }}>
        <button className="button" onClick={submit}>동의하고 시작</button>
        <button className="button secondary" onClick={clear}>서명 다시 쓰기</button>
        <button className="button ghost" onClick={signOut}>로그아웃</button>
      </div>
    </section></div>
  );
}

function HomePage({ employee }: { employee: any }) {
  const [now, setNow] = useState(new Date());
  const [workplaces, setWorkplaces] = useState<any[]>([]);
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState("");
  const [todayLog, setTodayLog] = useState<any | null>(null);
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [detectedPlace, setDetectedPlace] = useState<any | null>(null);
  const [unknownPlaceName, setUnknownPlaceName] = useState("");
  const [myDevices, setMyDevices] = useState<any[]>([]);
  const [thisFp, setThisFp] = useState<string | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  async function loadDevices() {
    const { data } = await supabase.from("registered_devices").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false });
    setMyDevices(data ?? []);
    try { const { fingerprintHash } = await getDeviceFingerprint(); setThisFp(fingerprintHash); } catch { /**/ }
  }

  async function load() {
    const { data: places } = await supabase.from("workplaces").select("*").neq("approval_status", "rejected").eq("is_active", true).order("name");
    setWorkplaces(places ?? []);
    const { data: logs } = await supabase.from("attendance_logs").select("*, workplaces(name,type)").eq("employee_id", employee.id).order("created_at", { ascending: false }).limit(6);
    const all = logs ?? []; const todayStr = todayIso();
    setTodayLog(all.find((l: any) => l.check_in_time?.startsWith(todayStr)) ?? null);
    setRecentLogs(all.filter((l: any) => !l.check_in_time?.startsWith(todayStr)).slice(0, 5));
    await loadDevices();
  }
  useEffect(() => { load(); }, []);

  async function registerThisDevice() {
    setMessage("");
    try {
      const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();
      const { data, error } = await supabase.rpc("register_device", { p_fingerprint_hash: fingerprintHash, p_device_info: deviceInfo });
      if (error) throw error;
      setMessage(data?.device_status === "approved" ? "이 기기가 등록·승인되었습니다." : "이 기기 등록을 신청했습니다. 관리자 승인 후 사용됩니다.");
      await loadDevices();
    } catch (e: any) { setMessage(e.message); }
  }

  function detectPlace(lat: number, lng: number, ip: string | null) {
    const approved = workplaces.filter((w) => w.approval_status === "approved" && w.lat != null && w.lng != null);
    const withDist = approved.map((w) => ({ ...w, distance: distanceMeters(lat, lng, w.lat, w.lng) }));
    const gps = withDist.sort((a, b) => a.distance - b.distance).find((w) => w.distance <= (w.radius_m ?? 100));
    if (gps) return gps;
    if (ip) return approved.find((w) => w.ip_hint && w.ip_hint === ip) || null;
    return null;
  }

  async function checkIn() {
    setBusy(true); setMessage("현재 위치를 확인하는 중입니다."); setDetectedPlace(null);
    try {
      const p = await getCurrentPositionFast(); const ip = await getPublicIp(); const d = detectPlace(p.lat, p.lng, ip);
      if (d) { setDetectedPlace({ ...d, currentLat: p.lat, currentLng: p.lng, ip }); setSelectedWorkplaceId(d.id); setMessage(`${d.name} 근처로 확인되었습니다. 이 장소가 맞으면 출근 확정을 눌러주세요.`); }
      else { setDetectedPlace({ currentLat: p.lat, currentLng: p.lng, ip }); setSelectedWorkplaceId(""); setMessage("등록된 근무지 반경 안이 아닙니다. 현재 장소명을 입력하면 관리자 승인 대기 근무지로 저장됩니다."); }
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }

  async function confirmCheckIn() {
    setBusy(true); setMessage("");
    try {
      const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();
      let workplaceId = selectedWorkplaceId;
      if (!workplaceId && unknownPlaceName && detectedPlace?.currentLat) {
        const { data: newPlace, error: placeError } = await supabase.from("workplaces").insert({ name: unknownPlaceName, type: "other_field", lat: detectedPlace.currentLat, lng: detectedPlace.currentLng, ip_hint: detectedPlace.ip, radius_m: 100, approval_status: "pending", is_active: false, requested_by: employee.id }).select().single();
        if (placeError) throw placeError; workplaceId = newPlace.id;
      }
      if (!workplaceId) throw new Error("근무지 선택 또는 현재 장소명 입력이 필요합니다.");
      const { data, error } = await supabase.rpc("check_in", { p_workplace_id: workplaceId, p_lat: detectedPlace?.currentLat ?? null, p_lng: detectedPlace?.currentLng ?? null, p_accuracy_m: null, p_ip_address: detectedPlace?.ip ?? null, p_device_fingerprint_hash: fingerprintHash, p_device_info: deviceInfo });
      if (error) throw error;
      setMessage(`출근 처리 결과: ${data?.attendance_status ?? "저장 완료"}`); setDetectedPlace(null); setUnknownPlaceName(""); await load();
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }

  async function checkOut() {
    setBusy(true); setMessage("퇴근 위치를 확인하는 중입니다.");
    try {
      const p = await getCurrentPositionFast(); const ip = await getPublicIp(); const { fingerprintHash, deviceInfo } = await getDeviceFingerprint();
      const { data, error } = await supabase.rpc("check_out", { p_lat: p.lat, p_lng: p.lng, p_accuracy_m: p.accuracy, p_ip_address: ip, p_device_fingerprint_hash: fingerprintHash, p_device_info: deviceInfo });
      if (error) throw error; setMessage(`퇴근 처리 결과: ${data?.attendance_status ?? "저장 완료"}`); await load();
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }

  const checkedIn = !!todayLog?.check_in_time; const checkedOut = !!todayLog?.check_out_time;
  const worked = workedMinutesWithLunch(todayLog?.check_in_time, todayLog?.check_out_time);
  const thisDevice = thisFp ? myDevices.find((d) => d.fingerprint_hash === thisFp) : null;

  return (
    <div className="home-layout">
      <section className="card">
        <p className="date-line">{now.toLocaleDateString("ko-KR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        <div className="clock">{now.toLocaleTimeString("ko-KR", { hour12: false })}</div>
        <div className="today-times">
          <div className="today-time-item"><span className="today-time-label">출근</span><span className="today-time-val">{checkedIn ? timeOnly(todayLog.check_in_time) : "--:--"}</span></div>
          <div className="today-time-item"><span className="today-time-label">퇴근</span><span className="today-time-val">{checkedOut ? timeOnly(todayLog.check_out_time) : "--:--"}</span></div>
          {worked != null && <div className="today-time-item"><span className="today-time-label">실근무</span><span className="today-time-val" style={{ fontSize: 17 }}>{fmtMinutes(worked)}</span></div>}
        </div>
        <div className="punch-grid">
          <button className="button punch" disabled={busy || checkedIn} onClick={checkIn}>출근하기</button>
          <button className="button secondary punch" disabled={busy || !checkedIn || checkedOut} onClick={checkOut}>퇴근하기</button>
        </div>
        <p className="subtle" style={{ marginTop: 10, textAlign: "center" }}>휴게시간 12:00–13:00 (1시간) 자동 적용</p>
        {message && <div className="alert" style={{ marginTop: 14 }}>{message}</div>}
        {detectedPlace && (
          <div className="card" style={{ marginTop: 14, boxShadow: "none", background: "#f6f8fb" }}>
            {detectedPlace.id
              ? (<><h3 style={{ marginTop: 0 }}>{detectedPlace.name} 맞나요?</h3><p className="subtle">GPS/IP 기준으로 가장 가까운 근무지를 찾았습니다.</p></>)
              : (<><h3 style={{ marginTop: 0 }}>현재 장소를 입력해주세요</h3><p className="subtle">입력한 장소는 관리자 승인 대기 근무지로 저장됩니다.</p><input className="input" style={{ marginTop: 8 }} value={unknownPlaceName} onChange={(e) => setUnknownPlaceName(e.target.value)} placeholder="예: 대구○○학교, ○○교육장" /></>)}
            <div className="actions" style={{ marginTop: 10 }}><button className="button" disabled={busy} onClick={confirmCheckIn}>출근 확정</button><button className="button ghost" onClick={() => setDetectedPlace(null)}>취소</button></div>
          </div>
        )}
        {recentLogs.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <p className="section-label">최근 기록</p>
            {recentLogs.map((l: any) => (
              <div className="recent-row" key={l.id}>
                <span className="recent-date">{l.check_in_time?.slice(5, 10)}</span>
                <span className="recent-times">{timeOnly(l.check_in_time)} → {timeOnly(l.check_out_time)}</span>
                <span className="recent-worked">{fmtMinutes(workedMinutesWithLunch(l.check_in_time, l.check_out_time))}</span>
                <span className={`badge ${badgeClass(l.status)}`}>{l.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">내 기기</h2>
        <p className="body-text" style={{ marginBottom: 14 }}>등록 가능 기기 <b>{employee.device_limit ?? 3}대</b>. 한도 내에서는 자동 승인되고, 초과 시 관리자 승인이 필요합니다.</p>
        {myDevices.length === 0 && <p className="body-text" style={{ color: "#8b94a6" }}>아직 등록된 기기가 없습니다.</p>}
        {myDevices.map((d) => (
          <div className="device-row" key={d.id}>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{d.device_info?.platform || "알 수 없는 기기"}{thisFp && d.fingerprint_hash === thisFp && <span style={{ marginLeft: 6, fontSize: 12, color: "#3a6df0", fontWeight: 700 }}>현재 기기</span>}</p>
              <p className="body-text" style={{ color: "#8b94a6", marginTop: 2 }}>최근 접속 {formatDateTime(d.last_seen_at)}</p>
            </div>
            <span className={`badge ${badgeClass(d.status)}`}>{d.status === "approved" ? "승인" : d.status === "pending" ? "승인 대기" : "거절"}</span>
          </div>
        ))}
        {!thisDevice && <button className="button secondary full" style={{ marginTop: 10 }} onClick={registerThisDevice}>이 기기 등록 신청</button>}
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
  const [message, setMessage] = useState(""); const [showCompAlert, setShowCompAlert] = useState(false);

  async function load() {
    const [r, a, c] = await Promise.all([
      supabase.from("attendance_requests").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false }),
      supabase.from("leave_adjustments").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false }),
      supabase.from("comp_time_requests").select("*").eq("employee_id", employee.id).order("created_at", { ascending: false }),
    ]);
    setRequests(r.data ?? []); setAdjustments(a.data ?? []); setCompRequests(c.data ?? []);
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
  const compEarnedHours = Math.round(compEarned * 8 * 10) / 10;
  const compUsedHours = requests.filter((r) => r.request_type === "comp_leave_use" && r.status === "approved").reduce((s, r) => s + (r.amount_hours ?? (r.amount_days ?? 0) * 8), 0);
  const compRemainHours = Math.max(0, compEarnedHours - compUsedHours);
  const remainPct = totalGranted > 0 ? Math.round((remaining / totalGranted) * 100) : 0;
  const isHourly = form.request_type === "hourly";

  async function submitLeave() {
    setMessage("");
    const amountHours = form.request_type === "hourly" && form.amount_hours ? Number(form.amount_hours) : null;
    const requestedDays = form.request_type === "hourly" ? Number(form.amount_hours || 0) / 8 : form.request_type === "half_am" || form.request_type === "half_pm" ? 0.5 : 1;
    if (["annual","half_am","half_pm","hourly"].includes(form.request_type) && requestedDays > expectedRemaining) return setMessage("잔여 휴가가 부족하여 신청할 수 없습니다.");
    const { error } = await supabase.from("attendance_requests").insert({ employee_id: employee.id, request_type: form.request_type, start_date: form.start_date, end_date: form.end_date, amount_hours: amountHours, amount_days: amountHours ? amountHours / 8 : null, reason: form.reason, status: "pending" });
    if (error) setMessage(error.message); else { setMessage("휴가 신청이 저장되었습니다."); await load(); }
  }

  async function useCompLeave() {
    setMessage(""); const hours = Number(form.amount_hours || 0);
    if (!hours || hours <= 0) return setMessage("사용할 시간을 입력해주세요.");
    if (hours > compRemainHours) return setMessage(`대체휴가 잔여 시간(${compRemainHours}시간)이 부족합니다.`);
    const { error } = await supabase.from("attendance_requests").insert({ employee_id: employee.id, request_type: "comp_leave_use", start_date: form.start_date, end_date: form.start_date, amount_hours: hours, amount_days: hours / 8, reason: form.reason || "대체휴가 시간 사용", status: "pending" });
    if (error) setMessage(error.message); else { setMessage("대체휴가 시간 사용 신청이 저장되었습니다."); setShowCompAlert(false); await load(); }
  }

  async function submitCompTime() {
    setMessage("");
    if (!compForm.hours || compForm.hours <= 0) return setMessage("추가 근무 시간을 입력해주세요.");
    const { error } = await supabase.from("comp_time_requests").insert({ employee_id: employee.id, work_date: compForm.work_date, start_time: compForm.start_time, end_time: compForm.end_time, hours: compForm.hours, converted_days: Number((compForm.hours / 8).toFixed(2)), reason: compForm.reason, status: "pending" });
    if (error) setMessage(error.message); else { setMessage("추가근무 신청이 저장되었습니다. 관리자 승인 후 대체휴가로 적립됩니다."); await load(); }
  }

  return (
    <div className="grid">
      {message && <div className="alert">{message}</div>}
      <section className="card">
        <h2 className="card-title">연차 현황</h2>
        <div className="leave-hero">
          <div className="leave-ring" style={{ background: `conic-gradient(var(--blue) ${remainPct * 3.6}deg, #e7ecf4 0deg)` }}>
            <div className="leave-ring-inner"><b>{remaining.toFixed(1)}</b><span>잔여일</span></div>
          </div>
          <div className="leave-info">
            <div className="leave-chips">
              <div className="leave-chip"><span>총 부여</span><b>{totalGranted.toFixed(1)}일</b></div>
              <div className="leave-chip"><span>기본 발생</span><b>{ent.baseGrantedDays}일</b></div>
              <div className="leave-chip"><span>조정</span><b>{adj >= 0 ? "+" : ""}{adj.toFixed(1)}일</b></div>
              <div className="leave-chip"><span>사용(승인)</span><b>{approvedUsed.toFixed(1)}일</b></div>
              <div className="leave-chip"><span>잔여(예상)</span><b>{expectedRemaining.toFixed(1)}일</b></div>
              <div className="leave-chip" style={{ borderColor: "#3a6df0", background: "#eef3fe" }}>
                <span>대체휴가 적립</span><b style={{ color: "#3a6df0" }}>{compEarned.toFixed(1)}일 ({compRemainHours}시간 잔여)</b>
              </div>
            </div>
            <p className="subtle" style={{ marginTop: 10 }}>근무 시작일 {employee.joined_at ?? "-"} · {ent.description}<br />산정기간 {ent.periodStart ?? "-"} ~ {ent.periodEnd ?? "-"} (근로기준법 제60조)</p>
          </div>
        </div>
      </section>

      <div className="grid two">
        <section className="card">
          <h2 className="card-title">휴가 신청</h2>
          <div className="form-row"><label className="label">신청 유형</label>
            <select className="select" value={form.request_type} onChange={(e) => { setForm({ ...form, request_type: e.target.value }); setShowCompAlert(false); }}>
              {REQUEST_TYPES_UI.map((k) => <option key={k} value={k}>{requestTypeLabels[k]}</option>)}
            </select>
          </div>
          {isHourly && compRemainHours > 0 && (
            <div className="alert" style={{ cursor: "pointer" }} onClick={() => setShowCompAlert(!showCompAlert)}>
              대체휴가 {compRemainHours}시간 있습니다. 이걸 시간휴가로 쓰시겠습니까? {showCompAlert ? "▲" : "▼"}
            </div>
          )}
          {isHourly && showCompAlert && (
            <div className="card" style={{ boxShadow: "none", background: "#f6f8fb", marginBottom: 12 }}>
              <p className="body-text"><b>대체휴가 시간 사용</b> — 연차 잔여에서 차감되지 않습니다.</p>
              <div className="form-row" style={{ marginTop: 8 }}><label className="label">사용 시간</label><input className="input" type="number" step="0.5" value={form.amount_hours} onChange={(e) => setForm({ ...form, amount_hours: e.target.value })} placeholder="예: 2" /></div>
              <div className="form-row"><label className="label">사용일</label><input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
              <div className="form-row"><label className="label">사유</label><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="사유 입력" /></div>
              <button className="button full" onClick={useCompLeave}>대체휴가 시간 사용 신청</button>
            </div>
          )}
          <div className="grid two">
            <div className="form-row"><label className="label">시작일</label><input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
            <div className="form-row"><label className="label">종료일</label><input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          </div>
          {isHourly && <div className="form-row"><label className="label">사용 시간</label><input className="input" type="number" step="0.5" value={form.amount_hours} onChange={(e) => setForm({ ...form, amount_hours: e.target.value })} /></div>}
          <div className="form-row"><label className="label">사유</label><textarea className="textarea" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
          <button className="button full" onClick={submitLeave}>휴가 신청</button>
        </section>

        <section className="card">
          <h2 className="card-title">추가근무 신청</h2>
          <p className="body-text" style={{ marginBottom: 14 }}>추가근무는 별도 수당이 아니라 대체휴가로 적립됩니다. 관리자 승인 후 휴가 잔여에 추가됩니다 (8시간 = 1일).</p>
          <div className="form-row"><label className="label">추가근무일</label><input className="input" type="date" value={compForm.work_date} onChange={(e) => setCompForm({ ...compForm, work_date: e.target.value })} /></div>
          <div className="comp-time-grid">
            <div className="form-row"><label className="label">시작</label><input className="input" type="time" value={compForm.start_time} onChange={(e) => setCompForm({ ...compForm, start_time: e.target.value })} /></div>
            <div className="form-row"><label className="label">종료</label><input className="input" type="time" value={compForm.end_time} onChange={(e) => setCompForm({ ...compForm, end_time: e.target.value })} /></div>
            <div className="form-row"><label className="label">시간</label><input className="input" type="number" step="0.5" value={compForm.hours} onChange={(e) => setCompForm({ ...compForm, hours: Number(e.target.value) })} /></div>
          </div>
          <div className="form-row"><label className="label">사유</label><textarea className="textarea" value={compForm.reason} onChange={(e) => setCompForm({ ...compForm, reason: e.target.value })} placeholder="예: 행사 운영, 외부 교육 연장 등" /></div>
          <button className="button full" onClick={submitCompTime}>추가근무 신청</button>
        </section>
      </div>

      <section className="card">
        <h2 className="card-title">신청 내역</h2>
        <DataTable rows={[
          ...requests.map((r) => ({ 구분: requestTypeLabels[r.request_type] ?? r.request_type, 기간: `${r.start_date}~${r.end_date}`, 환산: r.amount_days != null ? r.amount_days + "일" : r.amount_hours != null ? r.amount_hours + "시간" : "-", 상태: r.status, 사유: r.reason ?? "-" })),
          ...compRequests.map((r) => ({ 구분: "추가근무(대체휴가)", 기간: r.work_date, 환산: `${r.hours}시간→${r.converted_days}일`, 상태: r.status, 사유: r.reason ?? "-" })),
        ]} />
      </section>
    </div>
  );
}

function WorkplacePage({ employee }: { employee: any }) {
  const [query, setQuery] = useState(""); const [places, setPlaces] = useState<any[]>([]); const [workplaces, setWorkplaces] = useState<any[]>([]); const [message, setMessage] = useState("");
  async function load() { const { data } = await supabase.from("workplaces").select("*").order("created_at", { ascending: false }); setWorkplaces(data ?? []); }
  useEffect(() => { load(); }, []);
  async function search() { setMessage(""); const { data, error } = await supabase.functions.invoke("kakao-place-search", { body: { query } }); if (error) setMessage(error.message); else setPlaces(data?.documents ?? []); }
  async function requestPlace(p: any) {
    const { error } = await supabase.from("workplaces").insert({ name: p.place_name, type: "special_school", address: p.road_address_name || p.address_name, kakao_place_id: p.id, lat: Number(p.y), lng: Number(p.x), radius_m: 100, approval_status: "pending", is_active: false, requested_by: employee.id });
    if (error) setMessage(error.message); else { setMessage("근무지 승인 요청이 저장되었습니다."); setPlaces([]); setQuery(""); await load(); }
  }
  function dedup(list: any[], t = 100) {
    const k: any[] = [];
    for (const w of list) { if (w.lat == null || w.lng == null) { k.push(w); continue; } if (!k.some((x) => x.lat != null && distanceMeters(w.lat, w.lng, x.lat, x.lng) <= t)) k.push(w); }
    return k;
  }
  const approved = dedup(workplaces.filter((w) => w.approval_status === "approved"));
  const pending = workplaces.filter((w) => w.approval_status === "pending");
  return (
    <div className="grid two">
      <section className="card">
        <h2 className="card-title">근무지 검색·요청</h2>
        <p className="subtle" style={{ marginBottom: 12 }}>카카오맵 검색으로 근무지를 등록 요청합니다. 승인되면 다음 출근 시 자동 후보로 사용됩니다.</p>
        {message && <div className="alert">{message}</div>}
        <div className="form-row"><label className="label">근무지명</label><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 대구광명학교" onKeyDown={(e) => e.key === "Enter" && search()} /></div>
        <button className="button" onClick={search}>검색</button>
        <div className="grid" style={{ marginTop: 14 }}>{places.map((p) => (<div className="list-row" key={p.id}><div><b>{p.place_name}</b><div className="subtle">{p.road_address_name || p.address_name}</div></div><button className="button secondary" onClick={() => requestPlace(p)}>승인 요청</button></div>))}</div>
      </section>
      <section className="card">
        <h2 className="card-title">근무지 목록</h2>
        <h3>승인된 근무지</h3>
        <DataTable rows={approved.map((w) => ({ 이름: w.name, 유형: workplaceTypeLabels[w.type] ?? w.type, 반경: `${w.radius_m}m` }))} />
        <h3>승인 대기</h3>
        <DataTable rows={pending.map((w) => ({ 이름: w.name, 유형: workplaceTypeLabels[w.type] ?? w.type, 반경: `${w.radius_m}m`, 요청자: w.requested_by === employee.id ? "본인" : "-" }))} />
      </section>
    </div>
  );
}

function AdminPage({ currentEmployee, onChanged }: { currentEmployee: any; onChanged: () => void }) {
  const [employees, setEmployees] = useState<any[]>([]);
  const [empMap, setEmpMap] = useState<Record<string, any>>({});
  const [employeeFilter, setEmployeeFilter] = useState("active");
  const [devices, setDevices] = useState<any[]>([]);
  const [workplaces, setWorkplaces] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [compRequests, setCompRequests] = useState<any[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [newEmployee, setNewEmployee] = useState({ name: "", employee_no: "", phone: "", joined_at: todayIso(), role: "employee", device_limit: 3 });
  const [specialForm, setSpecialForm] = useState({ employee_id: "", days: "", reason: "" });
  const [specialMsg, setSpecialMsg] = useState("");

  async function load() {
    const { data: emps } = await supabase.from("employees").select("*").order("created_at", { ascending: false });
    const list = emps ?? []; const map: Record<string, any> = {};
    list.forEach((e: any) => { map[e.id] = e; });
    setEmployees(list); setEmpMap(map);
    const [d, w, r, c, a] = await Promise.all([
      supabase.from("registered_devices").select("*").order("created_at", { ascending: false }),
      supabase.from("workplaces").select("*").order("created_at", { ascending: false }),
      supabase.from("attendance_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("comp_time_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("leave_adjustments").select("*").order("created_at", { ascending: false }),
    ]);
    setDevices(d.data ?? []); setWorkplaces(w.data ?? []); setRequests(r.data ?? []); setCompRequests(c.data ?? []); setAdjustments(a.data ?? []);
  }
  useEffect(() => { load(); }, []);

  const empName = (id?: string | null) => id ? (empMap[id]?.name ?? "-") : "-";

  function leaveForEmployee(empId: string) {
    const emp = empMap[empId]; if (!emp) return null;
    const ent = calculateLeaveEntitlement(emp.joined_at);
    const adj = adjustments.filter((a) => a.employee_id === empId);
    const reqs = requests.filter((r) => r.employee_id === empId);
    const comps = compRequests.filter((c) => c.employee_id === empId);
    const adjDays = calculateAdjustmentDays(adj);
    const compEarned = calculateCompTimeEarnedDays(adj);
    const used = calculateUsedDays(reqs, false);
    const total = ent.baseGrantedDays + adjDays;
    const remain = Math.max(0, total - used);
    const compH = Math.round(compEarned * 8 * 10) / 10;
    const compUsedH = reqs.filter((r) => r.request_type === "comp_leave_use" && r.status === "approved").reduce((s, r) => s + (r.amount_hours ?? (r.amount_days ?? 0) * 8), 0);
    const pendingComp = comps.filter((c) => c.status === "pending").reduce((s, c) => s + Number(c.converted_days || 0), 0);
    return { total, used, remain, compEarned, compH, compRemainH: Math.max(0, compH - compUsedH), pendingComp };
  }

  async function grantSpecialLeave() {
    setSpecialMsg("");
    const days = Number(specialForm.days);
    if (!specialForm.employee_id) return setSpecialMsg("직원을 선택해주세요.");
    if (!days || days <= 0) return setSpecialMsg("부여할 일수를 입력해주세요.");
    if (!specialForm.reason.trim()) return setSpecialMsg("사유를 입력해주세요.");
    const { error } = await supabase.from("leave_adjustments").insert({ employee_id: specialForm.employee_id, adjustment_type: "add", adjustment_days: days, source_type: "special_grant", reason: specialForm.reason.trim(), created_by: currentEmployee.id });
    if (error) setSpecialMsg(error.message);
    else { setSpecialMsg(`${empName(specialForm.employee_id)}에게 ${days}일 특별휴가가 부여되었습니다.`); setSpecialForm({ employee_id: "", days: "", reason: "" }); await load(); }
  }

  async function createEmployee() {
    setMessage(""); const { data, error } = await supabase.functions.invoke("admin-create-employee", { body: newEmployee });
    if (error) setMessage(error.message); else if (data?.error) setMessage(data.error);
    else { setMessage(`직원 계정이 생성되었습니다. 초기 비밀번호: ${data.initial_password}`); setNewEmployee({ name: "", employee_no: "", phone: "", joined_at: todayIso(), role: "employee", device_limit: 3 }); await load(); onChanged(); }
  }
  async function updateEmployee(id: string, patch: Record<string, any>) { const { error } = await supabase.from("employees").update(patch).eq("id", id); if (error) setMessage(error.message); else { await load(); onChanged(); } }
  async function toggleEmployee(id: string, cur: string) { const n = cur !== "active"; await updateEmployee(id, { is_active: n, employment_status: n ? "active" : "inactive" }); }
  async function reviewWorkplace(id: string, status: string) { const { error } = await supabase.from("workplaces").update({ approval_status: status, is_active: status === "approved" }).eq("id", id); if (error) setMessage(error.message); else { await load(); onChanged(); } }
  async function reviewRequest(id: string, status: string) { const { error } = await supabase.rpc("review_attendance_request", { p_request_id: id, p_status: status, p_review_note: "" }); if (error) setMessage(error.message); else { await load(); onChanged(); } }
  async function reviewCompRequest(id: string, status: string) { const { error } = await supabase.rpc("review_comp_time_request", { p_request_id: id, p_status: status, p_review_note: "" }); if (error) setMessage(error.message); else { setMessage(status === "approved" ? "추가근무가 승인되어 대체휴가로 적립되었습니다." : "반려했습니다."); await load(); onChanged(); } }
  async function reviewDevice(id: string, status: string) { const { error } = await supabase.from("registered_devices").update({ status }).eq("id", id); if (error) setMessage(error.message); else { await load(); onChanged(); } }

  const filtered = employees.filter((e) => employeeFilter === "all" ? true : employeeFilter === "inactive" ? e.employment_status !== "active" : e.employment_status === "active");
  const pW = workplaces.filter((w) => w.approval_status === "pending");
  const pC = compRequests.filter((r) => r.status === "pending");
  const pR = requests.filter((r) => r.status === "pending");
  const pD = devices.filter((d) => d.status === "pending");

  return (
    <div className="grid">
      {message && <div className="alert">{message}</div>}

      <section className="card">
        <h2 className="card-title">승인 대기</h2>
        <div className="grid two">
          <div>
            <h3 style={{ marginTop: 0 }}>근무지 {pW.length > 0 && <span className="count-badge">{pW.length}</span>}</h3>
            {pW.length === 0 && <p className="subtle">없음</p>}
            {pW.map((w) => (<div className="list-row" key={w.id}><div><b>{w.name}</b><div className="subtle">{workplaceTypeLabels[w.type]} · {empName(w.requested_by)}</div></div><div className="actions"><button className="button secondary" onClick={() => reviewWorkplace(w.id, "approved")}>확정</button><button className="button danger" onClick={() => reviewWorkplace(w.id, "rejected")}>반려</button></div></div>))}
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>추가근무 {pC.length > 0 && <span className="count-badge">{pC.length}</span>}</h3>
            {pC.length === 0 && <p className="subtle">없음</p>}
            {pC.map((r) => (<div className="list-row" key={r.id}><div><b>{empName(r.employee_id)}</b><div className="subtle">{r.work_date} · {r.hours}시간 → {r.converted_days}일</div></div><div className="actions"><button className="button secondary" onClick={() => reviewCompRequest(r.id, "approved")}>승인</button><button className="button danger" onClick={() => reviewCompRequest(r.id, "rejected")}>반려</button></div></div>))}
          </div>
          <div>
            <h3>휴가 신청 {pR.length > 0 && <span className="count-badge">{pR.length}</span>}</h3>
            {pR.length === 0 && <p className="subtle">없음</p>}
            {pR.map((r) => (<div className="list-row" key={r.id}><div><b>{empName(r.employee_id)}</b><div className="subtle">{requestTypeLabels[r.request_type] ?? r.request_type} · {r.start_date}~{r.end_date}</div></div><div className="actions"><button className="button secondary" onClick={() => reviewRequest(r.id, "approved")}>승인</button><button className="button danger" onClick={() => reviewRequest(r.id, "rejected")}>반려</button></div></div>))}
          </div>
          <div>
            <h3>기기 {pD.length > 0 && <span className="count-badge">{pD.length}</span>}</h3>
            {pD.length === 0 && <p className="subtle">없음</p>}
            {pD.map((d) => (<div className="list-row" key={d.id}><div><b>{empName(d.employee_id)}</b><div className="subtle">{d.device_info?.platform || "기기"}</div></div><div className="actions"><button className="button secondary" onClick={() => reviewDevice(d.id, "approved")}>승인</button><button className="button danger" onClick={() => reviewDevice(d.id, "rejected")}>반려</button></div></div>))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">직원 연차 현황</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>직원</th><th>총 부여</th><th>사용</th><th>잔여</th><th>대체휴가 적립</th><th>대체휴가 잔여시간</th><th>추가근무 대기</th></tr></thead>
            <tbody>
              {employees.filter((e) => e.employment_status === "active").map((e) => {
                const lv = leaveForEmployee(e.id);
                if (!lv) return null;
                return (
                  <tr key={e.id}>
                    <td><b>{e.name}</b><br /><span className="subtle">{e.employee_no}</span></td>
                    <td>{lv.total.toFixed(1)}일</td>
                    <td>{lv.used.toFixed(1)}일</td>
                    <td><b style={{ color: lv.remain < 3 ? "var(--red)" : "inherit" }}>{lv.remain.toFixed(1)}일</b></td>
                    <td>{lv.compEarned.toFixed(1)}일</td>
                    <td>{lv.compRemainH}시간</td>
                    <td>{lv.pendingComp > 0 ? `+${lv.pendingComp.toFixed(1)}일 대기` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">특별휴가 부여</h2>
        <p className="subtle" style={{ marginBottom: 14 }}>직원의 연차 잔여에 직접 일수를 추가합니다. 감사 로그에 기록되며 취소할 수 없습니다.</p>
        {specialMsg && <div className="alert" style={{ background: specialMsg.includes("부여되었습니다") ? "#e4f6ee" : undefined, color: specialMsg.includes("부여되었습니다") ? "#0b9b6a" : undefined }}>{specialMsg}</div>}
        <div className="grid three">
          <div className="form-row"><label className="label">직원</label>
            <select className="select" value={specialForm.employee_id} onChange={(e) => setSpecialForm({ ...specialForm, employee_id: e.target.value })}>
              <option value="">직원 선택</option>
              {employees.filter((e) => e.employment_status === "active").map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label className="label">부여 일수</label><input className="input" type="number" step="0.5" value={specialForm.days} onChange={(e) => setSpecialForm({ ...specialForm, days: e.target.value })} placeholder="예: 1" /></div>
          <div className="form-row"><label className="label">사유</label><input className="input" value={specialForm.reason} onChange={(e) => setSpecialForm({ ...specialForm, reason: e.target.value })} placeholder="예: 경조사, 포상 등" /></div>
        </div>
        <button className="button" onClick={grantSpecialLeave}>특별휴가 부여</button>
      </section>

      <section className="card">
        <h2 className="card-title">직원 계정 생성</h2>
        <div className="grid four">
          <div className="form-row"><label className="label">이름</label><input className="input" value={newEmployee.name} onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })} /></div>
          <div className="form-row"><label className="label">사번</label><input className="input" value={newEmployee.employee_no} onChange={(e) => setNewEmployee({ ...newEmployee, employee_no: e.target.value })} /></div>
          <div className="form-row"><label className="label">휴대폰</label><input className="input" value={newEmployee.phone} onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })} placeholder="010-0000-0000" /></div>
          <div className="form-row"><label className="label">근무 시작일</label><input className="input" type="date" value={newEmployee.joined_at} onChange={(e) => setNewEmployee({ ...newEmployee, joined_at: e.target.value })} /></div>
        </div>
        <div className="grid two">
          <div className="form-row"><label className="label">권한</label><select className="select" value={newEmployee.role} onChange={(e) => setNewEmployee({ ...newEmployee, role: e.target.value })}><option value="employee">직원</option><option value="admin">관리자</option></select></div>
          <div className="form-row"><label className="label">기기 제한</label><select className="select" value={newEmployee.device_limit} onChange={(e) => setNewEmployee({ ...newEmployee, device_limit: Number(e.target.value) })}><option value={1}>1대</option><option value={2}>2대</option><option value={3}>3대</option></select></div>
        </div>
        <button className="button" onClick={createEmployee}>직원 생성</button>
      </section>

      <section className="card">
        <h2 className="card-title">직원 관리</h2>
        <div className="tabs">
          <button className={`tab ${employeeFilter === "active" ? "active" : ""}`} onClick={() => setEmployeeFilter("active")}>재직</button>
          <button className={`tab ${employeeFilter === "inactive" ? "active" : ""}`} onClick={() => setEmployeeFilter("inactive")}>비활성</button>
          <button className={`tab ${employeeFilter === "all" ? "active" : ""}`} onClick={() => setEmployeeFilter("all")}>전체</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>직원</th><th>권한</th><th>상태</th><th>근무 시작일</th><th>기기</th><th>처리</th></tr></thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}<br /><span className="subtle">{e.employee_no} · {e.phone}</span></td>
                  <td><select className="select" value={e.role} onChange={(ev) => updateEmployee(e.id, { role: ev.target.value })}><option value="admin">관리자</option><option value="employee">직원</option></select></td>
                  <td><span className={`badge ${badgeClass(e.employment_status)}`}>{e.employment_status === "active" ? "재직" : "비활성"}</span></td>
                  <td><input className="input" type="date" value={e.joined_at ?? ""} onChange={(ev) => updateEmployee(e.id, { joined_at: ev.target.value })} /></td>
                  <td><select className="select" value={e.device_limit} onChange={(ev) => updateEmployee(e.id, { device_limit: Number(ev.target.value) })}><option value={1}>1대</option><option value={2}>2대</option><option value={3}>3대</option></select></td>
                  <td><button className={e.employment_status === "active" ? "button danger" : "button secondary"} onClick={() => toggleEmployee(e.id, e.employment_status)}>{e.employment_status === "active" ? "비활성화" : "활성화"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportsPage() {
  const [logs, setLogs] = useState<any[]>([]); const [compRequests, setCompRequests] = useState<any[]>([]);
  async function load() {
    const [l, c] = await Promise.all([
      supabase.from("attendance_logs").select("*, employees(name, employee_no), workplaces(name,type)").order("created_at", { ascending: false }).limit(500),
      supabase.from("comp_time_requests").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    setLogs(l.data ?? []); setCompRequests(c.data ?? []);
  }
  useEffect(() => { load(); }, []);
  function downloadAll() {
    exportRowsToExcel("lupl_attendance_report.xlsx", "근태", logs.map((l) => ({ 직원: l.employees?.name, 사번: l.employees?.employee_no, 근무지: l.workplaces?.name, 유형: workplaceTypeLabels[l.workplaces?.type] ?? "-", 출근: formatDateTime(l.check_in_time), 퇴근: formatDateTime(l.check_out_time), 실근무: fmtMinutes(workedMinutesWithLunch(l.check_in_time, l.check_out_time)), 상태: l.status, 기기: l.device_status })));
  }
  const fieldLogs = logs.filter((l) => ["special_school","external_education","other_field"].includes(l.workplaces?.type));
  const exceptions = logs.filter((l) => ["위치 확인 필요","기기 확인 필요","관리자 확인 필요","위치 정확도 낮음"].includes(l.status) || !l.check_out_time);
  return (
    <div className="grid">
      <section className="grid four">
        <div className="metric"><div className="metric-value">{logs.length}</div><div className="metric-label">전체 근태</div></div>
        <div className="metric"><div className="metric-value">{fieldLogs.length}</div><div className="metric-label">외근</div></div>
        <div className="metric"><div className="metric-value">{exceptions.length}</div><div className="metric-label">예외</div></div>
        <div className="metric"><div className="metric-value">{compRequests.filter((r) => r.status === "approved").reduce((s, r) => s + Number(r.converted_days || 0), 0).toFixed(1)}</div><div className="metric-label">대체휴가 적립</div></div>
      </section>
      <section className="card"><h2 className="card-title">보고서 다운로드</h2><div className="actions"><button className="button" onClick={downloadAll}>월별 전체 근태 Excel</button></div></section>
      <section className="card"><h2 className="card-title">예외함</h2><DataTable rows={exceptions.map((l) => ({ 직원: l.employees?.name, 근무지: l.workplaces?.name, 출근: formatDateTime(l.check_in_time), 퇴근: formatDateTime(l.check_out_time), 상태: l.status }))} /></section>
    </div>
  );
}

function DataTable({ rows }: { rows: Record<string, any>[] }) {
  if (!rows.length) return <p className="subtle">표시할 데이터가 없습니다.</p>;
  const cols = Object.keys(rows[0]);
  return (
    <div className="table-wrap"><table>
      <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{cols.map((c) => <td key={c}>{String(row[c] ?? "-")}</td>)}</tr>)}</tbody>
    </table></div>
  );
}
