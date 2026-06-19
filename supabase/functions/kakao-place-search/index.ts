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

async function requireActiveEmployee(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { error: json({ documents: [], error: "로그인이 필요합니다." }, 401) };

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return { error: json({ documents: [], error: "Supabase Secret 설정이 부족합니다." }, 500) };
  }

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return { error: json({ documents: [], error: "로그인 정보를 확인할 수 없습니다." }, 401) };

  const { data: employee } = await userClient
    .from("employees")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .eq("employment_status", "active")
    .maybeSingle();
  if (!employee) return { error: json({ documents: [], error: "활성화된 직원 정보가 없습니다." }, 403) };
  return { employee };
}

async function kakaoSearch(path: string, query: string, kakaoRestKey: string) {
  const url = new URL(`https://dapi.kakao.com/v2/local/search/${path}.json`);
  url.searchParams.set("query", query);
  url.searchParams.set("size", "10");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await requireActiveEmployee(req);
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => ({}));
    const query = String(body.query || "").trim();
    if (!query) return json({ documents: [], error: "검색어를 입력해주세요." });

    const kakaoRestKey = Deno.env.get("KAKAO_REST_API_KEY");
    if (!kakaoRestKey) {
      return json({
        documents: [],
        error: "Kakao REST API 키가 Supabase Secret에 설정되어 있지 않습니다.",
      });
    }

    const keyword = await kakaoSearch("keyword", query, kakaoRestKey);
    if (!keyword.response.ok) {
      return json({
        documents: [],
        error: "카카오 장소 검색에 실패했습니다.",
        status: keyword.response.status,
        detail: keyword.data?.message || keyword.data?.error || keyword.data,
      });
    }

    const keywordDocs = Array.isArray(keyword.data?.documents) ? keyword.data.documents : [];
    if (keywordDocs.length > 0) return json(keyword.data);

    const address = await kakaoSearch("address", query, kakaoRestKey);
    if (!address.response.ok) {
      return json({
        documents: [],
        error: "카카오 주소 검색에 실패했습니다.",
        status: address.response.status,
        detail: address.data?.message || address.data?.error || address.data,
      });
    }

    const addressDocs = Array.isArray(address.data?.documents)
      ? address.data.documents.map((item: any) => ({
          id: item.address?.b_code || item.road_address?.zone_no || item.address_name,
          place_name: item.address_name,
          address_name: item.address_name,
          road_address_name: item.road_address?.address_name || "",
          x: item.x,
          y: item.y,
        }))
      : [];

    return json({ documents: addressDocs, meta: address.data?.meta });
  } catch (error) {
    return json({
      documents: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
