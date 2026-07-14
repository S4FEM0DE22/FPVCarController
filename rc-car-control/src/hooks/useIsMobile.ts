"use client";

import { useEffect, useState } from "react";

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => {
      setIsMobile(window.innerWidth < 1024);
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return isMobile;
}