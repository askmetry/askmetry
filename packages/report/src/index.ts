// @askmetry/report – PDF-Bericht der gehosteten Version (siehe HOSTED.md).
import { buildReportModel, loadReportInput, loadWorkspaceInput, type ReportTier } from './data.ts';
import { renderModelPdf } from './pdf.tsx';
import type { Lang } from '@askmetry/core/present';

export * from './data.ts';
export { toPdfLogo, icoToPng, encodePng, loadBrandLogos, type PdfLogo } from './logos.ts';
export { parseGuide, loadGuide, guideFromCore, guidePath, type ReportGuide, type GuideBlock } from './guide.ts';
export { tierLabel } from './text.ts';
export { renderModelPdf } from './pdf.tsx';

/** PDF eines gekauften Berichts (report-Zeile mit collection_id). */
export async function renderReportPdf(reportId: string): Promise<Buffer> {
  return renderModelPdf(buildReportModel(await loadReportInput(reportId)));
}

/** PDF ohne report-Zeile aus der neuesten (oder angegebenen) abgeschlossenen Messung eines Arbeitsbereichs – Vorschau/CLI. */
export async function renderWorkspacePdf(slug: string, opts: { tier: ReportTier; collectionId?: string; previousCollectionId?: string; lang?: Lang; recs?: 'db' | 'rules' }): Promise<Buffer> {
  return renderModelPdf(buildReportModel(await loadWorkspaceInput(slug, opts)));
}
