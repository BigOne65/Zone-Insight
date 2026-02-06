
export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: "URL parameter is required" });
  }

  // 1. 보안 키 매핑 (서버 환경변수에서 로드)
  // 클라이언트 코드는 'CONFIDENTIAL_...' 이라는 임시 텍스트만 가지고 있으며,
  // 실제 키는 이 서버리스 함수 내부에서만 접근 가능합니다. (브라우저 노출 방지)
  const KEY_MAP = {
    "CONFIDENTIAL_DATA_API_KEY": process.env.VITE_DATA_API_KEY,
    "CONFIDENTIAL_VWORLD_KEY": process.env.VITE_VWORLD_KEY,
    "CONFIDENTIAL_SGIS_ID": process.env.VITE_SGIS_SERVICE_ID,
    "CONFIDENTIAL_SGIS_SECRET": process.env.VITE_SGIS_SECRET_KEY,
    "CONFIDENTIAL_SEOUL_KEY": process.env.VITE_SEOUL_DATA_KEY,
  };

  let targetUrl = url;
  let missingKeys = [];

  // 2. 키 주입 및 누락 검사
  Object.keys(KEY_MAP).forEach((placeholder) => {
    if (targetUrl.includes(placeholder)) {
      const realKey = KEY_MAP[placeholder];
      
      if (!realKey) {
        // 환경변수가 Vercel 설정에 없는 경우 로그를 남깁니다. (Vercel Logs 탭에서 확인 가능)
        missingKeys.push(placeholder);
        console.warn(`[Proxy Warning] 환경변수가 설정되지 않았습니다: ${placeholder} (매핑된 변수를 확인하세요)`);
      } else {
        // 실제 키로 교체 (URL 인코딩 처리)
        // 주의: 공공데이터포털 등의 키는 'Decoding' 된(특수문자가 없는) 상태로 환경변수에 저장하는 것을 권장합니다.
        // encodeURIComponent가 자동으로 URL 안전한 형태로 변환해줍니다.
        targetUrl = targetUrl.replace(placeholder, encodeURIComponent(realKey));
      }
    }
  });

  if (missingKeys.length > 0) {
    console.error(`[Proxy Error] 다음 키에 대한 환경변수가 누락되었습니다: ${missingKeys.join(", ")}`);
  }

  try {
    // 3. 실제 API 호출 (서버 사이드 Fetch)
    // 서버에서 호출하므로 CORS 에러가 발생하지 않으며, 
    // http:// (서울시 API) 요청도 https:// (Vercel) 환경에서 안전하게 처리됩니다.
    const response = await fetch(targetUrl);
    
    // 응답 상태 및 타입 확인
    const contentType = response.headers.get("content-type");
    const data = await response.text();

    // 4. 클라이언트로 응답 반환
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", contentType || "application/json");
    
    // API 에러가 발생했더라도 내용은 전달 (클라이언트에서 파싱하도록)
    res.status(response.status).send(data);

  } catch (error) {
    console.error("Proxy Request Failed:", error);
    res.status(500).json({ 
      error: "External API Request Failed", 
      message: "외부 API 서버에 연결할 수 없습니다.",
      details: error.message 
    });
  }
}
