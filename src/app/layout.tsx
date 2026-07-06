import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Value Bets CR",
  description: "Sistema personal de analisis de cuotas deportivas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
