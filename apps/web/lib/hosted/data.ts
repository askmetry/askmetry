import 'server-only';
// Einzige Stelle, über die die Web-App den Hosted-Kern für Checks und Berichte anspricht (Seiten, Actions, Routen).
export { getCheckView, submitCheckEmail, verifyCheckEmail } from '@askmetry/core/hosted/checks';
export { getReport, getReportPdf, reportsForWorkspace, startReport } from '@askmetry/core/hosted/reports';
