
export interface Coords {
  lat: number;
  lon: number;
}

export interface Zone {
  trarNo: string;
  mainTrarNm: string;
  trarArea: string;
  ctprvnNm: string;
  signguNm: string;
  coords: string;
  stdrYm?: string;
  stdrDt?: string;
  searchLat?: number;
  searchLon?: number;
  parsedPolygon?: number[][][];
  // New fields for Admin Analysis
  type?: 'trade' | 'admin'; // 'trade' = 주요상권, 'admin' = 행정구역
  adminCode?: string;       // 행정동 코드 or 시군구 코드
  adminLevel?: string;      // 'adongCd' or 'signguCd'
}

export interface Store {
  bizesNm: string;
  brchNm: string;
  indsLclsNm: string;
  indsMclsNm: string;
  bldNm: string;
  flrNo: string;
  rdnmAdr: string;
  lat: string;
  lon: string;
  stdrYm?: string;
  stdrDt?: string;
}

export interface ChartData {
  name: string;
  value: number;
  count?: number;
  ratio?: number;
  lat?: number;
  lon?: number;
}

export interface SummaryData {
  name: string;
  count: number;
  ratio: number;
  franchiseCount: number;
  franchiseRatio: number;
  firstFloorCount: number;
  firstFloorRatio: number;
  topMid: string;
}

export interface StoreStats {
  totalStores: number;
  pieData: ChartData[];
  barData: ChartData[];
  fullBarData: ChartData[];
  buildingData: ChartData[];
  floorData: ChartData[];
  franchiseRate: string;
  summaryTableData: SummaryData[];
}

// Sbiz API Data Types
export interface SbizStats {
  population: {
    total: string;
    date: string;
  } | null;
  maxSales: {
    type: string;
    amount: number;
    percent: number;
    date: string;
  } | null;
  delivery: {
    day: string;
    count: number;
    percent: number;
    date: string;
  } | null;
  ageRank: Array<{ age: string; count: number }> | null;
}

// Seoul Estimated Sales Data Types
export interface SeoulSalesData {
  stdrYearQuarter: string; // 기준 년분기 (예: 20231)
  serviceName?: string;    // 업종명 (전체일 경우 undefined 혹은 '전체')
  
  totalAmount: number;     // 당월 매출 금액
  totalCount: number;      // 당월 매출 건수
  
  // Weekday vs Weekend
  weekdayAmount: number;
  weekendAmount: number;
  weekdayCount: number;
  weekendCount: number;

  // Day of Week
  dayAmount: { [key: string]: number }; // MON, TUE...
  dayCount: { [key: string]: number };

  // Time Slot
  timeAmount: { [key: string]: number }; // 00_06, 06_11...
  timeCount: { [key: string]: number };

  // Gender
  genderAmount: { male: number; female: number };
  genderCount: { male: number; female: number };

  // Age
  ageAmount: { [key: string]: number }; // 10, 20...
  ageCount: { [key: string]: number };

  // 업종별 데이터 리스트 (메인 데이터에만 포함됨)
  byIndustry?: SeoulSalesData[];
}