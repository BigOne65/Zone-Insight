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
}

const TradeMap: React.FC<MapProps> = ({ lat, lon, polygonCoords, tradeName, draggable, onDragEnd, markers = [], selectedMarkerIndex }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const polygonLayerRef = useRef<any>(null);
    const markerRef = useRef<any>(null);
    const extraMarkersRef = useRef<any>(null);

    const L = window.L;

    const refreshMap = () => {
        const map = mapInstanceRef.current;
        if (map) {
            map.invalidateSize();
            if (polygonLayerRef.current) {
                map.fitBounds(polygonLayerRef.current.getBounds());
            } else if (markerRef.current) {
                map.panTo(markerRef.current.getLatLng());
            } else {
                map.panTo([lat, lon]);
            }
        }
    };

    useEffect(() => {
        if (!mapRef.current || !L) return;

        if (!mapInstanceRef.current) {
            mapInstanceRef.current = L.map(mapRef.current).setView([lat, lon], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(mapInstanceRef.current);
            extraMarkersRef.current = L.layerGroup().addTo(mapInstanceRef.current);
        } else {
            if (!draggable) mapInstanceRef.current.setView([lat, lon], 15);
        }

        const map = mapInstanceRef.current;

        // Main Marker or Polygon
        if (markerRef.current) {
            markerRef.current.remove();
            markerRef.current = null;
        }

        if (polygonCoords && polygonCoords.length > 0) {
            if (polygonLayerRef.current) map.removeLayer(polygonLayerRef.current);
            try {
                const polygon = L.polygon(polygonCoords, {
                    color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.1, weight: 2
                }).addTo(map);
                polygonLayerRef.current = polygon;
                map.fitBounds(polygon.getBounds());
            } catch (e) {
                console.error("Polygon error:", e);
            }
        } else {
            if (polygonLayerRef.current) {
                map.removeLayer(polygonLayerRef.current);
                polygonLayerRef.current = null;
            }
            const marker = L.marker([lat, lon], { draggable: !!draggable }).addTo(map);
            if (tradeName) marker.bindPopup(tradeName).openPopup();
            
            if (draggable && onDragEnd) {
                marker.on('dragend', function(event: any) {
                    const pos = event.target.getLatLng();
                    onDragEnd(pos.lat, pos.lng);
                });
            }
            markerRef.current = marker;
            if(!draggable) map.setView([lat, lon], 15);
        }

        // Extra Markers (Top buildings)
        if (extraMarkersRef.current) extraMarkersRef.current.clearLayers();

        if (markers && markers.length > 0) {
            markers.forEach((m, idx) => {
                if (m.lat && m.lon) {
                    const iconHtml = `<div style="background-color: #ef4444; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: pointer;">${idx + 1}</div>`;
                    const customIcon = L.divIcon({
                        className: 'custom-div-icon',
                        html: iconHtml,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });
                    const marker = L.marker([m.lat, m.lon], { icon: customIcon })
                        .bindPopup(`<div style="text-align:center;">
                            <b style="color:#ef4444;">상가밀집 ${idx + 1}위</b><br>
                            <b>${m.name}</b><br>
                            <span style="color:#666;">(점포 ${m.count}개)</span>
                        </div>`);
                    
                    extraMarkersRef.current.addLayer(marker);
                    
                    if (selectedMarkerIndex === idx) {
                        setTimeout(() => marker.openPopup(), 100);
                    }
                }
            });
        }

        setTimeout(refreshMap, 300);

    }, [lat, lon, polygonCoords, tradeName, draggable, markers, L, selectedMarkerIndex]);

    return <div ref={mapRef} className="w-full h-full min-h-[100px]" />;
};

export default TradeMap;