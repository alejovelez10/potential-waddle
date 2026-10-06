import { EmailTemplate } from './welcome.template';

export interface NotificationTemplateParams {
  subject: string;
  /** Small header line under the logo (e.g. "Binntu Admin — Notificación interna"). */
  eyebrow: string;
  title: string;
  intro: string;
  /** Label/value rows rendered in a grey box. Values are user-supplied → always escaped. */
  rows?: Array<[label: string, value: string | null | undefined]>;
  ctaUrl?: string;
  ctaLabel?: string;
  footer?: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Generic transactional email (admin alerts and owner notices) used by the freemium flows:
 * verification requests and Premium assisted onboarding.
 */
export const getNotificationTemplate = (params: NotificationTemplateParams): EmailTemplate => {
  const rows = (params.rows ?? [])
    .filter(([, value]) => !!value)
    .map(
      ([label, value]) => `
                    <p style="color: #374151; font-size: 15px; margin: 0 0 10px 0;">
                      <strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value))}
                    </p>`,
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(params.subject)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f4;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background-color: #ffffff; padding: 40px 30px 20px 30px; text-align: center; border-radius: 12px 12px 0 0;">
              <img src="https://beewo.s3.amazonaws.com/uploads/survey_answer/answer_file/1603390/c4a4440b-1d6d-4bf8-ac94-ef0ead8ebe5e.png" alt="Binntu" style="max-width: 180px; height: auto; margin-bottom: 10px;" />
              <p style="color: #10b981; margin: 10px 0 0 0; font-size: 16px; font-weight: 500;">${escapeHtml(params.eyebrow)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 24px;">${escapeHtml(params.title)}</h2>
              <p style="color: #4b5563; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">${escapeHtml(params.intro)}</p>
              ${
                rows
                  ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border-radius: 8px; margin: 0 0 25px 0;">
                <tr>
                  <td style="padding: 20px;">${rows}
                  </td>
                </tr>
              </table>`
                  : ''
              }
              ${
                params.ctaUrl && params.ctaLabel
                  ? `<div style="text-align: center; margin: 30px 0;">
                <a href="${encodeURI(params.ctaUrl)}" style="display: inline-block; background-color: #10b981; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: 600;">${escapeHtml(params.ctaLabel)}</a>
              </div>`
                  : ''
              }
              ${params.footer ? `<p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">${escapeHtml(params.footer)}</p>` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: params.subject, html };
};
