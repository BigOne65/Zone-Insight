import { Zone, Store } from '../types';

// Declare proj4 global
declare const proj4: any;

// Define Common Korean Coordinate Systems
const PROJ_5179 = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
const PROJ_5174 = "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43";

/**
 * 환경 변수 로드 헬퍼
 * 보안 주의: 클라이언트 사이드 앱이므로 API 키가 네트워크 탭에 노출됩니다.
 * 반드시 V-World 및 공공데이터포털 콘솔에서 API 키의 'Referrer(도메인) 제한'을 설정하여 타 사이트에서의 도용을 방지하세요.
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
const BASE_URL = "http://apis.data.go.kr/B553077/api/open/sdsc2";
const VWORLD_BASE_URL = "https://api.vworld.kr/req/search";

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

// --- API Functions ---

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

export const searchZones = async (lat: number, lon: number): Promise<Zone[]> => {
    if (!DATA_API_KEY) throw new Error("공공데이터포털 API Key가 설정되지 않았습니다.");
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

// --- Shapefile / WFS Helpers ---

let cachedFeatures: any[] | null = null;

const projectPoint = (x: number, y: number): [number, number] => {
    let srcProj = PROJ_5179; 
    if (x < 600000) srcProj = PROJ_5174;
    
    if (typeof proj4 !== 'undefined') {
        const [lon, lat] = proj4(srcProj, 'EPSG:4326', [x, y]);
        return [lat, lon];
    }
    return [y, x];
};

const getDistSq = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    return Math.pow(lat1 - lat2, 2) + Math.pow(lon1 - lon2, 2);
};

// ** New: Fetch from V-World WFS (Solves missing ZIP file issue) **
const fetchPolygonFromVWorld = async (adminCode: string): Promise<number[][][]> => {
    if (!VWORLD_KEY) return [];
    
    // BaroAPI returns 10 digits (e.g. 1168064000), V-World usually expects 8 digits (11680640) for 'lt_c_admdong'.
    const shortCode = adminCode.length >= 8 ? adminCode.substring(0, 8) : adminCode;

    // Filter using XML syntax for WFS
    const query = `<Filter><PropertyIsEqualTo><PropertyName>adm_dr_cd</PropertyName><Literal>${shortCode}</Literal></PropertyIsEqualTo></Filter>`;
    
    const url = `https://api.vworld.kr/req/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=lt_c_admdong&OUTPUT=application/json&SRSNAME=EPSG:4326&KEY=${VWORLD_KEY}&FILTER=${encodeURIComponent(query)}`;

    try {
        console.log(`[WFS Debug] Fetching polygon for code ${shortCode}...`);
        // Use proxy to avoid CORS issues with V-World WFS
        const text = await fetchWithRetry(url);
        
        let json;
        try {
             json = JSON.parse(text);
        } catch (e) {
             console.warn("[WFS Debug] Failed to parse JSON", text.substring(0, 100));
             return [];
        }
        
        if (json.features && json.features.length > 0) {
            console.log(`[WFS Debug] Found ${json.features.length} features.`);
            const geometry = json.features[0].geometry;
            if (geometry.type === 'Polygon') {
                // GeoJSON: [lon, lat] -> Leaflet: [lat, lon]
                return geometry.coordinates.map((ring: any[]) => ring.map((p: number[]) => [p[1], p[0]]));
            } else if (geometry.type === 'MultiPolygon') {
                return geometry.coordinates[0].map((ring: any[]) => ring.map((p: number[]) => [p[1], p[0]]));
            }
        }
    } catch (e) {
        console.warn("V-World WFS failed:", e);
    }
    return [];
}

export const fetchLocalAdminPolygon = async (zone: Zone): Promise<number[][][]> => {
    // 1. Try V-World WFS first (Dynamically fetch data without ZIP)
    if (zone.type === 'admin' && zone.adminCode) {
        const wfsPolygon = await fetchPolygonFromVWorld(zone.adminCode);
        if (wfsPolygon.length > 0) return wfsPolygon;
        console.warn("WFS failed or empty, falling back to local ZIP file...");
    }

    // 2. Fallback to Local ZIP (BND_ADM_DONG_PG_simple.zip)
    try {
        if (!cachedFeatures) {
            // @ts-ignore
            if (typeof window.shp === 'undefined') {
                console.error("shpjs library not loaded");
                return [];
            }
            
            console.log("[Shapefile Debug] Loading local shapefile (BND_ADM_DONG_PG_simple.zip)...");
            
            try {
                // Cache Busting
                const response = await fetch('/BND_ADM_DONG_PG_simple.zip?v=' + new Date().getTime());
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch zip file: ${response.status} ${response.statusText}`);
                }
                
                // Content-Type Check: If we got HTML (e.g. 404 page), stop here
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('text/html')) {
                     console.warn("ZIP file not found (server returned HTML). Polygon data will be unavailable.");
                     return [];
                }

                const arrayBuffer = await response.arrayBuffer();
                
                if (arrayBuffer.byteLength === 0) throw new Error("File is empty.");

                // Magic Number Check (PK = 0x50 0x4B)
                const header = new Uint8Array(arrayBuffer, 0, 2);
                if (header[0] !== 0x50 || header[1] !== 0x4B) {
                    console.warn("File is not a valid ZIP file (Invalid Magic Number). Skip parsing.");
                    return [];
                }

                // @ts-ignore
                const geojson = await window.shp(arrayBuffer);
                
                if (Array.isArray(geojson)) cachedFeatures = geojson.flatMap(g => g.features);
                else cachedFeatures = geojson.features;
                
            } catch (err) {
                console.error("[Shapefile Debug] Error loading ZIP:", err);
                return [];
            }
        }
        
        if (!cachedFeatures) return [];

        const nameParts = zone.mainTrarNm.split(" ");
        const dongName = nameParts.length >= 1 ? nameParts[nameParts.length - 1] : "";
        
        const candidates = cachedFeatures.filter((f: any) => {
            const props = f.properties || {};
            const name = String(props.ADM_DR_NM || props.adm_dr_nm || props.ADM_NM || props.adm_nm || "").trim();
            return name === dongName; 
        });

        let targetFeature = null;

        if (candidates.length === 1) {
            targetFeature = candidates[0];
        } else if (candidates.length > 1) {
            if (zone.searchLat && zone.searchLon) {
                let minDist = Infinity;
                for (const feature of candidates) {
                    let coords = [];
                    if (feature.geometry.type === "Polygon") coords = feature.geometry.coordinates[0];
                    else if (feature.geometry.type === "MultiPolygon") coords = feature.geometry.coordinates[0][0];

                    if (coords.length > 0) {
                        let sumX = 0, sumY = 0, count = 0;
                        for (const p of coords) {
                            sumX += p[0];
                            sumY += p[1];
                            count++;
                        }
                        const avgX = sumX / count;
                        const avgY = sumY / count;
                        let [cLat, cLon] = [avgY, avgX];
                        if (avgX > 180) { 
                             [cLat, cLon] = projectPoint(avgX, avgY);
                        }
                        const dist = getDistSq(cLat, cLon, zone.searchLat, zone.searchLon);
                        if (dist < minDist) {
                            minDist = dist;
                            targetFeature = feature;
                        }
                    }
                }
                // Recalculate or just use the logic result (simplified for stability)
                targetFeature = candidates.find(f => {
                     let coords = [];
                     if (f.geometry.type === "Polygon") coords = f.geometry.coordinates[0];
                     else if (f.geometry.type === "MultiPolygon") coords = f.geometry.coordinates[0][0];
                     
                     if(coords.length > 0) {
                         let sumX = 0, sumY = 0, count = 0;
                         for(const p of coords) { sumX += p[0]; sumY += p[1]; count++; }
                         const avgX = sumX/count; const avgY = sumY/count;
                         let [cLat, cLon] = [avgY, avgX];
                         if(avgX > 180) [cLat, cLon] = projectPoint(avgX, avgY);
                         return Math.abs(getDistSq(cLat, cLon, zone.searchLat!, zone.searchLon!) - minDist) < 0.000001;
                     }
                     return false;
                });
            } else {
                targetFeature = candidates[0];
            }
        }

        if (!targetFeature) return [];

        let coords: any[] = [];
        if (targetFeature.geometry.type === "Polygon") coords = targetFeature.geometry.coordinates;
        else if (targetFeature.geometry.type === "MultiPolygon") coords = targetFeature.geometry.coordinates[0];

        if (coords.length > 0) {
            const testPoint = coords[0][0]; 
            const x = testPoint[0];
            const y = testPoint[1];
            const needsProj = x > 180;

            return coords.map((ring: number[][]) => 
                ring.map((c: number[]) => {
                    const [px, py] = c;
                    if (needsProj) return projectPoint(px, py);
                    return [c[1], c[0]];
                })
            );
        }
    } catch (e) {
        console.warn("Unexpected error in fetchLocalAdminPolygon:", e);
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
