const MAX_REQUESTS_WITH_IMAGES = 20;
const MAX_IMAGES_PER_REQUEST = 4;
const MAX_IMAGE_DATA_URL_LENGTH = 4_500_000;

export function compactAttachmentMeta(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment, index) => ({
      id: attachment?.id || `attachment-${index + 1}`,
      name: attachment?.name || `첨부 이미지 ${index + 1}`,
      type: attachment?.type || "",
      has_image_data: typeof attachment?.data_url === "string" && attachment.data_url.startsWith("data:image/"),
      size_chars: typeof attachment?.data_url === "string" ? attachment.data_url.length : 0,
    }));
}

export function requestImageSummary(request) {
  return String(request?.image_summary || request?.ai_summary || request?.ai_payload?.image_summary || "").trim();
}

export function safeRequestsForPrompt(requests) {
  return requests.map(request => {
    const { attachments, ...rest } = request || {};
    const imageSummary = requestImageSummary(request);
    return {
      ...rest,
      image_summary: imageSummary || undefined,
      attachments: compactAttachmentMeta(attachments),
    };
  });
}

function imageAttachments(request) {
  return (Array.isArray(request?.attachments) ? request.attachments : [])
    .filter(attachment => {
      const dataUrl = String(attachment?.data_url || "");
      return dataUrl.startsWith("data:image/") && dataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH;
    })
    .slice(0, MAX_IMAGES_PER_REQUEST);
}

function skippedImageCount(request) {
  const attachments = Array.isArray(request?.attachments) ? request.attachments : [];
  const imageLike = attachments.filter(attachment => String(attachment?.data_url || "").startsWith("data:image/"));
  return Math.max(0, imageLike.length - imageAttachments(request).length);
}

export function extractOpenAIResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const chunks = [];
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === "string") chunks.push(part.text);
      else if (typeof part?.text?.value === "string") chunks.push(part.text.value);
    }
  }
  return chunks.join("\n").trim();
}

export async function summarizeImprovementImages({ requests, apiKey, model }) {
  const targetRequests = (Array.isArray(requests) ? requests : [])
    .filter(request => imageAttachments(request).length > 0)
    .slice(0, MAX_REQUESTS_WITH_IMAGES);

  const summaries = {};
  if (!targetRequests.length) return summaries;

  if (!apiKey) {
    targetRequests.forEach(request => {
      summaries[request.id] = {
        id: request.id,
        image_summary: "이미지 첨부가 있으나 OpenAI API 키가 없어 자동 인식을 실행하지 못했습니다.",
        attachments: compactAttachmentMeta(request.attachments),
        skipped_count: skippedImageCount(request),
      };
    });
    return summaries;
  }

  for (const request of targetRequests) {
    const images = imageAttachments(request);
    const content = [
      {
        type: "input_text",
        text: [
          "너는 근태관리 웹앱 개선함에 첨부된 스크린샷을 읽는 한국어 QA 분석가다.",
          "이미지에서 보이는 화면, 오류 문구, 깨진 UI, 사용자가 개선해야 할 핵심을 짧게 요약한다.",
          "추측은 피하고, 보이는 내용과 요청 메모를 연결해서 3~5줄로 작성한다.",
          "",
          `메뉴: ${request.menu || request.menu_label || "-"}`,
          `하위 항목: ${request.submenu || request.submenu_label || "-"}`,
          `작성 메모: ${request.note || "-"}`,
        ].join("\n"),
      },
      ...images.map(attachment => ({
        type: "input_image",
        image_url: attachment.data_url,
        detail: "low",
      })),
    ];

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: [{ role: "user", content }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "이미지 인식 실패");
      const imageSummary = extractOpenAIResponseText(data) || "이미지를 읽었지만 요약할 내용을 찾지 못했습니다.";
      summaries[request.id] = {
        id: request.id,
        image_summary: imageSummary,
        attachments: compactAttachmentMeta(request.attachments),
        skipped_count: skippedImageCount(request),
      };
    } catch (error) {
      summaries[request.id] = {
        id: request.id,
        image_summary: `이미지 인식 실패: ${error.message || String(error)}`,
        attachments: compactAttachmentMeta(request.attachments),
        skipped_count: skippedImageCount(request),
      };
    }
  }

  return summaries;
}

export function enrichRequestsWithImageSummaries(requests, imageSummaries) {
  return (Array.isArray(requests) ? requests : []).map(request => {
    const image = imageSummaries?.[request.id];
    if (!image?.image_summary) return request;
    return {
      ...request,
      image_summary: image.image_summary,
      image_attachments: image.attachments || compactAttachmentMeta(request.attachments),
      image_skipped_count: image.skipped_count || 0,
    };
  });
}
