import React, { useEffect, useRef } from 'react';

interface GoogleAdProps {
  className?: string;
  style?: React.CSSProperties;
  client?: string; // ca-pub-XXXX...
  slot: string;    // Ad Unit ID generated from AdSense Console
  format?: 'auto' | 'fluid' | 'rectangle';
  responsive?: string;
  layout?: 'display' | 'in-article';
}

declare global {
  interface Window {
    adsbygoogle: any[];
  }
}

const GoogleAd: React.FC<GoogleAdProps> = ({
  className = "",
  style = { display: 'block' },
  client = "ca-pub-4276127967714914", // Your Publisher ID
  slot,
  format = "auto",
  responsive = "true",
  layout = 'display'
}) => {
  const adRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    try {
      // Check if ad is already loaded in this slot to prevent duplicates in React Strict Mode
      if (adRef.current && adRef.current.innerHTML === "") {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }
    } catch (e) {
      console.error("AdSense error:", e);
    }
  }, []);

  // 개발 환경(Localhost)에서는 광고가 보이지 않을 수 있으므로 자리만 잡아주는 스타일 추가 가능
  return (
    <div className={`google-ad-container my-8 w-full flex justify-center bg-gray-50 ${className}`}>
        {/* 광고 라벨 (선택 사항) */}
        <div className="w-full text-center">
            <div className="text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Advertisement</div>
            <ins
                ref={adRef}
                className="adsbygoogle"
                style={style}
                data-ad-client={client}
                data-ad-slot={slot}
                data-ad-format={format}
                data-full-width-responsive={responsive}
            />
        </div>
    </div>
  );
};

export default GoogleAd;