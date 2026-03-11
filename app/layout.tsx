import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import "./globals.css";

const bodyFont = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space"
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"]
});

export const metadata: Metadata = {
  title: "Model Debate",
  description: "Source-grounded ADR and technical decision memos from local or private GitHub repos."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${bodyFont.variable} ${monoFont.variable} font-sans bg-background text-foreground`}>
        {children}
      </body>
    </html>
  );
}
