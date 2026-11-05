// Mail-Versand und Vorlagen der gehosteten Version (siehe HOSTED.md, „Schnittstellen“).
//   import { sendMail, mailTemplates } from '@askmetry/core/mail/index';
//   await sendMail({ to, ...mailTemplates.reportReady({ lang, brandName, tierLabel, reportUrl, remeasure }), attachments: [{ filename, content, contentType: 'application/pdf' }] });
export { sendMail, maskEmail, extractLinks, isValidEmail, writeToOutbox, type MailAttachment, type MailMessage } from './send.ts';
export { mailTemplates, type RenderedMail } from './templates.ts';
export { escapeHtml, SENDER_LINE } from './layout.ts';
