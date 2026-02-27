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
  gapMm: 0,
  labelW: 52.5,
  labelH: 21.2,
  pagePaddingMm: 0,
} as const;

const SAFE_TOP_MM = 0;      
const SAFE_BOTTOM_MM = 0;   
const ROWS_PER_PAGE = 13;   
const A4_W_MM = 210;
const A4_H_MM = 297;

export default function BarcodeLabelSheet({
  labels,
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
      paddingTop: `${SAFE_TOP_MM}mm`,
      paddingBottom: `${SAFE_BOTTOM_MM}mm`,
      paddingLeft: `${ART56.pagePaddingMm}mm`,
      paddingRight: `${ART56.pagePaddingMm}mm`,
      justifyContent: "left",
      alignContent: "start",
      background: "white",
      boxSizing: "border-box",
      width: `${A4_W_MM}mm`,
    };
  }, []);

  const labelBoxStyle = useMemo((): React.CSSProperties => {
    return {
      width: `${ART56.labelW}mm`,
      height: `${ART56.labelH}mm`,
      border: "none",
      borderRadius: 0,
      padding: "4mm 3mm 2mm 3mm", 
      boxSizing: "border-box",
      display: "grid",
      alignContent: "start",
      gap: 1,
      background: "transparent",
      overflow: "hidden",
    };
  }, []);

  const barcodeNumberStyle: React.CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 9.5,
    fontWeight: 900,
    letterSpacing: 1,
    whiteSpace: "nowrap",
  };

  // ✅ sayfalama: sayfa başına 13*4 = 52 etiket
  const labelsPerPage = ROWS_PER_PAGE * ART56.cols;
  const pages: LabelItem[][] = [];
  for (let i = 0; i < labels.length; i += labelsPerPage) {
    pages.push(labels.slice(i, i + labelsPerPage));
  }

  return (
    <>
      <style>
        {`
          @media print {
            @page { size: A4; margin: 0; }

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
        {pages.map((pageLabels, pageIdx) => (
          <div
            key={`page:${pageIdx}`}
            style={{
              width: `${A4_W_MM}mm`,
              height: `${A4_H_MM}mm`,
              background: "white",
              pageBreakAfter: pageIdx < pages.length - 1 ? "always" : "auto",
              breakAfter: pageIdx < pages.length - 1 ? "page" : "auto",
              overflow: "hidden",
            }}
          >
            <div style={gridStyle}>
              {pageLabels.map((it, idx) => {
                const globalIdx = pageIdx * labelsPerPage + idx;
                const key = keyFor(it, globalIdx);

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
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 8,
                        marginTop: "0.6mm", 
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 800, opacity: 0.85, paddingLeft: "3mm" }}>
                        {showProductCode ? (code || "—") : ""}
                      </div>

                      <div style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: 0.3, paddingRight: "3mm" }}>
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
                      <div style={barcodeNumberStyle}>{it.barcode}</div>
                    </div>
                  </div>
                );
              })}

              {labels.length === 0 && (
                <div style={{ padding: 12, opacity: 0.7 }}>
                  Etiket yok.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}