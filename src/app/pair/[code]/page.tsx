import PairApproval from "@/components/PairApproval";

export const metadata = {
  title: "Link a device | BrainyKids",
  robots: { index: false, follow: false },
};

/** Target of the QR code shown on a kid device waiting to be linked. */
export default async function PairPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PairApproval code={code.toUpperCase().replace(/[^0-9A-Z]/g, "")} />;
}
