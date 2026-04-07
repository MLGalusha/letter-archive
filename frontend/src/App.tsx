import { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Header from "./components/Header/Header";
import ScrollToTop from "./components/ScrollToTop";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { HeaderDockProvider } from "./contexts/HeaderDockContext";
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

function App() {
  return (
    <ErrorBoundary>
    <Router>
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
                </HeaderDockProvider>
              </main>
            }
          />
        </Routes>
      </Suspense>
    </Router>
    </ErrorBoundary>
  );
}

export default App;
