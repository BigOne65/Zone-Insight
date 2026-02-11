import React, { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Sector, Legend, CartesianGrid, LabelList } from 'recharts';
import { GoogleGenAI } from "@google/genai"; // Import Google GenAI SDK
import * as Icons from './components/Icons';
import TradeMap from './components/Map';
import GoogleAd from './components/GoogleAd';
import { searchAddress, searchZones, fetchStores, searchAdminDistrict, fetchStoresInAdmin, fetchLocalAdminPolygon, fetchSeoulSalesData, getAdminCodeFromCoords } from './services/api';
import { Zone, Store, StoreStats, SeoulSalesData } from './types';

// Constants
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#d946ef'];
const MAJOR_BRANDS = [
  "스타벅스", "투썸", "이디야", "메가MGC", "컴포즈", "빽다방", "할리스", "폴바셋", "공차",
  "지에스25", "GS25", "CU", "씨유", "세븐일레븐", "이마트24", "다이소", "올리브영", "롯데마트", "이마트",
  "파리바게뜨", "뚜레쥬르", "던킨", "배스킨라빈스", "설빙", "베스킨라빈스", "VIPS", "빕스",
  "맥도날드", "버거킹", "롯데리아", "KFC", "맘스터치", "써브웨이", "교촌", "BHC", "BBQ", "도미노",
  "아웃백", "애슐리", "굽네치킨", "푸라닭", "60계치킨", 
  "피자헛", "파파존스", "피자스쿨", 
  "본죽", "한솥", "한솥도시락", "엽기떡볶이", "이삭토스트", 
  "명륜진사갈비", "채선당", "역전할머니맥주",
  "더벤티", "파스쿠찌", "크리스피크림",
  "홈플러스", "코스트코", "노브랜드", "처갓집양념치킨", "페리카나", "멕시카나", "노랑통닭", "자담치킨", "60계치킨",
  "피자알볼로", "피자스쿨", "반올림피자", "신전떡볶이", "죠스떡볶이", "바르다김선생", "김밥천국", "에그드랍",
  "엔제리너스", "탐앤탐스", "커피빈", "쥬씨", "와플대학", "아마스빈",
  "원할머니보쌈", "놀부부대찌개", "하남돼지집", "새마을식당", "투다리", "역전우동", "홍콩반점", "샐러디",
  "프랭크버거", "신세계백화점", "현대백화점", "롯데백화점", "하이마트"
];

// Utils
const parseWKT = (wkt: string): number[][][] => {
  if (!wkt) return [];
  try {
      const cleanWkt = wkt.replace(/^POLYGON\s*/i, '').trim();
      const rings = cleanWkt.match(/\([^()]+\)/g);
      if (!rings) return [];
      return rings.map(ringStr => {
          const content = ringStr.replace(/[()]/g, '');
          const points = content.split(',');
          return points.map(p => {
              const parts = p.trim().split(/\s+/);
              if (parts.length >= 2) {
                  const lon = parseFloat(parts[0]);
                  const lat = parseFloat(parts[1]);
                  if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
              }
              return null;
          }).filter((c): c is number[] => c !== null);
      });
  } catch (e) {
      return [];
  }
};

const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 10} startAngle={startAngle} endAngle={endAngle} fill={fill} />
    </g>
  );
};

