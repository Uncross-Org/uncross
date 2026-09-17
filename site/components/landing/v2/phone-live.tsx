"use client";

// The mobile dashboard inside a phone frame — the real /app at phone width,
// embedded and scaled, not a screenshot. The frame is the Schedule template's
// iPhone mockup; what shows on its screen is whatever the venue is doing now.
//
// The iframe is loaded only once the frame is near the viewport, so a visitor
// who never scrolls to it pays nothing for a second dashboard.

import { useEffect, useRef, useState } from "react";
import { IphoneMockup } from "@/components/ui/iphone-mockup";

// The width the dashboard is laid out at; the screen scales it to fit.
const SCREEN_W = 390;

export function PhoneLive({ ticker = "NVDAx", className = "" }: { ticker?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [box, setBox] = useState({ w: 312, h: 615 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  const scale = box.w / SCREEN_W;

  return (
    <div className={className}>
      <IphoneMockup>
        <div ref={ref} className="relative h-full w-full overflow-hidden bg-bg">
          {near ? (
            <iframe
              title={`Uncross dashboard, ${ticker}, live`}
              src={`/app?ticker=${ticker}`}
              loading="lazy"
              className="absolute top-0 left-0 origin-top-left border-0"
              style={{ width: SCREEN_W, height: Math.ceil(box.h / scale), transform: `scale(${scale})` }}
            />
          ) : (
            <div className="num flex h-full items-center justify-center text-[12px] text-muted">loading the live dashboard…</div>
          )}
        </div>
      </IphoneMockup>
    </div>
  );
}
