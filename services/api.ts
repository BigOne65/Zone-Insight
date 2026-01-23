import { Zone, Store } from '../types';

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
// [변경] V-World URL을 상수로 분리했습니다.
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
        // [변경] 분리한 상수(VWORLD_BASE_URL)를 사용하도록 수정
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

// Data.go.kr Zone Search
export const searchZones = async (lat: number, lon: number): Promise<Zone[]> => {
    if (!DATA_API_KEY) throw new Error("Data.go.kr API Key가 설정되지 않았습니다.");

    const SEARCH_RADIUS = 500;
    const zoneUrl = `${BASE_URL}/storeZoneInRadius?radius=${SEARCH_RADIUS}&cx=${lon}&cy=${lat}&serviceKey=${DATA_API_KEY}&type=json`;
    
    const zoneText = await fetchWithRetry(zoneUrl);
    let zones: Zone[] = [];

    try {
        const zoneJson = JSON.parse(zoneText);
        if (zoneJson.body && zoneJson.body.items) {
            zones = zoneJson.body.items;
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
                stdrDt: items[i].getElementsByTagName("stdrDt")[0]?.textContent || ""
            });
        }
    }

    if (zones.length === 0) throw new Error("주변 상권 정보가 없습니다.");
    return zones;
};

// Data.go.kr Store List
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
        
        // Extract Reference Date from header
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
        console.warn("JSON Parse failed for stores, might use XML fallback in production");
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
            await new Promise(r => setTimeout(r, 100)); // Rate limit safety
        }
    }

    return { stores: allStores, stdrYm };
};