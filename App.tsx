import React, { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Sector, Legend } from 'recharts';
import * as Icons from './components/Icons';
import TradeMap from './components/Map';
import GoogleAd from './components/GoogleAd';
import { searchAddress, searchZones, fetchStores, searchAdminDistrict, fetchStoresInAdmin, fetchLocalAdminPolygon, fetchSbizData, fetchSeoulSalesData, getAdminCodeFromCoords } from './services/api';
import { Zone, Store, StoreStats, SbizStats, SeoulSalesData } from './types';

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

// Custom Legend Component to handle pointer cursor and opacity
const CustomLegend = (props: any) => {
  const { payload, selectedIndustry, onSelect } = props;
  
  // payload 데이터를 값(value) 기준으로 내림차순 정렬
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
  
  // Search Settings
  const [searchType, setSearchType] = useState<'trade' | 'admin'>('trade'); 

  const [searchCoords, setSearchCoords] = useState<{lat: number, lon: number}>({ lat: 37.5665, lon: 126.9780 });
  const [resolvedAddress, setResolvedAddress] = useState("");
  const [foundZones, setFoundZones] = useState<Zone[]>([]);
  const [tradeZone, setTradeZone] = useState<Zone | null>(null);
  const [previewZone, setPreviewZone] = useState<Zone | null>(null);
  
  const [storeStats, setStoreStats] = useState<StoreStats | null>(null);
  const [sbizStats, setSbizStats] = useState<SbizStats | null>(null);
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
                  console.warn(`Failed to load polygon for ${z.mainTrarNm}`, e);
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

  const handleAnalyzeZone = async (selectedZone: Zone) => {
    setLoading(true); setLoadingMsg("상권 상세 데이터를 분석하고 있습니다..."); setError(null);
    setTradeZone(selectedZone);
    setStep('result');
    setSelectedLarge(null); setSelectedMid(null);
    setSelectedBuildingIndex(null);
    setDetailedAnalysisFilter(null);
    setSbizStats(null);
    setSeoulSales(null);
    setSelectedSeoulIndustry(null);

    try {
      let stores: Store[] = [];
      let stdrYm = "";

      // Fetch Stores & Sbiz Data
      if (selectedZone.type === 'admin' && selectedZone.adminCode && selectedZone.adminLevel) {
          const [storeResult, sbizResult, seoulResult] = await Promise.all([
             fetchStoresInAdmin(selectedZone.adminCode, selectedZone.adminLevel, (msg) => setLoadingMsg(msg)),
             fetchSbizData(selectedZone.adminCode),
             selectedZone.adminCode.startsWith('11') ? fetchSeoulSalesData(selectedZone.adminCode) : Promise.resolve(null)
          ]);
          stores = storeResult.stores;
          stdrYm = storeResult.stdrYm;
          setSbizStats(sbizResult);
          setSeoulSales(seoulResult);
      } else {
          // Trade Mode
          const result = await fetchStores(selectedZone.trarNo, (msg) => setLoadingMsg(msg));
          stores = result.stores;
          stdrYm = result.stdrYm;

          // Attempt to fetch Seoul Sales Data for Trade Zone
          if (selectedZone.searchLat && selectedZone.searchLon) {
               setLoadingMsg("행정동 매출 데이터를 추가 조회중입니다...");
               const adminCode = await getAdminCodeFromCoords(selectedZone.searchLat, selectedZone.searchLon);
               if (adminCode && adminCode.startsWith('11')) {
                   const seoulData = await fetchSeoulSalesData(adminCode);
                   setSeoulSales(seoulData);
               }
          }
      }
      
      const rawDate = stdrYm || stores[0]?.stdrYm || selectedZone.stdrYm || "";
      const cleanDate = rawDate.replace(/[^0-9]/g, '');
      const fmtDate = cleanDate.length >= 6 ? `${cleanDate.substring(0,4)}년 ${cleanDate.substring(4,6)}월` : rawDate;
      
      setDataDate(fmtDate);
      setAllRawStores(stores);
      analyzeData(stores);
    } catch (err: any) {
      setError("상세 데이터 로딩 실패: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const analyzeData = (stores: Store[], largeFilter?: string | null, midFilter?: string | null) => {
    if (!stores.length) return;

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

    const lCounts: Record<string, number> = {};
    const mCounts: Record<string, number> = {};
    const bCounts: Record<string, number> = {};
    const bInfo: Record<string, any> = {};
    let fFloor = 0;
    let franchise = 0;

    filtered.forEach(s => {
       if(!largeFilter) lCounts[s.indsLclsNm || "기타"] = (lCounts[s.indsLclsNm || "기타"] || 0) + 1;
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
    const isFranchiseStore = (s: Store) => (s.brchNm && s.brchNm.trim() !== "") || (s.bizesNm.includes("점") && !s.bizesNm.includes("상점"));

    const sortedStores = [...filtered].sort((a, b) => {
        const aMajor = isMajor(a.bizesNm);
        const bMajor = isMajor(b.bizesNm);
        if (aMajor && !bMajor) return -1;
        if (!aMajor && bMajor) return 1;
        if (aMajor === bMajor) {
            const aFran = isFranchiseStore(a);
            const bFran = isFranchiseStore(b);
            if (aFran && !bFran) return -1;
            if (!aFran && bFran) return 1;
        }
        const aFloor1 = (a.flrNo === '1' || a.flrNo === '1층' || a.flrNo === '지상1층') ? 1 : 0;
        const bFloor1 = (b.flrNo === '1' || b.flrNo === '1층' || b.flrNo === '지상1층') ? 1 : 0;
        if(aFloor1 !== bFloor1) return bFloor1 - aFloor1;
        const aHasBranch = (a.brchNm && a.brchNm.trim()) ? 1 : 0;
        const bHasBranch = (b.brchNm && b.brchNm.trim()) ? 1 : 0;
        if (aHasBranch !== bHasBranch) return bHasBranch - aHasBranch;
        return (a.bizesNm || "").localeCompare(b.bizesNm || "");
    });

    setStoreStats({
        totalStores: filtered.length,
        pieData: globalPieData,
        barData: fullBarData.slice(0, 10),
        fullBarData,
        buildingData,
        floorData: [{ name: '1층 점포', value: fFloor }, { name: '그 외 층', value: filtered.length - fFloor }],
        franchiseRate: filtered.length ? ((franchise/filtered.length)*100).toFixed(1) : "0",
        summaryTableData
    });
    setTopStores(sortedStores.slice(0, 50));
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

  // Derived Seoul Sales Data based on Filter
  const currentSeoulData = useMemo(() => {
      if (!seoulSales) return null;
      if (selectedSeoulIndustry && seoulSales.byIndustry) {
          return seoulSales.byIndustry.find(i => i.serviceName === selectedSeoulIndustry) || seoulSales;
      }
      return seoulSales;
  }, [seoulSales, selectedSeoulIndustry]);

  // Prepare Pie Chart Data for Seoul Industries
  const seoulIndustryPieData = useMemo(() => {
      if (!seoulSales || !seoulSales.byIndustry) return [];
      const mode = salesViewMode === 'amount' ? 'totalAmount' : 'totalCount';
      return seoulSales.byIndustry
          .map(item => ({ name: item.serviceName || '기타', value: item[mode] }))
          .sort((a, b) => b.value - a.value) // Sort by value desc
          .filter(d => d.value > 0)
          .slice(0, 10); // Show Top 10 only for readability
  }, [seoulSales, salesViewMode]);

  const reset = () => {
      setStep("input"); setAddress(""); setFoundZones([]); setTradeZone(null); 
      setAllRawStores([]); setStoreStats(null); setSbizStats(null); setDataDate(null);
      setSelectedBuildingIndex(null); setDetailedAnalysisFilter(null);
      setSeoulSales(null); setSelectedSeoulIndustry(null);
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
            aria-label="메인 화면으로 이동"
         >
            <div className="flex items-center gap-3 mb-4 transition-transform duration-300 group-hover:-translate-y-1">
                <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 rounded-xl shadow-lg shadow-blue-200">
                    <Icons.Store className="w-6 h-6 md:w-8 md:h-8 text-white" strokeWidth={2.5} />
                </div>
                <h1 className="text-3xl md:text-4xl font-black text-gray-800 tracking-tight">
                    주소기반 <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-600">상권분석</span>
                </h1>
            </div>
            <div className="h-6 flex items-center justify-center">
                {dataDate ? (
                    <span className="text-blue-700 font-semibold bg-blue-50 px-3 py-0.5 rounded-full text-xs border border-blue-100 flex items-center gap-1 animate-fade-in">
                        <Icons.TrendingUp className="w-3 h-3"/> {dataDate} 데이터 기준
                    </span>
                ) : (
                    <p className="text-sm text-gray-400 font-light tracking-wide group-hover:text-blue-500 transition-colors">Commercial Area Analysis Service</p>
                )}
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
                       onClick={() => setSearchType('trade')}
                       className={`px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${searchType === 'trade' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                   >
                       주요 상권 기준
                   </button>
                   <button 
                       onClick={() => setSearchType('admin')}
                       className={`px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${searchType === 'admin' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                   >
                       행정 구역 기준
                   </button>
               </div>
           </div>

           <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6">분석할 지역의 주소를 입력해주세요</h2>
           
           <div className="flex flex-col gap-2 mb-4">
              <div className="flex flex-col md:flex-row gap-2">
                  <input value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleGeocode()} className="w-full md:flex-1 p-3 md:p-4 border border-gray-300 rounded-xl text-base md:text-lg outline-none focus:ring-2 focus:ring-blue-500" placeholder="예: 테헤란로 000" />
                  <button onClick={handleGeocode} disabled={loading} className={`w-full md:w-auto text-white py-3 md:py-0 px-8 rounded-xl font-bold hover:opacity-90 disabled:bg-gray-400 transition flex items-center justify-center gap-2 ${searchType === 'trade' ? 'bg-blue-600' : 'bg-green-600'}`}>
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
                    공개된 상권 데이터를 기반으로, 
                    특정 지역(주소) 주변의 <strong>점포 현황, 업종 분포, 프랜차이즈 비율</strong> 등을 
                    분석하여 제공하는 무료 웹 서비스입니다. 
                    {searchType === 'trade' ? '상가 밀집 구역(주요 상권)을 중심으로' : '행정 구역을 기준으로'} 데이터를 분석합니다.
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
                        <span>분석 기준(주요 상권/행정 구역)을 선택하고, 주소를 입력하여 검색합니다.</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center font-bold text-xs text-gray-700">2</span>
                        <span>지도에서 검색된 위치가 맞는지 확인하고, '분석하기' 버튼을 클릭합니다.</span>
                    </li>
                    <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center font-bold text-xs text-gray-700">3</span>
                        <span>검색된 상권 목록 중 원하는 곳을 선택하여 상세 리포트를 확인합니다.</span>
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
                            <Icons.PieChartIcon className="w-4 h-4 text-blue-500 mt-0.5"/>
                            <span><strong>업종별 구성비:</strong> 대분류(음식, 소매 등) 및 중분류별 점포 수와 비율 차트</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Icons.Store className="w-4 h-4 text-green-500 mt-0.5"/>
                            <span><strong>프랜차이즈 분석:</strong> 전체 점포 중 프랜차이즈 가맹점 비율 추정치</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Icons.Layers className="w-4 h-4 text-orange-500 mt-0.5"/>
                            <span><strong>1층 점포 비율:</strong> 유동인구 접근성이 좋은 1층 점포의 비중 분석</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <Icons.Building className="w-4 h-4 text-indigo-500 mt-0.5"/>
                            <span><strong>상가 밀집 건물:</strong> 해당 상권 내 점포가 가장 많이 입점한 주요 건물 Top 5</span>
                        </li>
                    </ul>
                </div>
            </section>

            <section className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                <p className="text-xs text-gray-500 leading-relaxed text-center">
                    * 본 서비스는 API로 데이터를 호출하므로, 갱신 시점에 따라 실제 현황과 다소 차이가 있을 수 있습니다.
                </p>
            </section>
        </div>
        </>
      )}

      {/* 2. Verify Map */}
      {step === 'verify_location' && (
        <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mb-8 border border-blue-100 animate-fade-in">
           <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Icons.MapPin className="text-blue-500"/> 검색 위치 확인</h3>
           <p className="text-sm text-gray-600 mb-4">위치가 정확한지 확인하고, 필요하면 <strong>마커를 드래그</strong>하여 조정해주세요.</p>
           <div className="h-80 w-full rounded-lg overflow-hidden border border-gray-300 mb-4 relative z-0">
              <TradeMap lat={searchCoords.lat} lon={searchCoords.lon} draggable={true} onDragEnd={(lat, lon) => setSearchCoords({lat, lon})} />
           </div>
           <div className="text-sm text-gray-500 mb-4 bg-gray-50 p-3 rounded">검색 결과: <strong>{resolvedAddress}</strong></div>
           <button onClick={handleSearchZones} disabled={loading} className={`w-full text-white px-4 py-3 md:px-6 md:py-4 rounded-lg font-bold hover:opacity-90 transition flex items-center justify-center gap-2 shadow-lg ${searchType === 'trade' ? 'bg-blue-600' : 'bg-green-600'}`}>
                {loading ? '정보 조회 중...' : (searchType === 'trade' ? '📍 이 위치 주변 상권 분석하기' : '🏢 이 위치의 행정구역 분석하기')}
           </button>
           {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
        </div>
      )}

      {/* 3. Zone Select */}
      {step === 'select_zone' && (
         <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mb-8 border border-blue-100 animate-fade-in">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Icons.List className="text-blue-500"/> 
                {searchType === 'trade' ? `주변 상권 선택 (${foundZones.length}개)` : '분석 대상 행정구역 선택'}
            </h3>
            <div className="grid grid-cols-1 gap-4">
                {foundZones.map((z, i) => (
                    <div key={i} className={`border rounded-xl p-4 transition-all duration-300 ${previewZone?.trarNo === z.trarNo ? 'border-blue-500 bg-blue-50 shadow-md' : 'hover:border-blue-300 bg-white hover:shadow-sm'}`}>
                        <div onClick={() => setPreviewZone(prev => prev?.trarNo === z.trarNo ? null : z)} className="cursor-pointer flex justify-between items-center">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs px-2 py-1 rounded font-medium ${searchType === 'trade' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                                        {searchType === 'trade' ? `상권번호 ${z.trarNo}` : '행정동'}
                                    </span>
                                    <h4 className="font-bold text-gray-800 text-lg">{z.mainTrarNm}</h4>
                                </div>
                                <div className="text-sm text-gray-500">{z.ctprvnNm} {z.signguNm} {Number(z.trarArea) > 0 && `| ${Number(z.trarArea).toLocaleString()}㎡`}</div>
                            </div>
                            {previewZone?.trarNo === z.trarNo ? <Icons.ChevronUp className="text-gray-400 w-6 h-6"/> : <Icons.ChevronDown className="text-gray-400 w-6 h-6"/>}
                        </div>
                        {previewZone?.trarNo === z.trarNo && (
                            <div className="mt-4 pt-4 border-t border-blue-200 animate-fade-in">
                                 {(z.parsedPolygon && z.parsedPolygon.length > 0) || searchType === 'trade' ? (
                                     <div className="h-64 w-full rounded-lg overflow-hidden border border-gray-300 mb-3 relative z-0">
                                        <TradeMap lat={z.searchLat!} lon={z.searchLon!} polygonCoords={z.parsedPolygon} tradeName={z.mainTrarNm}/>
                                     </div>
                                 ) : (
                                     <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-3 text-center text-gray-500 text-sm">
                                         * 해당 행정구역의 상세 경계 데이터를 불러오지 못했습니다. (데이터 없음)
                                     </div>
                                 )}
                                 <button onClick={(e) => { e.stopPropagation(); handleAnalyzeZone(z); }} className={`w-full text-white px-6 py-3 rounded-lg font-bold hover:opacity-90 transition flex items-center justify-center gap-2 ${searchType === 'trade' ? 'bg-blue-600' : 'bg-green-600'}`}>
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
             <div className="flex border-b border-gray-200 mb-6 overflow-x-auto gap-2">
                <button className={`tab-btn whitespace-nowrap active`}>
                    <Icons.MapPin className="inline-block w-4 h-4 mr-1"/> 상권 현황
                </button>
             </div>

             <div className="space-y-6 animate-fade-in">
                 {/* Main Card */}
                 <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                    <div className={`bg-gradient-to-r p-4 md:p-6 text-white flex flex-col md:flex-row justify-between items-center ${tradeZone.type === 'admin' ? 'from-green-500 to-teal-600' : 'from-blue-500 to-indigo-600'}`}>
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
                    {/* Map is shown only if we have coordinates or polygon */}
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
                                <span className="text-sm text-gray-500 font-medium mr-2">{seoulSales.stdrYearQuarter} 분기 기준</span>
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
                                                    outerRadius={90}
                                                    innerRadius={50}
                                                    onClick={(data) => setSelectedSeoulIndustry(prev => prev === data.name ? null : data.name)}
                                                    cursor="pointer"
                                                    paddingAngle={2}
                                                    label={({ name, percent, value }) => 
                                                       `${name} ${(percent * 100).toFixed(0)}%`
                                                    }
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
                                                <Tooltip 
                                                    formatter={(value: number) => 
                                                        salesViewMode === 'amount' 
                                                            ? `${(value).toLocaleString()}원` 
                                                            : `${value.toLocaleString()}건`
                                                    } 
                                                />
                                                <Legend 
                                                    layout="vertical" 
                                                    verticalAlign="middle" 
                                                    align="right"
                                                    content={
                                                      <CustomLegend 
                                                        selectedIndustry={selectedSeoulIndustry} 
                                                        onSelect={(name: string) => setSelectedSeoulIndustry(prev => prev === name ? null : name)} 
                                                      />
                                                    }
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="text-center mt-2 text-xs text-gray-500">
                                        * 범례 또는 차트를 클릭하여 해당 업종으로 필터링할 수 있습니다.
                                    </div>
                                </div>
                            )}

                            {/* Right: Day of Week Analysis */}
                            <div className="w-full lg:w-1/2 bg-white border rounded-xl p-4">
                                <h4 className="font-bold text-gray-700 mb-3 text-sm">요일별 {salesViewMode === 'amount' ? '매출' : '건수'} 분석</h4>
                                <div className="flex flex-col gap-3 h-full justify-center">
                                    {/* Peak Day */}
                                    <div className="bg-gray-50 p-3 rounded-lg flex justify-between items-center mb-4">
                                        <span className="text-xs text-gray-500 font-bold">가장 높은 요일</span>
                                        {(() => {
                                            const source = salesViewMode === 'amount' ? currentSeoulData.dayAmount : currentSeoulData.dayCount;
                                            const keys = Object.keys(source);
                                            if (keys.length === 0) return <span>-</span>;
                                            const peakDay = keys.reduce((a, b) => source[a] > source[b] ? a : b);
                                            const mapDay: any = { MON:'월', TUE:'화', WED:'수', THU:'목', FRI:'금', SAT:'토', SUN:'일' };
                                            return <span className="text-lg font-black text-indigo-600">{mapDay[peakDay]}요일</span>;
                                        })()}
                                    </div>
                                    {/* List */}
                                    <div className="grid grid-cols-7 gap-1 text-center h-[180px]">
                                        {['MON','TUE','WED','THU','FRI','SAT','SUN'].map((d) => {
                                            const mapDay: any = { MON:'월', TUE:'화', WED:'수', THU:'목', FRI:'금', SAT:'토', SUN:'일' };
                                            const val = salesViewMode === 'amount' ? currentSeoulData.dayAmount[d] : currentSeoulData.dayCount[d];
                                            // Simple bar height calc
                                            const maxVal = Math.max(...Object.values(salesViewMode === 'amount' ? currentSeoulData.dayAmount : currentSeoulData.dayCount)) || 1;
                                            const percent = (val / maxVal) * 100;
                                            const unit = salesViewMode === 'amount' ? '원' : '건';

                                            return (
                                                <div key={d} className="flex flex-col items-center gap-1 h-full justify-end">
                                                    <div className="w-full bg-gray-100 rounded-t-sm relative h-full flex items-end justify-center">
                                                        <div className="w-full bg-indigo-400 rounded-t-sm opacity-80 transition-all duration-500" style={{ height: `${percent}%` }}></div>
                                                    </div>
                                                    <span className="text-xs font-bold text-gray-600">{mapDay[d]}</span>
                                                    <span className="text-[10px] text-gray-400 scale-90 tracking-tighter">
                                                        {val.toLocaleString()}{unit}
                                                    </span>
                                                </div>
                                            )
                                        })}
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
                                    ? <>{(currentSeoulData.totalAmount).toLocaleString()}<span className="text-lg text-gray-500 ml-1">원</span></>
                                    : <>{(currentSeoulData.totalCount).toLocaleString()}<span className="text-lg text-gray-500 ml-1">건</span></>
                                }
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                            {/* 1. Weekday vs Weekend */}
                            <div className="bg-white border rounded-xl p-4">
                                <h4 className="font-bold text-gray-700 mb-4 flex items-center gap-2 text-sm">주중 / 주말 비율</h4>
                                <div className="h-40 flex items-center justify-center relative">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={[
                                                    { name: '주중', value: salesViewMode === 'amount' ? currentSeoulData.weekdayAmount : currentSeoulData.weekdayCount },
                                                    { name: '주말', value: salesViewMode === 'amount' ? currentSeoulData.weekendAmount : currentSeoulData.weekendCount }
                                                ]}
                                                cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value"
                                            >
                                                <Cell fill="#6366f1" /> {/* Indigo */}
                                                <Cell fill="#f43f5e" /> {/* Rose */}
                                            </Pie>
                                            <Tooltip formatter={(val: number) => val.toLocaleString()} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <div className="text-center text-xs text-gray-500">
                                            <div>주중</div>
                                            <div className="font-bold text-indigo-600">
                                                {(( (salesViewMode==='amount' ? currentSeoulData.weekdayAmount : currentSeoulData.weekdayCount) / (salesViewMode==='amount' ? currentSeoulData.totalAmount : currentSeoulData.totalCount || 1) ) * 100).toFixed(0)}%
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1 text-xs mt-2 text-gray-600">
                                    {(() => {
                                        const wd = salesViewMode === 'amount' ? currentSeoulData.weekdayAmount : currentSeoulData.weekdayCount;
                                        const we = salesViewMode === 'amount' ? currentSeoulData.weekendAmount : currentSeoulData.weekendCount;
                                        const total = wd + we || 1;
                                        return (
                                            <>
                                                <div className="flex justify-between items-center"><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-indigo-500"></div>주중</span> <span>{wd.toLocaleString()} ({((wd/total)*100).toFixed(1)}%)</span></div>
                                                <div className="flex justify-between items-center"><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-rose-500"></div>주말</span> <span>{we.toLocaleString()} ({((we/total)*100).toFixed(1)}%)</span></div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* 2. Gender Ratio */}
                            <div className="bg-white border rounded-xl p-4">
                                <h4 className="font-bold text-gray-700 mb-4 flex items-center gap-2 text-sm">남성 / 여성 비율</h4>
                                <div className="h-40 flex items-center justify-center relative">
                                     <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={[
                                                    { name: '남성', value: salesViewMode === 'amount' ? currentSeoulData.genderAmount.male : currentSeoulData.genderCount.male },
                                                    { name: '여성', value: salesViewMode === 'amount' ? currentSeoulData.genderAmount.female : currentSeoulData.genderCount.female }
                                                ]}
                                                cx="50%" cy="50%" innerRadius={40} outerRadius={60} dataKey="value"
                                            >
                                                <Cell fill="#3b82f6" /> {/* Blue */}
                                                <Cell fill="#ec4899" /> {/* Pink */}
                                            </Pie>
                                            <Tooltip formatter={(val: number) => val.toLocaleString()} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="flex flex-col gap-1 text-xs mt-2 text-gray-600">
                                    {(() => {
                                        const m = salesViewMode === 'amount' ? currentSeoulData.genderAmount.male : currentSeoulData.genderCount.male;
                                        const f = salesViewMode === 'amount' ? currentSeoulData.genderAmount.female : currentSeoulData.genderCount.female;
                                        const total = m + f || 1;
                                        return (
                                            <>
                                                <div className="flex justify-between items-center"><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div>남성</span> <span>{m.toLocaleString()} ({((m/total)*100).toFixed(1)}%)</span></div>
                                                <div className="flex justify-between items-center"><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-pink-500"></div>여성</span> <span>{f.toLocaleString()} ({((f/total)*100).toFixed(1)}%)</span></div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>

                        {/* 3. Time Slot Analysis & Age Analysis Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Time Slot */}
                            <div className="bg-white border rounded-xl p-4">
                                <h4 className="font-bold text-gray-700 mb-3 text-sm">시간대별 분석</h4>
                                <div className="text-xs space-y-3">
                                    {Object.keys(currentSeoulData.timeAmount).map(t => {
                                        const val = salesViewMode === 'amount' ? currentSeoulData.timeAmount[t] : currentSeoulData.timeCount[t];
                                        const maxVal = Math.max(...Object.values(salesViewMode === 'amount' ? currentSeoulData.timeAmount : currentSeoulData.timeCount)) || 1;
                                        const unit = salesViewMode === 'amount' ? '원' : '건';
                                        
                                        return (
                                            <div key={t} className="flex items-center gap-2">
                                                <span className="w-12 text-gray-500 font-medium">{t.replace('_', '~')}시</span>
                                                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden max-w-[50%]">
                                                    <div className="h-full bg-green-400 rounded-full transition-all duration-500" style={{ width: `${(val/maxVal)*100}%` }}></div>
                                                </div>
                                                <span className="flex-1 text-right text-gray-700 font-medium truncate">{val.toLocaleString()}{unit}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Age Analysis */}
                            <div className="bg-white border rounded-xl p-4">
                                <h4 className="font-bold text-gray-700 mb-3 text-sm">연령대별 분석</h4>
                                <div className="text-xs space-y-3">
                                    {Object.keys(currentSeoulData.ageAmount).map(a => {
                                        const val = salesViewMode === 'amount' ? currentSeoulData.ageAmount[a] : currentSeoulData.ageCount[a];
                                        const maxVal = Math.max(...Object.values(salesViewMode === 'amount' ? currentSeoulData.ageAmount : currentSeoulData.ageCount)) || 1;
                                        const unit = salesViewMode === 'amount' ? '원' : '건';

                                        return (
                                            <div key={a} className="flex items-center gap-2">
                                                <span className="w-10 text-gray-500 font-medium">{a}대</span>
                                                <div className="w-1/2 h-3 bg-gray-100 rounded-full overflow-hidden">
                                                    <div className="h-full bg-orange-400 rounded-full transition-all duration-500" style={{ width: `${(val/maxVal)*100}%` }}></div>
                                                </div>
                                                <span className="flex-1 text-right text-gray-700 font-medium truncate pl-2">{val.toLocaleString()}{unit}</span>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                 )}

                 {/* Sbiz Stats Section (Only for Admin Zone) */}
                 {tradeZone.type === 'admin' && sbizStats && (
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in">
                        {/* 1. Population */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                             <div className="bg-blue-100 p-2 rounded-full mb-2"><Icons.Users className="w-5 h-5 text-blue-600"/></div>
                             <h4 className="text-sm text-gray-500 font-medium">일 평균 유동인구</h4>
                             <p className="text-xl md:text-2xl font-bold text-gray-800 mt-1">{sbizStats.population?.total || "-"}</p>
                             <span className="text-xs text-gray-400 mt-1">{sbizStats.population?.date || ""} 기준</span>
                        </div>
                        {/* 2. Max Revenue */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                             <div className="bg-yellow-100 p-2 rounded-full mb-2"><Icons.Wallet className="w-5 h-5 text-yellow-600"/></div>
                             <h4 className="text-sm text-gray-500 font-medium">매출 1위 업종</h4>
                             <p className="text-lg md:text-xl font-bold text-gray-800 mt-1 break-keep leading-tight px-1">{sbizStats.maxSales?.type || "-"}</p>
                             <div className="text-xs text-gray-400 mt-1 flex flex-col items-center">
                                 <span>월 평균 매출 {sbizStats.maxSales?.amount.toLocaleString()}만원 ({sbizStats.maxSales?.percent}%)</span>
                                 <span className="text-[10px] text-gray-300 mt-0.5">{sbizStats.maxSales?.date} 기준</span>
                             </div>
                        </div>
                        {/* 3. Delivery */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                             <div className="bg-green-100 p-2 rounded-full mb-2"><Icons.Truck className="w-5 h-5 text-green-600"/></div>
                             <h4 className="text-sm text-gray-500 font-medium">배달 피크 요일</h4>
                             <p className="text-xl md:text-2xl font-bold text-gray-800 mt-1">{sbizStats.delivery?.day ? `${sbizStats.delivery.day}요일` : "-"}</p>
                             <div className="text-xs text-gray-400 mt-1 flex flex-col items-center">
                                 <span>월 평균 {sbizStats.delivery?.count}건 ({Number(sbizStats.delivery?.percent).toFixed(1)}%)</span>
                                 <span className="text-[10px] text-gray-300 mt-0.5">{sbizStats.delivery?.date} 기준</span>
                             </div>
                        </div>
                        {/* 4. Age Rank */}
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                             <div className="bg-purple-100 p-2 rounded-full mb-2"><Icons.Star className="w-5 h-5 text-purple-600 fill-purple-600"/></div>
                             <h4 className="text-sm text-gray-500 font-medium">주 방문 연령층(일 평균)</h4>
                             <div className="mt-2 flex flex-col gap-1 w-full px-2">
                                 {sbizStats.ageRank?.map((rank, i) => (
                                     <div key={i} className="flex justify-between items-center text-xs">
                                         <span className={`${i === 0 ? 'font-bold text-purple-600' : 'text-gray-600'}`}>
                                            {i+1}위 {rank.age}
                                         </span>
                                         <span className="text-gray-400">{rank.count.toLocaleString()}명</span>
                                     </div>
                                 ))}
                                 {(!sbizStats.ageRank || sbizStats.ageRank.length === 0) && <span className="text-xs text-gray-400">-</span>}
                             </div>
                        </div>
                     </div>
                 )}

                 {/* Summary Cards */}
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                     <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border">
                         <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Icons.Building className="text-indigo-500"/> 상가 밀집 건물 Top 5</h3>
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
                     <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border">
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
                     <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border flex flex-col justify-center items-center text-center">
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

                 {/* AD Placement 1: Between Summary and Charts */}
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

                 {/* AD Placement 2: Between Charts and Detailed Table */}
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