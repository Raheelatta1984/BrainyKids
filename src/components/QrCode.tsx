"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Renders a QR code in the browser (no third-party network calls, so it keeps
 * working on a phone with no signal from the kid device's own screen).
 */
export default function QrCode({ value, size = 216 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1e2542", light: "#ffffff" },
    })
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setSrc(null);
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!src) {
    return <div className="qr-placeholder" style={{ width: size, height: size }} aria-hidden="true" />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img className="qr" src={src} width={size} height={size} alt="QR code to link this device" />;
}
