import React, { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Sector } from 'recharts';
import * as Icons from './components/Icons';
import TradeMap from './components/Map';
import GoogleAd from './components/GoogleAd'; // Import Ad Component
import { searchAddress, searchZones, fetchStores } from './services/api';
import { Zone, Store, StoreStats } from './types';

// Constants
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
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

const App: React.FC = () => {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"input" | "verify_location" | "select_zone" | "result">("input");
  
  const [searchCoords, setSearchCoords] = useState<{lat: number, lon: number}>({ lat: 37.5665, lon: 126.9780 });
  const [resolvedAddress, setResolvedAddress] = useState("");
  const [foundZones, setFoundZones] = useState<Zone[]>([]);
  const [tradeZone, setTradeZone] = useState<Zone | null>(null);
  const [previewZone, setPreviewZone] = useState<Zone | null>(null);
  
  const [storeStats, setStoreStats] = useState<StoreStats | null>(null);
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

  // Handlers
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
    setLoading(true); setLoadingMsg("주변 상권 정보를 검색하고 있습니다..."); setError(null);
    try {
      const zones = await searchZones(searchCoords.lat, searchCoords.lon);
      const enhancedZones = zones.map(z => ({
        ...z,
        searchLat: searchCoords.lat,
        searchLon: searchCoords.lon,
        parsedPolygon: parseWKT(z.coords)
      }));
      setFoundZones(enhancedZones);
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

    try {
      // fetchStores returns both stores and the stdrYm extracted from response header
      const { stores, stdrYm } = await fetchStores(selectedZone.trarNo, (msg) => setLoadingMsg(msg));
      
      // Date Fallback Logic: Response Header > First Store Item > Zone Info
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

    // 1. Summary
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

    // 2. Filtering
    let filtered = stores;
    if(largeFilter) filtered = filtered.filter(s => s.indsLclsNm === largeFilter);
    if(midFilter) filtered = filtered.filter(s => s.indsMclsNm === midFilter);

    // 3. Stats Generation
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

    // Top Stores Logic with Priority: Major Brands > Estimated Franchise > Others
    const isMajor = (nm: string) => MAJOR_BRANDS.some(b => nm.includes(b));
    const isFranchiseStore = (s: Store) => (s.brchNm && s.brchNm.trim() !== "") || (s.bizesNm.includes("점") && !s.bizesNm.includes("상점"));

    const sortedStores = [...filtered].sort((a, b) => {
        // Priority 1: Major Brand
        const aMajor = isMajor(a.bizesNm);
        const bMajor = isMajor(b.bizesNm);
        
        if (aMajor && !bMajor) return -1;
        if (!aMajor && bMajor) return 1;

        // Priority 2: Estimated Franchise (if tied on Major status)
        // If both are Major, they are equal here. If both are NOT Major, we check franchise status.
        if (aMajor === bMajor) {
            const aFran = isFranchiseStore(a);
            const bFran = isFranchiseStore(b);
            if (aFran && !bFran) return -1;
            if (!aFran && bFran) return 1;
        }
        
        // Priority 3: 1st Floor
        const aFloor1 = (a.flrNo === '1' || a.flrNo === '1층' || a.flrNo === '지상1층') ? 1 : 0;
        const bFloor1 = (b.flrNo === '1' || b.flrNo === '1층' || b.flrNo === '지상1층') ? 1 : 0;
        if(aFloor1 !== bFloor1) return bFloor1 - aFloor1;

        // Priority 4: Has Branch Name (Secondary check if not caught by logic above)
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
    setTopStores(sortedStores.slice(0, 30));
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
    
    // Default View (Large Category)
    if(!detailedAnalysisFilter) return storeStats.summaryTableData;

    // Drill-down View (Medium Category)
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
        name: g.name,
        count: g.count,
        ratio: totalInGroup ? (g.count / totalInGroup) * 100 : 0,
        franchiseCount: g.franchise,
        franchiseRatio: g.count ? (g.franchise/g.count)*100 : 0,
        firstFloorCount: g.firstFloor,
        firstFloorRatio: g.count ? (g.firstFloor/g.count)*100 : 0,
        topMid: "-" // Not used in this view
    })).sort((a: any, b: any) => b.count - a.count);

  }, [storeStats, detailedAnalysisFilter, allRawStores]);

  const reset = () => {
      setStep("input"); setAddress(""); setFoundZones([]); setTradeZone(null); 
      setAllRawStores([]); setStoreStats(null); setDataDate(null);
      setSelectedBuildingIndex(null);
      setDetailedAnalysisFilter(null);
  };

  return (
    <div className="min-h-screen max-w-6xl mx-auto p-3 md:p-8">
      {/* Header */}
      <header className="mb-8 flex flex-col items-center justify-center gap-4 text-center relative">
         <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">🏪 상권 분석</h1>
            <p className="text-gray-500 flex items-center justify-center gap-2">
                {dataDate && <span className="text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded text-xs">{dataDate} 기준</span>}
            </p>
         </div>
         {step !== 'input' && (
             <button onClick={reset} className="md:absolute md:right-0 md:top-2 bg-gray-100 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-200 transition text-sm flex items-center gap-2">
                 <Icons.Search className="w-4 h-4"/> 처음으로
             </button>
         )}
      </header>

      {/* 1. Input */}
      {step === 'input' && (
        <>
        <div className="bg-white rounded-2xl shadow-lg p-4 md:p-8 max-w-2xl mx-auto mt-6 md:mt-20 text-center animate-fade-in">
           <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6">분석할 지역의 주소를 입력해주세요</h2>
           <div className="flex flex-col gap-2 mb-4">
              <div className="flex flex-col md:flex-row gap-2">
                  <input value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleGeocode()} className="w-full md:flex-1 p-3 md:p-4 border border-gray-300 rounded-xl text-base md:text-lg outline-none focus:ring-2 focus:ring-blue-500" placeholder="예: 테헤란로 000" />
                  <button onClick={handleGeocode} disabled={loading} className="w-full md:w-auto bg-blue-600 text-white py-3 md:py-0 px-8 rounded-xl font-bold hover:bg-blue-700 disabled:bg-gray-400 transition flex items-center justify-center gap-2">
                     {loading ? <div className="loading-spinner" /> : <><Icons.Search className="w-5 h-5 md:w-6 md:h-6"/><span className="md:hidden">검색</span></>}
                  </button>
              </div>
           </div>
           {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </div>

        {/* Content for AdSense Approval (Valuable Inventory) */}
        <div className="max-w-5xl mx-auto mt-8 md:mt-12 px-2 md:px-4 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
                <div className="space-y-6">
                    <section>
                        <h3 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                            <span className="bg-blue-100 text-blue-600 p-1.5 rounded-lg"><Icons.MapPin className="w-5 h-5"/></span>
                            상권 분석 서비스란?
                        </h3>
                        <p className="text-gray-600 leading-relaxed text-sm md:text-base">
                            공개된 상권 데이터를 기반으로, 
                            특정 지역(주소) 주변의 <strong>점포 현황, 업종 분포, 프랜차이즈 비율</strong> 등을 
                            분석하여 제공하는 무료 웹 서비스입니다. 
                            창업을 준비하거나 상권 현황이 궁금한 분들에게 객관적인 데이터를 시각화하여 보여드립니다.
                        </p>
                    </section>
                    
                    <section>
                        <h3 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                            <span className="bg-green-100 text-green-600 p-1.5 rounded-lg"><Icons.List className="w-5 h-5"/></span>
                            이용 방법
                        </h3>
                        <ul className="space-y-3 text-gray-600 text-sm md:text-base">
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center font-bold text-xs text-gray-700">1</span>
                                <span>분석하고 싶은 지역의 도로명 주소나 지번 주소를 입력창에 입력하고 검색 버튼을 누릅니다.</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center font-bold text-xs text-gray-700">2</span>
                                <span>지도에서 검색된 위치가 맞는지 확인하고, '상권 분석하기' 버튼을 클릭하여 주변 상권 목록을 조회합니다.</span>
                            </li>
                            <li className="flex gap-3">
                                <span className="flex-shrink-0 w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center font-bold text-xs text-gray-700">3</span>
                                <span>원하는 상권 구역을 선택하면, 해당 구역 내의 모든 점포 데이터를 분석한 리포트를 확인할 수 있습니다.</span>
                            </li>
                        </ul>
                    </section>
                </div>

                <div className="space-y-6">
                    <section>
                         <h3 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                            <span className="bg-orange-100 text-orange-600 p-1.5 rounded-lg"><Icons.TrendingUp className="w-5 h-5"/></span>
                            제공하는 주요 데이터
                        </h3>
                        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                            <ul className="grid grid-cols-1 gap-3 text-sm text-gray-700">
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
                        <p className="text-xs text-gray-500 leading-relaxed">
                            * 본 서비스는 API로 데이터를 호출하여 보여줍니다. <br/>
                            * 데이터 갱신 시점에 따라 실제 현황과 일부 차이가 있을 수 있습니다.<br/>
                            * 주소 검색은 국토교통부 V-World API를 활용합니다.
                        </p>
                    </section>
                </div>
            </div>
        </div>

        <div className="max-w-2xl mx-auto mt-12 mb-8 animate-fade-in">
           <GoogleAd slot="2761269289" />
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
           <button onClick={handleSearchZones} disabled={loading} className="w-full bg-blue-600 text-white px-4 py-3 md:px-6 md:py-4 rounded-lg font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg">
                {loading ? '상권 찾는 중...' : '📍 이 위치 주변 상권 분석하기'}
           </button>
           {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
        </div>
      )}

      {/* 3. Zone Select */}
      {step === 'select_zone' && (
         <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 mb-8 border border-blue-100 animate-fade-in">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Icons.List className="text-blue-500"/> 주변 상권 선택 ({foundZones.length}개)</h3>
            <div className="grid grid-cols-1 gap-4">
                {foundZones.map((z, i) => (
                    <div key={i} className={`border rounded-xl p-4 transition-all duration-300 ${previewZone?.trarNo === z.trarNo ? 'border-blue-500 bg-blue-50 shadow-md' : 'hover:border-blue-300 bg-white hover:shadow-sm'}`}>
                        <div onClick={() => setPreviewZone(prev => prev?.trarNo === z.trarNo ? null : z)} className="cursor-pointer flex justify-between items-center">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded font-medium">상권번호 {z.trarNo}</span>
                                    <h4 className="font-bold text-gray-800 text-lg">{z.mainTrarNm}</h4>
                                </div>
                                <div className="text-sm text-gray-500">{z.ctprvnNm} {z.signguNm} | {Number(z.trarArea).toLocaleString()}㎡</div>
                            </div>
                            {previewZone?.trarNo === z.trarNo ? <Icons.ChevronUp className="text-gray-400 w-6 h-6"/> : <Icons.ChevronDown className="text-gray-400 w-6 h-6"/>}
                        </div>
                        {previewZone?.trarNo === z.trarNo && (
                            <div className="mt-4 pt-4 border-t border-blue-200 animate-fade-in">
                                 <div className="h-64 w-full rounded-lg overflow-hidden border border-gray-300 mb-3 relative z-0">
                                    <TradeMap lat={z.searchLat!} lon={z.searchLon!} polygonCoords={z.parsedPolygon} tradeName={z.mainTrarNm}/>
                                 </div>
                                 <button onClick={(e) => { e.stopPropagation(); handleAnalyzeZone(z); }} className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2">
                                    이 상권 분석 시작 <Icons.ArrowRight className="w-4 h-4"/>
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
             <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
                <button className={`tab-btn whitespace-nowrap active`}>
                    <Icons.MapPin className="inline-block w-4 h-4 mr-1"/> 상권 현황
                </button>
             </div>

             <div className="space-y-6 animate-fade-in">
                 {/* Filter Alert */}
                 {(selectedLarge || selectedMid) && (
                    <div className="bg-indigo-50 border-l-4 border-indigo-500 p-4 flex justify-between items-center rounded-r-lg shadow-sm">
                       <div className="flex items-center text-sm text-indigo-700">
                           <Icons.Filter className="h-5 w-5 mr-2 text-indigo-500"/>
                           현재 <strong>{selectedLarge && `'${selectedLarge}'`} {selectedMid && ` > '${selectedMid}'`}</strong> 필터 적용 중
                       </div>
                       <button onClick={() => { setSelectedLarge(null); setSelectedMid(null); }} className="text-sm font-medium text-indigo-600 hover:underline">필터 해제</button>
                    </div>
                 )}

                 {/* Main Card */}
                 <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                    <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-4 md:p-6 text-white flex flex-col md:flex-row justify-between items-center">
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
                 </div>

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
                                     <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] text-white ${selectedBuildingIndex === i ? 'bg-blue-500' : 'bg-red-500'}`}>{i+1}</span>
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

                 {/* Comprehensive Analysis Table (New) */}
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
                    <div className="p-4 md:p-6 border-b bg-gray-50"><h3 className="text-lg font-bold text-gray-800">📌 주요 프랜차이즈 및 유명 브랜드 (Top 30)</h3></div>
                    <div className="overflow-x-auto max-h-96 custom-scrollbar">
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
  );
};

export default App;