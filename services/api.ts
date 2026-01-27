import { Zone, Store } from '../types';

// Declare proj4 global
declare const proj4: any;

// Define Coordinate Systems
const PROJ_WGS84 = 'EPSG:4326';
// SGIS uses UTM-K (GRS80)
const PROJ_5179 = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

/**
 * 환경 변수 로드 헬퍼
 * .env 파일이 없어도 빌드 타임/런타임 환경 변수(Vercel 등)에서 값을 읽어옵니다.
 */
const getEnvVar = (key: string): string => {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
        // @ts-ignore
        return import.meta.env[key] || "";
    }
    return "";
};

const DATA_API_KEY = getEnvVar("VITE_DATA_API_KEY");
const VWORLD_KEY = getEnvVar("VITE_VWORLD_KEY");
const SGIS_ID = getEnvVar("VITE_SGIS_SERVICE_ID");
const SGIS_SECRET = getEnvVar("VITE_SGIS_SECRET_KEY");

// API Endpoints
const BASE_URL = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const VWORLD_BASE_URL = "https://api.vworld.kr/req/search";
// Update Base URL to mods.go.kr
const SGIS_BASE_URL = "https://sgisapi.mods.go.kr/OpenAPI3";

const PAGE_SIZE = 1000;

// --- Cache ---
const polygonCache = new Map<string, number[][][]>();

// --- Helpers ---

/**
 * API Key 포맷팅
 * 공공데이터포털 키가 Decoding된 상태(+, / 포함)라면 반드시 인코딩해야 함.
 * 이미 Encoding된 상태(% 포함)라면 그대로 사용.
 */
const getFormattedKey = (key: string) => {
    if (!key) return "";
    return key.includes('%') ? key : encodeURIComponent(key);
};

/**
 * XML 에러 파싱
 * 공공데이터포털은 에러 발생 시 status 200 OK와 함께 XML 에러 메시지를 반환하는 경우가 많음.
 */
const parseXmlError = (text: string) => {
    try {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "text/xml");
        const authMsg = xml.getElementsByTagName("returnAuthMsg")[0]?.textContent;
        const errMsg = xml.getElementsByTagName("errMsg")[0]?.textContent;
        const returnReasonCode = xml.getElementsByTagName("returnReasonCode")[0]?.textContent;
        
        if (authMsg) return `API 인증 오류: ${authMsg} (코드: ${returnReasonCode})`;
        if (errMsg) return `API 오류: ${errMsg}`;
        return "API에서 알 수 없는 오류(XML)가 반환되었습니다.";
    } catch (e) {
        return "API 응답을 처리하는 중 오류가 발생했습니다.";
    }
};

// --- Network Helpers ---

const fetchJsonp = (url: string, callbackParam = 'callback'): Promise<any> => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const callbackName = `jsonp_callback_${Math.round(100000 * Math.random())}`;
        // @ts-ignore
        window[callbackName] = (data: any) => {
            // @ts-ignore
            delete window[callbackName];
            document.body.removeChild(script);
            resolve(data);
        };
        script.src = `${url}&${callbackParam}=${callbackName}`;
        script.onerror = () => {
            // @ts-ignore
            delete window[callbackName];
            document.body.removeChild(script);
            reject(new Error('JSONP Request Failed'));
        };
        document.body.appendChild(script);
    });
};

