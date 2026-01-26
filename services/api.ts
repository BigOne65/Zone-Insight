import { Zone, Store } from '../types';

// Declare proj4 global
declare const proj4: any;

// Define Common Korean Coordinate Systems
// EPSG:5179 (UTM-K, GRS80) - Most modern government data (Statistics Korea, NGII)
const PROJ_5179 = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
// EPSG:5174 (Bessel, Old) - Old cadastral maps
const PROJ_5174 = "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43";

// 환경 변수 안전하게 가져오기 (Crash 방지)
const getEnvVar = (key: string): string => {
    try {
        // Vite / ES Modules
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            // @ts-ignore
            return import.meta.env[key] || "";
        }
    } catch (e) { }

    try {
        // Webpack / Node
        // @ts-ignore
        if (typeof process !== 'undefined' && process.env) {
            // @ts-ignore
            return process.env[key] || "";
        }
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

// Helper: Proxy fetch for Data.go.kr (CORS workaround)
const fetchWithRetry = async (targetUrl: string): Promise<string> => {
    const proxies = [
        (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];
    for (let i = 0; i < proxies.length; i++) {
        try {
            const proxyUrl = proxies[i](targetUrl);
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error(`HTTP status ${response.status}`);
            return await response.text(); 
        } catch (e) {
            console.warn(`Proxy ${i + 1} failed:`, e);
            if (i === proxies.length - 1) throw e; 
        }
    }
    throw new Error("All proxies failed");
};

// V-World Geocoding
export const searchAddress = async (address: string): Promise<any> => {
    if (!VWORLD_KEY) throw new Error("V-World API Key가 설정되지 않았습니다. .env 파일을 확인하세요.");

    let errorDetails: string[] = [];
    
    const runSearch = async (searchType: string, category?: string) => {
        let baseUrl = `${VWORLD_BASE_URL}?service=search&request=search&version=2.0&crs=EPSG:4326&size=10&page=1&query=${encodeURIComponent(address)}&type=${searchType}&format=json&errorformat=json&key=${VWORLD_KEY}`;
        if (category) baseUrl += `&category=${category}`;
        
        try {
            const data = await fetchJsonp(baseUrl);
            if (data.response.status === "OK" && data.response.result?.items?.length > 0) {
                return data.response.result.items[0];
            } else {
                if (data.response.status !== "NOT_FOUND") {
                    errorDetails.push(`[${searchType}] ${data.response.error?.text || data.response.status}`);
                }
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
    
    const detailMsg = errorDetails.length > 0 ? errorDetails.join(", ") : "결과 없음";
    throw new Error(`검색 실패: ${detailMsg}`);
};

// --- Trade Zone Analysis (Default) ---

export const searchZones = async (lat: number, lon: number): Promise<Zone[]> => {
    if (!DATA_API_KEY) throw new Error("Data.go.kr API Key가 설정되지 않았습니다.");

    const SEARCH_RADIUS = 500;
    const zoneUrl = `${BASE_URL}/storeZoneInRadius?radius=${SEARCH_RADIUS}&cx=${lon}&cy=${lat}&serviceKey=${DATA_API_KEY}&type=json`;
    
    const zoneText = await fetchWithRetry(zoneUrl);
    let zones: Zone[] = [];

    try {
        const zoneJson = JSON.parse(zoneText);
        if (zoneJson.body && zoneJson.body.items) {
            zones = zoneJson.body.items.map((item: any) => ({ ...item, type: 'trade' }));
        }
    } catch (e) {
        // XML Fallback
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
        
        if (listJson.header && listJson.header.stdrYm) stdrYm = String(listJson.header.stdrYm);
        else if (listJson.response && listJson.response.header && listJson.response.header.stdrYm) stdrYm = String(listJson.response.header.stdrYm);

        let items = null;
        if (listJson.body && listJson.body.items) items = listJson.body.items;
        else if (listJson.response && listJson.response.body && listJson.response.body.items) items = listJson.response.body.items;
        
        if (items) {
            allStores = Array.isArray(items) ? items : [items];
            if (listJson.body && listJson.body.totalCount) totalCount = listJson.body.totalCount;
            else if (listJson.response && listJson.response.body && listJson.response.body.totalCount) totalCount = listJson.response.body.totalCount;
            else totalCount = allStores.length;
        }
    } catch (e) {
        console.warn("JSON Parse failed for stores, might use XML fallback");
    }

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    const MAX_PAGES = 10;
    const loopLimit = Math.min(totalPages, MAX_PAGES);

    if (loopLimit > 1) {
        for (let i = 2; i <= loopLimit; i++) {
            const nextUrl = `${BASE_URL}/storeListInArea?key=${zoneNo}&numOfRows=${PAGE_SIZE}&pageNo=${i}&serviceKey=${DATA_API_KEY}&type=json`;
            try {
                const nextText = await fetchWithRetry(nextUrl);
                const nextJson = JSON.parse(nextText);
                if (nextJson.body && nextJson.body.items) {
                    allStores = [...allStores, ...nextJson.body.items];
                }
            } catch (e) {}
            onProgress(`${i} / ${loopLimit} 페이지 수집 중...`);
            await new Promise(r => setTimeout(r, 100));
        }
    }

    return { stores: allStores, stdrYm };
};

// --- Administrative District Analysis (Op #19 baroApi & Op #8 storeListInDong) ---

const fetchBaroApi = async (resId: string, catId: string, extraParams: string = "") => {
    const url = `${BASE_URL}/baroApi?resId=${resId}&catId=${catId}&type=json&serviceKey=${DATA_API_KEY}${extraParams}`;
    const text = await fetchWithRetry(url);
    try {
        const json = JSON.parse(text);
        if (json.body && json.body.items) return Array.isArray(json.body.items) ? json.body.items : [json.body.items];
        if (json.items) return Array.isArray(json.items) ? json.items : [json.items]; // Some formats might differ
        return [];
    } catch (e) {
        return [];
    }
};

export const searchAdminDistrict = async (addressStr: string): Promise<Zone[]> => {
    if (!DATA_API_KEY) throw new Error("API Key Missing");

    // 1. Parse Address
    const parts = addressStr.split(" ");
    const sidoName = parts[0];
    const sigunguName = parts[1];
    const dongName = parts.length > 2 ? parts[2] : "";

    if (!sidoName) throw new Error("주소 형식을 확인할 수 없습니다.");

    // 2. Resolve Sido Code (baroApi)
    const sidos = await fetchBaroApi('dong', 'mega');
    const targetSido = sidos.find((s: any) => s.ctprvnNm.includes(sidoName) || sidoName.includes(s.ctprvnNm));
    
    if (!targetSido) throw new Error(`행정구역(시도)을 찾을 수 없습니다: ${sidoName}`);
    
    let adminZones: Zone[] = [];

    // 3. Resolve Sigungu Code
    if (sigunguName) {
        const sigungus = await fetchBaroApi('dong', 'cty', `&ctprvnCd=${targetSido.ctprvnCd}`);
        const targetSigungu = sigungus.find((s: any) => s.signguNm.includes(sigunguName));
        
        if (targetSigungu) {
            // 4. Fetch All Adongs in this Sigungu
            const dongs = await fetchBaroApi('dong', 'admi', `&signguCd=${targetSigungu.signguCd}`);
            
            // 5. Intelligent Filtering
            let filteredDongs = dongs;
            if (dongName) {
                const matches = dongs.filter((d: any) => d.adongNm.includes(dongName));
                if (matches.length > 0) {
                    filteredDongs = matches;
                }
            }

            // Map to Zone interface
            adminZones = filteredDongs.map((d: any) => ({
                trarNo: d.adongCd, // Use AdongCd as pseudo-trarNo
                mainTrarNm: `${targetSido.ctprvnNm} ${targetSigungu.signguNm} ${d.adongNm}`,
                ctprvnNm: targetSido.ctprvnNm,
                signguNm: targetSigungu.signguNm,
                trarArea: "0",
                coords: "", // No polygon initially
                type: 'admin',
                adminCode: d.adongCd,
                adminLevel: 'adongCd'
            }));
        }
    } else {
        throw new Error("시군구 단위까지 입력해주세요. (예: 서울 강남구)");
    }

    if (adminZones.length === 0) throw new Error("해당 조건에 맞는 행정동을 찾을 수 없습니다.");
    return adminZones;
};

// --- Local Shapefile Loader (Using shpjs) ---
let cachedFeatures: any[] | null = null; // Cache for parsed features

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
            // Fetch from public folder
            // @ts-ignore
            const geojson = await window.shp('/zones.zip');
            
            // shpjs returns either a FeatureCollection or an array of them
            if (Array.isArray(geojson)) {
                 cachedFeatures = geojson.flatMap(g => g.features);
            } else {
                 cachedFeatures = geojson.features;
            }
            console.log("Shapefile loaded. Total features:", cachedFeatures?.length);
        }
        
        if (!cachedFeatures) return [];

        const adminCode = zone.adminCode || "";
        const targetCode8 = adminCode.substring(0, 8);
        
        // Extract Dong Name from mainTrarNm (format: "Sido Sigungu Dong")
        const nameParts = zone.mainTrarNm.split(" ");
        const dongName = nameParts.length >= 3 ? nameParts[nameParts.length - 1] : "";

        // 2. Find feature matching
        let feature = cachedFeatures.find((f: any) => {
            const props = f.properties || {};
            
            // Strategy A: Check Code (if SGIS code matches MOIS prefix - unlikely but possible)
            // Attributes might be lower or upper case
            const fileCode = String(props.ADM_DR_CD || props.adm_dr_cd || props.adm_cd || props.ADM_CD || "").trim();
            if (fileCode && (fileCode === adminCode || fileCode === targetCode8 || fileCode.startsWith(targetCode8))) {
                return true;
            }
            return false;
        });

        // Strategy B: Check Name (Fallback - SGIS codes are different from MOIS codes)
        if (!feature && dongName) {
            // console.log("Code match failed, trying name match for:", dongName);
            feature = cachedFeatures.find((f: any) => {
                const props = f.properties || {};
                const fileName = String(props.ADM_DR_NM || props.adm_dr_nm || "").trim();
                return fileName === dongName;
            });
        }
        
        if (!feature) {
             console.warn(`Feature not found for: ${zone.mainTrarNm} (Code: ${adminCode}, Name: ${dongName})`);
             // Debug log to help user see what properties are available
             if (cachedFeatures.length > 0) {
                 console.log("Sample properties from file:", cachedFeatures[0].properties);
             }
             return [];
        }

        // 3. Process Geometry & Reproject if needed
        let coords: any[] = [];
        if (feature.geometry.type === "Polygon") {
            coords = feature.geometry.coordinates;
        } else if (feature.geometry.type === "MultiPolygon") {
            // Use the largest polygon or the first one
            coords = feature.geometry.coordinates[0];
        }

        if (coords.length > 0) {
            // Check first point to see if projection is needed
            // GeoJSON usually [lon, lat] or [x, y]
            const testPoint = coords[0][0]; 
            const x = testPoint[0];
            const y = testPoint[1];

            let needsProj = false;
            let srcProj = PROJ_5179; // Default assumption for modern Gov data (UTM-K)

            // If coordinates are large (not lat/lon), they need projection
            if (x > 180 || y > 90) {
                needsProj = true;
                // Simple heuristic to distinguish 5179 vs 5174
                // 5179 x_0 is 1,000,000. 5174 x_0 is 200,000.
                if (x < 600000) srcProj = PROJ_5174;
            }

            return coords.map((ring: number[][]) => 
                ring.map((c: number[]) => {
                    let [px, py] = c;
                    
                    if (needsProj && typeof proj4 !== 'undefined') {
                        // proj4(source, dest, point) -> returns [lon, lat]
                        const [lon, lat] = proj4(srcProj, 'EPSG:4326', [px, py]);
                        return [lat, lon]; // Leaflet wants [lat, lon]
                    }
                    
                    // If already lat/lon (WGS84), GeoJSON is [lon, lat], Leaflet needs [lat, lon]
                    return [c[1], c[0]];
                })
            );
        }
    } catch (e) {
        console.warn("Failed to load/parse local shapefile:", e);
    }
    return [];
};

// Op #8 storeListInDong
export const fetchStoresInAdmin = async (adminCode: string, divId: string, onProgress: (msg: string) => void): Promise<{ stores: Store[], stdrYm: string }> => {
    if (!DATA_API_KEY) throw new Error("API Key Missing");

    // divId must be one of: ctprvnCd, signguCd, adongCd
    const PAGE_SIZE = 500;
    let allStores: Store[] = [];
    let totalCount = 0;
    let stdrYm = "";

    const firstUrl = `${BASE_URL}/storeListInDong?divId=${divId}&key=${adminCode}&numOfRows=${PAGE_SIZE}&pageNo=1&serviceKey=${DATA_API_KEY}&type=json`;
    const firstText = await fetchWithRetry(firstUrl);

    try {
        const listJson = JSON.parse(firstText);
        if (listJson.header && listJson.header.stdrYm) stdrYm = String(listJson.header.stdrYm);
        else if (listJson.response && listJson.response.header && listJson.response.header.stdrYm) stdrYm = String(listJson.response.header.stdrYm);

        let items = null;
        if (listJson.body && listJson.body.items) items = listJson.body.items;
        else if (listJson.response && listJson.response.body && listJson.response.body.items) items = listJson.response.body.items;

        if (items) {
            allStores = Array.isArray(items) ? items : [items];
            if (listJson.body && listJson.body.totalCount) totalCount = listJson.body.totalCount;
            else if (listJson.response && listJson.response.body && listJson.response.body.totalCount) totalCount = listJson.response.body.totalCount;
            else totalCount = allStores.length;
        }
    } catch (e) {
        console.warn("JSON Parse failed for admin stores");
    }

    // Pagination (Limit to 5 pages for admin query as data can be huge)
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    const MAX_PAGES = 5; 
    const loopLimit = Math.min(totalPages, MAX_PAGES);

    if (loopLimit > 1) {
        for (let i = 2; i <= loopLimit; i++) {
            const nextUrl = `${BASE_URL}/storeListInDong?divId=${divId}&key=${adminCode}&numOfRows=${PAGE_SIZE}&pageNo=${i}&serviceKey=${DATA_API_KEY}&type=json`;
            try {
                const nextText = await fetchWithRetry(nextUrl);
                const nextJson = JSON.parse(nextText);
                if (nextJson.body && nextJson.body.items) {
                    allStores = [...allStores, ...nextJson.body.items];
                }
            } catch (e) {}
            onProgress(`${i} / ${loopLimit} 페이지 수집 중... (행정구역 데이터)`);
            await new Promise(r => setTimeout(r, 200)); // Safer rate limit
        }
    }

    return { stores: allStores, stdrYm };
};
