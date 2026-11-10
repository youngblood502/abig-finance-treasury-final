import { PageSkeleton } from "@/components/layout/page-loading";

// Shown in the page area while any page's data loads (Next.js wraps each page in a Suspense boundary with this as its fallback). The
// sidebar, header and bar stay in place. Pages for one record use the "detail" outline in their own loading.tsx.
export default function Loading() {
  return <PageSkeleton />;
}
