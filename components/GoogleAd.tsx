import React, { useEffect, useRef } from 'react';

interface GoogleAdProps {
  className?: string;
  style?: React.CSSProperties;
  client?: string; // ca-pub-XXXX...
  slot: string;    // Ad Unit ID generated from AdSense Console
  format?: 'auto' | 'fluid' | 'rectangle' | 'horizontal' | 'vertical';
  responsive?: string;
  layout?: string;
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
  format = "horizontal", // Default set to 'horizontal' per user request
  responsive = "true",
  layout
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

  return (
    <div className={`google-ad-container my-8 w-full flex justify-center bg-gray-50 rounded-lg overflow-hidden ${className}`}>
        {/* 광고 라벨 */}
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
                {...(layout ? { 'data-ad-layout': layout } : {})}
            />
        </div>
    </div>
  );
};

export default GoogleAd;