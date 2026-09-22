import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "SavePlace",
  description: "Evidence-first place saving from public social recommendations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
