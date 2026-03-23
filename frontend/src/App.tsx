import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import Header from "./components/Header/Header";
import ScrollToTop from "./components/ScrollToTop";
import { ErrorBoundary } from "./components/ErrorBoundary";
import HomePage from "./pages/HomePage";
import LetterDetailPage from "./pages/LetterDetailPage";
import AboutPage from "./pages/AboutPage";
import SupportPage from "./pages/SupportPage";
import CollectionsPage from "./pages/CollectionsPage";
import CollectionDetailPage from "./pages/CollectionDetailPage";
import UpdatesPage from "./pages/UpdatesPage";
import UpdateDetailPage from "./pages/UpdateDetailPage";
import NotFoundPage from "./pages/NotFoundPage";
import AdminLoginPage from "./pages/admin/AdminLoginPage";
import AcceptInvitePage from "./pages/admin/AcceptInvitePage";
import AdminDashboard from "./pages/admin/AdminDashboard";
import UploadLetterPage from "./pages/admin/UploadLetterPage";
import LetterReviewPage from "./pages/admin/LetterReviewPage";
import ProcessingQueuePage from "./pages/admin/ProcessingQueuePage";
import SettingsPage from "./pages/admin/SettingsPage";
import UsagePage from "./pages/admin/UsagePage";
import NotificationsPage from "./pages/admin/NotificationsPage";
import NotesPage from "./pages/admin/NotesPage";
import ContentPage from "./pages/admin/ContentPage";
import UpdateEditorPage from "./pages/admin/UpdateEditorPage";
import "./App.css";

function App() {
  return (
    <HelmetProvider>
    <ErrorBoundary>
    <Router>
      <ScrollToTop />
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
        <Route path="/admin/content/updates/new" element={<UpdateEditorPage />} />
        <Route path="/admin/content/updates/:id" element={<UpdateEditorPage />} />
        <Route path="/admin/usage" element={<UsagePage />} />
        <Route path="/admin/notifications" element={<NotificationsPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />

        {/* Letter detail - no main header (has its own header) */}
        <Route path="/letter/:letterId" element={<LetterDetailPage />} />

        {/* Public routes - with header */}
        <Route
          path="/*"
          element={
            <main className="main-page-layout">
              <Header />
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/support" element={<SupportPage />} />
                <Route path="/collections" element={<CollectionsPage />} />
                <Route path="/collections/:collectionCode" element={<CollectionDetailPage />} />
                <Route path="/updates" element={<UpdatesPage />} />
                <Route path="/updates/:slug" element={<UpdateDetailPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </main>
          }
        />
      </Routes>
    </Router>
    </ErrorBoundary>
    </HelmetProvider>
  );
}

export default App;
