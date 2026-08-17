"use client";

import { useEffect, useState } from "react";

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => {
      const tabletWidth = window.innerWidth < 1180;
      const touchFirstDevice = window.matchMedia("(pointer: coarse)").matches;
      setIsMobile(tabletWidth || (touchFirstDevice && window.innerWidth <= 1366));
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isMobile;
}
