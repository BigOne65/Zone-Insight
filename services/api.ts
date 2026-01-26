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

const BASE_URL = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const VWORLD_BASE_URL = "https://api.vworld.kr/req/search";
const SGIS_BASE_URL = "https://sgisapi.kostat.go.kr/OpenAPI3";

// --- Cache ---
const polygonCache = new Map<string, number[][][]>();

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
    for (let i = 0; i < proxies.length; i++) {
        try {
            const response = await fetch(proxies[i](targetUrl));
            if (!response.ok) throw new Error(`HTTP status ${response.status}`);
            return await response.text(); 
        } catch (e) {
            if (i === proxies.length - 1) throw e; 
        }
    }
    throw new Error("All proxies failed");
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
    
    let response;
    try {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        response = await fetch(proxyUrl);
    } catch {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        response = await fetch(proxyUrl);
    }

    const data = await response.json();
    if (data.errCd === 0 && data.result) {
        sgisAccessToken = data.result.accessToken;
        // Token typically lasts 4 hours. AccessTimeout is in ms usually.
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
    const zoneUrl = `${BASE_URL}/storeZoneInRadius?radius=${SEARCH_RADIUS}&cx=${lon}&cy=${lat}&serviceKey=${DATA_API_KEY}&type=json`;
    const zoneText = await fetchWithRetry(zoneUrl);
    let zones: Zone[] = [];
    try {
        const zoneJson = JSON.parse(zoneText);
        if (zoneJson.body && zoneJson.body.items) zones = zoneJson.body.items.map((item: any) => ({ ...item, type: 'trade' }));
    } catch (e) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(zoneText, "text/xml");
        const items = xml.getElementsByTagName("item");
        for(let i=0; i<items.length; i++) {
            zones.push({
                trarNo: items[i].getElementsByTagName("trarNo")[0]?.textContent || "",
                mainTrarNm: items[i].getElementsByTagName("mainTrarNm")[0]?.textContent || "",
                trarArea: items[i].getElementsByTagName("trarArea")[0]?.textContent || "",
                ctprvnNm: items[i].getElementsByTagName("ctprvnNm")[0]?.textContent || "",
                signguNm: items[i].getElementsByTagName("signguNm")[0]?.textContent || "",
                coords: items[i].getElementsByTagName("coords")[0]?.textContent || "",
                stdrYm: items[i].getElementsByTagName("stdrYm")[0]?.textContent || "",
                stdrDt: items[i].getElementsByTagName("stdrDt")[0]?.textContent || "",
                type: 'trade'
            });
        }
    }
    if (zones.length === 0) throw new Error("주변 상권 정보가 없습니다.");
    return zones;
};

export const fetchStores = async (zoneNo: string, onProgress: (msg: string) => void): Promise<{ stores: Store[], stdrYm: string }> => {
    if (!DATA_API_KEY) throw new Error("API Key Missing");
    const PAGE_SIZE = 500;
    let allStores: Store[] = [];
    let totalCount = 0;
    let stdrYm = "";
    const firstUrl = `${BASE_URL}/storeListInArea?key=${zoneNo}&numOfRows=${PAGE_SIZE}&pageNo=1&serviceKey=${DATA_API_KEY}&type=json`;
    const firstText = await fetchWithRetry(firstUrl);
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
    const loopLimit = Math.min(totalPages, 10);
    if (loopLimit > 1) {
        for (let i = 2; i <= loopLimit; i++) {
            const nextUrl = `${BASE_URL}/storeListInArea?key=${zoneNo}&numOfRows=${PAGE_SIZE}&pageNo=${i}&serviceKey=${DATA_API_KEY}&type=json`;
            try {
                const nextText = await fetchWithRetry(nextUrl);
                const nextJson = JSON.parse(nextText);
                if (nextJson.body?.items) allStores = [...allStores, ...nextJson.body.items];
            } catch (e) {}
            onProgress(`${i} / ${loopLimit} 페이지 수집 중...`);
            await new Promise(r => setTimeout(r, 100));
        }
    }
    return { stores: allStores, stdrYm };
};

