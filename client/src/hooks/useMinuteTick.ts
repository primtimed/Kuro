import { useEffect, useState } from "react";

const MINUTE_MS = 60_000;

/** A number that changes once a minute; use it to refresh things that update every minute. */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / MINUTE_MS));

  useEffect(() => {
    const timer = setInterval(() => setTick(Math.floor(Date.now() / MINUTE_MS)), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);

  return tick;
}
