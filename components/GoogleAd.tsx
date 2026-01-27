import React, { useEffect, useRef, useState } from 'react';

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
  client,
  slot,
  format = "horizontal", // Default set to 'horizontal' per user request
  responsive = "true",
  layout
}) => {
  const adRef = useRef<HTMLModElement>(null);
  const [isAdPushed, setIsAdPushed] = useState(false);
  
  // @ts-ignore
  // Safely access env to avoid undefined error
  const envClient = import.meta.env?.VITE_GOOGLE_ADSENSE_ID;
  const finalClient = client || envClient;

  useEffect(() => {
    // Prevent pushing multiple times for the same component instance
    if (isAdPushed) return;
    if (!finalClient) return;

    const element = adRef.current;
    if (!element) return;

    const pushAd = () => {
      try {
        // Double check innerHTML to be safe
        if (element && element.innerHTML === "") {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
          setIsAdPushed(true);
        }
      } catch (e) {
        console.error("AdSense error:", e);
      }
    };

    // If element already has width, push immediately
    if (element.offsetWidth > 0) {
        pushAd();
    } else {
        // Wait for element to have width (layout painted) to avoid "availableWidth=0" error
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentRect.width > 0) {
                    pushAd();
                    observer.disconnect();
                }
            }
        });
        
        observer.observe(element);
        
        return () => {
            observer.disconnect();
        };
    }
  }, [isAdPushed, slot, finalClient]);

  if (!finalClient) return null;

  return (
    <div className={`google-ad-container my-8 w-full flex justify-center bg-gray-50 rounded-lg overflow-hidden ${className}`}>
        {/* 광고 라벨 */}
        <div className="w-full text-center">
            <div className="text-[10px] text-gray-400 mb-1 uppercase tracking-wider">Advertisement</div>
            <ins
                ref={adRef}
                className="adsbygoogle"
                style={style}
                data-ad-client={finalClient}
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