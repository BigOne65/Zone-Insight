import { Zone, Store, SbizStats, SeoulSalesData } from '../types';

// Declare proj4 global
declare const proj4: any;

// Define Coordinate Systems
const PROJ_WGS84 = 'EPSG:4326';
// SGIS uses UTM-K (GRS80)
const PROJ_5179 = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

/**
 * 환경 변수 로드 헬퍼
 */
const getEnvVar = (key: string): string => {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
        // @ts-ignore
        return import.meta.env[key] || "";
    }
    return "";
};

// Load Keys from Environment
const DATA_API_KEY = getEnvVar("VITE_DATA_API_KEY");
const VWORLD_KEY = getEnvVar("VITE_VWORLD_KEY");
const SGIS_ID = getEnvVar("VITE_SGIS_SERVICE_ID");
const SGIS_SECRET = getEnvVar("VITE_SGIS_SECRET_KEY");

// API Endpoints (Using Local Proxy via vite.config.ts or vercel.json)
// V-World supports JSONP/CORS natively, so we keep it direct.
const VWORLD_BASE_URL = "https://api.vworld.kr/req/search";

// Proxied Endpoints
const BASE_URL = "/api/public";
const SGIS_BASE_URL = "/api/sgis";
const SBIZ_BASE_URL_PROXY = "/api/sbiz";

// --- Cache ---
const polygonCache = new Map<string, number[][][]>();

// --- Helpers ---

const getFormattedKey = (key: string) => {
    if (!key) return "";
    return key.includes('%') ? key : encodeURIComponent(key);
};

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

/**
 * Standard Fetch Wrapper
 * No longer requires external proxies. Vercel/Vite handles CORS.
 */
const fetchStandard = async (url: string): Promise<string> => {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            // Check if it's a 403/500 from the target API
            throw new Error(`HTTP status ${response.status}`);
        }
        return await response.text();
    } catch (e: any) {
        console.warn(`Fetch failed for ${url}:`, e);
        throw new Error(`데이터 요청 실패: ${e.message}`);
    }
};

// --- SGIS Helpers ---

let sgisAccessToken: string | null = null;
let tokenExpiry: number = 0;

