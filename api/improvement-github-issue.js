import { readJsonBody, requireAdmin, send } from "./_shared.js";

function issueBody(requests) {
  const items = requests.map((request, index) => [
    `## ${index + 1}. ${request.menu || "메뉴 미지정"}${request.submenu ? ` / ${request.submenu}` : ""}`,
    `- 유형: ${request.type || "-"}`,
    `- 상태: ${request.status || "-"}`,
    `- 작성자: ${request.requester || "-"}`,
    `- 작성일: ${request.created_at || "-"}`,
    "",
    String(request.note || "").trim() || "-",
  ].join("\n"));
  return ["앱 개선함에서 생성된 이슈입니다.", "", `요청 수: ${requests.length}건`, "", ...items].join("\n\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST만 지원합니다." });
  try {
    await requireAdmin(req);
    const token = process.env.LUPL_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
    const repo = process.env.LUPL_GITHUB_REPO || "leehuieun-ai/lupl-attendance-final";
    if (!token) return send(res, 500, { error: "LUPL_GITHUB_TOKEN 환경변수가 없습니다." });

    const body = readJsonBody(req);
    const requests = Array.isArray(body.requests) ? body.requests.slice(0, 100) : [];
    if (requests.length === 0) return send(res, 400, { error: "GitHub Issue로 보낼 개선 요청이 없습니다." });

    const first = requests[0] || {};
    const title = String(body.title || `[개선함] ${first.menu || "개선 요청"}${requests.length > 1 ? ` 외 ${requests.length - 1}건` : ""}`).slice(0, 120);
    const labels = String(process.env.LUPL_GITHUB_ISSUE_LABELS || "").split(",").map(label => label.trim()).filter(Boolean);
    const payload = { title, body: issueBody(requests) };
    if (labels.length) payload.labels = labels;

    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "lupl-attendance",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) return send(res, response.status, { error: data?.message || "GitHub Issue 생성 실패" });

    return send(res, 200, { issue: { number: data.number, html_url: data.html_url, title: data.title } });
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || String(error) });
  }
}
