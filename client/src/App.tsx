import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AccountProvider, useAccount } from "./context/AccountContext";
import { LibraryProvider } from "./context/LibraryContext";
import { ServicesProvider } from "./context/ServicesContext";
import { MediaModeProvider, useMediaMode } from "./context/MediaModeContext";
import { Navbar } from "./components/Navbar";
import { Home } from "./pages/Home";
import { TVHome } from "./pages/TVHome";
import { Detail } from "./pages/Detail";
import { Search } from "./pages/Search";
import { Library } from "./pages/Library";
import { Browse } from "./pages/Browse";
import { Watch } from "./pages/Watch";
import { ProfileSelect } from "./pages/ProfileSelect";
import { Settings } from "./pages/Settings";
import { useSpatialNav } from "./hooks/useSpatialNav";

function SpatialNav() {
  useSpatialNav();
  return null;
}

function HomeRoute() {
  const { mode } = useMediaMode();
  return mode === "tv" ? <TVHome /> : <Home />;
}

function AppRoutes() {
  const { account } = useAccount();

  if (!account) return <ProfileSelect />;

  return (
    <LibraryProvider>
      <ServicesProvider>
        <MediaModeProvider>
        <BrowserRouter>
          <SpatialNav />
          <Routes>
            <Route path="/watch/:id/:episode" element={<Watch />} />
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
                  </Routes>
                </>
              }
            />
          </Routes>
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