const getSgisToken = async (): Promise<string> => {
    if (sgisAccessToken && Date.now() < tokenExpiry - 300000) {
        return sgisAccessToken;
    }

    if (!SGIS_ID || !SGIS_SECRET) {
        throw new Error("SGIS API 키가 설정되지 않았습니다.");
    }

    const url = `${SGIS_BASE_URL}/auth/authentication.json?consumer_key=${SGIS_ID}&consumer_secret=${SGIS_SECRET}`;
    
    let responseText;
    try {
        responseText = await fetchStandard(url);
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
    if (!VWORLD_KEY) throw new Error("V-World API Key가 누락되었습니다.");
    let errorDetails: string[] = [];
    
    // V-World uses JSONP, so it doesn't need proxy
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
    
    throw new Error(`검색 결과가 없습니다.`);
};

export const searchZones = async (lat: number, lon: number): Promise<Zone[]> => {
    if (!DATA_API_KEY) throw new Error("공공데이터 API Key가 누락되었습니다.");
    const SEARCH_RADIUS = 500;
    
    const serviceKey = getFormattedKey(DATA_API_KEY);
    const zoneUrl = `${BASE_URL}/storeZoneInRadius?radius=${SEARCH_RADIUS}&cx=${lon}&cy=${lat}&serviceKey=${serviceKey}&type=json`;
    
    const zoneText = await fetchStandard(zoneUrl);
    
    if (zoneText.trim().startsWith('<')) {
        throw new Error(parseXmlError(zoneText));
    }

    let zones: Zone[] = [];
    try {
        const zoneJson = JSON.parse(zoneText);
        if (zoneJson.body && zoneJson.body.items) {
            zones = Array.isArray(zoneJson.body.items) ? zoneJson.body.items : [zoneJson.body.items];
            zones = zones.map((item: any) => ({ ...item, type: 'trade' }));
        }
    } catch (e) {
        throw new Error("상권 데이터 파싱 실패");
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
    
    const firstText = await fetchStandard(firstUrl);
    
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
        const BATCH_SIZE = 3;
        let consecutiveErrors = 0;

        for (let i = 2; i <= totalPages; i += BATCH_SIZE) {
            const endPage = Math.min(i + BATCH_SIZE - 1, totalPages);
            onProgress(`${i}~${endPage} / ${totalPages} 페이지 데이터 수집 중...`);

            const promises = [];
            for (let page = i; page <= endPage; page++) {
                const nextUrl = `${BASE_URL}/storeListInArea?key=${zoneNo}&numOfRows=${PAGE_SIZE}&pageNo=${page}&serviceKey=${serviceKey}&type=json`;
                promises.push(
                    fetchStandard(nextUrl)
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
            
            if (consecutiveErrors >= 2) break;
            await new Promise(r => setTimeout(r, 50));
        }
    }
    return { stores: allStores, stdrYm };
};

const fetchBaroApi = async (resId: string, catId: string, extraParams: string = "") => {
    const serviceKey = getFormattedKey(DATA_API_KEY);
    const url = `${BASE_URL}/baroApi?resId=${resId}&catId=${catId}&type=json&serviceKey=${serviceKey}${extraParams}`;
    const text = await fetchStandard(url);
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
    
    if (!sido) throw new Error("시/도 정보를 찾을 수 없습니다.");

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
        throw new Error("시군구 단위까지 정보가 필요합니다.");
    }

    if (adminZones.length === 0) throw new Error("해당 조건에 맞는 행정동을 찾을 수 없습니다.");
    return adminZones;
};

export const fetchLocalAdminPolygon = async (zone: Zone): Promise<number[][][]> => {
    if (polygonCache.has(zone.mainTrarNm)) {
        return polygonCache.get(zone.mainTrarNm)!;
    }

    try {
        const token = await getSgisToken();
        
        const geoUrl = `${SGIS_BASE_URL}/addr/geocode.json?accessToken=${token}&address=${encodeURIComponent(zone.mainTrarNm)}`;
        
        let geoResStr = await fetchStandard(geoUrl);
        const geoData = JSON.parse(geoResStr);
        
        let admCd = "";
        if (geoData.errCd === 0 && geoData.result?.resultdata?.length > 0) {
            admCd = geoData.result.resultdata[0].adm_cd;
        } else {
            return [];
        }

        const currentYear = new Date().getFullYear().toString();
        let boundUrl = `${SGIS_BASE_URL}/boundary/hadmarea.geojson?accessToken=${token}&adm_cd=${admCd}&year=${currentYear}&low_search=0`;
        
        let boundResStr = await fetchStandard(boundUrl);
        let boundData = JSON.parse(boundResStr);

        if (!boundData.features || boundData.features.length === 0) {
             const prevYear = (new Date().getFullYear() - 1).toString();
             boundUrl = `${SGIS_BASE_URL}/boundary/hadmarea.geojson?accessToken=${token}&adm_cd=${admCd}&year=${prevYear}&low_search=0`;
             boundResStr = await fetchStandard(boundUrl);
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
        console.warn(`[SGIS] Error: ${e.message}`);
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
    
    const firstText = await fetchStandard(firstUrl);
    
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
        const BATCH_SIZE = 3;
        let consecutiveErrors = 0;

        for (let i = 2; i <= totalPages; i += BATCH_SIZE) {
            const endPage = Math.min(i + BATCH_SIZE - 1, totalPages);
            onProgress(`${i}~${endPage} / ${totalPages} 페이지 데이터 수집 중...`);

            const promises = [];
            for (let page = i; page <= endPage; page++) {
                const nextUrl = `${BASE_URL}/storeListInDong?divId=${divId}&key=${adminCode}&numOfRows=${PAGE_SIZE}&pageNo=${page}&serviceKey=${serviceKey}&type=json`;
                promises.push(
                    fetchStandard(nextUrl)
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
            
            if (consecutiveErrors >= 2) break;
            await new Promise(r => setTimeout(r, 50));
        }
    }
    return { stores: allStores, stdrYm };
};

export const fetchSbizData = async (dongCd: string): Promise<SbizStats> => {
    // Sbiz also proxied
    const endpoints = {
        maxSales: `${SBIZ_BASE_URL_PROXY}/MaxSlsBiz/search.json?dongCd=${dongCd}`,
        delivery: `${SBIZ_BASE_URL_PROXY}/DlvyDay/search.json?dongCd=${dongCd}`,
        ageRank: `${SBIZ_BASE_URL_PROXY}/VstAgeRnk/search.json?dongCd=${dongCd}`,
        population: `${SBIZ_BASE_URL_PROXY}/cfrDynppl/search.json?dongCd=${dongCd}`
    };

    try {
        const [maxSalesRes, deliveryRes, ageRankRes, populationRes] = await Promise.all([
            fetchStandard(endpoints.maxSales).then(t => JSON.parse(t)).catch(() => null),
            fetchStandard(endpoints.delivery).then(t => JSON.parse(t)).catch(() => null),
            fetchStandard(endpoints.ageRank).then(t => JSON.parse(t)).catch(() => null),
            fetchStandard(endpoints.population).then(t => JSON.parse(t)).catch(() => null)
        ]);

        const formatAge = (ageCode: string) => {
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

        if (populationRes && populationRes.data) {
            result.population = {
                total: parseInt(populationRes.data.ppltn || "0").toLocaleString(),
                date: populationRes.data.crtrYm
            };
        }

        if (maxSalesRes && maxSalesRes.data) {
            result.maxSales = {
                type: maxSalesRes.data.tpbizClscdNm,
                amount: maxSalesRes.data.mmTotSlsAmt, 
                percent: maxSalesRes.data.mmTotSlsAmtPercent,
                date: maxSalesRes.data.crtrYm
            };
        }

        if (deliveryRes && deliveryRes.data) {
            result.delivery = {
                day: deliveryRes.data.days,
                count: deliveryRes.data.totAmt,
                percent: deliveryRes.data.percent,
                date: deliveryRes.data.crtrYm
            };
        }

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
 * API 대신 CSV 파일(seoul_sales_202503.csv)을 public 폴더에서 로드하여
 * ADSTRD_CD(행정동 코드)가 일치하는 행만 필터링합니다.
 */
export const fetchSeoulSalesData = async (adminCode: string): Promise<SeoulSalesData | null> => {
    const csvUrl = "/seoul_sales_202503.csv"; // public folder

    const createEmptyData = (quarter: string, serviceName?: string): SeoulSalesData => ({
        stdrYearQuarter: quarter,
        serviceName: serviceName,
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
    });

    try {
        const response = await fetch(csvUrl);
        if (!response.ok) {
            console.warn("CSV File Fetch Failed");
            return null;
        }
        const text = await response.text();
        const lines = text.split(/\r?\n/);
        
        if (lines.length < 2) return null;

        const headers = lines[0].split(',').map(h => h.trim());
        const getIdx = (colName: string) => headers.indexOf(colName);

        // Header Indices
        const ADSTRD_CD = getIdx("ADSTRD_CD");
        const SVC_NM = getIdx("SVC_INDUTY_CD_NM");
        
        // Data structure to return
        // Default Quarter assumed 2025 Q3 since the file name is such
        let aggregatedData = createEmptyData("20253");
        const industryMap: Record<string, SeoulSalesData> = {};

        const getNum = (row: string[], colName: string) => {
             const idx = getIdx(colName);
             if(idx === -1) return 0;
             const val = parseFloat(row[idx]);
             return isNaN(val) ? 0 : val;
        };

        const accumulateRow = (target: SeoulSalesData, row: string[]) => {
            // Totals
            target.totalAmount += getNum(row, "THSMON_SELNG_AMT");
            target.totalCount += getNum(row, "THSMON_SELNG_CO");

            // Weekday/Weekend
            target.weekdayAmount += getNum(row, "MDWK_SELNG_AMT");
            target.weekendAmount += getNum(row, "WKEND_SELNG_AMT");
            target.weekdayCount += getNum(row, "MDWK_SELNG_CO");
            target.weekendCount += getNum(row, "WKEND_SELNG_CO");

            // Days
            target.dayAmount.MON += getNum(row, "MON_SELNG_AMT");
            target.dayAmount.TUE += getNum(row, "TUES_SELNG_AMT");
            target.dayAmount.WED += getNum(row, "WED_SELNG_AMT");
            target.dayAmount.THU += getNum(row, "THUR_SELNG_AMT");
            target.dayAmount.FRI += getNum(row, "FRI_SELNG_AMT");
            target.dayAmount.SAT += getNum(row, "SAT_SELNG_AMT");
            target.dayAmount.SUN += getNum(row, "SUN_SELNG_AMT");

            target.dayCount.MON += getNum(row, "MON_SELNG_CO");
            target.dayCount.TUE += getNum(row, "TUES_SELNG_CO");
            target.dayCount.WED += getNum(row, "WED_SELNG_CO");
            target.dayCount.THU += getNum(row, "THUR_SELNG_CO");
            target.dayCount.FRI += getNum(row, "FRI_SELNG_CO");
            target.dayCount.SAT += getNum(row, "SAT_SELNG_CO");
            target.dayCount.SUN += getNum(row, "SUN_SELNG_CO");

            // Times
            target.timeAmount["00_06"] += getNum(row, "TMZN_00_06_SELNG_AMT");
            target.timeAmount["06_11"] += getNum(row, "TMZN_06_11_SELNG_AMT");
            target.timeAmount["11_14"] += getNum(row, "TMZN_11_14_SELNG_AMT");
            target.timeAmount["14_17"] += getNum(row, "TMZN_14_17_SELNG_AMT");
            target.timeAmount["17_21"] += getNum(row, "TMZN_17_21_SELNG_AMT");
            target.timeAmount["21_24"] += getNum(row, "TMZN_21_24_SELNG_AMT");

            target.timeCount["00_06"] += getNum(row, "TMZN_00_06_SELNG_CO");
            target.timeCount["06_11"] += getNum(row, "TMZN_06_11_SELNG_CO");
            target.timeCount["11_14"] += getNum(row, "TMZN_11_14_SELNG_CO");
            target.timeCount["14_17"] += getNum(row, "TMZN_14_17_SELNG_CO");
            target.timeCount["17_21"] += getNum(row, "TMZN_17_21_SELNG_CO");
            target.timeCount["21_24"] += getNum(row, "TMZN_21_24_SELNG_CO");

            // Gender
            target.genderAmount.male += getNum(row, "ML_SELNG_AMT");
            target.genderAmount.female += getNum(row, "FML_SELNG_AMT");
            target.genderCount.male += getNum(row, "ML_SELNG_CO");
            target.genderCount.female += getNum(row, "FML_SELNG_CO");

            // Age
            target.ageAmount["10"] += getNum(row, "AGRDE_10_SELNG_AMT");
            target.ageAmount["20"] += getNum(row, "AGRDE_20_SELNG_AMT");
            target.ageAmount["30"] += getNum(row, "AGRDE_30_SELNG_AMT");
            target.ageAmount["40"] += getNum(row, "AGRDE_40_SELNG_AMT");
            target.ageAmount["50"] += getNum(row, "AGRDE_50_SELNG_AMT");
            target.ageAmount["60"] += getNum(row, "AGRDE_60_ABOVE_SELNG_AMT");

            target.ageCount["10"] += getNum(row, "AGRDE_10_SELNG_CO");
            target.ageCount["20"] += getNum(row, "AGRDE_20_SELNG_CO");
            target.ageCount["30"] += getNum(row, "AGRDE_30_SELNG_CO");
            target.ageCount["40"] += getNum(row, "AGRDE_40_SELNG_CO");
            target.ageCount["50"] += getNum(row, "AGRDE_50_SELNG_CO");
            target.ageCount["60"] += getNum(row, "AGRDE_60_ABOVE_SELNG_CO");
        };
        
        // If ADSTRD_CD column missing, can't filter
        if (ADSTRD_CD === -1) return null;

        let hasData = false;
        
        // Loop lines
        for(let i=1; i<lines.length; i++) {
            const row = lines[i].split(','); // Assuming standard CSV without quoted commas for now
            if (row.length < headers.length) continue;
            
            // CSV ADSTRD_CD might be string, compare with adminCode
            const rowAdminCode = row[ADSTRD_CD];
            
            // Check match
            if (String(rowAdminCode) === String(adminCode)) {
                hasData = true;
                accumulateRow(aggregatedData, row);
                
                // Industry Data
                const svcName = SVC_NM !== -1 ? row[SVC_NM] : "기타";
                if (!industryMap[svcName]) {
                    industryMap[svcName] = createEmptyData("20253", svcName);
                }
                accumulateRow(industryMap[svcName], row);
            }
        }

        if (!hasData) return null;

        // Finalize
        aggregatedData.byIndustry = Object.values(industryMap).sort((a, b) => b.totalAmount - a.totalAmount);
        return aggregatedData;

    } catch (e) {
        console.warn("CSV Process Error:", e);
        return null;
    }
};

export const getAdminCodeFromCoords = async (lat: number, lon: number): Promise<string | null> => {
    if (!VWORLD_KEY) return null;
    
    // V-World Reverse Geocoding uses JSONP, direct call is fine.
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