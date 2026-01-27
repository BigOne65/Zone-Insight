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
  style = {},
  client = "ca-pub-4276127967714914", // Your Publisher ID
  slot,
  format = "horizontal",
  responsive = "true",
  layout
}) => {
  // Use a ref to track if the ad push has already happened to prevent double-push in Strict Mode
  const adPushedRef = useRef(false);
  
  // Detect Development Mode (Vite specific)
  // @ts-ignore
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    // Prevent pushing multiple times for the same component instance
    if (adPushedRef.current) return;

    try {
      // Safe push operation
      const adsbygoogle = window.adsbygoogle || [];
      adsbygoogle.push({});
      adPushedRef.current = true;
    } catch (e) {
      console.error("AdSense push error:", e);
    }
  }, [slot]); // Depend on slot to re-trigger if slot changes (though unlikely for static ad spots)

  return (
    <div 
      className={`google-ad-container my-8 w-full flex justify-center bg-gray-50 rounded-lg overflow-hidden ${className}`}
      // CLS Prevention: Minimum height to reserve space
      style={{ minHeight: '280px', ...style }} 
    >
        {/* 광고 라벨 */}
        <div className="w-full text-center">
            <div className="text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Advertisement</div>
            <ins
                className="adsbygoogle"
                style={{ display: 'block' }}
                data-ad-client={client}
                data-ad-slot={slot}
                data-ad-format={format}
                data-full-width-responsive={responsive}
                data-adtest={isDev ? "on" : "off"} // Show test ads in development
                {...(layout ? { 'data-ad-layout': layout } : {})}
            />
        </div>
    </div>
  );
};

export default GoogleAd;