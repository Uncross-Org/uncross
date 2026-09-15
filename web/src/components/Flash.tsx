import { useEffect, useRef, useState, type ReactNode } from "react";

/** Briefly highlights its content whenever `value` changes (not on first render). */
export function Flash({ value, children, className = "" }: { value: string; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setN((x) => x + 1);
    }
  }, [value]);
  return (
    <span key={n} className={`${className} ${n ? "flash" : ""}`}>
      {children}
    </span>
  );
}
