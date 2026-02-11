import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Header from "./components/Header/Header";
import ScrollToTop from "./components/ScrollToTop";
import AdminLayout from "./components/AdminLayout";
import HomePage from "./pages/HomePage";
import LetterDetailPage from "./pages/LetterDetailPage";
import AboutPage from "./pages/AboutPage";
import ContactPage from "./pages/ContactPage";
import CollectionsPage from "./pages/CollectionsPage";
import CollectionDetailPage from "./pages/CollectionDetailPage";
import PersonPage from "./pages/PersonPage";
import PlacePage from "./pages/PlacePage";
import ExplorePage from "./pages/ExplorePage";
import AdminLoginPage from "./pages/admin/AdminLoginPage";
import AdminDashboard from "./pages/admin/AdminDashboard";
import UploadLetterPage from "./pages/admin/UploadLetterPage";
import LetterReviewPage from "./pages/admin/LetterReviewPage";
import EntityReviewPage from "./pages/admin/EntityReviewPage";
import PeoplePage from "./pages/admin/PeoplePage";
import PlacesPage from "./pages/admin/PlacesPage";
import RelationshipsPage from "./pages/admin/RelationshipsPage";
import ProcessingQueuePage from "./pages/admin/ProcessingQueuePage";
import "./App.css";

function App() {
  return (
    <Router>
      <ScrollToTop />
      <Routes>
        {/* Admin login - no layout */}
        <Route path="/admin-login" element={<AdminLoginPage />} />

        {/* Admin routes - with sidebar layout */}
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/upload" element={<AdminLayout title="Upload Letters"><UploadLetterPage /></AdminLayout>} />
        <Route path="/admin/processing" element={<AdminLayout title="Processing Queue"><ProcessingQueuePage /></AdminLayout>} />
        <Route path="/admin/letters/:letterId" element={<LetterReviewPage />} />
        <Route path="/admin/entities/review" element={<AdminLayout title="Entity Review"><EntityReviewPage /></AdminLayout>} />
        <Route path="/admin/entities/people" element={<AdminLayout title="People"><PeoplePage /></AdminLayout>} />
        <Route path="/admin/entities/places" element={<AdminLayout title="Places"><PlacesPage /></AdminLayout>} />
        <Route path="/admin/entities/relationships" element={<AdminLayout title="Relationships"><RelationshipsPage /></AdminLayout>} />

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
                <Route path="/contact" element={<ContactPage />} />
                <Route path="/collections" element={<CollectionsPage />} />
                <Route path="/collections/:collectionCode" element={<CollectionDetailPage />} />
                <Route path="/people/:personId" element={<PersonPage />} />
                <Route path="/places/:placeId" element={<PlacePage />} />
                <Route path="/explore" element={<ExplorePage />} />
              </Routes>
            </main>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
