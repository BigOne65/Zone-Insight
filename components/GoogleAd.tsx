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
  const elementRef = useRef<HTMLModElement>(null);
  
  // Detect Development Mode (Vite specific)
  // Check if import.meta and import.meta.env exist to prevent runtime errors
  // @ts-ignore
  const isDev = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env.DEV : false;

  useEffect(() => {
    // Prevent pushing multiple times for the same component instance
    if (adPushedRef.current) return;

    // Function to safely push the ad
    const pushAd = () => {
      try {
        // Double check if the element exists and has width to avoid "No slot size for availableWidth=0" error
        if (elementRef.current && elementRef.current.offsetWidth > 0) {
           const adsbygoogle = window.adsbygoogle || [];
           adsbygoogle.push({});
           adPushedRef.current = true;
        } else {
           // If width is still 0, retry once after a short delay or just log/ignore
           // Retrying via a recursive setTimeout could be risky if it never gets width, so we try once more after a longer delay.
           setTimeout(() => {
               if (!adPushedRef.current && elementRef.current && elementRef.current.offsetWidth > 0) {
                    try {
                        const adsbygoogle = window.adsbygoogle || [];
                        adsbygoogle.push({});
                        adPushedRef.current = true;
                    } catch(e) { console.error("AdSense retry error:", e); }
               }
           }, 500);
        }
      } catch (e) {
        console.error("AdSense push error:", e);
      }
    };

    // Delay push to ensure DOM is fully painted and has dimensions
    // This is crucial for React's conditional rendering where layout might happen slightly after mount
    const timer = setTimeout(pushAd, 200);

    return () => clearTimeout(timer);
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
                ref={elementRef}
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