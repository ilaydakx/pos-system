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

// A4 ölçüleri (mm)
const A4_W = 210;
const A4_H = 297;

// Yazıcı güvenli boşluk (mm) — alt satır boş kalsın diye
const SAFE_TOP = 10;
const SAFE_BOTTOM = 10;

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

  // Sayfaya sığan satır/etiket sayısı
  const rowsPerPage = Math.floor((A4_H - SAFE_TOP - SAFE_BOTTOM) / ART56.labelH);
  const labelsPerPage = rowsPerPage * ART56.cols;

  // labels -> pages
  const pages: LabelItem[][] = useMemo(() => {
    const out: LabelItem[][] = [];
    for (let i = 0; i < labels.length; i += labelsPerPage) {
      out.push(labels.slice(i, i + labelsPerPage));
    }
    return out;
  }, [labels, labelsPerPage]);

  // Barcode render (sayfalara bölünmüş key sistemi ile)
  useEffect(() => {
    const flatCount = labels.length;
    for (let i = 0; i < flatCount; i++) {
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
          height: 34, // px (etiket içinde stabil)
        });
      } catch {
        // sessiz geç
      }
    }
  }, [labels]);

  const sheetStyle = useMemo((): React.CSSProperties => ({ background: "white" }), []);

  const gridStyle = useMemo((): React.CSSProperties => {
    return {
      display: "grid",
      gridTemplateColumns: `repeat(${ART56.cols}, ${ART56.labelW}mm)`,
      gap: `${ART56.gapMm}mm`,
      paddingTop: `${SAFE_TOP}mm`,
      paddingBottom: `${SAFE_BOTTOM}mm`,
      paddingLeft: `${ART56.pagePaddingMm}mm`,
      paddingRight: `${ART56.pagePaddingMm}mm`,
      justifyContent: "left",
      alignContent: "start",
      background: "white",
      boxSizing: "border-box",
    };
  }, []);

  // Etiket kutusu: absolute layout için şart
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

  const codeStyle: React.CSSProperties = {
    position: "absolute",
    top: "1.6mm",
    left: "2mm",
    right: "26mm", // fiyat sağda dursun diye yer aç
    textAlign: "left",
    fontSize: 10,
    fontWeight: 800,
    opacity: 0.9,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
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
    bottom: "3.6mm", // barkod numarasına yer bırak
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
              width: `${A4_W}mm`,
              height: `${A4_H}mm`,
              background: "white",
              pageBreakAfter: pageIdx < pages.length - 1 ? "always" : "auto",
              breakAfter: pageIdx < pages.length - 1 ? "page" : "auto",
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
                    {/* Üst satır: Kod + Fiyat */}
                    {showProductCode ? <div style={codeStyle}>{code || "—"}</div> : null}
                    {showPrice ? <div style={priceStyle}>{it.priceText || ""}</div> : null}

                    {/* Opsiyonel size/color */}
                    {sizeColor ? <div style={sizeColorStyle}>{sizeColor}</div> : null}

                    {/* Barkod SVG */}
                    <div style={barcodeWrapStyle}>
                      <svg
                        ref={(el) => {
                          svgRefs.current[key] = el;
                        }}
                        style={{ width: "100%", height: 34 }}
                      />
                    </div>

                    {/* Barkod numarası (KALSIN) */}
                    <div style={barcodeNumberStyle}>{it.barcode}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {labels.length === 0 && (
          <div style={{ padding: 12, opacity: 0.7 }}>
            Etiket yok. Soldan ürün seç / bugün eklenenleri seç.
          </div>
        )}
      </div>
    </>
  );
}
