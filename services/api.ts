import { Zone, Store } from '../types';

// Declare proj4 global
declare const proj4: any;

// Define Common Korean Coordinate Systems
// EPSG:5179 (UTM-K, GRS80) - Most modern government data (Statistics Korea, NGII)
const PROJ_5179 = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
// EPSG:5174 (Bessel, Old) - Old cadastral maps
const PROJ_5174 = "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43";

// 환경 변수 안전하게 가져오기
const getEnvVar = (key: string): string => {
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) return import.meta.env[key] || "";
    } catch (e) { }
    try {
        // @ts-ignore
        if (typeof process !== 'undefined' && process.env) return process.env[key] || "";
    } catch (e) { }
    return "";
};

const DATA_API_KEY = getEnvVar("VITE_DATA_API_KEY");
const VWORLD_KEY = getEnvVar("VITE_VWORLD_KEY");

const BASE_URL = "http://apis.data.go.kr/B553077/api/open/sdsc2";
const VWORLD_BASE_URL = "https://api.vworld.kr/req/search";

// Helper: JSONP for V-World
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

// Helper: Proxy fetch for Data.go.kr
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

// V-World Geocoding
export const searchAddress = async (address: string): Promise<any> => {
    if (!VWORLD_KEY) throw new Error("V-World API Key가 설정되지 않았습니다.");
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

// --- Trade Zone Analysis ---
export const searchZones = async (lat: number, lon: number): Promise<Zone[]> => {
    if (!DATA_API_KEY) throw new Error("Data.go.kr API Key가 설정되지 않았습니다.");
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

// --- Administrative District Analysis ---
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

export const searchAdminDistrict = async (addressStr: string): Promise<Zone[]> => {
    if (!DATA_API_KEY) throw new Error("API Key Missing");
    const parts = addressStr.split(" ");
    const sidoName = parts[0];
    const sigunguName = parts[1];
    const dongName = parts.length > 2 ? parts[2] : "";

    if (!sidoName) throw new Error("주소 형식을 확인할 수 없습니다.");
    const sidos = await fetchBaroApi('dong', 'mega');
    const targetSido = sidos.find((s: any) => s.ctprvnNm.includes(sidoName) || sidoName.includes(s.ctprvnNm));
    if (!targetSido) throw new Error(`행정구역(시도)을 찾을 수 없습니다: ${sidoName}`);
    
    let adminZones: Zone[] = [];
    if (sigunguName) {
        const sigungus = await fetchBaroApi('dong', 'cty', `&ctprvnCd=${targetSido.ctprvnCd}`);
        const targetSigungu = sigungus.find((s: any) => s.signguNm.includes(sigunguName));
        if (targetSigungu) {
            const dongs = await fetchBaroApi('dong', 'admi', `&signguCd=${targetSigungu.signguCd}`);
            let filteredDongs = dongs;
            if (dongName) filteredDongs = dongs.filter((d: any) => d.adongNm.includes(dongName));
            adminZones = filteredDongs.map((d: any) => ({
                trarNo: d.adongCd,
                mainTrarNm: `${targetSido.ctprvnNm} ${targetSigungu.signguNm} ${d.adongNm}`,
                ctprvnNm: targetSido.ctprvnNm,
                signguNm: targetSigungu.signguNm,
                trarArea: "0",
                coords: "",
                type: 'admin',
                adminCode: d.adongCd, // 10-digit MOIS code
                adminLevel: 'adongCd'
            }));
        }
    } else { throw new Error("시군구 단위까지 입력해주세요."); }

    if (adminZones.length === 0) throw new Error("해당 조건에 맞는 행정동을 찾을 수 없습니다.");
    return adminZones;
};

// --- Local Shapefile Loader (Using shpjs) ---
let cachedFeatures: any[] | null = null;

export const fetchLocalAdminPolygon = async (zone: Zone): Promise<number[][][]> => {
    try {
        // 1. Load zones.zip if not cached
        if (!cachedFeatures) {
            // @ts-ignore
            if (typeof window.shp === 'undefined') {
                console.error("shpjs library not loaded");
                return [];
            }
            console.log("Loading local shapefile (zones.zip)...");
            // @ts-ignore
            const geojson = await window.shp('/zones.zip');
            if (Array.isArray(geojson)) cachedFeatures = geojson.flatMap(g => g.features);
            else cachedFeatures = geojson.features;
            console.log(`Shapefile loaded. Total features: ${cachedFeatures?.length}`);
        }
        
        if (!cachedFeatures) return [];

        // MOIS Code (10 digits) vs SGIS Code (8 digits) mismatch handling
        // We match by SIDO Code (first 2 digits) AND Dong Name.
        const moisCode = zone.adminCode || "";
        const sidoCode = moisCode.substring(0, 2); // e.g., '11' for Seoul
        
        // Extract Dong Name from full address (e.g., "Seoul Gangnam-gu Samsung 1-dong")
        const nameParts = zone.mainTrarNm.split(" ");
        const dongName = nameParts.length >= 1 ? nameParts[nameParts.length - 1] : "";

        // Debug Log
        console.log(`Searching for Polygon: SidoCode=${sidoCode}, DongName=${dongName}`);

        // Find Feature
        let feature = cachedFeatures.find((f: any) => {
            const props = f.properties || {};
            // Sido Check: SGIS Code usually starts with Sido Code
            const fileCode = String(props.ADM_DR_CD || props.adm_dr_cd || "").trim();
            if (fileCode.length >= 2 && !fileCode.startsWith(sidoCode)) return false;

            // Name Check
            const fileName = String(props.ADM_DR_NM || props.adm_dr_nm || "").trim();
            return fileName === dongName;
        });

        // Fuzzy fallback (ignore spaces)
        if (!feature) {
            feature = cachedFeatures.find((f: any) => {
                const props = f.properties || {};
                const fileCode = String(props.ADM_DR_CD || props.adm_dr_cd || "").trim();
                if (fileCode.length >= 2 && !fileCode.startsWith(sidoCode)) return false;
                
                const fileName = String(props.ADM_DR_NM || props.adm_dr_nm || "").trim();
                return fileName.replace(/\s/g, "") === dongName.replace(/\s/g, "");
            });
        }
        
        if (!feature) {
             console.warn(`Polygon NOT found for: ${dongName} (Sido: ${sidoCode})`);
             return [];
        }

        console.log(`Polygon FOUND for: ${dongName}`);

        // Process Geometry & Reproject
        let coords: any[] = [];
        if (feature.geometry.type === "Polygon") coords = feature.geometry.coordinates;
        else if (feature.geometry.type === "MultiPolygon") coords = feature.geometry.coordinates[0];

        if (coords.length > 0) {
            // Check coordinate system
            const testPoint = coords[0][0]; 
            const x = testPoint[0];
            const y = testPoint[1];
            let needsProj = false;
            let srcProj = PROJ_5179; // Default Modern

            // Heuristic: If x > 180, it's projected (not lat/lon)
            if (x > 180) {
                needsProj = true;
                // Heuristic: 5179 (x ~ 1,000,000) vs 5174 (x ~ 200,000)
                if (x < 600000) srcProj = PROJ_5174;
            }

            return coords.map((ring: number[][]) => 
                ring.map((c: number[]) => {
                    let [px, py] = c;
                    if (needsProj && typeof proj4 !== 'undefined') {
                        // proj4 returns [lon, lat], Leaflet needs [lat, lon]
                        const [lon, lat] = proj4(srcProj, 'EPSG:4326', [px, py]);
                        return [lat, lon];
                    }
                    // If already lat/lon, GeoJSON is [lon, lat] -> Leaflet [lat, lon]
                    return [c[1], c[0]];
                })
            );
        }
    } catch (e) {
        console.warn("Failed to load/parse local shapefile:", e);
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
