import React, { useEffect, useRef } from 'react';
import { ChartData } from '../types';

declare global {
  interface Window {
    L: any;
  }
}

interface MapProps {
  lat: number;
  lon: number;
  polygonCoords?: number[][][];
  tradeName?: string;
  draggable?: boolean;
  onDragEnd?: (lat: number, lon: number) => void;
  markers?: ChartData[];
  selectedMarkerIndex?: number | null;
  onMarkerClick?: (index: number) => void;
}

const TradeMap: React.FC<MapProps> = ({ lat, lon, polygonCoords, tradeName, draggable, onDragEnd, markers = [], selectedMarkerIndex, onMarkerClick }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const polygonLayerRef = useRef<any>(null);
    const markerRef = useRef<any>(null);
    const extraMarkersRef = useRef<any>(null);

    // 1. 지도 초기화 및 형상(Polygon/Main Marker) 관리 - 줌 레벨 변경 발생
    useEffect(() => {
        const L = window.L;
        if (!mapRef.current || !L) return;

        // 지도 인스턴스 초기화
        if (!mapInstanceRef.current) {
            mapInstanceRef.current = L.map(mapRef.current).setView([lat, lon], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapInstanceRef.current);
            
            // 마커 레이어 그룹 생성
            extraMarkersRef.current = L.layerGroup().addTo(mapInstanceRef.current);
        } else {
            // draggable 모드가 아닐 때만 view 업데이트 (검색 시)
            // 상권 분석 모드(polygon 존재)일 때는 fitBounds가 아래에서 처리하므로 여기서 setView 안함
            if (!draggable && (!polygonCoords || polygonCoords.length === 0)) {
                mapInstanceRef.current.setView([lat, lon], 15);
            }
        }

        const map = mapInstanceRef.current;

        // 메인 마커 (검색 위치)
        if (markerRef.current) {
            markerRef.current.remove();
            markerRef.current = null;
        }

        // 폴리곤 처리
        if (polygonCoords && polygonCoords.length > 0) {
            if (polygonLayerRef.current) map.removeLayer(polygonLayerRef.current);
            try {
                const polygon = L.polygon(polygonCoords, {
                    color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 2
                }).addTo(map);
                polygonLayerRef.current = polygon;
                
                // 폴리곤이 변경되었을 때만 영역 맞춤 (줌 레벨 변경됨)
                map.invalidateSize();
                map.fitBounds(polygon.getBounds());
            } catch (e) {
                console.error("Polygon error:", e);
            }
        } else {
            // 폴리곤 제거
            if (polygonLayerRef.current) {
                map.removeLayer(polygonLayerRef.current);
                polygonLayerRef.current = null;
            }
            
            // 메인 마커 추가
            const marker = L.marker([lat, lon], { draggable: !!draggable }).addTo(map);
            if (tradeName) marker.bindPopup(tradeName).openPopup();
            
            if (draggable && onDragEnd) {
                marker.on('dragend', function(event: any) {
                    const pos = event.target.getLatLng();
                    onDragEnd(pos.lat, pos.lng);
                });
            }
            markerRef.current = marker;
        }
    }, [lat, lon, polygonCoords, tradeName, draggable, onDragEnd]); 
    // 주의: markers나 selectedMarkerIndex는 이 useEffect의 의존성 배열에서 제외하여 줌 리셋 방지

    // 2. 추가 마커(빌딩 순위) 관리 - 줌 레벨 변경 없음 (Repaint Only)
    useEffect(() => {
        const L = window.L;
        const map = mapInstanceRef.current;
        const layerGroup = extraMarkersRef.current;

        if (!map || !layerGroup || !L) return;

        // 기존 마커 제거
        layerGroup.clearLayers();

        if (markers && markers.length > 0) {
            markers.forEach((m, idx) => {
                if (m.lat && m.lon) {
                    const isSelected = selectedMarkerIndex === idx;
                    const bgColor = isSelected ? '#3b82f6' : '#ef4444';
                    
                    const iconHtml = `<div style="background-color: ${bgColor}; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: pointer;">${idx + 1}</div>`;
                    
                    const customIcon = L.divIcon({
                        className: 'custom-div-icon',
                        html: iconHtml,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });
                    
                    const marker = L.marker([m.lat, m.lon], { 
                        icon: customIcon,
                        zIndexOffset: isSelected ? 1000 : 0 
                    })
                        .bindPopup(`<div style="text-align:center;">
                            <b style="color:${bgColor};">상가밀집 ${idx + 1}위</b><br>
                            <b>${m.name}</b><br>
                            <span style="color:#666;">(점포 ${m.count}개)</span>
                        </div>`);
                    
                    marker.on('click', () => {
                        if (onMarkerClick) {
                            onMarkerClick(idx);
                        }
                    });

                    layerGroup.addLayer(marker);
                    
                    if (isSelected) {
                        // 팝업만 열고 map.setView나 fitBounds는 호출하지 않음으로써 현재 줌 상태 유지
                        setTimeout(() => marker.openPopup(), 100);
                    }
                }
            });
        }
    }, [markers, selectedMarkerIndex, onMarkerClick]);

    return <div ref={mapRef} className="w-full h-full min-h-[100px]" />;
};

export default TradeMap;