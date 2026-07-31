import { Suspense, lazy, useCallback } from "react";
import {
  createBrowserRouter,
  Route,
  RouterProvider,
  Routes,
} from "react-router-dom";
import Header from "./components/Header/Header";
import ScrollToTop from "./components/ScrollToTop";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { HeaderDockProvider } from "./contexts/HeaderDockContext";
import PageSwipeLayer from "./components/SwipeNavigation/PageSwipeLayer";
import { setAppScrollElement } from "./utils/appScroll";
import { layoutBenchmarkEnabled } from "./config/features";
import "./App.css";

const HomePage = lazy(() => import("./pages/HomePage"));
const LetterDetailPage = lazy(() => import("./pages/LetterDetailPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const SupportPage = lazy(() => import("./pages/SupportPage"));
const CollectionsPage = lazy(() => import("./pages/CollectionsPage"));
const CollectionDetailPage = lazy(() => import("./pages/CollectionDetailPage"));
const BlogPage = lazy(() => import("./pages/UpdatesPage"));
const BlogDetailPage = lazy(() => import("./pages/UpdateDetailPage"));
const PersonPage = lazy(() => import("./pages/PersonPage"));
const PlacePage = lazy(() => import("./pages/PlacePage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const AdminLoginPage = lazy(() => import("./pages/admin/AdminLoginPage"));
const AcceptInvitePage = lazy(() => import("./pages/admin/AcceptInvitePage"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const UploadLetterPage = lazy(() => import("./pages/admin/UploadLetterPage"));
const LetterReviewPage = lazy(() => import("./pages/admin/LetterReviewPage"));
const ProcessingQueuePage = lazy(() => import("./pages/admin/ProcessingQueuePage"));
const LayoutBenchmarkPage = lazy(() => import("./pages/admin/LayoutBenchmarkPage"));
const TranscriptAlignmentPage = lazy(() => import("./pages/admin/TranscriptAlignmentPage"));
const SettingsPage = lazy(() => import("./pages/admin/SettingsPage"));
const UsagePage = lazy(() => import("./pages/admin/UsagePage"));
const NotificationsPage = lazy(() => import("./pages/admin/NotificationsPage"));
const NotesPage = lazy(() => import("./pages/admin/NotesPage"));
const ContentPage = lazy(() => import("./pages/admin/ContentPage"));
const BlogEditorPage = lazy(() => import("./pages/admin/UpdateEditorPage"));
const AdminCollectionPage = lazy(() => import("./pages/admin/AdminCollectionPage"));
const BlockEditorPage = lazy(() => import("./pages/admin/BlockEditorPage"));

function RouteLoading() {
  return (
    <div className="body-layout">
      <p className="loading-message">Loading...</p>
    </div>
  );
}

function AppRoutes() {
  // Registers the public-site scroll container with the appScroll helper
  // module. See utils/appScroll.ts and the scroll-container refactor (#35)
  // for background on why scroll lives on a child div instead of window.
  const registerAppScroll = useCallback((node: HTMLDivElement | null) => {
    setAppScrollElement(node);
  }, []);

  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          {/* Admin login + invite - no layout */}
          <Route path="/admin-login" element={<AdminLoginPage />} />
          <Route path="/admin-invite" element={<AcceptInvitePage />} />

          {/* Admin routes - with sidebar layout */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/upload" element={<UploadLetterPage />} />
          <Route path="/admin/processing" element={<ProcessingQueuePage />} />
          {layoutBenchmarkEnabled && (
            <>
              <Route path="/admin/layout-benchmark" element={<LayoutBenchmarkPage />} />
              <Route
                path="/admin/layout-benchmark/alignment"
                element={<TranscriptAlignmentPage />}
              />
            </>
          )}
          <Route path="/admin/letters/:letterId" element={<LetterReviewPage />} />
          <Route path="/admin/notes" element={<NotesPage />} />
          <Route path="/admin/content" element={<ContentPage />} />
          <Route path="/admin/content/blog/new" element={<BlogEditorPage />} />
          <Route path="/admin/content/blog/:id" element={<BlogEditorPage />} />
          <Route path="/admin/content/pages/:slug" element={<BlockEditorPage />} />
          <Route path="/admin/collections/:code" element={<AdminCollectionPage />} />
          <Route path="/admin/usage" element={<UsagePage />} />
          <Route path="/admin/notifications" element={<NotificationsPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />

          {/* Public routes - with header */}
          <Route
            path="/*"
            element={
              <main className="main-page-layout public-site-shell">
                <HeaderDockProvider>
                  <Header />
                  <div id="app-scroll" ref={registerAppScroll}>
                    <PageSwipeLayer>
                    <div id="main-content">
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/about" element={<AboutPage />} />
                      <Route path="/support" element={<SupportPage />} />
                      <Route path="/collections" element={<CollectionsPage />} />
                      <Route path="/collections/:collectionCode" element={<CollectionDetailPage />} />
                      <Route path="/blog" element={<BlogPage />} />
                      <Route path="/blog/:slug" element={<BlogDetailPage />} />
                      <Route path="/people/:personId" element={<PersonPage />} />
                      <Route path="/places/:placeId" element={<PlacePage />} />
                      <Route path="/letter/:letterId" element={<LetterDetailPage />} />
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                    </div>
                    </PageSwipeLayer>
                  </div>
                </HeaderDockProvider>
              </main>
            }
          />
        </Routes>
      </Suspense>
    </>
  );
}

const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    ),
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
