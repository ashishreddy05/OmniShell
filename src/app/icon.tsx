import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
          borderRadius: 8,
        }}
      >
        <span
          style={{
            color: "white",
            fontSize: 16,
            fontWeight: 700,
            fontFamily: "sans-serif",
            letterSpacing: -1,
            lineHeight: 1,
          }}
        >
          OS
        </span>
      </div>
    ),
    { ...size }
  );
}
