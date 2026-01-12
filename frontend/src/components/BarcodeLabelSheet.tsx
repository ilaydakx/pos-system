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
          height: 18,
        });
      } catch {
        // barcode invalid olursa sessiz geç
      }
    }
  }, [labels]);

  const sheetStyle = useMemo((): React.CSSProperties => {
    return {
      background: "white",
    };
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

  const labelBoxStyle = useMemo((): React.CSSProperties => {
    return {
      width: `${ART56.labelW}mm`,
      height: `${ART56.labelH}mm`,
      border: "none",
      borderRadius: 0,
      padding: "2mm 2mm",
      boxSizing: "border-box",
      display: "grid",
      alignContent: "start",
      gap: 1,
      background: "transparent",
    };
  }, []);

  return (
    <>
      {/* print styles */}
      <style>
        {`
          @media print {
            /* sadece etiket sayfası gözüksün */
            body * { visibility: hidden !important; }
            #barcode-print-area, #barcode-print-area * { visibility: visible !important; }

            /* kaymayı azaltmak için browser default marginleri kapat */
            html, body { margin: 0 !important; padding: 0 !important; }

            #barcode-print-area {
              position: absolute;
              left: 0;
              top: 0;
              width: 210mm; /* A4 */
              background: white !important;
            }

            /* dekoratif border/radius vb. asla ölçü etkilemesin */
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
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.85 }}>
                    {showProductCode ? (code || "—") : ""}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 900 ,  letterSpacing: 0.3}}>
                    {showPrice ? (it.priceText || "") : ""}
                  </div>
                </div>
  

                {sizeColor && (
                  <div style={{ fontSize: 9.5, fontWeight: 700, opacity: 0.85 }}>{sizeColor}</div>
                )}

                <div style={{ display: "grid", justifyItems: "center", gap: 2, marginTop: "auto" }}>
                  <svg
                    ref={(el) => {
                      svgRefs.current[key] = el;
                    }}
                    style={{ width: "100%", height: 18 }}
                  />
                  <div
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      fontSize: 9.5,
                      fontWeight: 900,
                      letterSpacing: 1,
                    }}
                  >
                    {it.barcode}
                  </div>
                </div>
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