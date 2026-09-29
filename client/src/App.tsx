import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AccountProvider, useAccount } from "./context/AccountContext";
import { LibraryProvider } from "./context/LibraryContext";
import { ServicesProvider } from "./context/ServicesContext";
import { MediaModeProvider, useMediaMode } from "./context/MediaModeContext";
import { Navbar } from "./components/Navbar";
import { Home } from "./pages/Home";
import { TVHome } from "./pages/TVHome";
import { ProfileSelect } from "./pages/ProfileSelect";
import { SignIn } from "./pages/SignIn";
import { useSpatialNav } from "./hooks/useSpatialNav";

// Home pages load with the app; everything else downloads when first opened, which keeps
// the video player (hls.js) and large pages out of the initial bundle.
const Detail = lazy(() => import("./pages/Detail").then((m) => ({ default: m.Detail })));
const Search = lazy(() => import("./pages/Search").then((m) => ({ default: m.Search })));
const Library = lazy(() => import("./pages/Library").then((m) => ({ default: m.Library })));
const Browse = lazy(() => import("./pages/Browse").then((m) => ({ default: m.Browse })));
const Watch = lazy(() => import("./pages/Watch").then((m) => ({ default: m.Watch })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
const LiveTV = lazy(() => import("./pages/LiveTV").then((m) => ({ default: m.LiveTV })));
const LiveWatch = lazy(() => import("./pages/LiveWatch").then((m) => ({ default: m.LiveWatch })));
const Invite = lazy(() => import("./pages/Invite").then((m) => ({ default: m.Invite })));
const Pair = lazy(() => import("./pages/Pair").then((m) => ({ default: m.Pair })));

function PageFallback() {
  return <div style={{ minHeight: "100vh", background: "var(--bg)" }} />;
}

function SpatialNav() {
  useSpatialNav();
  return null;
}

function HomeRoute() {
  const { mode } = useMediaMode();
  return mode === "tv" ? <TVHome /> : <Home />;
}

function OfflineScreen() {
  return (
    <main role="alert" style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 16, textAlign: "center" }}>
      <p style={{ margin: 0, fontSize: 16, color: "var(--muted)" }}>Can't reach the Kuro server right now.</p>
      <button onClick={() => window.location.reload()} data-tv-autofocus style={{
        minHeight: 44, padding: "0 20px", borderRadius: 8, fontSize: 14, fontWeight: 600,
        background: "var(--accent)", color: "var(--text)", border: "none",
      }}>
        Try again
      </button>
    </main>
  );
}

function AppRoutes() {
  const { status } = useAccount();

  if (status === "loading") return <PageFallback />;
  if (status === "offline") return <OfflineScreen />;
  if (status === "signedOut") {
    return (
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/invite/:token" element={<Invite />} />
            <Route path="*" element={<SignIn />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    );
  }

  return (
    <LibraryProvider>
      <ServicesProvider>
        <MediaModeProvider>
        <BrowserRouter>
          <SpatialNav />
          <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/watch/:id/:episode" element={<Watch />} />
            <Route path="/live/:id" element={<LiveWatch />} />
            <Route path="/invite/:token" element={<Invite />} />
            <Route path="/profiles" element={<ProfileSelect />} />
            <Route
              path="/*"
              element={
                <>
                  <Navbar />
                  <Routes>
                    <Route path="/" element={<HomeRoute />} />
                    <Route path="/title/:id" element={<Detail />} />
                    <Route path="/search" element={<Search />} />
                    <Route path="/library" element={<Library />} />
                    <Route path="/browse" element={<Browse />} />
                    <Route path="/browse/:category" element={<Browse />} />
                    <Route path="/browse/service/:serviceId" element={<Browse />} />
                    <Route path="/genre/:genre" element={<Browse />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/live" element={<LiveTV />} />
                    <Route path="/pair" element={<Pair />} />
                  </Routes>
                </>
              }
            />
          </Routes>
          </Suspense>
        </BrowserRouter>
        </MediaModeProvider>
      </ServicesProvider>
    </LibraryProvider>
  );
}

export function App() {
  return (
    <AccountProvider>
      <AppRoutes />
    </AccountProvider>
  );
}
