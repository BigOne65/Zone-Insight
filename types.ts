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
  sgisCode?: string;        // SGIS 통계청 코드 (for Polygon)
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