import { useEffect, useMemo, useRef } from "react";
import JsBarcode from "jsbarcode";

export type LabelItem = {
  barcode: string;
  title?: string;
  productCode?: string;
  priceText?: string;
  size?: string;
  color?: string;
};

const ART56 = {
  cols: 4,
  gapMm: 0, // 4 * 52.5 = 210mm (A4 width)
  labelW: 52.5,
  labelH: 21.2,
  pagePaddingMm: 0,
} as const;

export default function BarcodeLabelSheet({
  labels,
  cols: _cols,
  gapMm: _gapMm,
  labelWidthMm: _labelWidthMm,
  labelHeightMm: _labelHeightMm,
  pagePaddingMm: _pagePaddingMm,
  showProductCode,
  showPrice,
  showSizeColor,
}: {
  labels: LabelItem[];
  cols: number;
  gapMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  pagePaddingMm: number;
  showProductCode: boolean;
  showPrice: boolean;
  showSizeColor: boolean;
}) {
  const svgRefs = useRef<Record<string, SVGSVGElement | null>>({});

  const keyFor = (it: LabelItem, idx: number) => `${it.barcode}__${idx}`;

  // barcode render
  useEffect(() => {
    for (let i = 0; i < labels.length; i++) {
      const it = labels[i];
      const key = keyFor(it, i);
      const svg = svgRefs.current[key];
      if (!svg) continue;

      try {
        JsBarcode(svg, it.barcode, {
          format: "CODE128",
          displayValue: false,
          margin: 0,
          width: 1.2,
          height: 34, // px: daha stabil
        });
      } catch {
        // barcode invalid olursa sessiz geç
      }
    }
  }, [labels]);

  const sheetStyle = useMemo((): React.CSSProperties => {
    return { background: "white" };
  }, []);

  const gridStyle = useMemo((): React.CSSProperties => {
    return {
      display: "grid",
      gridTemplateColumns: `repeat(${ART56.cols}, ${ART56.labelW}mm)`,
      gap: `${ART56.gapMm}mm`,
      padding: `${ART56.pagePaddingMm}mm`,
      justifyContent: "left",
      alignContent: "start",
      background: "white",
      boxSizing: "border-box",
    };
  }, []);

  // ✅ EN ÖNEMLİ: relative + overflow hidden
  const labelBoxStyle = useMemo((): React.CSSProperties => {
    return {
      width: `${ART56.labelW}mm`,
      height: `${ART56.labelH}mm`,
      position: "relative",
      overflow: "hidden",
      border: "none",
      borderRadius: 0,
      padding: 0,
      boxSizing: "border-box",
      background: "transparent",
      WebkitPrintColorAdjust: "exact",
      printColorAdjust: "exact",
    };
  }, []);

  // ✅ Ürün kodu / fiyat / barkod alanlarını mm ile sabitle
  const codeStyle: React.CSSProperties = {
    position: "absolute",
    top: "1.6mm",
    left: "2mm",
    right: "2mm",
    textAlign: "left",
    fontSize: 10,
    fontWeight: 800,
    opacity: 0.9,
    whiteSpace: "nowrap",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  };

  const priceStyle: React.CSSProperties = {
    position: "absolute",
    top: "1.4mm",
    right: "2mm",
    textAlign: "right",
    fontSize: 12.5,
    fontWeight: 900,
    letterSpacing: 0.3,
    whiteSpace: "nowrap",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  };

  const sizeColorStyle: React.CSSProperties = {
    position: "absolute",
    top: "6.0mm",
    left: "2mm",
    right: "2mm",
    fontSize: 9.5,
    fontWeight: 700,
    opacity: 0.85,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const barcodeWrapStyle: React.CSSProperties = {
    position: "absolute",
    bottom: "3.6mm", // alttaki barkod numarasına yer bırak
    left: "2mm",
    right: "2mm",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  };

  const barcodeNumberStyle: React.CSSProperties = {
    position: "absolute",
    bottom: "1.2mm",
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 9.5,
    fontWeight: 900,
    letterSpacing: 1,
    whiteSpace: "nowrap",
  };

  return (
    <>
      {/* print styles */}
      <style>
        {`
          @media print {
            body * { visibility: hidden !important; }
            #barcode-print-area, #barcode-print-area * { visibility: visible !important; }

            html, body { margin: 0 !important; padding: 0 !important; }

            #barcode-print-area {
              position: absolute;
              left: 0;
              top: 0;
              width: 210mm;
              background: white !important;
            }

            #barcode-print-area .label {
              border: none !important;
              border-radius: 0 !important;
              box-shadow: none !important;
              background: transparent !important;
            }
          }
        `}
      </style>

      <div id="barcode-print-area" style={sheetStyle}>
        <div style={gridStyle}>
          {labels.map((it, idx) => {
            const key = keyFor(it, idx);
            const code = (it.productCode || "").trim();
            const size = (it.size || "").trim();
            const color = (it.color || "").trim();

            const sizeColor =
              showSizeColor && (size || color)
                ? [size ? `Beden: ${size}` : "", color ? `Renk: ${color}` : ""]
                    .filter(Boolean)
                    .join(" • ")
                : "";

            return (
              <div key={key} style={labelBoxStyle} className="label">
                {/* Ürün kodu */}
                {showProductCode ? (
                  <div style={codeStyle}>{code || "—"}</div>
                ) : null}

                {/* Fiyat */}
                {showPrice ? <div style={priceStyle}>{it.priceText || ""}</div> : null}

                {/* Beden/Renk (istersen kapalı kalır) */}
                {sizeColor ? <div style={sizeColorStyle}>{sizeColor}</div> : null}

                {/* Barkod */}
                <div style={barcodeWrapStyle}>
                  <svg
                    ref={(el) => {
                      svgRefs.current[key] = el;
                    }}
                    style={{ width: "100%", height: "10.5mm" }} // ✅ mm ile stabil
                  />
                </div>

                {/* Barkod numarası */}
                <div style={barcodeNumberStyle}>{it.barcode}</div>
              </div>
            );
          })}

          {labels.length === 0 && (
            <div style={{ padding: 12, opacity: 0.7 }}>
              Etiket yok. Soldan ürün seç / bugün eklenenleri seç.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
