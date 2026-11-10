import { PageSkeleton } from "@/components/layout/page-loading";

// One record: its summary beside its history, in outline while the data loads.
export default function Loading() {
  return <PageSkeleton variant="detail" />;
}
