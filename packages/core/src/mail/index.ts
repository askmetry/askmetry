// STUB – wird vom PDF-&-Mail-Agenten implementiert (Signaturen verbindlich, siehe HOSTED.md).
export interface MailAttachment { filename: string; content: Buffer; contentType?: string }
export interface MailMessage { to: string; subject: string; html: string; text: string; attachments?: MailAttachment[]; replyTo?: string }
export interface RenderedMail { subject: string; html: string; text: string }
type Lang = 'de' | 'en';

export async function sendMail(_m: MailMessage): Promise<void> { throw new Error('mail: noch nicht implementiert'); }

const stub = (): RenderedMail => { throw new Error('mail: noch nicht implementiert'); };
export const mailTemplates = {
  checkVerify: (_i: { lang: Lang; domain: string; verifyUrl: string }): RenderedMail => stub(),
  checkReady: (_i: { lang: Lang; domain: string; checkUrl: string; recommendationsTotal: number }): RenderedMail => stub(),
  reportReady: (_i: { lang: Lang; brandName: string; tierLabel: string; reportUrl: string; remeasure: boolean }): RenderedMail => stub(),
  remeasureReminder: (_i: { lang: Lang; brandName: string; buyUrl: string; optOutUrl: string; readyAt: Date }): RenderedMail => stub(),
  authVerify: (_i: { lang: Lang; url: string }): RenderedMail => stub(),
  authReset: (_i: { lang: Lang; url: string }): RenderedMail => stub(),
};
