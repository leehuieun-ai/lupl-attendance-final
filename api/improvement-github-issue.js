import { readJsonBody, requireAdmin, send } from "./_shared.js";
import {
  compactAttachmentMeta,
  enrichRequestsWithImageSummaries,
  requestImageSummary,
  summarizeImprovementImages,
} from "./_improvement-images.js";

function requestTitle(request) {
  const raw = String(request.title || request.note || requestImageSummary(request) || request.submenu || request.menu || "개선 요청")
    .replace(/\s+/g, " ")
    .trim();
  return (raw.length > 46 ? `${raw.slice(0, 46)}...` : raw) || "개선 요청";
}

function categoryLabel(request) {
  return [request.menu, request.submenu].filter(Boolean).join(" / ") || "메뉴 미지정";
}

function issueBody(requests) {
  const groups = requests.reduce((acc, request) => {
    const label = categoryLabel(request);
    if (!acc[label]) acc[label] = [];
    acc[label].push(request);
    return acc;
  }, {});
  let index = 0;
  const sections = Object.entries(groups).flatMap(([label, items]) => [
    `## ${label}`,
    ...items.map(request => {
      index += 1;
      return [
        `### ${index}. ${requestTitle(request)}`,
        `- 유형: ${request.type || "-"}`,
        `- 상태: ${request.status || "-"}`,
        `- 작성자: ${request.requester || "-"}`,
        `- 작성일: ${request.created_at || "-"}`,
        ...attachmentIssueLines(request),
        "",
        String(request.note || "").trim() || "-",
      ].join("\n");
    }),
  ]);
  return ["앱 개선함에서 생성된 이슈입니다.", "", `요청 수: ${requests.length}건`, "", ...sections].join("\n\n");
}

function attachmentIssueLines(request) {
  const attachments = compactAttachmentMeta(request.attachments || request.image_attachments);
  const imageSummary = requestImageSummary(request);
  if (!attachments.length && !imageSummary) return [];
  const lines = [];
  if (attachments.length) {
    const names = attachments.map(attachment => attachment.name).filter(Boolean).slice(0, 5).join(", ");
    lines.push(`- 첨부 이미지: ${attachments.length}장${names ? ` (${names})` : ""}`);
    lines.push("- 첨부 원본: 앱 개선함 상세에서 확인");
  }
  if (imageSummary) lines.push(`- 이미지 인식 요약: ${imageSummary}`);
  return lines;
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
    const openaiKey = process.env.LUPL_attendance_API_KEY || process.env.OPENAI_API_KEY;
    const visionModel = process.env.LUPL_OPENAI_VISION_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-5.5";
    const imageSummaries = await summarizeImprovementImages({
      requests,
      apiKey: openaiKey,
      model: visionModel,
    });
    const enrichedRequests = enrichRequestsWithImageSummaries(requests, imageSummaries);

    const first = enrichedRequests[0] || {};
    const title = String(body.title || `[개선함] ${requestTitle(first)}${requests.length > 1 ? ` 외 ${requests.length - 1}건` : ""}`).slice(0, 120);
    const labels = String(process.env.LUPL_GITHUB_ISSUE_LABELS || "").split(",").map(label => label.trim()).filter(Boolean);
    const payload = { title, body: issueBody(enrichedRequests) };
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

    return send(res, 200, {
      issue: { number: data.number, html_url: data.html_url, title: data.title },
      image_summaries: imageSummaries,
    });
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || String(error) });
  }
}
