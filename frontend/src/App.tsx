import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Header from "./components/Header/Header";
import ScrollToTop from "./components/ScrollToTop";
import HomePage from "./pages/HomePage";
import LetterDetailPage from "./pages/LetterDetailPage";
import AboutPage from "./pages/AboutPage";
import ContactPage from "./pages/ContactPage";
import AdminLoginPage from "./pages/admin/AdminLoginPage";
import AdminDashboard from "./pages/admin/AdminDashboard";
import UploadLetterPage from "./pages/admin/UploadLetterPage";
import LetterReviewPage from "./pages/admin/LetterReviewPage";
import "./App.css";

function App() {
  return (
    <Router>
      <ScrollToTop />
      <Routes>
        {/* Admin routes - no header */}
        <Route path="/admin-login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/upload" element={<UploadLetterPage />} />
        <Route path="/admin/letters/:letterId" element={<LetterReviewPage />} />

        {/* Public routes - with header */}
        <Route
          path="/*"
          element={
            <main className="main-page-layout">
              <Header />
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/letter/:letterId" element={<LetterDetailPage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/contact" element={<ContactPage />} />
              </Routes>
            </main>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
