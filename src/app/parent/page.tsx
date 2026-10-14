import AppShell from "@/components/AppShell";

export const metadata = {
  title: "Parent dashboard | BrainyKids",
  robots: { index: false, follow: false },
};

/** Same shell as `/`: parents land on the dashboard, kids stay in kid mode. */
export default function ParentPage() {
  return <AppShell />;
}
