import { SchedulePanel } from "../components/SchedulePanel";
import { useIsMobile } from "../hooks/useIsMobile";

export function Schedule() {
  const isMobile = useIsMobile();
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", padding: isMobile ? "20px 16px 64px" : "24px 32px 88px", maxWidth: 1000 }}>
      <SchedulePanel variant="page" />
    </main>
  );
}
