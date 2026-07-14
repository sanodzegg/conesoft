import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/useAuth";
import { isPaidPlan } from "./store/useAuthStore";

import Homepage from './pages/homepage'
const Settings = lazy(() => import('./pages/settings'))
const FaviconConversion = lazy(() => import('./pages/favicons'))
const ImageEditor = lazy(() => import('./pages/image-editor'))
const BulkConverter = lazy(() => import('./pages/bulk-converter'))
const WebsiteScreenshot = lazy(() => import('./pages/website-screenshot'))
const WebsitePdf = lazy(() => import('./pages/website-pdf'))
const PdfMerge = lazy(() => import('./pages/pdf-merge'))
const Auth = lazy(() => import('./pages/auth'))
const Pricing = lazy(() => import('./pages/pricing'))
const SvgEditor = lazy(() => import('./pages/svg-editor'))
const BatchRename = lazy(() => import('./pages/batch-rename'))
const PaletteExtractor = lazy(() => import('./pages/palette-extractor'))
const ImageCompression = lazy(() => import('./pages/image-compression'))
const Lighthouse = lazy(() => import('./pages/lighthouse'))
const PdfEditor = lazy(() => import('./pages/pdf-editor'))
const ImagesToPdf = lazy(() => import('./pages/images-to-pdf'))
const PdfToImages = lazy(() => import('./pages/pdf-to-images'))
const PdfSplit = lazy(() => import('./pages/pdf-split'))
const PdfHub = lazy(() => import('./pages/pdf-hub'))
const PdfCompress = lazy(() => import('./pages/pdf-compress'))
const PdfPageNumbers = lazy(() => import('./pages/pdf-page-numbers'))
const PdfHeaderFooter = lazy(() => import('./pages/pdf-header-footer'))
const PdfSign = lazy(() => import('./pages/pdf-sign'))
const PdfCrop = lazy(() => import('./pages/pdf-crop'))

function ProRoute({ children }: { children: React.ReactNode }) {
  const { plan } = useAuth()
  if (plan === 'limited') return <Navigate to="/pricing" replace />
  return <>{children}</>
}

// Stricter than ProRoute: paid plans only (trial + limited both redirected). For features
// that aren't metered and are sold as Pro-only, e.g. the bulk converter. The nav item is
// also locked for non-paid plans (see navigation-secondary `paidOnly`); this guards direct
// URL access.
function PaidRoute({ children }: { children: React.ReactNode }) {
  const { plan } = useAuth()
  if (!isPaidPlan(plan)) return <Navigate to="/pricing" replace />
  return <>{children}</>
}

export default function Router() {
  return (
    <Suspense>
      <Routes>
          <Route index element={<Homepage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/extensions/favicon" element={<FaviconConversion />} />
          <Route path="/extensions/svg-editor" element={<SvgEditor />} />
          <Route path="/extensions/pdf-merge" element={<ProRoute><PdfMerge /></ProRoute>} />
          <Route path="/extensions/image-editor" element={<ImageEditor />} />
          <Route path="/extensions/bulk-converter" element={<PaidRoute><BulkConverter /></PaidRoute>} />
          <Route path="/extensions/batch-rename" element={<PaidRoute><BatchRename /></PaidRoute>} />
          <Route path="/extensions/palette-extractor" element={<PaletteExtractor />} />
          <Route path="/extensions/image-compression" element={<ImageCompression />} />
          <Route path="/extensions/website-screenshot" element={<ProRoute><WebsiteScreenshot /></ProRoute>} />
          <Route path="/extensions/website-pdf" element={<ProRoute><WebsitePdf /></ProRoute>} />
          <Route path="/extensions/lighthouse" element={<ProRoute><Lighthouse /></ProRoute>} />
          <Route path="/extensions/pdf" element={<ProRoute><PdfHub /></ProRoute>} />
          <Route path="/extensions/pdf-editor" element={<ProRoute><PdfEditor /></ProRoute>} />
          <Route path="/extensions/images-to-pdf" element={<ProRoute><ImagesToPdf /></ProRoute>} />
          <Route path="/extensions/pdf-to-images" element={<ProRoute><PdfToImages /></ProRoute>} />
          <Route path="/extensions/pdf-split" element={<ProRoute><PdfSplit /></ProRoute>} />
          <Route path="/extensions/pdf-compress" element={<ProRoute><PdfCompress /></ProRoute>} />
          <Route path="/extensions/pdf-page-numbers" element={<ProRoute><PdfPageNumbers /></ProRoute>} />
          <Route path="/extensions/pdf-header-footer" element={<ProRoute><PdfHeaderFooter /></ProRoute>} />
          <Route path="/extensions/pdf-sign" element={<ProRoute><PdfSign /></ProRoute>} />
          <Route path="/extensions/pdf-crop" element={<ProRoute><PdfCrop /></ProRoute>} />
          <Route path="/account" element={<Auth />} />
          <Route path="/pricing" element={<Pricing />} />
      </Routes>
    </Suspense>
  )
}