const fetchWithRetry = async (targetUrl: string): Promise<string> => {
    const proxies = [
        (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];
    
    let lastError;
    for (let i = 0; i < proxies.length; i++) {
        try {
            const response = await fetch(proxies[i](targetUrl));
            if (!response.ok) throw new Error(`HTTP status ${response.status}`);
            return await response.text(); 
        } catch (e) {
            console.warn(`Proxy ${i+1} failed:`, e);
            lastError = e;
            if (i === proxies.length - 1) throw lastError; 
        }
    }
    throw new Error("모든 프록시 서버 연결 실패");
};

// --- SGIS Helpers ---

let sgisAccessToken: string | null = null;
let tokenExpiry: number = 0;

const getSgisToken = async (): Promise<string> => {
    // Return cached token if valid (buffer 5 mins)
    if (sgisAccessToken && Date.now() < tokenExpiry - 300000) {
        return sgisAccessToken;
    }

    if (!SGIS_ID || !SGIS_SECRET || SGIS_ID.startsWith("YOUR")) {
        throw new Error("SGIS API Key가 설정되지 않았습니다. 환경 변수를 확인해주세요.");
    }

    const url = `${SGIS_BASE_URL}/auth/authentication.json?consumer_key=${SGIS_ID}&consumer_secret=${SGIS_SECRET}`;
    
    let responseText;
    try {
        responseText = await fetchWithRetry(url);
    } catch (e: any) {
        throw new Error(`SGIS 인증 실패: ${e.message}`);
    }

    const data = JSON.parse(responseText);
    if (data.errCd === 0 && data.result) {
        sgisAccessToken = data.result.accessToken;
        const timeoutMs = parseInt(data.result.accessTimeout, 10) || 14400000;
        tokenExpiry = Date.now() + timeoutMs;
        return sgisAccessToken as string;
    } else {
        throw new Error(`SGIS Auth Error: ${data.errMsg}`);
    }
};

// --- API Functions ---

export const searchAddress = async (address: string): Promise<any> => {
    if (!VWORLD_KEY || VWORLD_KEY.startsWith("YOUR")) throw new Error("V-World API Key가 설정되지 않았습니다.");
    let errorDetails: string[] = [];
    
    const runSearch = async (searchType: string, category?: string) => {
        let baseUrl = `${VWORLD_BASE_URL}?service=search&request=search&version=2.0&crs=EPSG:4326&size=10&page=1&query=${encodeURIComponent(address)}&type=${searchType}&format=json&errorformat=json&key=${VWORLD_KEY}`;
        if (category) baseUrl += `&category=${category}`;
        try {
            const data = await fetchJsonp(baseUrl);
            if (data.response.status === "OK" && data.response.result?.items?.length > 0) return data.response.result.items[0];
            else {
                if (data.response.status !== "NOT_FOUND") errorDetails.push(`[${searchType}] ${data.response.error?.text || data.response.status}`);
                return null;
            }
        } catch (e: any) {
            errorDetails.push(`[${searchType}] Network Error: ${e.message}`);
            return null;
        }
    };
    
    let item = await runSearch("ADDRESS", "road");
    if (!item) item = await runSearch("ADDRESS", "parcel");
    if (!item) item = await runSearch("PLACE");
    if (item) return item;
    
    throw new Error(`검색 실패: ${errorDetails.length > 0 ? errorDetails.join(", ") : "결과 없음"}`);
};

export const searchZones = async (lat: number, lon: number): Promise<Zone[]> => {
    if (!DATA_API_KEY || DATA_API_KEY.startsWith("YOUR")) throw new Error("공공데이터포털 API Key가 설정되지 않았습니다.");
    const SEARCH_RADIUS = 500;
    
    const serviceKey = getFormattedKey(DATA_API_KEY);
    const zoneUrl = `${BASE_URL}/storeZoneInRadius?radius=${SEARCH_RADIUS}&cx=${lon}&cy=${lat}&serviceKey=${serviceKey}&type=json`;
    
    const zoneText = await fetchWithRetry(zoneUrl);
    
    // Check for XML Error Response
    if (zoneText.trim().startsWith('<')) {
        throw new Error(parseXmlError(zoneText));
    }

    let zones: Zone[] = [];
    try {
        const zoneJson = JSON.parse(zoneText);
        if (zoneJson.body && zoneJson.body.items) {
            zones = Array.isArray(zoneJson.body.items) ? zoneJson.body.items : [zoneJson.body.items];
            // type: 'trade' 추가
            zones = zones.map((item: any) => ({ ...item, type: 'trade' }));
        }
    } catch (e) {
        throw new Error("데이터 파싱 실패 (JSON형식이 아닙니다)");
    }
    
    if (zones.length === 0) throw new Error("주변 상권 정보가 없습니다.");
    return zones;
};

export const fetchStores = async (zoneNo: string, onProgress: (msg: string) => void): Promise<{ stores: Store[], stdrYm: string }> => {
    if (!DATA_API_KEY) throw new Error("API Key Missing");
    
    let allStores: Store[] = [];
    let totalCount = 0;
    let stdrYm = "";
    
    const serviceKey = getFormattedKey(DATA_API_KEY);
    const firstUrl = `${BASE_URL}/storeListInArea?key=${zoneNo}&numOfRows=${PAGE_SIZE}&pageNo=1&serviceKey=${serviceKey}&type=json`;
    
    const firstText = await fetchWithRetry(firstUrl);
    
    if (firstText.trim().startsWith('<')) {
        throw new Error(parseXmlError(firstText));
    }

    try {
        const listJson = JSON.parse(firstText);
        if (listJson.header?.stdrYm) stdrYm = String(listJson.header.stdrYm);
        else if (listJson.response?.header?.stdrYm) stdrYm = String(listJson.response.header.stdrYm);
        let items = listJson.body?.items || listJson.response?.body?.items;
        if (items) {
            allStores = Array.isArray(items) ? items : [items];
            totalCount = listJson.body?.totalCount || listJson.response?.body?.totalCount || allStores.length;
        }
    } catch (e) {}

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    
    if (totalPages > 1) {
        for (let i = 2; i <= totalPages; i++) {
            const nextUrl = `${BASE_URL}/storeListInArea?key=${zoneNo}&numOfRows=${PAGE_SIZE}&pageNo=${i}&serviceKey=${serviceKey}&type=json`;
            try {
                const nextText = await fetchWithRetry(nextUrl);
                if (!nextText.trim().startsWith('<')) {
                    const nextJson = JSON.parse(nextText);
                    if (nextJson.body?.items) {
                        const nextItems = Array.isArray(nextJson.body.items) ? nextJson.body.items : [nextJson.body.items];
                        allStores = [...allStores, ...nextItems];
                    }
                }
            } catch (e) {}
            onProgress(`${i} / ${totalPages} 페이지 수집 중...`);
            await new Promise(r => setTimeout(r, 100));
        }
    }
    return { stores: allStores, stdrYm };
};

const fetchBaroApi = async (resId: string, catId: string, extraParams: string = "") => {
    const serviceKey = getFormattedKey(DATA_API_KEY);
    const url = `${BASE_URL}/baroApi?resId=${resId}&catId=${catId}&type=json&serviceKey=${serviceKey}${extraParams}`;
    const text = await fetchWithRetry(url);
    if (text.trim().startsWith('<')) return [];
    try {
        const json = JSON.parse(text);
        if (json.body?.items) return Array.isArray(json.body.items) ? json.body.items : [json.body.items];
        if (json.items) return Array.isArray(json.items) ? json.items : [json.items];
        return [];
    } catch (e) { return []; }
};

export const searchAdminDistrict = async (sido: string, sigungu: string, dong: string): Promise<Zone[]> => {
    if (!DATA_API_KEY) throw new Error("API Key Missing");
    
    if (!sido) throw new Error("시/도 정보를 찾을 수 없습니다. (예: 서울특별시, 경기도)");

    const sidos = await fetchBaroApi('dong', 'mega');
    const targetSido = sidos.find((s: any) => s.ctprvnNm.includes(sido) || sido.includes(s.ctprvnNm));
    
    if (!targetSido) throw new Error(`행정구역(시도)을 찾을 수 없습니다: ${sido}`);
    
    let adminZones: Zone[] = [];

    if (sigungu) {
        const sigungus = await fetchBaroApi('dong', 'cty', `&ctprvnCd=${targetSido.ctprvnCd}`);
        const targetSigungu = sigungus.find((s: any) => s.signguNm.includes(sigungu) || sigungu.includes(s.signguNm));
        
        if (targetSigungu) {
            const dongs = await fetchBaroApi('dong', 'admi', `&signguCd=${targetSigungu.signguCd}`);
            let filteredDongs = dongs;
            
            if (dong) {
                const cleanDong = dong.replace(/[0-9.]+|동$/g, "").trim();
                const matches = dongs.filter((d: any) => {
                     const cleanAdong = d.adongNm.replace(/[0-9.]+|동$/g, "").trim();
                     return d.adongNm.includes(dong) || (cleanDong.length > 0 && cleanAdong === cleanDong);
                });

                if (matches.length > 0) {
                    filteredDongs = matches;
                }
            }

            adminZones = filteredDongs.map((d: any) => ({
                trarNo: d.adongCd,
                mainTrarNm: `${targetSido.ctprvnNm} ${targetSigungu.signguNm} ${d.adongNm}`,
                ctprvnNm: targetSido.ctprvnNm,
                signguNm: targetSigungu.signguNm,
                trarArea: "0",
                coords: "",
                type: 'admin',
                adminCode: d.adongCd,
                adminLevel: 'adongCd'
            }));
        } else {
             throw new Error(`행정구역(시군구)을 찾을 수 없습니다: ${sigungu}`);
        }
    } else {
        throw new Error("시군구 단위까지 정보가 필요합니다. (예: 서울 강남구)");
    }

    if (adminZones.length === 0) throw new Error("해당 조건에 맞는 행정동을 찾을 수 없습니다.");
    return adminZones;
};

/**
 * V-World API를 통해 해당 좌표의 표준 행정구역 코드(행정안전부 기준)를 조회합니다.
 * SGIS 코드는 통계청 기준이라 공공데이터포털 상권 API와 불일치하는 경우가 많습니다.
 */
const getStandardAdminCode = async (lat: number, lon: number): Promise<string | null> => {
    if (!VWORLD_KEY || VWORLD_KEY.startsWith("YOUR")) return null;
    
    // Address Endpoint using PARCEL type to get admin code (level4AC)
    // Replace base search url with address url
    const url = `${"https://api.vworld.kr/req/address"}?service=address&request=getaddress&version=2.0&crs=EPSG:4326&point=${lon},${lat}&format=json&type=PARCEL&key=${VWORLD_KEY}`;
    
    try {
        const data = await fetchJsonp(url);
        if (data.response.status === "OK" && data.response.result?.length > 0) {
            // structure.level4AC : 행정동 코드 (10자리)
            return data.response.result[0].structure.level4AC || null;
        }
    } catch(e) { 
        console.warn("V-World Reverse Geocode failed:", e); 
    }
    return null;
}

/**
 * SGIS 리버스 지오코딩 및 V-World 표준 코드 조회를 통합하여 정확한 행정구역 정보를 반환합니다.
 */
export const getAdminDistrictByLocation = async (lat: number, lon: number): Promise<Zone> => {
    try {
        const token = await getSgisToken();
        
        // 1. WGS84 (Lat/Lon) -> UTM-K (SGIS Default) 변환
        let utmkX = 0;
        let utmkY = 0;

        if (typeof proj4 !== 'undefined') {
             const [x, y] = proj4(PROJ_WGS84, PROJ_5179, [lon, lat]);
             utmkX = x;
             utmkY = y;
        } else {
             throw new Error("좌표 변환 라이브러리(proj4)가 로드되지 않았습니다.");
        }

        // 2. 리버스 지오코딩 요청 (addr_type=21: 행정동)
        // https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/addressBoundary.html#rgeocode
        const url = `${SGIS_BASE_URL}/addr/rgeocode.json?accessToken=${token}&x_coor=${utmkX}&y_coor=${utmkY}&addr_type=21`;
        
        const resStr = await fetchWithRetry(url);
        const resData = JSON.parse(resStr);

        if (resData.errCd === 0 && resData.result && resData.result.length > 0) {
            const item = resData.result[0];
            const fullName = item.full_addr || `${item.sido_nm} ${item.sgg_nm} ${item.adm_nm}`;
            
            // 3. V-World를 통해 표준 행정코드(MOIS Code) 조회 시도
            // SGIS adm_cd(7자리)와 공공데이터포털 상권정보 API의 key(10자리 행정안전부 코드)가 다름
            const moisCode = await getStandardAdminCode(lat, lon);
            
            return {
                trarNo: moisCode || item.adm_cd, // Prefer MOIS code for API calls
                mainTrarNm: fullName,
                ctprvnNm: item.sido_nm,
                signguNm: item.sgg_nm,
                trarArea: "0",
                coords: "",
                type: 'admin',
                adminCode: moisCode || item.adm_cd, // Data API uses this
                sgisCode: item.adm_cd,              // Polygon API uses this
                adminLevel: 'adongCd'
            };
        } else {
            throw new Error("해당 위치의 행정동 정보를 찾을 수 없습니다.");
        }
    } catch (e: any) {
        throw new Error(`행정동 검색 실패: ${e.message}`);
    }
};

export const fetchLocalAdminPolygon = async (zone: Zone): Promise<number[][][]> => {
    if (polygonCache.has(zone.mainTrarNm)) {
        console.log(`[SGIS] 캐시된 경계 데이터 사용: ${zone.mainTrarNm}`);
        return polygonCache.get(zone.mainTrarNm)!;
    }

    try {
        console.log(`[SGIS] 행정구역 경계 데이터 요청: ${zone.mainTrarNm}`);
        const token = await getSgisToken();
        
        // SGIS code가 있으면 우선 사용, 없으면 adminCode 사용
        let admCd = zone.sgisCode || zone.adminCode;

        if (!admCd) {
            const geoUrl = `${SGIS_BASE_URL}/addr/geocode.json?accessToken=${token}&address=${encodeURIComponent(zone.mainTrarNm)}`;
            let geoResStr = await fetchWithRetry(geoUrl);
            const geoData = JSON.parse(geoResStr);
            if (geoData.errCd === 0 && geoData.result?.resultdata?.length > 0) {
                admCd = geoData.result.resultdata[0].adm_cd;
            } else {
                console.warn(`[SGIS] 주소 검색 실패: ${zone.mainTrarNm}`);
                return [];
            }
        }

        const currentYear = new Date().getFullYear().toString();
        let boundUrl = `${SGIS_BASE_URL}/boundary/hadmarea.geojson?accessToken=${token}&adm_cd=${admCd}&year=${currentYear}&low_search=0`;
        
        let boundResStr = await fetchWithRetry(boundUrl);
        let boundData = JSON.parse(boundResStr);

        if (!boundData.features || boundData.features.length === 0) {
             const prevYear = (new Date().getFullYear() - 1).toString();
             console.warn(`[SGIS] ${currentYear}년도 데이터 없음, ${prevYear}년도로 재시도`);
             boundUrl = `${SGIS_BASE_URL}/boundary/hadmarea.geojson?accessToken=${token}&adm_cd=${admCd}&year=${prevYear}&low_search=0`;
             boundResStr = await fetchWithRetry(boundUrl);
             boundData = JSON.parse(boundResStr);
        }

        if (boundData.features && boundData.features.length > 0) {
            const geometry = boundData.features[0].geometry;
            let coords = [];
            
            if (geometry.type === "Polygon") {
                coords = geometry.coordinates;
            } else if (geometry.type === "MultiPolygon") {
                let maxLen = 0;
                geometry.coordinates.forEach((poly: any[]) => {
                    if (poly[0].length > maxLen) {
                        maxLen = poly[0].length;
                        coords = poly;
                    }
                });
            }

            if (coords.length > 0) {
                const ring = coords[0];
                const result = [ring.map((p: number[]) => {
                    if (typeof proj4 !== 'undefined') {
                        const [lon, lat] = proj4(PROJ_5179, PROJ_WGS84, p);
                        return [lat, lon];
                    }
                    return [p[1], p[0]];
                })];

                polygonCache.set(zone.mainTrarNm, result);
                return result;
            }
        }
    } catch (e: any) {
        console.warn(`[SGIS] API Error: ${e.message}`);
    }
    return [];
};

export const fetchStoresInAdmin = async (adminCode: string, divId: string, onProgress: (msg: string) => void): Promise<{ stores: Store[], stdrYm: string }> => {
    if (!DATA_API_KEY) throw new Error("API Key Missing");
    
    let allStores: Store[] = [];
    let totalCount = 0;
    let stdrYm = "";
    
    const serviceKey = getFormattedKey(DATA_API_KEY);
    const firstUrl = `${BASE_URL}/storeListInDong?divId=${divId}&key=${adminCode}&numOfRows=${PAGE_SIZE}&pageNo=1&serviceKey=${serviceKey}&type=json`;
    
    const firstText = await fetchWithRetry(firstUrl);
    
    if (firstText.trim().startsWith('<')) {
        throw new Error(parseXmlError(firstText));
    }

    try {
        const listJson = JSON.parse(firstText);
        if (listJson.header?.stdrYm) stdrYm = String(listJson.header.stdrYm);
        else if (listJson.response?.header?.stdrYm) stdrYm = String(listJson.response.header.stdrYm);
        let items = listJson.body?.items || listJson.response?.body?.items;
        if (items) {
            allStores = Array.isArray(items) ? items : [items];
            totalCount = listJson.body?.totalCount || listJson.response?.body?.totalCount || allStores.length;
        }
    } catch (e) {}

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    
    if (totalPages > 1) {
        for (let i = 2; i <= totalPages; i++) {
            const nextUrl = `${BASE_URL}/storeListInDong?divId=${divId}&key=${adminCode}&numOfRows=${PAGE_SIZE}&pageNo=${i}&serviceKey=${serviceKey}&type=json`;
            try {
                const nextText = await fetchWithRetry(nextUrl);
                if (!nextText.trim().startsWith('<')) {
                    const nextJson = JSON.parse(nextText);
                    if (nextJson.body?.items) {
                        const nextItems = Array.isArray(nextJson.body.items) ? nextJson.body.items : [nextJson.body.items];
                        allStores = [...allStores, ...nextItems];
                    }
                }
            } catch (e) {}
            onProgress(`${i} / ${totalPages} 페이지 수집 중... (행정구역 데이터)`);
            await new Promise(r => setTimeout(r, 200));
        }
    }
    return { stores: allStores, stdrYm };
};