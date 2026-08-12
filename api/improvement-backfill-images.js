import { readJsonBody, requireAdmin, send } from "./_shared.js";
import {
  compactAttachmentMeta,
  summarizeImprovementImages,
} from "./_improvement-images.js";

const DEFAULT_SCAN_LIMIT = 300;
const DEFAULT_PROCESS_LIMIT = 5;
const MAX_PROCESS_LIMIT = 10;

function authToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function restHeaders(req) {
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const key = serviceKey || anonKey;
  const token = serviceKey || authToken(req);
  if (!key || !token) throw new Error("Supabase 환경변수가 없습니다.");
  return {
    apikey: key,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function restUrl(path) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Supabase URL 환경변수가 없습니다.");
  return new URL(path, supabaseUrl.endsWith("/") ? supabaseUrl : `${supabaseUrl}/`);
}

function hasImageAttachment(row) {
  return (Array.isArray(row?.attachments) ? row.attachments : [])
    .some(attachment => String(attachment?.data_url || "").startsWith("data:image/"));
}

function hasStoredImageSummary(row) {
  const payload = row?.ai_payload || {};
  return Boolean(String(payload.image_summary || "").trim());
}

function requesterName(row) {
  const employee = Array.isArray(row?.employees) ? row.employees[0] : row?.employees;
  return employee?.name || "-";
}

function toVisionRequest(row) {
  return {
    id: row.id,
    type: row.request_type_label || row.request_type,
    menu: row.menu_label,
    submenu: row.submenu_label,
    note: row.note,
    title: row.note,
    status: row.status,
    created_at: row.created_at,
    requester: requesterName(row),
    attachments: row.attachments || [],
    ai_payload: row.ai_payload || {},
  };
}

async function fetchCandidateRows(req, scanLimit) {
  const url = restUrl("rest/v1/improvement_requests");
  url.searchParams.set("select", "id,request_type,request_type_label,menu_label,submenu_label,note,status,created_at,updated_at,github_issue_number,github_issue_url,github_issue_title,attachments,ai_summary,ai_payload,employees(name,employee_no)");
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(scanLimit));

  const response = await fetch(url, { headers: restHeaders(req) });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || "개선함 요청을 조회하지 못했습니다.");
  return data;
}

async function patchImageSummary(req, row, summary) {
  const now = new Date().toISOString();
  const nextPayload = {
    ...(row.ai_payload || {}),
    source: row.ai_payload?.source || "improvement_image_vision",
    image_summary: String(summary.image_summary || "").trim(),
    image_attachments: summary.attachments || compactAttachmentMeta(row.attachments),
    image_skipped_count: summary.skipped_count || 0,
    image_backfilled_at: now,
    image_model: process.env.LUPL_OPENAI_VISION_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-5.5",
  };
  const url = restUrl("rest/v1/improvement_requests");
  url.searchParams.set("id", `eq.${row.id}`);

  const response = await fetch(url, {
    method: "PATCH",
    headers: { ...restHeaders(req), Prefer: "return=minimal" },
    body: JSON.stringify({
      ai_summary: nextPayload.image_summary,
      ai_payload: nextPayload,
      updated_at: now,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.message || "이미지 요약 저장에 실패했습니다.");
  }
  return nextPayload;
}

function githubCommentBody(items) {
  const lines = items.map((item, index) => [
    `### ${index + 1}. ${item.menu || "메뉴 미지정"}${item.submenu ? ` / ${item.submenu}` : ""}`,
    `- 작성자: ${item.requester || "-"}`,
    `- 작성일: ${item.created_at || "-"}`,
    `- 첨부 이미지: ${(item.attachments || []).length}장`,
    "",
    item.image_summary,
  ].join("\n"));

  return [
    "## 이미지 첨부 재분석 결과",
    "",
    "기존 개선함 첨부 이미지를 비전 모델로 다시 읽어 앱에 저장했습니다.",
    "",
    ...lines,
  ].join("\n\n");
}

async function addGithubComments(rowsWithSummaries) {
  const token = process.env.LUPL_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.LUPL_GITHUB_REPO || "leehuieun-ai/lupl-attendance-final";
  if (!token) return { skipped: true, comments: [], errors: [] };

  const groups = rowsWithSummaries.reduce((acc, row) => {
    const number = row.github_issue_number;
    if (!number) return acc;
    if (!acc[number]) acc[number] = [];
    acc[number].push(row);
    return acc;
  }, {});
  const comments = [];
  const errors = [];

  for (const [issueNumber, items] of Object.entries(groups)) {
    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "lupl-attendance",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ body: githubCommentBody(items) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "GitHub 댓글 작성 실패");
      comments.push({ issue_number: Number(issueNumber), html_url: data.html_url });
    } catch (error) {
      errors.push({ issue_number: Number(issueNumber), error: error.message || String(error) });
    }
  }

  return { skipped: false, comments, errors };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "POST만 지원합니다." });
  try {
    await requireAdmin(req);
    const body = readJsonBody(req);
    const scanLimit = Math.min(Number(body.scan_limit || DEFAULT_SCAN_LIMIT) || DEFAULT_SCAN_LIMIT, 500);
    const processLimit = Math.min(Number(body.limit || DEFAULT_PROCESS_LIMIT) || DEFAULT_PROCESS_LIMIT, MAX_PROCESS_LIMIT);
    const apiKey = process.env.LUPL_attendance_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.LUPL_OPENAI_VISION_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-5.5";
    if (!apiKey) return send(res, 500, { error: "OpenAI API 키가 없어 이미지 재분석을 실행할 수 없습니다." });

    const rows = await fetchCandidateRows(req, scanLimit);
    const candidates = rows
      .filter(row => hasImageAttachment(row) && !hasStoredImageSummary(row))
      .slice(0, processLimit);

    const imageSummaries = await summarizeImprovementImages({
      requests: candidates.map(toVisionRequest),
      apiKey,
      model,
    });

    const updated = [];
    const failed = [];
    for (const row of candidates) {
      const summary = imageSummaries[row.id];
      if (!summary?.image_summary) {
        failed.push({ id: row.id, error: "이미지 요약 결과가 없습니다." });
        continue;
      }
      try {
        await patchImageSummary(req, row, summary);
        updated.push({
          id: row.id,
          menu: row.menu_label,
          submenu: row.submenu_label,
          requester: requesterName(row),
          created_at: row.created_at,
          github_issue_number: row.github_issue_number,
          attachments: compactAttachmentMeta(row.attachments),
          image_summary: summary.image_summary,
        });
      } catch (error) {
        failed.push({ id: row.id, error: error.message || String(error) });
      }
    }

    const github = await addGithubComments(updated);
    return send(res, 200, {
      scanned_count: rows.length,
      candidate_count: candidates.length,
      updated_count: updated.length,
      failed_count: failed.length,
      updated,
      failed,
      github,
    });
  } catch (error) {
    return send(res, error.statusCode || 500, { error: error.message || String(error) });
  }
}
