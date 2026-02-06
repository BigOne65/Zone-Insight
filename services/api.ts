import { Zone, Store, SbizStats, SeoulSalesData } from '../types';

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
const SEOUL_DATA_KEY = getEnvVar("VITE_SEOUL_DATA_KEY");

// API Endpoints
const BASE_URL = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const VWORLD_BASE_URL = "https://api.vworld.kr/req/search";
// Update Base URL to mods.go.kr
const SGIS_BASE_URL = "https://sgisapi.mods.go.kr/OpenAPI3";
const SEOUL_BASE_URL = "http://openapi.seoul.go.kr:8088";

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

// Proxy list optimized for speed and reliability
// api.allorigins.win uses Cloudflare (Anycast), so it usually finds the fastest route (e.g. ICN node).
const PROXY_LIST = [
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// Track the index of the currently working proxy to avoid retrying failed ones repeatedly
let currentProxyIndex = 0;

const fetchWithRetry = async (targetUrl: string): Promise<string> => {
    let lastError;
    
    // Try up to the number of available proxies
    for (let i = 0; i < PROXY_LIST.length; i++) {
        // Calculate index starting from the current preferred proxy
        const idx = (currentProxyIndex + i) % PROXY_LIST.length;
        
        try {
            const response = await fetch(PROXY_LIST[idx](targetUrl));
            if (!response.ok) throw new Error(`HTTP status ${response.status}`);
            
            // If successful, update the preferred proxy index to this one
            currentProxyIndex = idx;
            return await response.text();
        } catch (e) {
            console.warn(`Proxy ${idx + 1} failed:`, e);
            lastError = e;
            // Continue to next proxy
        }
    }
    throw new Error(`모든 프록시 서버 연결 실패: ${lastError}`);
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
    const PAGE_SIZE = 500;
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
        // Parallel fetching in batches to speed up loading
        const BATCH_SIZE = 6;
        let consecutiveErrors = 0;

        for (let i = 2; i <= totalPages; i += BATCH_SIZE) {
            const endPage = Math.min(i + BATCH_SIZE - 1, totalPages);
            onProgress(`${i}~${endPage} / ${totalPages} 페이지 데이터 고속 수집 중... (병렬 연결)`);

            const promises = [];
            for (let page = i; page <= endPage; page++) {
                const nextUrl = `${BASE_URL}/storeListInArea?key=${zoneNo}&numOfRows=${PAGE_SIZE}&pageNo=${page}&serviceKey=${serviceKey}&type=json`;
                promises.push(
                    fetchWithRetry(nextUrl)
                        .then(text => {
                            if (text.trim().startsWith('<')) return null;
                            const json = JSON.parse(text);
                            return json.body?.items || json.response?.body?.items;
                        })
                        .then(items => {
                            if (items) return Array.isArray(items) ? items : [items];
                            return null;
                        })
                        .catch(() => null)
                );
            }

            const results = await Promise.all(promises);
            const validResults = results.filter(r => r !== null);

            if (validResults.length === 0) {
                consecutiveErrors++;
            } else {
                consecutiveErrors = 0;
                validResults.forEach(items => {
                    allStores = [...allStores, ...items];
                });
            }
            
            if (consecutiveErrors >= 2) {
                console.warn("연속된 API 호출 실패로 추가 데이터 수집을 중단합니다.");
                break;
            }
            await new Promise(r => setTimeout(r, 50));
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

export const fetchLocalAdminPolygon = async (zone: Zone): Promise<number[][][]> => {
    if (polygonCache.has(zone.mainTrarNm)) {
        console.log(`[SGIS] 캐시된 경계 데이터 사용: ${zone.mainTrarNm}`);
        return polygonCache.get(zone.mainTrarNm)!;
    }

    try {
        console.log(`[SGIS] 행정구역 경계 데이터 요청: ${zone.mainTrarNm}`);
        const token = await getSgisToken();
        
        const geoUrl = `${SGIS_BASE_URL}/addr/geocode.json?accessToken=${token}&address=${encodeURIComponent(zone.mainTrarNm)}`;
        
        let geoResStr = await fetchWithRetry(geoUrl);
        const geoData = JSON.parse(geoResStr);
        
        let admCd = "";
        if (geoData.errCd === 0 && geoData.result?.resultdata?.length > 0) {
            admCd = geoData.result.resultdata[0].adm_cd;
        } else {
            console.warn(`[SGIS] 주소 검색 실패: ${zone.mainTrarNm}`);
            return [];
        }

        // SGIS API requires 'year' parameter (2000~2025)
        // Automatically use current year (e.g. 2025)
        const currentYear = new Date().getFullYear().toString();
        let boundUrl = `${SGIS_BASE_URL}/boundary/hadmarea.geojson?accessToken=${token}&adm_cd=${admCd}&year=${currentYear}&low_search=0`;
        
        let boundResStr = await fetchWithRetry(boundUrl);
        let boundData = JSON.parse(boundResStr);

        // Fallback: If current year data is missing, try previous year
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
    const PAGE_SIZE = 500;
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
        // Parallel fetching for speed
        const BATCH_SIZE = 6;
        let consecutiveErrors = 0;

        for (let i = 2; i <= totalPages; i += BATCH_SIZE) {
            const endPage = Math.min(i + BATCH_SIZE - 1, totalPages);
            onProgress(`${i}~${endPage} / ${totalPages} 페이지 데이터 고속 수집 중... (병렬 연결)`);

            const promises = [];
            for (let page = i; page <= endPage; page++) {
                const nextUrl = `${BASE_URL}/storeListInDong?divId=${divId}&key=${adminCode}&numOfRows=${PAGE_SIZE}&pageNo=${page}&serviceKey=${serviceKey}&type=json`;
                promises.push(
                    fetchWithRetry(nextUrl)
                        .then(text => {
                             if (text.trim().startsWith('<')) return null;
                             const json = JSON.parse(text);
                             return json.body?.items || json.response?.body?.items;
                        })
                        .then(items => {
                             if(items) return Array.isArray(items) ? items : [items];
                             return null;
                        })
                        .catch(() => null)
                );
            }

            const results = await Promise.all(promises);
            const validResults = results.filter(r => r !== null);

            if (validResults.length === 0) {
                consecutiveErrors++;
            } else {
                consecutiveErrors = 0;
                validResults.forEach(items => {
                    allStores = [...allStores, ...items];
                });
            }
            
            if (consecutiveErrors >= 2) {
                console.warn("연속된 API 호출 실패로 추가 데이터 수집을 중단합니다.");
                break;
            }
            await new Promise(r => setTimeout(r, 50));
        }
    }
    return { stores: allStores, stdrYm };
};

export const fetchSbizData = async (dongCd: string): Promise<SbizStats> => {
    const SBIZ_BASE_URL = "https://bigdata.sbiz.or.kr/sbiz/api/bizonSttus";
    const endpoints = {
        maxSales: `${SBIZ_BASE_URL}/MaxSlsBiz/search.json?dongCd=${dongCd}`,
        delivery: `${SBIZ_BASE_URL}/DlvyDay/search.json?dongCd=${dongCd}`,
        ageRank: `${SBIZ_BASE_URL}/VstAgeRnk/search.json?dongCd=${dongCd}`,
        population: `${SBIZ_BASE_URL}/cfrDynppl/search.json?dongCd=${dongCd}`
    };

    try {
        const [maxSalesRes, deliveryRes, ageRankRes, populationRes] = await Promise.all([
            fetchWithRetry(endpoints.maxSales).then(t => JSON.parse(t)).catch(() => null),
            fetchWithRetry(endpoints.delivery).then(t => JSON.parse(t)).catch(() => null),
            fetchWithRetry(endpoints.ageRank).then(t => JSON.parse(t)).catch(() => null),
            fetchWithRetry(endpoints.population).then(t => JSON.parse(t)).catch(() => null)
        ]);

        const formatAge = (ageCode: string) => {
             // M60 -> 60대, M40 -> 40대...
             if(!ageCode) return "정보없음";
             const ageNum = ageCode.replace(/[^0-9]/g, '');
             return ageNum ? `${ageNum}대` : ageCode;
        };

        const result: SbizStats = {
            population: null,
            maxSales: null,
            delivery: null,
            ageRank: null
        };

        // 1. 유동인구 (cfrDynppl)
        if (populationRes && populationRes.data) {
            result.population = {
                total: parseInt(populationRes.data.ppltn || "0").toLocaleString(),
                date: populationRes.data.crtrYm
            };
        }

        // 2. 최대 매출 업종 (MaxSlsBiz)
        if (maxSalesRes && maxSalesRes.data) {
            result.maxSales = {
                type: maxSalesRes.data.tpbizClscdNm,
                amount: maxSalesRes.data.mmTotSlsAmt, // 단위: 만원
                percent: maxSalesRes.data.mmTotSlsAmtPercent,
                date: maxSalesRes.data.crtrYm
            };
        }

        // 3. 배달 (DlvyDay)
        if (deliveryRes && deliveryRes.data) {
            result.delivery = {
                day: deliveryRes.data.days,
                count: deliveryRes.data.totAmt,
                percent: deliveryRes.data.percent,
                date: deliveryRes.data.crtrYm
            };
        }

        // 4. 방문 연령 (VstAgeRnk) - Sort to find Rank 1~5
        if (ageRankRes && Array.isArray(ageRankRes.data)) {
            const sorted = [...ageRankRes.data].sort((a: any, b: any) => b.pipcnt - a.pipcnt);
            result.ageRank = sorted.slice(0, 5).map(item => ({
                age: formatAge(item.age),
                count: item.pipcnt
            }));
        }

        return result;

    } catch (e) {
        console.warn("Sbiz Data Fetch Error:", e);
        return { population: null, maxSales: null, delivery: null, ageRank: null };
    }
};

/**
 * 서울 열린데이터 광장 (행정동별 추정매출) 데이터 조회
 */
export const fetchSeoulSalesData = async (adminCode: string): Promise<SeoulSalesData | null> => {
    if (!SEOUL_DATA_KEY || SEOUL_DATA_KEY.startsWith("YOUR")) {
        console.warn("서울 데이터 API 키가 없습니다.");
        return null;
    }

    // 서울시 코드는 10자리 행정동 코드(11xxxxxxx)를 사용하지만, API 호출 시 확인 필요.
    // VwsmAdstrdSelngW 서비스 호출
    
    // 최근 분기 추정 (현재 날짜 기준)
    const now = new Date();
    const currentYear = now.getFullYear();

    // 20254(미래)부터 과거 2년치(8분기)를 후보군으로 설정하여 데이터가 있는 가장 최근 분기 검색
    // 사용자가 '20254' 등 미래 날짜를 원할 경우를 대비해 올해 4분기부터 시작
    const targetQuarters = [];
    for(let y = currentYear; y >= currentYear - 1; y--) {
        for(let q = 4; q >= 1; q--) {
            targetQuarters.push(`${y}${q}`);
        }
    }

    const serviceName = "VwsmAdstrdSelngW";
    
    // Aggregate result holder
    let aggregatedData: SeoulSalesData | null = null;

    for (const q of targetQuarters) {
        // Format: KEY/json/Service/Start/End/YearQuarter/AdminCode
        const url = `${SEOUL_BASE_URL}/${SEOUL_DATA_KEY}/json/${serviceName}/1/1000/${q}/${adminCode}`;
        
        try {
            const jsonText = await fetchWithRetry(url);
            
            // Error handling for Seoul API
            // Usually returns JSON like { VwsmAdstrdSelngW: { row: [...] } } or { RESULT: { CODE: ... } }
            // Some error responses are valid JSON, some might be HTML/XML if key is wrong
            
            let data: any;
            try {
                data = JSON.parse(jsonText);
            } catch (e) {
                console.warn(`Seoul API Parse Error (${q}):`, jsonText);
                continue; 
            }

            if (data.VwsmAdstrdSelngW && data.VwsmAdstrdSelngW.row) {
                const rows = data.VwsmAdstrdSelngW.row;
                if (rows.length > 0) {
                    // Initialize Aggregation
                    aggregatedData = {
                        stdrYearQuarter: q,
                        totalAmount: 0,
                        totalCount: 0,
                        weekdayAmount: 0, weekendAmount: 0,
                        weekdayCount: 0, weekendCount: 0,
                        dayAmount: { MON: 0, TUE: 0, WED: 0, THU: 0, FRI: 0, SAT: 0, SUN: 0 },
                        dayCount: { MON: 0, TUE: 0, WED: 0, THU: 0, FRI: 0, SAT: 0, SUN: 0 },
                        timeAmount: { "00_06": 0, "06_11": 0, "11_14": 0, "14_17": 0, "17_21": 0, "21_24": 0 },
                        timeCount: { "00_06": 0, "06_11": 0, "11_14": 0, "14_17": 0, "17_21": 0, "21_24": 0 },
                        genderAmount: { male: 0, female: 0 },
                        genderCount: { male: 0, female: 0 },
                        ageAmount: { "10": 0, "20": 0, "30": 0, "40": 0, "50": 0, "60": 0 },
                        ageCount: { "10": 0, "20": 0, "30": 0, "40": 0, "50": 0, "60": 0 }
                    };

                    rows.forEach((row: any) => {
                        // Amount & Count
                        aggregatedData!.totalAmount += row.TH_MON_SELNG_AMT + row.TH_TUE_SELNG_AMT + row.TH_WED_SELNG_AMT + row.TH_THU_SELNG_AMT + row.TH_FRI_SELNG_AMT + row.TH_SAT_SELNG_AMT + row.TH_SUN_SELNG_AMT;
                        aggregatedData!.totalCount += row.TH_MON_SELNG_CO + row.TH_TUE_SELNG_CO + row.TH_WED_SELNG_CO + row.TH_THU_SELNG_CO + row.TH_FRI_SELNG_CO + row.TH_SAT_SELNG_CO + row.TH_SUN_SELNG_CO;

                        // Weekday vs Weekend
                        aggregatedData!.weekdayAmount += row.TH_MON_SELNG_AMT + row.TH_TUE_SELNG_AMT + row.TH_WED_SELNG_AMT + row.TH_THU_SELNG_AMT + row.TH_FRI_SELNG_AMT;
                        aggregatedData!.weekendAmount += row.TH_SAT_SELNG_AMT + row.TH_SUN_SELNG_AMT;
                        
                        aggregatedData!.weekdayCount += row.TH_MON_SELNG_CO + row.TH_TUE_SELNG_CO + row.TH_WED_SELNG_CO + row.TH_THU_SELNG_CO + row.TH_FRI_SELNG_CO;
                        aggregatedData!.weekendCount += row.TH_SAT_SELNG_CO + row.TH_SUN_SELNG_CO;

                        // Day of Week
                        aggregatedData!.dayAmount.MON += row.TH_MON_SELNG_AMT;
                        aggregatedData!.dayAmount.TUE += row.TH_TUE_SELNG_AMT;
                        aggregatedData!.dayAmount.WED += row.TH_WED_SELNG_AMT;
                        aggregatedData!.dayAmount.THU += row.TH_THU_SELNG_AMT;
                        aggregatedData!.dayAmount.FRI += row.TH_FRI_SELNG_AMT;
                        aggregatedData!.dayAmount.SAT += row.TH_SAT_SELNG_AMT;
                        aggregatedData!.dayAmount.SUN += row.TH_SUN_SELNG_AMT;

                        aggregatedData!.dayCount.MON += row.TH_MON_SELNG_CO;
                        aggregatedData!.dayCount.TUE += row.TH_TUE_SELNG_CO;
                        aggregatedData!.dayCount.WED += row.TH_WED_SELNG_CO;
                        aggregatedData!.dayCount.THU += row.TH_THU_SELNG_CO;
                        aggregatedData!.dayCount.FRI += row.TH_FRI_SELNG_CO;
                        aggregatedData!.dayCount.SAT += row.TH_SAT_SELNG_CO;
                        aggregatedData!.dayCount.SUN += row.TH_SUN_SELNG_CO;

                        // Time Slot
                        aggregatedData!.timeAmount["00_06"] += row.TMZN_00_06_SELNG_AMT;
                        aggregatedData!.timeAmount["06_11"] += row.TMZN_06_11_SELNG_AMT;
                        aggregatedData!.timeAmount["11_14"] += row.TMZN_11_14_SELNG_AMT;
                        aggregatedData!.timeAmount["14_17"] += row.TMZN_14_17_SELNG_AMT;
                        aggregatedData!.timeAmount["17_21"] += row.TMZN_17_21_SELNG_AMT;
                        aggregatedData!.timeAmount["21_24"] += row.TMZN_21_24_SELNG_AMT;

                        aggregatedData!.timeCount["00_06"] += row.TMZN_00_06_SELNG_CO;
                        aggregatedData!.timeCount["06_11"] += row.TMZN_06_11_SELNG_CO;
                        aggregatedData!.timeCount["11_14"] += row.TMZN_11_14_SELNG_CO;
                        aggregatedData!.timeCount["14_17"] += row.TMZN_14_17_SELNG_CO;
                        aggregatedData!.timeCount["17_21"] += row.TMZN_17_21_SELNG_CO;
                        aggregatedData!.timeCount["21_24"] += row.TMZN_21_24_SELNG_CO;

                        // Gender
                        aggregatedData!.genderAmount.male += row.ML_SELNG_AMT;
                        aggregatedData!.genderAmount.female += row.FML_SELNG_AMT;
                        aggregatedData!.genderCount.male += row.ML_SELNG_CO;
                        aggregatedData!.genderCount.female += row.FML_SELNG_CO;

                        // Age
                        aggregatedData!.ageAmount["10"] += row.AGRDE_10_SELNG_AMT;
                        aggregatedData!.ageAmount["20"] += row.AGRDE_20_SELNG_AMT;
                        aggregatedData!.ageAmount["30"] += row.AGRDE_30_SELNG_AMT;
                        aggregatedData!.ageAmount["40"] += row.AGRDE_40_SELNG_AMT;
                        aggregatedData!.ageAmount["50"] += row.AGRDE_50_SELNG_AMT;
                        aggregatedData!.ageAmount["60"] += row.AGRDE_60_ABOVE_SELNG_AMT;

                        aggregatedData!.ageCount["10"] += row.AGRDE_10_SELNG_CO;
                        aggregatedData!.ageCount["20"] += row.AGRDE_20_SELNG_CO;
                        aggregatedData!.ageCount["30"] += row.AGRDE_30_SELNG_CO;
                        aggregatedData!.ageCount["40"] += row.AGRDE_40_SELNG_CO;
                        aggregatedData!.ageCount["50"] += row.AGRDE_50_SELNG_CO;
                        aggregatedData!.ageCount["60"] += row.AGRDE_60_ABOVE_SELNG_CO;
                    });
                    
                    // Break after successful fetch and aggregation
                    break;
                }
            }
        } catch (e) {
            console.warn(`Seoul API Network/Retry Error (${q}):`, e);
        }
    }

    return aggregatedData;
};

/**
 * 좌표(위경도)를 행정동 코드로 변환 (Reverse Geocoding)
 * V-World API 사용
 */
export const getAdminCodeFromCoords = async (lat: number, lon: number): Promise<string | null> => {
    if (!VWORLD_KEY || VWORLD_KEY.startsWith("YOUR")) return null;
    
    // Using V-World Reverse Geocoding via JSONP
    const url = `https://api.vworld.kr/req/address?service=address&request=getAddress&version=2.0&crs=EPSG:4326&point=${lon},${lat}&format=json&type=PARCEL&zipcode=false&simple=false&key=${VWORLD_KEY}`;
    
    try {
        const data = await fetchJsonp(url);
        if (data.response && data.response.status === "OK") {
            const result = data.response.result;
            if (result && result.length > 0) {
                 const structure = result[0].structure;
                 if (structure && structure.level4AC) {
                     return structure.level4AC;
                 }
            }
        }
    } catch (e) {
        console.warn("Reverse Geocoding failed:", e);
    }
    return null;
};