// Formatter for Sales Data
const formatSalesValue = (value: number, mode: 'amount' | 'count') => {
    if (mode === 'count') {
        return value.toLocaleString();
    }
    const eokValue = value / 100000000;
    return eokValue.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

// Custom Legend Component
const CustomLegend = (props: any) => {
  const { payload, selectedIndustry, onSelect } = props;
  const sortedPayload = useMemo(() => {
      if (!payload) return [];
      return [...payload].sort((a: any, b: any) => (b.payload?.value || 0) - (a.payload?.value || 0));
  }, [payload]);

  return (
    <ul className="flex flex-col gap-1 pl-4 text-xs">
      {sortedPayload.map((entry: any, index: number) => {
        const isSelected = selectedIndustry === entry.value;
        const isDimmed = selectedIndustry && !isSelected;
        return (
          <li 
            key={`item-${index}`}
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            style={{ opacity: isDimmed ? 0.3 : 1 }}
            onClick={() => onSelect(entry.value)}
          >
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-gray-600">{entry.value}</span>
          </li>
        );
      })}
    </ul>
  );
};

const App: React.FC = () => {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"input" | "verify_location" | "select_zone" | "result">("input");
  
  const [searchType, setSearchType] = useState<'trade' | 'admin'>('admin'); 
  const [searchCoords, setSearchCoords] = useState<{lat: number, lon: number}>({ lat: 37.5665, lon: 126.9780 });
  const [resolvedAddress, setResolvedAddress] = useState("");
  const [foundZones, setFoundZones] = useState<Zone[]>([]);
  const [tradeZone, setTradeZone] = useState<Zone | null>(null);
  const [previewZone, setPreviewZone] = useState<Zone | null>(null);
  
  const [storeStats, setStoreStats] = useState<StoreStats | null>(null);
  const [seoulSales, setSeoulSales] = useState<SeoulSalesData | null>(null);
  const [selectedSeoulIndustry, setSelectedSeoulIndustry] = useState<string | null>(null);
  
  const [topStores, setTopStores] = useState<Store[]>([]);
  const [allRawStores, setAllRawStores] = useState<Store[]>([]);
  const [dataDate, setDataDate] = useState<string | null>(null);

  // Filters
  const [selectedLarge, setSelectedLarge] = useState<string | null>(null);
  const [selectedMid, setSelectedMid] = useState<string | null>(null);
  const [viewModeLarge, setViewModeLarge] = useState<'chart' | 'table'>('chart');
  const [viewModeMid, setViewModeMid] = useState<'chart' | 'table'>('chart');
  
  // Interactive Map State
  const [selectedBuildingIndex, setSelectedBuildingIndex] = useState<number | null>(null);
  const [detailedAnalysisFilter, setDetailedAnalysisFilter] = useState<string | null>(null);

  // Sales Tab State
  const [salesViewMode, setSalesViewMode] = useState<'amount' | 'count'>('amount');

  // AI Analysis State
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleGeocode = async () => {
    if (!address) { setError("주소를 입력해주세요."); return; }
    setLoading(true); setLoadingMsg("주소 위치를 확인하고 있습니다..."); setError(null);
    try {
      const item = await searchAddress(address);
      const lat = parseFloat(item.point.y);
      const lon = parseFloat(item.point.x);
      setSearchCoords({ lat, lon });
      setResolvedAddress(item.address?.road || item.address?.parcel || item.title);
      setStep('verify_location');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchZones = async () => {
    setLoading(true); setError(null);
    try {
      if (searchType === 'trade') {
          setLoadingMsg("주변 상권 정보를 검색하고 있습니다...");
          const zones = await searchZones(searchCoords.lat, searchCoords.lon);
          const enhancedZones = zones.map(z => ({
            ...z,
            searchLat: searchCoords.lat,
            searchLon: searchCoords.lon,
            parsedPolygon: parseWKT(z.coords),
            type: 'trade' as const
          }));
          setFoundZones(enhancedZones);
      } else {
          setLoadingMsg("해당 주소의 행정구역(동) 정보를 조회하고 있습니다...");
          const addrParts = resolvedAddress.split(" ");
          const dongMatch = resolvedAddress.match(/\(([^)]+)\)$/);
          const explicitDong = dongMatch ? dongMatch[1] : (addrParts.slice(2).join(" ") || "");
          const zones = await searchAdminDistrict(addrParts[0] || "", addrParts[1] || "", explicitDong);
          
          setLoadingMsg("행정구역 경계 데이터(Polygon)를 불러오는 중입니다...");
          const enhancedZones = await Promise.all(zones.map(async (z) => {
              const baseZone = {
                  ...z,
                  searchLat: searchCoords.lat,
                  searchLon: searchCoords.lon,
                  type: 'admin' as const
              };
              try {
                  const polygon = await fetchLocalAdminPolygon(baseZone);
                  return { ...baseZone, parsedPolygon: polygon };
              } catch (e) {
                  return { ...baseZone, parsedPolygon: [] };
              }
          }));
          setFoundZones(enhancedZones);
      }
      setStep('select_zone');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateAiInsight = async (zoneName: string, stats: StoreStats, seoulData: SeoulSalesData | null) => {
    setIsAiLoading(true);
    setAiSummary(null);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        // Prepare Data Context
        const topIndustries = stats.barData.slice(0, 3).map(d => `${d.name}(${d.count}개)`);
        const context = {
            areaName: zoneName,
            franchiseRate: stats.franchiseRate + "%",
            firstFloorRate: stats.totalStores > 0 ? ((stats.floorData[0].value / stats.totalStores) * 100).toFixed(1) + "%" : "0%",
            topCategories: topIndustries.join(", "),
            totalStores: stats.totalStores,
            salesInfo: seoulData ? {
                weekendRatio: (seoulData.weekendAmount / (seoulData.weekdayAmount + seoulData.weekendAmount + 0.1) * 100).toFixed(1) + "%",
                peakTime: Object.entries(seoulData.timeAmount).sort((a,b) => b[1] - a[1])[0][0].replace('_', '~') + "시",
                peakAge: Object.entries(seoulData.ageAmount).sort((a,b) => b[1] - a[1])[0][0] + "대"
            } : "데이터 없음"
        };

        const prompt = `
            당신은 베테랑 상권 분석가입니다. 아래 데이터를 바탕으로 예비 창업자를 위한 **3문장 요약**을 작성해주세요.
            
            [상권 데이터: ${context.areaName}]
            - 업종 분포 Top3: ${context.topCategories}
            - 프랜차이즈 비율: ${context.franchiseRate} (높을수록 발달 상권)
            - 1층 점포 비율: ${context.firstFloorRate} (낮을수록 오피스/빌딩 상권 가능성)
            - (서울시 매출데이터): ${typeof context.salesInfo !== 'string' ? `주말 매출 비중 ${context.salesInfo.weekendRatio}, 피크 시간대 ${context.salesInfo.peakTime}, 주 소비 연령층 ${context.salesInfo.peakAge}` : "없음"}

            **작성 가이드:**
            1. 첫 번째 문장: 데이터를 근거로 상권의 전반적인 성격(예: 오피스 중심, 주거 밀집, 주말 유흥 등)을 규정하세요.
            2. 두 번째 문장: 경쟁 강도나 소비 패턴에서 발견되는 눈에 띄는 특징을 언급하세요.
            3. 세 번째 문장: 이 상권에 적합한 구체적인 창업 전략이나 주의사항을 한 가지 제안하세요.
            
            **주의:**
            - 말투는 전문적이고 정중하게 작성하세요.
            - 마크다운 문법(볼드 등)을 사용하지 말고 순수 텍스트로만 작성하세요.
            - 3문장을 넘기지 마세요.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });

        if (response.text) {
            setAiSummary(response.text);
        }
    } catch (e) {
        console.error("AI Generation Error", e);
        setAiSummary("AI 분석을 불러오는 도중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
        setIsAiLoading(false);
    }
  };

  const handleAnalyzeZone = async (selectedZone: Zone) => {
    setLoading(true); setLoadingMsg("상권 상세 데이터를 분석하고 있습니다..."); setError(null);
    setTradeZone(selectedZone);
    setStep('result');
    setSelectedLarge(null); setSelectedMid(null);
    setSelectedBuildingIndex(null);
    setDetailedAnalysisFilter(null);
    setSeoulSales(null);
    setSelectedSeoulIndustry(null);
    setAiSummary(null); // Reset AI summary

    try {
      let stores: Store[] = [];
      let stdrYm = "";
      let fetchedSeoulSales: SeoulSalesData | null = null;

      if (selectedZone.type === 'admin' && selectedZone.adminCode && selectedZone.adminLevel) {
          const [storeResult, seoulResult] = await Promise.all([
             fetchStoresInAdmin(selectedZone.adminCode, selectedZone.adminLevel, (msg) => setLoadingMsg(msg)),
             selectedZone.adminCode.startsWith('11') ? fetchSeoulSalesData(selectedZone.adminCode) : Promise.resolve(null)
          ]);
          stores = storeResult.stores;
          stdrYm = storeResult.stdrYm;
          fetchedSeoulSales = seoulResult;
          setSeoulSales(seoulResult);
      } else {
          const result = await fetchStores(selectedZone.trarNo, (msg) => setLoadingMsg(msg));
          stores = result.stores;
          stdrYm = result.stdrYm;

          if (selectedZone.searchLat && selectedZone.searchLon) {
               setLoadingMsg("행정동 매출 데이터를 추가 조회중입니다...");
               const adminCode = await getAdminCodeFromCoords(selectedZone.searchLat, selectedZone.searchLon);
               if (adminCode && adminCode.startsWith('11')) {
                   fetchedSeoulSales = await fetchSeoulSalesData(adminCode);
                   setSeoulSales(fetchedSeoulSales);
               }
          }
      }
      
      const rawDate = stdrYm || stores[0]?.stdrYm || selectedZone.stdrYm || "";
      const cleanDate = rawDate.replace(/[^0-9]/g, '');
      const fmtDate = cleanDate.length >= 6 ? `${cleanDate.substring(0,4)}년 ${cleanDate.substring(4,6)}월` : rawDate;
      
      setDataDate(fmtDate);
      setAllRawStores(stores);
      
      // Calculate Stats & Trigger AI
      const calculatedStats = analyzeData(stores);
      if (calculatedStats) {
          generateAiInsight(selectedZone.mainTrarNm, calculatedStats, fetchedSeoulSales);
      }

    } catch (err: any) {
      setError("상세 데이터 로딩 실패: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Modified to return stats
  const analyzeData = (stores: Store[], largeFilter?: string | null, midFilter?: string | null): StoreStats | null => {
    if (!stores.length) return null;

    const summaryGroups: Record<string, any> = {};
    stores.forEach(s => {
        const l = s.indsLclsNm || "기타";
        if(!summaryGroups[l]) summaryGroups[l] = { name: l, count: 0, franchise: 0, firstFloor: 0, mids: {} };
        const g = summaryGroups[l];
        g.count++;
        const isFranchise = (s.brchNm && s.brchNm.trim() !== "") || (s.bizesNm.includes("점") && !s.bizesNm.includes("상점"));
        if(isFranchise) g.franchise++;
        if(["1", "1층", "지상1층"].includes(s.flrNo)) g.firstFloor++;
        g.mids[s.indsMclsNm || "기타"] = (g.mids[s.indsMclsNm || "기타"] || 0) + 1;
    });

    const summaryTableData = Object.values(summaryGroups).map((g: any) => {
        const sortedMid = Object.entries(g.mids).sort((a: any, b: any) => b[1] - a[1]);
        return {
            name: g.name, count: g.count, ratio: (g.count/stores.length)*100,
            franchiseCount: g.franchise, franchiseRatio: g.count ? (g.franchise/g.count)*100 : 0,
            firstFloorCount: g.firstFloor, firstFloorRatio: g.count ? (g.firstFloor/g.count)*100 : 0,
            topMid: sortedMid.length ? sortedMid[0][0] : "-"
        };
    }).sort((a,b) => b.count - a.count);

    let filtered = stores;
    if(largeFilter) filtered = filtered.filter(s => s.indsLclsNm === largeFilter);
    if(midFilter) filtered = filtered.filter(s => s.indsMclsNm === midFilter);

    const mCounts: Record<string, number> = {};
    const bCounts: Record<string, number> = {};
    const bInfo: Record<string, any> = {};
    let fFloor = 0;
    let franchise = 0;

    filtered.forEach(s => {
       mCounts[s.indsMclsNm || "기타"] = (mCounts[s.indsMclsNm || "기타"] || 0) + 1;
       if(s.bldNm) {
         bCounts[s.bldNm] = (bCounts[s.bldNm] || 0) + 1;
         if(!bInfo[s.bldNm] && s.lat) bInfo[s.bldNm] = { lat: parseFloat(s.lat), lon: parseFloat(s.lon) };
       }
       if(["1", "1층", "지상1층"].includes(s.flrNo)) fFloor++;
       if((s.brchNm && s.brchNm.trim() !== "") || (s.bizesNm.includes("점") && !s.bizesNm.includes("상점"))) franchise++;
    });

    const globalLCounts: Record<string, number> = {};
    stores.forEach(s => globalLCounts[s.indsLclsNm || "기타"] = (globalLCounts[s.indsLclsNm || "기타"] || 0) + 1);
    const globalPieData = Object.keys(globalLCounts).map(k => ({ name: k, value: globalLCounts[k] })).sort((a,b) => b.value - a.value);

    const fullBarData = Object.keys(mCounts).map(k => ({ name: k, count: mCounts[k], value: mCounts[k] })).sort((a,b) => b.count - a.count);
    const buildingData = Object.keys(bCounts).map(k => ({ name: k, count: bCounts[k], value: bCounts[k], lat: bInfo[k]?.lat, lon: bInfo[k]?.lon })).sort((a,b) => b.count - a.count).slice(0, 5);

    const isMajor = (nm: string) => MAJOR_BRANDS.some(b => nm.includes(b));
    const sortedStores = [...filtered].sort((a, b) => {
        const aMajor = isMajor(a.bizesNm);
        const bMajor = isMajor(b.bizesNm);
        if (aMajor && !bMajor) return -1;
        if (!aMajor && bMajor) return 1;
        return (a.bizesNm || "").localeCompare(b.bizesNm || "");
    });

    const stats: StoreStats = {
        totalStores: filtered.length,
        pieData: globalPieData,
        barData: fullBarData.slice(0, 10),
        fullBarData,
        buildingData,
        floorData: [{ name: '1층 점포', value: fFloor }, { name: '그 외 층', value: filtered.length - fFloor }],
        franchiseRate: filtered.length ? ((franchise/filtered.length)*100).toFixed(1) : "0",
        summaryTableData
    };

    setStoreStats(stats);
    setTopStores(sortedStores.slice(0, 100));
    
    return stats;
  };

  useEffect(() => {
    if(allRawStores.length > 0) analyzeData(allRawStores, selectedLarge, selectedMid);
  }, [selectedLarge, selectedMid, allRawStores]);

  const activePieIndex = useMemo(() => {
     if(!storeStats || !selectedLarge) return -1;
     return storeStats.pieData.findIndex(i => i.name === selectedLarge);
  }, [storeStats, selectedLarge]);

  const summaryTableDisplayData = useMemo(() => {
    if(!storeStats) return [];
    if(!detailedAnalysisFilter) return storeStats.summaryTableData;
    const targetStores = allRawStores.filter(s => s.indsLclsNm === detailedAnalysisFilter);
    const groups: Record<string, any> = {};
    targetStores.forEach(s => {
        const m = s.indsMclsNm || "기타";
        if(!groups[m]) groups[m] = { name: m, count: 0, franchise: 0, firstFloor: 0 };
        const g = groups[m];
        g.count++;
        const isFranchise = (s.brchNm && s.brchNm.trim() !== "") || (s.bizesNm.includes("점") && !s.bizesNm.includes("상점"));
        if(isFranchise) g.franchise++;
        if(["1", "1층", "지상1층"].includes(s.flrNo)) g.firstFloor++;
    });
    const totalInGroup = targetStores.length;
    return Object.values(groups).map((g: any) => ({
        name: g.name, count: g.count, ratio: totalInGroup ? (g.count / totalInGroup) * 100 : 0, franchiseCount: g.franchise, franchiseRatio: g.count ? (g.franchise/g.count)*100 : 0, firstFloorCount: g.firstFloor, firstFloorRatio: g.count ? (g.firstFloor/g.count)*100 : 0, topMid: "-"
    })).sort((a: any, b: any) => b.count - a.count);
  }, [storeStats, detailedAnalysisFilter, allRawStores]);

  const currentSeoulData = useMemo(() => {
      if (!seoulSales) return null;
      if (selectedSeoulIndustry && seoulSales.byIndustry) {
          return seoulSales.byIndustry.find(i => i.serviceName === selectedSeoulIndustry) || seoulSales;
      }
      return seoulSales;
  }, [seoulSales, selectedSeoulIndustry]);

  const seoulIndustryPieData = useMemo(() => {
      if (!seoulSales || !seoulSales.byIndustry) return [];
      const mode = salesViewMode === 'amount' ? 'totalAmount' : 'totalCount';
      return seoulSales.byIndustry
          .map(item => ({ name: item.serviceName || '기타', value: item[mode] }))
          .sort((a, b) => b.value - a.value)
          .filter(d => d.value > 0)
          .slice(0, 10);
  }, [seoulSales, salesViewMode]);

  // Prep Data for Time Chart
  const timeChartData = useMemo(() => {
    if (!currentSeoulData) return [];
    const source = salesViewMode === 'amount' ? currentSeoulData.timeAmount : currentSeoulData.timeCount;
    
    // Calculate total for percentage
    const total = Object.values(source).reduce((acc, curr) => acc + curr, 0) || 1;

    return [
        { name: '00-06시', key: '00_06', value: source['00_06'], percentStr: `${((source['00_06'] / total) * 100).toFixed(1)}%` },
        { name: '06-11시', key: '06_11', value: source['06_11'], percentStr: `${((source['06_11'] / total) * 100).toFixed(1)}%` },
        { name: '11-14시', key: '11_14', value: source['11_14'], percentStr: `${((source['11_14'] / total) * 100).toFixed(1)}%` },
        { name: '14-17시', key: '14_17', value: source['14_17'], percentStr: `${((source['14_17'] / total) * 100).toFixed(1)}%` },
        { name: '17-21시', key: '17_21', value: source['17_21'], percentStr: `${((source['17_21'] / total) * 100).toFixed(1)}%` },
        { name: '21-24시', key: '21_24', value: source['21_24'], percentStr: `${((source['21_24'] / total) * 100).toFixed(1)}%` },
    ];
  }, [currentSeoulData, salesViewMode]);

  // Prep Data for Age Chart
  const ageChartData = useMemo(() => {
    if (!currentSeoulData) return [];
    const source = salesViewMode === 'amount' ? currentSeoulData.ageAmount : currentSeoulData.ageCount;
    
    // Calculate total for percentage
    const total = Object.values(source).reduce((acc, curr) => acc + curr, 0) || 1;

    return [
        { name: '10대', value: source['10'], percentStr: `${((source['10'] / total) * 100).toFixed(1)}%` },
        { name: '20대', value: source['20'], percentStr: `${((source['20'] / total) * 100).toFixed(1)}%` },
        { name: '30대', value: source['30'], percentStr: `${((source['30'] / total) * 100).toFixed(1)}%` },
        { name: '40대', value: source['40'], percentStr: `${((source['40'] / total) * 100).toFixed(1)}%` },
        { name: '50대', value: source['50'], percentStr: `${((source['50'] / total) * 100).toFixed(1)}%` },
        { name: '60대+', value: source['60'], percentStr: `${((source['60'] / total) * 100).toFixed(1)}%` },
    ];
  }, [currentSeoulData, salesViewMode]);

  // Prep Data for Weekday/Weekend Chart
  const weekdayChartData = useMemo(() => {
    if (!currentSeoulData) return [];
    const isAmount = salesViewMode === 'amount';
    const wd = isAmount ? currentSeoulData.weekdayAmount : currentSeoulData.weekdayCount;
    const we = isAmount ? currentSeoulData.weekendAmount : currentSeoulData.weekendCount;
    const total = wd + we || 1;

    return [
        { name: '주중', value: wd, color: '#3b82f6', percent: ((wd / total) * 100).toFixed(1) }, 
        { name: '주말', value: we, color: '#ef4444', percent: ((we / total) * 100).toFixed(1) } 
    ];
  }, [currentSeoulData, salesViewMode]);

  // Prep Data for Day of Week Chart
  const dayChartData = useMemo(() => {
    if (!currentSeoulData) return [];
    const source = salesViewMode === 'amount' ? currentSeoulData.dayAmount : currentSeoulData.dayCount;
    
    // Calculate total for percentage
    const total = Object.values(source).reduce((acc, curr) => acc + curr, 0) || 1;
    const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const mapDay: any = { MON:'월', TUE:'화', WED:'수', THU:'목', FRI:'금', SAT:'토', SUN:'일' };

    return days.map(d => ({
        name: mapDay[d],
        value: source[d],
        percentStr: `${((source[d] / total) * 100).toFixed(1)}%`
    }));
  }, [currentSeoulData, salesViewMode]);

  // Prep Data for Gender Chart
  const genderChartData = useMemo(() => {
    if (!currentSeoulData) return [];
    const source = salesViewMode === 'amount' ? currentSeoulData.genderAmount : currentSeoulData.genderCount;
    const total = source.male + source.female;
    return [
        { name: '남성', value: source.male, percent: total ? (source.male/total)*100 : 0, color: '#3b82f6' },
        { name: '여성', value: source.female, percent: total ? (source.female/total)*100 : 0, color: '#ec4899' },
    ];
  }, [currentSeoulData, salesViewMode]);

  const CustomXAxisTick = ({ x, y, payload, data }: any) => {
      if (!data || !data[payload.index]) return null;
      const item = data[payload.index];
      const valStr = salesViewMode === 'amount' 
          ? `${formatSalesValue(item.value, 'amount')}억원` 
          : `${item.value.toLocaleString()}건`;
      
      return (
          <g transform={`translate(${x},${y})`}>
              <text x={0} y={0} dy={12} textAnchor="middle" fill="#4b5563" fontSize={11} fontWeight="bold">
                  {payload.value}
              </text>
              <text x={0} y={0} dy={26} textAnchor="middle" fill="#9ca3af" fontSize={10}>
                  {valStr}
              </text>
          </g>
      );
  };

  const reset = () => {
      setStep("input"); setAddress(""); setFoundZones([]); setTradeZone(null); 
      setAllRawStores([]); setStoreStats(null); setDataDate(null);
      setSelectedBuildingIndex(null); setDetailedAnalysisFilter(null);
      setSeoulSales(null); setSelectedSeoulIndustry(null);
      setAiSummary(null);
  };

  return (
    <div className="min-h-screen max-w-6xl mx-auto p-3 md:p-8 flex flex-col">
      <div className="flex-grow">
      {/* Header */}
      <header className="mb-10 flex flex-col items-center justify-center gap-4 text-center relative pt-4 md:pt-8">
         <div 
            onClick={reset} 
            className="cursor-pointer group flex flex-col items-center justify-center select-none"
            role="button"
         >
            <div className="flex items-center gap-3 mb-4 transition-transform duration-300 group-hover:-translate-y-1">
                <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 rounded-xl shadow-lg shadow-blue-200">
                    <Icons.Store className="w-6 h-6 md:w-8 md:h-8 text-white" strokeWidth={2.5} />
                </div>
                <h1 className="text-3xl md:text-4xl font-black text-gray-800 tracking-tight">
                    주소기반 <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-600">상권분석</span>
                </h1>
            </div>
         </div>
         {step !== 'input' && (
             <button onClick={reset} className="md:absolute md:right-0 md:top-10 bg-white border border-gray-200 text-gray-600 px-5 py-2.5 rounded-full hover:bg-gray-50 hover:border-blue-200 hover:text-blue-600 hover:shadow-md transition-all text-sm font-medium flex items-center gap-2 group/btn">
                 <Icons.Search className="w-4 h-4 text-gray-400 group-hover/btn:text-blue-500"/> 
                 <span className="hidden md:inline">다른 지역 검색</span>
                 <span className="md:hidden">재검색</span>
             </button>
         )}
      </header>

      {/* 1. Input */}
      {step === 'input' && (
        <>
        <div className="bg-white rounded-2xl shadow-lg p-4 md:p-8 max-w-6xl mx-auto mt-6 md:mt-20 text-center animate-fade-in">
           <div className="flex justify-center mb-6">
               <div className="bg-gray-100 p-1 rounded-xl inline-flex shadow-inner">
                   <button 
                       onClick={() => setSearchType('admin')}
                       className={`px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${searchType === 'admin' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                   >
                       행정 구역 기준
                   </button>
                   <button 
                       onClick={() => setSearchType('trade')}
                       className={`px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${searchType === 'trade' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                   >
                       주요 상권 기준
                   </button>
               </div>
           </div>
           <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6">분석할 지역의 주소를 입력해주세요</h2>
           <div className="flex flex-col gap-2 mb-4">
              <div className="flex flex-col md:flex-row gap-2">
                  <input value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleGeocode()} className="w-full md:flex-1 p-3 md:p-4 border border-gray-300 rounded-xl text-base md:text-lg outline-none focus:ring-2 focus:ring-blue-500" placeholder="예: 테헤란로 000" />
                  <button onClick={handleGeocode} disabled={loading} className={`w-full md:w-auto text-white py-3 md:py-0 px-8 rounded-xl font-bold hover:opacity-90 disabled:bg-gray-400 transition flex items-center justify-center gap-2 ${searchType === 'trade' ? 'bg-green-600' : 'bg-blue-600'}`}>
                     {loading ? <div className="loading-spinner" /> : <><Icons.Search className="w-5 h-5 md:w-6 md:h-6"/><span>검색</span></>}
                  </button>
              </div>
           </div>
           {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </div>

        <GoogleAd slot="4992341640" className="max-w-6xl mx-auto mt-6" style={{ minHeight: '100px' }} />

        <div className="max-w-6xl mx-auto mt-8 md:mt-12 px-4 animate-fade-in space-y-8">
            <section className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-600 p-1.5 rounded-lg"><Icons.MapPin className="w-5 h-5"/></span>
                    상권 분석 서비스란?
                </h3>
                <p className="text-gray-600 leading-relaxed">
                    성공적인 창업은 정확한 데이터에서 시작됩니다. 본 서비스는 공공데이터포털(Data.go.kr), 서울시 열린데이터광장, 통계청(SGIS)의 방대한 빅데이터를 실시간으로 융합·분석합니다.
                    유료 서비스 못지않은 고품질의 <strong>입지 분석, 점포 밀집도, 프랜차이즈 현황, 서울시 추정 매출 데이터</strong>를 100% 무료로 확인하세요.
                </p>
            </section>
            
            <section className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                <h3 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                    <span className="bg-green-100 text-green-600 p-1.5 rounded-lg"><Icons.List className="w-5 h-5"/></span>
                    이용 방법
                </h3>
                <ul className="space-y-3 text-gray-600">
                    <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center font-bold text-xs text-gray-700">1</span>
                        <span><strong>지역 검색:</strong> 분석을 희망하는 동 이름이나 도로명 주소를 입력하여 검색합니다. (예: 삼성동, 테헤란로)</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center font-bold text-xs text-gray-700">2</span>
                        <span><strong>영역 설정:</strong> '행정동(주거 인구 중심)' 또는 '주요 상권(유동 인구 중심)' 중 분석 목적에 맞는 기준을 선택하고 지도로 위치를 확인합니다.</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center font-bold text-xs text-gray-700">3</span>
                        <span><strong>데이터 확인:</strong> 업종별 분포, 1층 점포 비율, 프랜차이즈 현황, 서울시 매출 추이 등 시각화된 리포트를 분석하여 인사이트를 얻습니다.</span>
                    </li>
                </ul>
            </section>

            <section className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                 <h3 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                    <span className="bg-orange-100 text-orange-600 p-1.5 rounded-lg"><Icons.TrendingUp className="w-5 h-5"/></span>
                    제공하는 주요 데이터
                </h3>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
                        <li className="flex items-start gap-2">
                            <Icons.Wallet className="w-4 h-4 text-indigo-500 mt-0.5"/>
                            <span><strong>서울시 추정 매출:</strong> 카드 소비 데이터를 기반으로 한 요일·시간대별, 성별·연령별 매출 패턴 정밀 분석 (서울 지역 한정)</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Icons.Layers className="w-4 h-4 text-blue-500 mt-0.5"/>
                            <span><strong>상가 밀집도 & 층별 분석:</strong> 건물별 상가 밀집 순위 및 1층 점포 비율을 통해 상권의 활기도와 임대료 수준 간접 파악</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Icons.PieChartIcon className="w-4 h-4 text-green-500 mt-0.5"/>
                            <span><strong>업종 및 경쟁 분석:</strong> 내 업종의 점포 수, 구성비, 프랜차이즈 vs 개인 점포 비율 비교</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Icons.Building className="w-4 h-4 text-orange-500 mt-0.5"/>
                            <span><strong>핵심 상업 시설:</strong> 스타벅스, 올리브영 등 앵커 스토어 입점 현황 및 상가 리스트 제공</span>
                        </li>
                    </ul>
                </div>
            </section>

            <section className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                <p className="text-xs text-gray-500 leading-relaxed text-center">
                    * 본 서비스는 공공데이터 API를 실시간으로 호출하므로, 데이터 갱신 시점에 따라 실제 현황과 다소 차이가 있을 수 있습니다.
                </p>
            </section>
        </div>
        </>
      )}

      {/* 2. Verify Map */}
      {step === 'verify_location' && (
        <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mb-8 border border-blue-100 animate-fade-in">
           <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Icons.MapPin className="text-blue-500"/> 검색 위치 확인</h3>
           <div className="h-80 w-full rounded-lg overflow-hidden border border-gray-300 mb-4 relative z-0">
              <TradeMap lat={searchCoords.lat} lon={searchCoords.lon} draggable={true} onDragEnd={(lat, lon) => setSearchCoords({lat, lon})} />
           </div>
           <div className="text-sm text-gray-500 mb-4 bg-gray-50 p-3 rounded">검색 결과: <strong>{resolvedAddress}</strong></div>
           <button onClick={handleSearchZones} disabled={loading} className={`w-full text-white px-4 py-3 md:px-6 md:py-4 rounded-lg font-bold hover:opacity-90 transition flex items-center justify-center gap-2 shadow-lg ${searchType === 'trade' ? 'bg-green-600' : 'bg-blue-600'}`}>
                {loading ? '정보 조회 중...' : (searchType === 'trade' ? '📍 이 위치 주변 상권 분석하기' : '🏢 이 위치의 행정구역 분석하기')}
           </button>
        </div>
      )}

      {/* 3. Zone Select */}
      {step === 'select_zone' && (
         <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mb-8 border border-blue-100 animate-fade-in">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Icons.List className="text-blue-500"/> 
                {searchType === 'trade' ? `주변 상권 선택 (${foundZones.length}개)` : '분석 대상 행정구역 선택'}
            </h3>
            
            {/* ADDED MAP SECTION */}
            <div className="h-80 w-full rounded-lg overflow-hidden border border-gray-300 mb-6 relative z-0">
                <TradeMap 
                    lat={previewZone?.searchLat || searchCoords.lat} 
                    lon={previewZone?.searchLon || searchCoords.lon} 
                    polygonCoords={previewZone?.parsedPolygon} 
                    tradeName={previewZone?.mainTrarNm} 
                />
            </div>
            
            <div className="grid grid-cols-1 gap-4">
                {foundZones.map((z, i) => (
                    <div key={i} className={`border rounded-xl p-4 transition-all duration-300 ${previewZone?.trarNo === z.trarNo ? 'bg-blue-50 shadow-md border-blue-500' : 'bg-white hover:shadow-sm'}`}>
                        <div onClick={() => setPreviewZone(prev => prev?.trarNo === z.trarNo ? null : z)} className="cursor-pointer flex justify-between items-center">
                            <div>
                                <h4 className="font-bold text-gray-800 text-lg">{z.mainTrarNm}</h4>
                                <div className="text-sm text-gray-500">{z.ctprvnNm} {z.signguNm}</div>
                            </div>
                            {previewZone?.trarNo === z.trarNo ? <Icons.ChevronUp className="text-gray-400"/> : <Icons.ChevronDown className="text-gray-400"/>}
                        </div>
                        {previewZone?.trarNo === z.trarNo && (
                            <div className="mt-4 pt-4 border-t border-blue-200 animate-fade-in">
                                 <button onClick={(e) => { e.stopPropagation(); handleAnalyzeZone(z); }} className={`w-full text-white px-6 py-3 rounded-lg font-bold hover:opacity-90 transition flex items-center justify-center gap-2 ${searchType === 'trade' ? 'bg-green-600' : 'bg-blue-600'}`}>
                                    이 {searchType === 'trade' ? '상권' : '구역'} 분석 시작 <Icons.ArrowRight className="w-4 h-4"/>
                                 </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
         </div>
      )}

      {/* 4. Dashboard */}
      {step === 'result' && storeStats && tradeZone && (
         <div className="animate-fade-in">
             <div className="space-y-6 animate-fade-in">
                 {/* Main Card */}
                 <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                    <div className={`bg-gradient-to-r p-4 md:p-6 text-white flex flex-col md:flex-row justify-between items-center ${tradeZone.type === 'admin' ? 'from-blue-500 to-indigo-600' : 'from-green-500 to-teal-600'}`}>
                       <div>
                          <h2 className="text-3xl font-bold mb-1">{tradeZone.mainTrarNm}</h2>
                          <p className="opacity-90 text-sm flex items-center gap-1"><Icons.MapPin className="w-4 h-4"/> {tradeZone.ctprvnNm} {tradeZone.signguNm}</p>
                       </div>
                       <div className="text-right mt-4 md:mt-0">
                          <p className="text-sm opacity-75">
                            {(selectedLarge || selectedMid) ? '필터링된 점포' : `총 점포수 ${dataDate ? `(${dataDate} 기준)` : ''}`}
                          </p>
                          <p className="text-4xl font-bold">{storeStats.totalStores.toLocaleString()}<span className="text-xl">개</span></p>
                       </div>
                    </div>
                    <div className="w-full h-80 bg-gray-100 border-b border-gray-200 relative z-0">
                        <TradeMap 
                           lat={tradeZone.searchLat!} 
                           lon={tradeZone.searchLon!} 
                           polygonCoords={tradeZone.parsedPolygon} 
                           tradeName={tradeZone.mainTrarNm} 
                           markers={storeStats.buildingData}
                           selectedMarkerIndex={selectedBuildingIndex}
                           onMarkerClick={(index) => setSelectedBuildingIndex(prev => prev === index ? null : index)}
                        />
                    </div>
                    
                    {/* AI Analysis Section */}
                    <div className="p-4 md:p-6 bg-gradient-to-r from-indigo-50 to-blue-50 border-t border-indigo-100">
                        <div className="flex items-start gap-3">
                            <div className="bg-white p-2 rounded-lg shadow-sm text-indigo-600 mt-1">
                                {/* Sparkles Icon for AI */}
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                            </div>
                            <div className="flex-1">
                                <h3 className="font-bold text-indigo-900 mb-2 flex items-center gap-2">AI 상권 브리핑 <span className="text-[10px] bg-indigo-200 text-indigo-700 px-1.5 py-0.5 rounded">BETA</span></h3>
                                {isAiLoading ? (
                                    <div className="space-y-2 animate-pulse">
                                        <div className="h-4 bg-indigo-200/50 rounded w-3/4"></div>
                                        <div className="h-4 bg-indigo-200/50 rounded w-5/6"></div>
                                        <div className="h-4 bg-indigo-200/50 rounded w-2/3"></div>
                                    </div>
                                ) : aiSummary ? (
                                    <div className="text-sm text-indigo-800 leading-relaxed whitespace-pre-line animate-fade-in">
                                        {aiSummary}
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">데이터 분석 대기 중...</p>
                                )}
                            </div>
                        </div>
                    </div>
                 </div>

                 {/* Seoul Sales Analysis Section */}
                 {seoulSales && currentSeoulData && (
                    <div className="bg-white rounded-xl shadow-sm border p-4 md:p-6 animate-fade-in">
                        <div className="flex flex-col md:flex-row justify-between items-center mb-6 border-b pb-4">
                            <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                <span className="bg-indigo-100 p-1.5 rounded-lg"><Icons.Wallet className="w-5 h-5 text-indigo-600"/></span>
                                {selectedSeoulIndustry ? `추정 매출 분석 - ${selectedSeoulIndustry}` : '추정 매출 분석 (서울시 행정동 데이터)'}
                            </h3>
                            <div className="flex items-center gap-2 mt-3 md:mt-0">
                                <div className="bg-gray-100 p-1 rounded-lg flex">
                                    <button 
                                        onClick={() => setSalesViewMode('amount')}
                                        className={`px-3 py-1 text-sm font-bold rounded-md transition ${salesViewMode === 'amount' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                                    >
                                        매출 금액
                                    </button>
                                    <button 
                                        onClick={() => setSalesViewMode('count')}
                                        className={`px-3 py-1 text-sm font-bold rounded-md transition ${salesViewMode === 'count' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500'}`}
                                    >
                                        매출 건수
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Top Section: Industry Pie Chart AND Day of Week Analysis (Combined) */}
                        <div className="flex flex-col lg:flex-row gap-6 mb-6">
                            
                            {/* Left: Industry Distribution (Pie Chart) */}
                            {seoulSales.byIndustry && seoulSales.byIndustry.length > 0 && (
                                <div className="w-full lg:w-1/2 p-4 bg-gray-50 rounded-xl border border-gray-200">
                                    <div className="flex justify-between items-center mb-4">
                                        <h4 className="font-bold text-gray-700 text-sm flex items-center gap-2">
                                            <Icons.PieChartIcon className="w-4 h-4 text-indigo-500" />
                                            업종별 {salesViewMode === 'amount' ? '매출' : '건수'} 비중
                                        </h4>
                                        {selectedSeoulIndustry && (
                                            <button 
                                                onClick={() => setSelectedSeoulIndustry(null)}
                                                className="text-xs bg-white border border-gray-300 px-2 py-1 rounded text-gray-600 hover:text-indigo-600 hover:border-indigo-300 transition"
                                            >
                                                필터 초기화
                                            </button>
                                        )}
                                    </div>
                                    <div className="h-[300px]">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={seoulIndustryPieData}
                                                    dataKey="value"
                                                    nameKey="name"
                                                    cx="50%"
                                                    cy="50%"
                                                    outerRadius={75}
                                                    innerRadius={40}
                                                    onClick={(data) => setSelectedSeoulIndustry(prev => prev === data.name ? null : data.name)}
                                                    cursor="pointer"
                                                    paddingAngle={2}
                                                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                                >
                                                    {seoulIndustryPieData.map((entry, index) => (
                                                        <Cell 
                                                            key={`cell-${index}`} 
                                                            fill={COLORS[index % COLORS.length]} 
                                                            stroke={selectedSeoulIndustry === entry.name ? "#000" : "none"}
                                                            strokeWidth={2}
                                                            opacity={selectedSeoulIndustry && selectedSeoulIndustry !== entry.name ? 0.3 : 1}
                                                        />
                                                    ))}
                                                </Pie>
                                                <Tooltip formatter={(value: number) => salesViewMode === 'amount' ? `${formatSalesValue(value, 'amount')}억원` : `${value.toLocaleString()}건`} />
                                                <Legend layout="vertical" verticalAlign="middle" align="right" content={<CustomLegend selectedIndustry={selectedSeoulIndustry} onSelect={(name: string) => setSelectedSeoulIndustry(prev => prev === name ? null : name)} />} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}

                            {/* Right: Weekday/Weekend AND Day of Week Analysis */}
                            <div className="w-full lg:w-1/2 flex flex-col gap-4">
                                {/* Top: Weekday/Weekend Analysis (RESTORED) */}
                                <div className="bg-white border rounded-xl p-4 flex-1">
                                    <h4 className="font-bold text-gray-700 mb-3 text-sm">주중/주말 매출 비중</h4>
                                    <div className="h-40 flex items-center justify-center">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={weekdayChartData}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={30}
                                                    outerRadius={60}
                                                    paddingAngle={5}
                                                    dataKey="value"
                                                >
                                                    {weekdayChartData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip formatter={(value: number) => salesViewMode === 'amount' ? `${formatSalesValue(value, 'amount')}억원` : `${value.toLocaleString()}건`} />
                                                <Legend formatter={(value, entry: any) => `${value} (${entry.payload.percent}%)`}/>
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Bottom: Day of Week Analysis */}
                                <div className="bg-white border rounded-xl p-4 flex-1">
                                    <h4 className="font-bold text-gray-700 mb-3 text-sm">요일별 {salesViewMode === 'amount' ? '매출' : '건수'} 분석</h4>
                                    <div className="h-48">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={dayChartData} margin={{top: 20, right: 0, left: 0, bottom: 20}}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" tick={<CustomXAxisTick data={dayChartData} />} interval={0} height={40} />
                                                <Tooltip formatter={(value: number) => salesViewMode === 'amount' ? `${formatSalesValue(value, 'amount')}억원` : `${value.toLocaleString()}건`} cursor={{fill: 'transparent'}} />
                                                <Bar dataKey="value" fill="#93c5fd" activeBar={{ fill: '#3b82f6' }} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                                    <LabelList dataKey="percentStr" position="insideTop" style={{ fill: '#1e3a8a', fontWeight: 'bold', fontSize: '11px' }} />
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* New Section: Time & Demographics */}
                        <div className="flex flex-col lg:flex-row gap-6 mb-6">
                            {/* Time Slot Analysis */}
                            <div className="w-full lg:w-1/2 bg-white border rounded-xl p-4">
                                <h4 className="font-bold text-gray-700 mb-3 text-sm">시간대별 {salesViewMode === 'amount' ? '매출' : '건수'} 분석</h4>
                                <div className="h-64">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart 
                                            data={timeChartData} 
                                            margin={{top: 20, right: 30, left: 20, bottom: 20}}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="name" tick={<CustomXAxisTick data={timeChartData} />} interval={0} height={40} />
                                            <YAxis hide />
                                            <Tooltip formatter={(value: number) => salesViewMode === 'amount' ? `${formatSalesValue(value, 'amount')}억원` : `${value.toLocaleString()}건`} cursor={{fill: 'transparent'}} />
                                            <Bar dataKey="value" fill="#86efac" activeBar={{ fill: '#10b981' }} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                                <LabelList dataKey="percentStr" position="insideTop" style={{ fill: '#064e3b', fontWeight: 'bold', fontSize: '11px' }} />
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Demographics Analysis */}
                            <div className="w-full lg:w-1/2 bg-white border rounded-xl p-4 flex flex-col gap-4">
                                {/* Gender */}
                                <div>
                                    <h4 className="font-bold text-gray-700 mb-2 text-sm flex justify-between">
                                        <span>성별 분포</span>
                                        <span className="text-xs font-normal text-gray-500">남성 vs 여성</span>
                                    </h4>
                                    <div className="h-4 flex rounded-full overflow-hidden mb-1">
                                        {genderChartData.map((d, i) => (
                                            <div key={i} style={{width: `${d.percent}%`, backgroundColor: d.color}} className="h-full relative flex items-center justify-center">
                                                {d.percent > 5 && (
                                                    <span className="text-[10px] text-white font-bold drop-shadow-md">
                                                        {d.percent.toFixed(1)}%
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-between text-xs text-gray-600 px-1">
                                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"/>남성 {genderChartData[0].percent.toFixed(1)}%</span>
                                        <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-pink-500"/>여성 {genderChartData[1].percent.toFixed(1)}%</span>
                                    </div>
                                </div>

                                {/* Age */}
                                <div className="flex-1">
                                    <h4 className="font-bold text-gray-700 mb-2 text-sm">연령대별 분포</h4>
                                    <div className="h-40">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart 
                                                data={ageChartData} 
                                                margin={{top: 20, right: 0, left: 0, bottom: 20}}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" tick={<CustomXAxisTick data={ageChartData} />} interval={0} height={40} />
                                                <Tooltip formatter={(value: number) => salesViewMode === 'amount' ? `${formatSalesValue(value, 'amount')}억원` : `${value.toLocaleString()}건`} cursor={{fill: 'transparent'}} />
                                                <Bar dataKey="value" fill="#fdba74" activeBar={{ fill: '#f97316' }} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                                    <LabelList dataKey="percentStr" position="insideTop" style={{ fill: '#7c2d12', fontWeight: 'bold', fontSize: '11px' }} />
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Summary Numbers */}
                        <div className="bg-indigo-50 rounded-xl p-4 mb-6 text-center transition-colors duration-300" style={selectedSeoulIndustry ? {backgroundColor: '#eff6ff'} : {}}>
                            <p className="text-indigo-800 text-sm font-bold mb-1">
                                {selectedSeoulIndustry ? `[${selectedSeoulIndustry}]` : '전체 업종'} 월 평균 {salesViewMode === 'amount' ? '추정 매출' : '매출 건수'}
                            </p>
                            <p className="text-3xl font-black text-indigo-600">
                                {salesViewMode === 'amount' 
                                    ? <>{formatSalesValue(currentSeoulData.totalAmount, 'amount')}<span className="text-lg text-gray-500 ml-1">억원</span></>
                                    : <>{(currentSeoulData.totalCount).toLocaleString()}<span className="text-lg text-gray-500 ml-1">건</span></>
                                }
                            </p>
                        </div>
                    </div>
                 )}

                 {/* Industry Analysis Card Container */}
                 <div className="bg-white rounded-xl shadow-sm border p-4 md:p-6 animate-fade-in">
                     <div className="flex flex-col md:flex-row justify-between items-center mb-6 border-b pb-4">
                        <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                            <span className="bg-blue-100 p-1.5 rounded-lg"><Icons.Store className="w-5 h-5 text-blue-600"/></span>
                            업종 분석(소상공인 데이터)
                        </h3>
                     </div>

                     <div className="space-y-6">
                         {/* Summary Cards */}
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                             <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border">
                                 <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Icons.Building className="text-indigo-500"/> 상가 밀집 건물 Top 5</h3>
                                 <div className="w-full h-48 bg-gray-100 rounded-lg mb-4 overflow-hidden border border-gray-200 relative z-0">
                                    <TradeMap 
                                       lat={tradeZone.searchLat!} 
                                       lon={tradeZone.searchLon!} 
                                       polygonCoords={tradeZone.parsedPolygon} 
                                       tradeName={tradeZone.mainTrarNm} 
                                       markers={storeStats.buildingData}
                                       selectedMarkerIndex={selectedBuildingIndex}
                                       onMarkerClick={(index) => setSelectedBuildingIndex(prev => prev === index ? null : index)}
                                    />
                                 </div>
                                 <ul className="space-y-2">
                                    {storeStats.buildingData.map((b,i) => (
                                       <li key={i} 
                                           onClick={() => setSelectedBuildingIndex(selectedBuildingIndex === i ? null : i)}
                                           className={`flex justify-between items-center text-sm border-b pb-2 last:border-0 cursor-pointer p-2 rounded transition-colors ${selectedBuildingIndex === i ? 'bg-blue-50 border-blue-200' : 'hover:bg-gray-50 border-transparent'}`}>
                                          <span className="truncate w-2/3 flex items-center gap-2">
                                             <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] flex-shrink-0 text-white flex-shrink-0 ${selectedBuildingIndex === i ? 'bg-blue-500' : 'bg-red-500'}`}>{i+1}</span>
                                             <span className={selectedBuildingIndex === i ? 'font-medium text-gray-900' : ''}>{b.name}</span>
                                          </span>
                                          <span className={`font-bold ${selectedBuildingIndex === i ? 'text-blue-600' : 'text-indigo-600'}`}>{b.count}개</span>
                                       </li>
                                    ))}
                                 </ul>
                             </div>

                             <div className="flex flex-col gap-6">
                                <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border flex-1">
                                    <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Icons.Layers className="text-orange-500"/> 1층 점포 비율</h3>
                                    <div className="h-40 w-full relative static-chart">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={storeStats.floorData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value">
                                                    <Cell fill="#f97316"/> <Cell fill="#e2e8f0"/>
                                                </Pie>
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none pb-4">
                                            <span className="text-xl font-bold text-gray-700">{storeStats.totalStores > 0 ? ((storeStats.floorData[0].value/storeStats.totalStores)*100).toFixed(0) : 0}%</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border flex flex-col justify-center items-center text-center flex-1">
                                    <div className="w-full flex items-center gap-2 mb-2 px-2">
                                        <Icons.Store className="text-green-500 h-5 w-5 flex-shrink-0" />
                                        <h3 className="text-lg font-bold text-gray-800 whitespace-nowrap">프랜차이즈 비율</h3>
                                    </div>
                                    <div className="flex-1 flex flex-col justify-center items-center py-2">
                                        <div className="text-5xl font-extrabold text-green-500 mb-2">{storeStats.franchiseRate}%</div>
                                        <p className="text-sm text-gray-500">전체 점포 중 프랜차이즈형<br/>점포로 추정되는 비율</p>
                                    </div>
                                </div>
                             </div>
                         </div>

                         {/* AD Placement 1 */}
                         <GoogleAd slot="4992341640" />

                         {/* Charts */}
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                             <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border clickable-chart">
                                 <div className="flex justify-between items-center mb-4 border-l-4 border-blue-500 pl-3">
                                    <h3 className="text-lg font-bold text-gray-800">업종별 구성비 (대분류)</h3>
                                    <div className="flex bg-gray-100 rounded-lg p-1">
                                       <button onClick={()=>setViewModeLarge('chart')} className={`p-1.5 rounded ${viewModeLarge==='chart'?'bg-white shadow-sm text-blue-600':'text-gray-400 hover:text-gray-600'}`} title="차트로 보기"><Icons.PieChartIcon className="w-5 h-5"/></button>
                                       <button onClick={()=>setViewModeLarge('table')} className={`p-1.5 rounded ${viewModeLarge==='table'?'bg-white shadow-sm text-blue-600':'text-gray-400 hover:text-gray-600'}`} title="표로 보기"><Icons.List className="w-5 h-5"/></button>
                                    </div>
                                 </div>
                                 <div className="h-64 w-full overflow-hidden">
                                    {viewModeLarge === 'chart' ? (
                                       <ResponsiveContainer width="100%" height="100%">
                                          <PieChart>
                                             {/* @ts-ignore */}
                                             <Pie data={storeStats.pieData} activeIndex={activePieIndex} activeShape={renderActiveShape} dataKey="value" cx="50%" cy="50%" outerRadius={80} onClick={(d) => { setSelectedLarge(d.name === selectedLarge ? null : d.name); setSelectedMid(null); }} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                                {storeStats.pieData.map((e,i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={selectedLarge && selectedLarge !== e.name ? 0.3 : 1} />)}
                                             </Pie>
                                             <Tooltip/>
                                          </PieChart>
                                       </ResponsiveContainer>
                                    ) : (
                                       <div className="h-full overflow-y-auto custom-scrollbar">
                                          <table className="w-full text-sm text-left">
                                             <thead className="bg-gray-50 text-gray-600 sticky top-0 font-medium">
                                                  <tr><th className="px-3 py-2">대분류명</th><th className="px-3 py-2 text-right">점포수</th><th className="px-3 py-2 text-right">비율</th></tr>
                                             </thead>
                                             <tbody className="divide-y">
                                                {storeStats.pieData.map((d,i) => (
                                                   <tr key={i} className={`cursor-pointer hover:bg-gray-50 ${selectedLarge===d.name?'bg-blue-50':''}`} onClick={()=>{setSelectedLarge(d.name===selectedLarge?null:d.name); setSelectedMid(null);}}>
                                                      <td className="px-3 py-2">{d.name}</td>
                                                      <td className="px-3 py-2 text-right font-medium">{d.value.toLocaleString()}</td>
                                                      <td className="px-3 py-2 text-right text-gray-500">{((d.value / storeStats.totalStores) * 100).toFixed(1)}%</td>
                                                   </tr>
                                                ))}
                                             </tbody>
                                          </table>
                                        </div>
                                    )}
                                 </div>
                             </div>
                             
                             <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border clickable-chart">
                                 <div className="flex justify-between items-center mb-4 border-l-4 border-green-500 pl-3">
                                    <h3 className="text-lg font-bold text-gray-800">{viewModeMid === 'chart' ? '세부 업종 Top 10 (중분류)' : '세부 업종 전체 리스트 (중분류)'}</h3>
                                    <div className="flex bg-gray-100 rounded-lg p-1">
                                       <button onClick={()=>setViewModeMid('chart')} className={`p-1.5 rounded ${viewModeMid==='chart'?'bg-white shadow-sm text-green-600':'text-gray-400 hover:text-gray-600'}`} title="차트로 보기"><Icons.BarChart2 className="w-5 h-5"/></button>
                                       <button onClick={()=>setViewModeMid('table')} className={`p-1.5 rounded ${viewModeMid==='table'?'bg-white shadow-sm text-green-600':'text-gray-400 hover:text-gray-600'}`} title="표로 보기"><Icons.List className="w-5 h-5"/></button>
                                    </div>
                                 </div>
                                 <div className="h-64 w-full overflow-hidden">
                                     {viewModeMid === 'chart' ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                           <BarChart layout="vertical" data={storeStats.barData}>
                                              <XAxis type="number" hide/>
                                              <YAxis dataKey="name" type="category" width={100} tick={{fontSize:12}}/>
                                              <Tooltip/>
                                              <Bar dataKey="count" fill="#82ca9d" radius={[0,4,4,0]} onClick={(d) => setSelectedMid(d.name === selectedMid ? null : d.name)}>
                                                 {storeStats.barData.map((e,i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={selectedMid && selectedMid !== e.name ? 0.3 : 1}/>)}
                                              </Bar>
                                           </BarChart>
                                        </ResponsiveContainer>
                                     ) : (
                                        <div className="h-full overflow-y-auto custom-scrollbar">
                                           <table className="w-full text-sm text-left">
                                              <thead className="bg-gray-50 text-gray-600 sticky top-0 font-medium">
                                                  <tr><th className="px-3 py-2">순위</th><th className="px-3 py-2">중분류명</th><th className="px-3 py-2 text-right">점포수</th><th className="px-3 py-2 text-right">그래프</th></tr>
                                              </thead>
                                              <tbody className="divide-y">
                                                 {storeStats.fullBarData.map((d,i) => (
                                                    <tr key={i} className={`cursor-pointer hover:bg-gray-50 ${selectedMid===d.name?'bg-green-50':''}`} onClick={()=>setSelectedMid(d.name===selectedMid?null:d.name)}>
                                                       <td className="px-3 py-2 text-gray-400 text-xs">{i+1}</td>
                                                       <td className="px-3 py-2">{d.name}</td>
                                                       <td className="px-3 py-2 text-right font-medium">{d.count.toLocaleString()}</td>
                                                       <td className="px-3 py-2 text-right">
                                                            <div className="h-2 bg-gray-100 rounded-full w-20 ml-auto overflow-hidden">
                                                                <div className="h-full rounded-full" style={{width: `${(d.count / storeStats.fullBarData[0].count) * 100}%`, backgroundColor: COLORS[i % COLORS.length]}}></div>
                                                            </div>
                                                       </td>
                                                    </tr>
                                                 ))}
                                              </tbody>
                                           </table>
                                        </div>
                                     )}
                                 </div>
                             </div>
                         </div>

                         {/* AD Placement 2 */}
                         <GoogleAd slot="1816170509" />

                         {/* Comprehensive Analysis Table */}
                         <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                            <div className="p-4 md:p-6 border-b bg-gray-50 flex items-center justify-between">
                                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <Icons.TrendingUp className="text-blue-600"/> 
                                    {detailedAnalysisFilter ? (
                                        <span className="flex items-center gap-2">
                                            <span className="text-gray-500">{detailedAnalysisFilter}</span>
                                            <Icons.ArrowRight className="w-4 h-4 text-gray-400"/>
                                            <span>세부 업종 분석</span>
                                        </span>
                                    ) : (
                                        "업종별 종합 분석 (구성비 · 프랜차이즈 · 1층 비율)"
                                    )}
                                </h3>
                                {detailedAnalysisFilter ? (
                                     <button onClick={() => setDetailedAnalysisFilter(null)} className="text-sm bg-white border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 flex items-center gap-1 transition text-gray-700 font-medium">
                                        <Icons.ArrowRight className="w-4 h-4 rotate-180" /> 대분류로 돌아가기
                                     </button>
                                ) : (
                                    <span className="text-xs text-gray-500">* 전체 상권 데이터 기준</span>
                                )}
                            </div>
                            <div className="overflow-x-auto custom-scrollbar">
                                <table className="w-full text-sm text-left whitespace-nowrap">
                                    <thead className="bg-gray-100 text-gray-700 font-semibold">
                                        <tr>
                                            <th className="px-3 py-2 md:px-6 md:py-3">업종 ({detailedAnalysisFilter ? '중분류' : '대분류'})</th>
                                            <th className="px-3 py-2 md:px-6 md:py-3 text-right">점포수 ({detailedAnalysisFilter ? '그룹 내 비중' : '구성비'})</th>
                                            {!detailedAnalysisFilter && <th className="px-3 py-2 md:px-6 md:py-3">대표 세부업종</th>}
                                            <th className="px-3 py-2 md:px-6 md:py-3 text-center">프랜차이즈 비율</th>
                                            <th className="px-3 py-2 md:px-6 md:py-3 text-center">1층 점포 비율</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {summaryTableDisplayData.map((item, idx) => (
                                            <tr key={idx} 
                                                className={`hover:bg-gray-50 transition-colors ${!detailedAnalysisFilter ? 'cursor-pointer group' : ''}`}
                                                onClick={() => !detailedAnalysisFilter && setDetailedAnalysisFilter(item.name)}
                                            >
                                                <td className="px-3 py-2 md:px-6 md:py-3 font-medium text-gray-900 flex items-center gap-2">
                                                    {item.name}
                                                    {!detailedAnalysisFilter && <Icons.Search className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />}
                                                </td>
                                                <td className="px-3 py-2 md:px-6 md:py-3 text-right">
                                                    <div className="font-bold">{item.count.toLocaleString()}개</div>
                                                    <div className="text-xs text-gray-500">({item.ratio.toFixed(1)}%)</div>
                                                </td>
                                                {!detailedAnalysisFilter && <td className="px-3 py-2 md:px-6 md:py-3 text-gray-600">{item.topMid}</td>}
                                                <td className="px-3 py-2 md:px-6 md:py-3">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <span className="w-12 text-right font-medium text-green-600">{item.franchiseRatio.toFixed(1)}%</span>
                                                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                            <div className="h-full bg-green-500 rounded-full" style={{width: `${item.franchiseRatio}%`}}></div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 md:px-6 md:py-3">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <span className="w-12 text-right font-medium text-orange-600">{item.firstFloorRatio.toFixed(1)}%</span>
                                                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                                            <div className="h-full bg-orange-500 rounded-full" style={{width: `${item.firstFloorRatio}%`}}></div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                         </div>

                         {/* Store List */}
                         <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                            <div className="p-4 md:p-6 border-b bg-gray-50"><h3 className="text-lg font-bold text-gray-800">📌 주요 프랜차이즈 및 유명 브랜드 (가나다순)</h3></div>
                            <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                               <table className="w-full text-left text-sm text-gray-600">
                                  <thead className="bg-gray-100 text-gray-700 uppercase font-semibold sticky top-0">
                                     <tr>
                                        <th className="px-2 py-2 md:px-6 md:py-3 whitespace-nowrap">번호</th>
                                        <th className="px-2 py-2 md:px-6 md:py-3 min-w-[200px]">상호명</th>
                                        <th className="px-2 py-2 md:px-6 md:py-3 whitespace-nowrap min-w-[60px]">대분류</th>
                                        <th className="px-2 py-2 md:px-6 md:py-3 whitespace-nowrap min-w-[80px]">중분류</th>
                                        <th className="px-2 py-2 md:px-6 md:py-3 min-w-[150px]">주소</th>
                                     </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                     {topStores.map((s,i) => {
                                        const isMajorStore = MAJOR_BRANDS.some(brand => s.bizesNm.includes(brand));
                                        return (
                                            <tr key={i} className={`hover:bg-gray-50 ${isMajorStore ? 'bg-yellow-50' : ''}`}>
                                               <td className="px-2 py-2 md:px-6 md:py-3 font-bold text-gray-500">{i + 1}</td>
                                               <td className="px-2 py-2 md:px-6 md:py-3 font-medium text-gray-900">
                                                  <div className="flex items-center gap-2">
                                                      {isMajorStore && <Icons.Star className="w-4 h-4 text-yellow-500 fill-yellow-500 flex-shrink-0" title="파워 브랜드" />}
                                                      <span>{s.bizesNm}</span>
                                                  </div>
                                                  <div className="mt-1 flex gap-1">
                                                      {s.brchNm && <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">지점: {s.brchNm}</span>}
                                                      {["1","1층","지상1층"].includes(s.flrNo) && <span className="text-xs text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded font-medium">1F</span>}
                                                  </div>
                                               </td>
                                               <td className="px-2 py-2 md:px-6 md:py-3"><span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">{s.indsLclsNm}</span></td>
                                               <td className="px-2 py-2 md:px-6 md:py-3">{s.indsMclsNm}</td>
                                               <td className="px-2 py-2 md:px-6 md:py-3 text-gray-500 truncate max-w-xs" title={s.rdnmAdr}>{s.rdnmAdr}</td>
                                            </tr>
                                        );
                                     })}
                                     {topStores.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">프랜차이즈 데이터 없음</td></tr>}
                                  </tbody>
                               </table>
                            </div>
                         </div>
                     </div>
                 </div>

                 {/* AD Placement 3: Bottom of the page */}
                 <GoogleAd slot="3283674157" />
             </div>
         </div>
      )}

      {loading && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
             <div className="bg-white p-6 rounded-xl shadow-xl flex items-center gap-4">
                 <div className="loading-spinner" />
                 <span className="text-gray-800 font-medium">{loadingMsg}</span>
             </div>
          </div>
      )}

      </div>
      
    </div>
  );
};

export default App;