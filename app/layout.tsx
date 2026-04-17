import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navigation from "./components/Nav";



const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Finance OS",
  description: "Zero-Based Manual Budgeting",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-50 text-slate-900 min-h-screen`}>
        <div className="max-w-7xl mx-auto p-4 md:p-8">
            <Navigation />
            {children}
        </div>
      </body>
    </html>
  );
}