const fetchBaroApi = async (resId: string, catId: string, extraParams: string = "") => {
    const url = `${BASE_URL}/baroApi?resId=${resId}&catId=${catId}&type=json&serviceKey=${DATA_API_KEY}${extraParams}`;
    const text = await fetchWithRetry(url);
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
                } else {
                    console.log(`No specific match for dong: ${dong} (clean: ${cleanDong}). Showing all dongs in ${targetSigungu.signguNm}.`);
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

// --- SGIS Based Polygon Fetcher ---

export const fetchLocalAdminPolygon = async (zone: Zone): Promise<number[][][]> => {
    // 1. Check Cache
    if (polygonCache.has(zone.mainTrarNm)) {
        console.log(`[SGIS] 캐시된 경계 데이터 사용: ${zone.mainTrarNm}`);
        return polygonCache.get(zone.mainTrarNm)!;
    }

    try {
        console.log(`[SGIS] 행정구역 경계 데이터 요청: ${zone.mainTrarNm}`);
        const token = await getSgisToken();
        
        // 2. Get SGIS Administrative Code (adm_cd) using Geocoding
        // zone.mainTrarNm (e.g., "서울 강남구 삼성동") -> Geocode -> SGIS Code (e.g., "1123068")
        const geoUrl = `${SGIS_BASE_URL}/addr/geocode.json?accessToken=${token}&address=${encodeURIComponent(zone.mainTrarNm)}`;
        
        let geoRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(geoUrl)}`);
        if (!geoRes.ok) geoRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(geoUrl)}`);
        
        const geoData = await geoRes.json();
        
        let admCd = "";
        if (geoData.errCd === 0 && geoData.result?.resultdata?.length > 0) {
            admCd = geoData.result.resultdata[0].adm_cd;
            console.log(`[SGIS] 행정동 코드 획득: ${admCd}`);
        } else {
            console.warn(`[SGIS] 주소 검색 실패: ${zone.mainTrarNm}`);
            return [];
        }

        // 3. Fetch Boundary using adm_cd
        // Endpoint: /boundary/hadmarea.geojson (Administrative District Boundary)
        // low_search=0 (Retrieve boundary for the specific adm_cd)
        const boundUrl = `${SGIS_BASE_URL}/boundary/hadmarea.geojson?accessToken=${token}&adm_cd=${admCd}&low_search=0`;
        
        let boundRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(boundUrl)}`);
        if (!boundRes.ok) boundRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(boundUrl)}`);
        
        const boundData = await boundRes.json();

        if (boundData.features && boundData.features.length > 0) {
            const geometry = boundData.features[0].geometry;
            let coords = [];
            
            // Handle Polygon or MultiPolygon
            if (geometry.type === "Polygon") {
                coords = geometry.coordinates;
            } else if (geometry.type === "MultiPolygon") {
                // For MultiPolygon, find the largest ring (usually the mainland)
                let maxLen = 0;
                geometry.coordinates.forEach((poly: any[]) => {
                    if (poly[0].length > maxLen) {
                        maxLen = poly[0].length;
                        coords = poly;
                    }
                });
            }

            if (coords.length > 0) {
                // 4. Transform Coordinates: UTM-K (5179) -> WGS84 (4326) -> Leaflet [lat, lon]
                const ring = coords[0]; // Outer ring
                const result = [ring.map((p: number[]) => {
                    // SGIS returns [x, y] in UTM-K
                    if (typeof proj4 !== 'undefined') {
                        // proj4 returns [lon, lat] for WGS84
                        const [lon, lat] = proj4(PROJ_5179, PROJ_WGS84, p);
                        return [lat, lon]; // Leaflet expects [lat, lon]
                    }
                    return [p[1], p[0]]; // Fallback (incorrect if unprojected)
                })];

                // Cache the result
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
    const PAGE_SIZE = 500;
    let allStores: Store[] = [];
    let totalCount = 0;
    let stdrYm = "";
    const firstUrl = `${BASE_URL}/storeListInDong?divId=${divId}&key=${adminCode}&numOfRows=${PAGE_SIZE}&pageNo=1&serviceKey=${DATA_API_KEY}&type=json`;
    const firstText = await fetchWithRetry(firstUrl);
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
    const loopLimit = Math.min(totalPages, 5);
    if (loopLimit > 1) {
        for (let i = 2; i <= loopLimit; i++) {
            const nextUrl = `${BASE_URL}/storeListInDong?divId=${divId}&key=${adminCode}&numOfRows=${PAGE_SIZE}&pageNo=${i}&serviceKey=${DATA_API_KEY}&type=json`;
            try {
                const nextText = await fetchWithRetry(nextUrl);
                const nextJson = JSON.parse(nextText);
                if (nextJson.body?.items) allStores = [...allStores, ...nextJson.body.items];
            } catch (e) {}
            onProgress(`${i} / ${loopLimit} 페이지 수집 중... (행정구역 데이터)`);
            await new Promise(r => setTimeout(r, 200));
        }
    }
    return { stores: allStores, stdrYm };
};
