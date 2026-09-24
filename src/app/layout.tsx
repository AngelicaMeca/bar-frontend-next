import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], weight: ["600", "700"] });

export const metadata: Metadata = {
  title: { default: "La Barra · Gestión", template: "%s · La Barra" },
  description: "Sistema de gestión integral para bares: salón, pedidos, cocina, caja, stock, reservas y reportes.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#151a2b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${jakarta.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
