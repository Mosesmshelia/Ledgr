// PDF: clean A4 report in the Ledgr design language. Inter is embedded because it has the ₦ sign
// (PDF's built-in Helvetica does not). Wide reports switch to landscape automatically.
import path from "node:path";
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import type { ReportData, Section, Row } from "./types";
import { formatCell, isNumeric } from "./format";
import { formatMoney, formatPercent } from "@/lib/finance/money";
import { formatDate, formatRange } from "@/lib/finance/periods";

let registered = false;
function registerFonts() {
  if (registered) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  Font.register({ family: "Inter", fonts: [
    { src: path.join(dir, "Inter-Regular.ttf"), fontWeight: 400 },
    { src: path.join(dir, "Inter-SemiBold.ttf"), fontWeight: 600 },
  ] });
  Font.registerHyphenationCallback((w) => [w]);
  registered = true;
}

const INK = "#1d1d1f", INK2 = "#6e6e73", INK3 = "#8e8e93", LINE = "#e5e5ea", ACCENT = "#0071e3", WARN = "#b25000", NEG = "#d70015", POS = "#1f8a4c";

const s = StyleSheet.create({
  page: { fontFamily: "Inter", fontSize: 8.5, color: INK, paddingTop: 36, paddingBottom: 44, paddingHorizontal: 36 },
  brand: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  logo: { width: 16, height: 16, borderRadius: 4, backgroundColor: ACCENT, color: "#fff", fontSize: 9, fontWeight: 600, textAlign: "center", paddingTop: 2.5, marginRight: 6 },
  title: { fontSize: 17, fontWeight: 600, marginBottom: 3 },
  meta: { flexDirection: "row", flexWrap: "wrap", color: INK2, fontSize: 8, marginBottom: 12 },
  metaItem: { marginRight: 12 },
  figures: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10, marginHorizontal: -3 },
  figure: { width: "33.33%", paddingHorizontal: 3, marginBottom: 6 },
  figureBox: { borderWidth: 0.75, borderColor: LINE, borderRadius: 6, padding: 7 },
  figLabel: { color: INK2, fontSize: 7.5 },
  figValue: { fontSize: 12.5, fontWeight: 600, marginTop: 2 },
  figSub: { color: INK3, fontSize: 7, marginTop: 1 },
  summary: { backgroundColor: "#f5f5f7", borderRadius: 6, padding: 9, marginBottom: 12 },
  summaryHead: { fontWeight: 600, marginBottom: 3 },
  summaryLine: { lineHeight: 1.35, marginBottom: 2 },
  sectionTitle: { fontSize: 10.5, fontWeight: 600, marginTop: 8, marginBottom: 5 },
  th: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: INK3, paddingBottom: 3.5, color: INK2, fontSize: 7.5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 3.5 },
  cell: { paddingRight: 5 },
  num: { textAlign: "right" },
  note: { color: INK2, fontSize: 7.5, marginTop: 5 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", color: INK3, fontSize: 7 },
});

function rowStyle(r: Row) {
  switch (r._style) {
    case "header": return { fontWeight: 600 as const, color: INK2, borderBottomWidth: 0, paddingTop: 8 };
    case "total": return { fontWeight: 600 as const, borderTopWidth: 0.75, borderTopColor: INK3 };
    case "grand": return { fontWeight: 600 as const, fontSize: 10, borderTopWidth: 1.5, borderTopColor: INK, paddingVertical: 5 };
    case "muted": return { color: INK2, fontSize: 7.5, borderBottomWidth: 0 };
    case "warning": return { color: WARN };
    default: return {};
  }
}

