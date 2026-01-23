import React, { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Sector } from 'recharts';
import * as Icons from './components/Icons';
import TradeMap from './components/Map';
import { searchAddress, searchZones, fetchStores } from './services/api';
import { Zone, Store, StoreStats, ChartData } from './types';

// Constants
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const MAJOR_BRANDS = [
  "스타벅스", "투썸", "이디야", "메가MGC", "컴포즈", "빽다방", "할리스", "폴바셋", "공차",
  "GS25", "CU", "세븐일레븐", "이마트24", "다이소", "올리브영", "롯데마트", "이마트",
  "파리바게뜨", "뚜레쥬르", "던킨", "배스킨라빈스", "설빙",
  "맥도날드", "버거킹", "롯데리아", "KFC", "맘스터치", "써브웨이", "교촌", "BHC", "BBQ", "도미노"
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

  // Handlers
  const handleGeocode = async () => {
    if (!address) { setError("주소를 입력해주세요."); return; }
    setLoading(true); setLoadingMsg("주소 위치를 확인 중..."); setError(null);
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
    setLoading(true); setLoadingMsg("주변 상권 검색 중..."); setError(null);
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
    setLoading(true); setLoadingMsg("데이터 수집 중..."); setError(null);
    setTradeZone(selectedZone);
    setStep('result');
    setSelectedLarge(null); setSelectedMid(null);

    try {
      const stores = await fetchStores(selectedZone.trarNo, (msg) => setLoadingMsg(msg));
      
      // 날짜 파싱
      const rawDate = stores[0]?.stdrYm || selectedZone.stdrYm || "";
      const fmtDate = rawDate.length >= 6 ? `${rawDate.substring(0,4)}년 ${rawDate.substring(4,6)}월` : rawDate;
      setDataDate(fmtDate);
      
      setAllRawStores(stores);
      analyzeData(stores);
    } catch (err: any) {
      setError("데이터 분석 실패: " + err.message);
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

    const pieData = Object.keys(lCounts).map(k => ({ name: k, value: lCounts[k] })).sort((a,b) => b.value - a.value);
    // If filtered, show breakdown of Mid categories in pie? No, keep logic simple.
    // If largeFilter is active, pieData should effectively be 100% of that large category, but for UI stability we might keep global pie. 
    // Let's stick to global pie for L-Cat, and bar for M-Cat.
    
    // For the Pie Chart, we usually want the distribution of Large Categories of the *current view*.
    // But if a Large Filter is selected, the Pie Chart becomes boring (100%). 
    // Let's keep the Pie Chart showing *All Stores* distribution always, to act as a selector.
    const globalLCounts: Record<string, number> = {};
    stores.forEach(s => globalLCounts[s.indsLclsNm || "기타"] = (globalLCounts[s.indsLclsNm || "기타"] || 0) + 1);
    const globalPieData = Object.keys(globalLCounts).map(k => ({ name: k, value: globalLCounts[k] })).sort((a,b) => b.value - a.value);

    const fullBarData = Object.keys(mCounts).map(k => ({ name: k, count: mCounts[k], value: mCounts[k] })).sort((a,b) => b.count - a.count);
    const buildingData = Object.keys(bCounts).map(k => ({ name: k, count: bCounts[k], value: bCounts[k], lat: bInfo[k]?.lat, lon: bInfo[k]?.lon })).sort((a,b) => b.count - a.count).slice(0, 5);

    // Top Stores Logic
    const isMajor = (nm: string) => MAJOR_BRANDS.some(b => nm.includes(b));
    const sortedStores = [...filtered].sort((a, b) => {
        const aMajor = isMajor(a.bizesNm) ? 1 : 0;
        const bMajor = isMajor(b.bizesNm) ? 1 : 0;
        if(aMajor !== bMajor) return bMajor - aMajor;
        return (a.bizesNm || "").localeCompare(b.bizesNm || "");
    });

    setStoreStats({
        totalStores: filtered.length,
        pieData: globalPieData,
        barData: fullBarData.slice(0, 10),
        fullBarData,
        buildingData,
        floorData: [{ name: '1층', value: fFloor }, { name: '그 외', value: filtered.length - fFloor }],
        franchiseRate: filtered.length ? ((franchise/filtered.length)*100).toFixed(1) : "0",
        summaryTableData
    });
    setTopStores(sortedStores.slice(0, 50));
  };

  // Re-analyze when filters change
  useEffect(() => {
    if(allRawStores.length > 0) analyzeData(allRawStores, selectedLarge, selectedMid);
  }, [selectedLarge, selectedMid, allRawStores]);

  const activePieIndex = useMemo(() => {
     if(!storeStats || !selectedLarge) return -1;
     return storeStats.pieData.findIndex(i => i.name === selectedLarge);
  }, [storeStats, selectedLarge]);

  const reset = () => {
      setStep("input"); setAddress(""); setFoundZones([]); setTradeZone(null); 
      setAllRawStores([]); setStoreStats(null);
  };

  return (
    <div className="min-h-screen max-w-6xl mx-auto p-4 md:p-8">
      {/* Header */}
      <header className="mb-8 text-center relative">
         <h1 className="text-3xl font-bold text-gray-900 mb-2">🏪 상권 분석 대시보드</h1>
         {dataDate && <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded text-xs font-medium">{dataDate} 기준</span>}
         {step !== 'input' && (
             <button onClick={reset} className="absolute right-0 top-0 bg-gray-100 text-gray-600 px-3 py-1 rounded hover:bg-gray-200 text-sm flex items-center gap-1">
                 <Icons.Search className="w-4 h-4"/> 검색 초기화
             </button>
         )}
      </header>

      {/* 1. Input */}
      {step === 'input' && (
        <div className="max-w-xl mx-auto bg-white p-8 rounded-2xl shadow-lg text-center mt-20">
           <h2 className="text-xl font-bold mb-6">분석할 지역 주소를 입력하세요</h2>
           <div className="flex gap-2">
              <input value={address} onChange={e => setAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleGeocode()} className="flex-1 p-3 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500" placeholder="예: 강남대로 000" />
              <button onClick={handleGeocode} disabled={loading} className="bg-blue-600 text-white px-6 rounded-xl hover:bg-blue-700 font-bold">
                 {loading ? "..." : "검색"}
              </button>
           </div>
           {error && <p className="text-red-500 mt-4 text-sm">{error}</p>}
        </div>
      )}

      {/* 2. Verify Map */}
      {step === 'verify_location' && (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-blue-50">
           <h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Icons.MapPin className="text-blue-500"/> 위치 확인</h3>
           <div className="h-80 w-full rounded-lg overflow-hidden border mb-4 relative z-0">
              <TradeMap lat={searchCoords.lat} lon={searchCoords.lon} draggable={true} onDragEnd={(lat, lon) => setSearchCoords({lat, lon})} />
           </div>
           <p className="text-center text-sm text-gray-600 mb-4">{resolvedAddress}</p>
           <button onClick={handleSearchZones} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700">주변 상권 찾기</button>
        </div>
      )}

      {/* 3. Zone Select */}
      {step === 'select_zone' && (
         <div className="grid gap-4">
            <h3 className="font-bold text-lg">상권을 선택하세요 ({foundZones.length}개)</h3>
            {foundZones.map((z, i) => (
                <div key={i} className={`border rounded-xl p-4 cursor-pointer transition ${previewZone?.trarNo === z.trarNo ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'hover:bg-gray-50'}`} onClick={() => setPreviewZone(prev => prev?.trarNo === z.trarNo ? null : z)}>
                    <div className="flex justify-between items-center">
                        <div>
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">No. {z.trarNo}</span>
                            <h4 className="font-bold text-lg">{z.mainTrarNm}</h4>
                            <p className="text-sm text-gray-500">{z.signguNm} | {Number(z.trarArea).toLocaleString()}㎡</p>
                        </div>
                        {previewZone?.trarNo === z.trarNo ? <Icons.ChevronUp/> : <Icons.ChevronDown/>}
                    </div>
                    {previewZone?.trarNo === z.trarNo && (
                        <div className="mt-4 pt-4 border-t border-blue-200">
                             <div className="h-64 w-full rounded-lg overflow-hidden border mb-4 relative z-0">
                                <TradeMap lat={z.searchLat!} lon={z.searchLon!} polygonCoords={z.parsedPolygon} tradeName={z.mainTrarNm}/>
                             </div>
                             <button onClick={(e) => { e.stopPropagation(); handleAnalyzeZone(z); }} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700">분석 시작</button>
                        </div>
                    )}
                </div>
            ))}
         </div>
      )}

      {/* 4. Dashboard */}
      {step === 'result' && storeStats && tradeZone && (
         <div className="space-y-6 animate-fade-in">
             {/* Filter Alert */}
             {(selectedLarge || selectedMid) && (
                <div className="bg-indigo-50 border-l-4 border-indigo-500 p-4 flex justify-between items-center rounded-r shadow-sm">
                   <div className="text-indigo-700 text-sm font-medium">필터: {selectedLarge} {selectedMid && ` > ${selectedMid}`}</div>
                   <button onClick={() => { setSelectedLarge(null); setSelectedMid(null); }} className="text-xs text-indigo-500 underline">초기화</button>
                </div>
             )}

             {/* Main Card */}
             <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-6 text-white flex justify-between items-center">
                   <div>
                      <h2 className="text-2xl font-bold">{tradeZone.mainTrarNm}</h2>
                      <p className="text-sm opacity-90">{tradeZone.ctprvnNm} {tradeZone.signguNm}</p>
                   </div>
                   <div className="text-right">
                      <p className="text-sm opacity-80">총 점포수</p>
                      <p className="text-3xl font-bold">{storeStats.totalStores.toLocaleString()}</p>
                   </div>
                </div>
                <div className="h-80 bg-gray-100 relative z-0">
                    <TradeMap lat={tradeZone.searchLat!} lon={tradeZone.searchLon!} polygonCoords={tradeZone.parsedPolygon} tradeName={tradeZone.mainTrarNm} markers={storeStats.buildingData}/>
                </div>
             </div>

             {/* Summary Cards */}
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="bg-white p-5 rounded-xl shadow border">
                     <h4 className="font-bold text-gray-700 mb-3 flex items-center gap-2"><Icons.Building className="w-4 h-4"/> 상가 밀집 건물</h4>
                     <ul className="space-y-2 text-sm">
                        {storeStats.buildingData.map((b,i) => (
                           <li key={i} className="flex justify-between border-b pb-1 last:border-0">
                              <span className="truncate w-2/3">{i+1}. {b.name}</span>
                              <span className="font-bold text-indigo-600">{b.count}개</span>
                           </li>
                        ))}
                     </ul>
                 </div>
                 <div className="bg-white p-5 rounded-xl shadow border flex flex-col items-center justify-center">
                     <h4 className="font-bold text-gray-700 mb-2">프랜차이즈 비율</h4>
                     <div className="text-4xl font-extrabold text-green-500">{storeStats.franchiseRate}%</div>
                     <p className="text-xs text-gray-400 mt-1">브랜드/체인점 추정</p>
                 </div>
                 <div className="bg-white p-5 rounded-xl shadow border flex flex-col items-center justify-center">
                     <h4 className="font-bold text-gray-700 mb-2">1층 점포 비율</h4>
                     <div className="text-4xl font-extrabold text-orange-500">
                        {storeStats.totalStores ? ((storeStats.floorData[0].value/storeStats.totalStores)*100).toFixed(0) : 0}%
                     </div>
                     <p className="text-xs text-gray-400 mt-1">{storeStats.floorData[0].value}개 점포</p>
                 </div>
             </div>

             {/* Charts */}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 {/* Pie Chart */}
                 <div className="bg-white p-6 rounded-xl shadow border">
                     <div className="flex justify-between mb-4">
                        <h3 className="font-bold text-gray-800">업종별 비중 (대분류)</h3>
                        <div className="flex bg-gray-100 rounded p-1">
                           <button onClick={()=>setViewModeLarge('chart')} className={`p-1 ${viewModeLarge==='chart'?'bg-white shadow':''}`}><Icons.PieChartIcon className="w-4 h-4"/></button>
                           <button onClick={()=>setViewModeLarge('table')} className={`p-1 ${viewModeLarge==='table'?'bg-white shadow':''}`}><Icons.List className="w-4 h-4"/></button>
                        </div>
                     </div>
                     <div className="h-64">
                        {viewModeLarge === 'chart' ? (
                           <ResponsiveContainer>
                              <PieChart>
                                 {/* @ts-ignore */}
                                 <Pie data={storeStats.pieData} activeIndex={activePieIndex} activeShape={renderActiveShape} dataKey="value" cx="50%" cy="50%" outerRadius={80} onClick={(d) => { setSelectedLarge(d.name === selectedLarge ? null : d.name); setSelectedMid(null); }}>
                                    {storeStats.pieData.map((e,i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={selectedLarge && selectedLarge !== e.name ? 0.3 : 1} />)}
                                 </Pie>
                                 <Tooltip/>
                              </PieChart>
                           </ResponsiveContainer>
                        ) : (
                           <div className="h-full overflow-y-auto custom-scrollbar">
                              <table className="w-full text-sm text-left">
                                 <tbody>
                                    {storeStats.pieData.map((d,i) => (
                                       <tr key={i} className={`cursor-pointer hover:bg-gray-50 ${selectedLarge===d.name?'bg-blue-50':''}`} onClick={()=>{setSelectedLarge(d.name===selectedLarge?null:d.name); setSelectedMid(null);}}>
                                          <td className="p-2 border-b">{d.name}</td>
                                          <td className="p-2 border-b text-right font-bold">{d.value}</td>
                                       </tr>
                                    ))}
                                 </tbody>
                              </table>
                           </div>
                        )}
                     </div>
                 </div>
                 
                 {/* Bar Chart */}
                 <div className="bg-white p-6 rounded-xl shadow border">
                     <div className="flex justify-between mb-4">
                        <h3 className="font-bold text-gray-800">상세 업종 Top 10</h3>
                        <div className="flex bg-gray-100 rounded p-1">
                           <button onClick={()=>setViewModeMid('chart')} className={`p-1 ${viewModeMid==='chart'?'bg-white shadow':''}`}><Icons.BarChart2 className="w-4 h-4"/></button>
                           <button onClick={()=>setViewModeMid('table')} className={`p-1 ${viewModeMid==='table'?'bg-white shadow':''}`}><Icons.List className="w-4 h-4"/></button>
                        </div>
                     </div>
                     <div className="h-64">
                         {viewModeMid === 'chart' ? (
                            <ResponsiveContainer>
                               <BarChart layout="vertical" data={storeStats.barData}>
                                  <XAxis type="number" hide/>
                                  <YAxis dataKey="name" type="category" width={90} tick={{fontSize:11}}/>
                                  <Tooltip/>
                                  <Bar dataKey="count" fill="#82ca9d" radius={[0,4,4,0]} onClick={(d) => setSelectedMid(d.name === selectedMid ? null : d.name)}>
                                     {storeStats.barData.map((e,i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={selectedMid && selectedMid !== e.name ? 0.3 : 1}/>)}
                                  </Bar>
                               </BarChart>
                            </ResponsiveContainer>
                         ) : (
                            <div className="h-full overflow-y-auto custom-scrollbar">
                               <table className="w-full text-sm text-left">
                                  <tbody>
                                     {storeStats.fullBarData.map((d,i) => (
                                        <tr key={i} className={`cursor-pointer hover:bg-gray-50 ${selectedMid===d.name?'bg-green-50':''}`} onClick={()=>setSelectedMid(d.name===selectedMid?null:d.name)}>
                                           <td className="p-2 border-b text-xs text-gray-400">{i+1}</td>
                                           <td className="p-2 border-b">{d.name}</td>
                                           <td className="p-2 border-b text-right">{d.count}</td>
                                        </tr>
                                     ))}
                                  </tbody>
                               </table>
                            </div>
                         )}
                     </div>
                 </div>
             </div>

             {/* Store List */}
             <div className="bg-white rounded-xl shadow border overflow-hidden">
                <div className="p-4 bg-gray-50 border-b font-bold text-gray-700">📌 주요 점포 리스트 (Top 50)</div>
                <div className="overflow-x-auto max-h-96 custom-scrollbar">
                   <table className="w-full text-sm text-left whitespace-nowrap">
                      <thead className="bg-gray-100 text-gray-600 sticky top-0">
                         <tr><th className="p-3">상호명</th><th className="p-3">업종</th><th className="p-3">주소</th></tr>
                      </thead>
                      <tbody>
                         {topStores.map((s,i) => (
                            <tr key={i} className="hover:bg-gray-50 border-b last:border-0">
                               <td className="p-3 font-medium">
                                  {s.bizesNm}
                                  {s.brchNm && <span className="ml-2 text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{s.brchNm}</span>}
                                  {["1","1층"].includes(s.flrNo) && <span className="ml-1 text-xs bg-orange-100 text-orange-600 px-1 rounded">1F</span>}
                               </td>
                               <td className="p-3 text-gray-500">{s.indsMclsNm}</td>
                               <td className="p-3 text-gray-400 text-xs">{s.rdnmAdr}</td>
                            </tr>
                         ))}
                      </tbody>
                   </table>
                </div>
             </div>
         </div>
      )}

      {loading && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
             <div className="bg-white p-6 rounded-2xl shadow-2xl flex items-center gap-4">
                 <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                 <span className="font-bold text-gray-700">{loadingMsg}</span>
             </div>
          </div>
      )}
    </div>
  );
};

export default App;