function SectionTable({ sec }: { sec: Section }) {
  const widths = sec.columns.map((c) => c.width ?? (c.type === "text" ? 2 : 1));
  const total = widths.reduce((a, w) => a + w, 0);
  const pct = (i: number) => `${(widths[i] / total) * 100}%`;
  const statement = sec.kind === "statement";
  const cells = (row: Row) => sec.columns.map((c, i) => (
    <Text key={c.key} style={[s.cell, { width: pct(i) }, isNumeric(c) ? s.num : {}, i === 0 && row._style === "indent" ? { paddingLeft: 10 } : {},
      c.type === "money" && typeof row[c.key] === "number" && (row[c.key] as number) < 0 && row._style === "grand" ? { color: NEG } : {}]}>
      {formatCell(c, row, { statement, exact: statement })}
    </Text>
  ));
  return (
    <View>
      {sec.title && <Text style={s.sectionTitle} minPresenceAhead={40}>{sec.title}</Text>}
      {sec.columns.some((c) => c.label) && (
        <View style={s.th} fixed={false}>
          {sec.columns.map((c, i) => <Text key={c.key} style={[s.cell, { width: pct(i) }, isNumeric(c) ? s.num : {}]}>{c.label}</Text>)}
        </View>
      )}
      {sec.rows.length === 0 && <Text style={[s.note, { marginTop: 4 }]}>Nothing to show for this period.</Text>}
      {sec.rows.map((row, i) => <View key={i} style={[s.tr, rowStyle(row)]} wrap={false}>{cells(row)}</View>)}
      {sec.totals && <View style={[s.tr, rowStyle({ _style: "total" })]} wrap={false}>{cells(sec.totals)}</View>}
      {sec.note && <Text style={s.note}>{sec.note}</Text>}
    </View>
  );
}

export function ReportPdf({ r }: { r: ReportData }) {
  const wide = r.sections.some((x) => x.columns.length > 7);
  const statusText = r.status === "complete" ? "Fully calculated" : r.status === "partial" ? "Some costs estimated" : "Some product costs missing";
  const generated = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(r.generatedAt));
  return (
    <Document title={`${r.title} · ${r.business}`} author="Ledgr" creator="Ledgr">
      <Page size="A4" orientation={wide ? "landscape" : "portrait"} style={s.page}>
        <View style={s.brand}><Text style={s.logo}>L</Text><Text style={{ fontWeight: 600 }}>{r.business}</Text></View>
        <Text style={s.title}>{r.title}</Text>
        <View style={s.meta}>
          <Text style={s.metaItem}>{r.asAt ? `As at ${formatDate(r.to, true)}` : formatRange(r.from, r.to)}</Text>
          <Text style={s.metaItem}>Currency: {r.currency === "NGN" ? "Naira (₦)" : r.currency}</Text>
          <Text style={s.metaItem}>Generated {generated}</Text>
          <Text style={[s.metaItem, { color: r.status === "complete" ? POS : WARN }]}>{statusText}</Text>
        </View>
        {r.statusNote && <Text style={[s.note, { color: WARN, marginTop: -6, marginBottom: 10 }]}>{r.statusNote}</Text>}
        {!!r.figures?.length && (
          <View style={s.figures}>
            {r.figures.map((f) => (
              <View key={f.label} style={[s.figure, { width: r.figures!.length === 4 ? "25%" : "33.33%" }]}>
                <View style={s.figureBox}>
                  <Text style={s.figLabel}>{f.label}</Text>
                  <Text style={[s.figValue, f.tone === "negative" ? { color: NEG } : f.tone === "warning" ? { color: WARN } : {}]}>
                    {f.value === null ? "—" : f.type === "money" ? formatMoney(f.value) : f.type === "pct" ? formatPercent(f.value, 1) : f.value.toLocaleString("en-NG")}
                  </Text>
                  {f.sub && <Text style={s.figSub}>{f.sub}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}
        {!!r.summary?.length && (
          <View style={s.summary} wrap={false}>
            <Text style={s.summaryHead}>In plain English</Text>
            {r.summary.map((line, i) => <Text key={i} style={s.summaryLine}>{line}</Text>)}
          </View>
        )}
        {r.sections.map((sec, i) => <SectionTable key={i} sec={sec} />)}
        <View style={s.footer} fixed>
          <Text>{r.business} · {r.title}</Text>
          <Text render={({ pageNumber, totalPages }) => `Ledgr · Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function toPDF(r: ReportData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ReportPdf r={r} />);
}
